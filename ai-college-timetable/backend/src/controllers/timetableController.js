
import { sampleCollegeData } from "../data/sampleData.js";

import { generateTimetable } from "../services/solverService.js";

import { validateTimetable } from "../services/validatorService.js";

import {
    extractTimetableRequirements,
    extractModificationRequest,
    testGemini
} from "../services/llmService.js";

import { buildSolverData } from "../services/aiTimetableService.js";

import {
    applyTimetableModification
} from "../services/modificationService.js";


/*
=========================================================
GEMINI API TEST
GET /api/timetable/gemini-test
=========================================================
*/
export async function geminiTest(req, res) {
    try {
        const result = await testGemini();

        return res.json({
            success: true,
            message: result
        });
    } catch (error) {
        console.error("Gemini test error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Gemini API test failed."
        });
    }
}


/*
=========================================================
NORMAL TEST TIMETABLE
GET /api/timetable/generate-test
=========================================================
*/
export async function generate(req, res) {
    try {
        const timetable = await generateTimetable(sampleCollegeData);

        const validation = validateTimetable(
            timetable,
            sampleCollegeData
        );

        return res.json({
            success: true,
            message: "Timetable generated successfully.",
            timetable,
            validation
        });
    } catch (error) {
        console.error("Timetable generation error:", error);

        return res.status(500).json({
            success: false,
            message: error.message || "Timetable generation failed."
        });
    }
}


/*
=========================================================
AI TIMETABLE GENERATION
POST /api/timetable/generate-ai

Request:
{
    "prompt": "Generate a timetable for CSE-A"
}

Gemini understands the prompt.
OR-Tools generates the timetable.
Validator checks the result.
=========================================================
*/

export async function generateWithAI(req, res) {
    try {
        const {
            prompt,
            teacherWorkloads = {}
        } = req.body;

        // Validate the prompt.
        if (typeof prompt !== "string" || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                message: "Please enter a timetable prompt."
            });
        }

        // Validate workload input.
        if (
            !teacherWorkloads ||
            typeof teacherWorkloads !== "object" ||
            Array.isArray(teacherWorkloads)
        ) {
            return res.status(400).json({
                success: false,
                message: "teacherWorkloads must be an object."
            });
        }

        const knownTeacherIds = new Set(
            sampleCollegeData.teachers.map(teacher => teacher.id)
        );

        for (const [teacherId, value] of Object.entries(teacherWorkloads)) {
            const workload = Number(value);

            if (!knownTeacherIds.has(teacherId)) {
                return res.status(400).json({
                    success: false,
                    message: `Unknown teacher ID: ${teacherId}`
                });
            }

            if (
                value === "" ||
                !Number.isInteger(workload) ||
                workload < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        `Workload for ${teacherId} must be a ` +
                        "non-negative whole number."
                });
            }
        }

        // Apply the user-provided weekly maximum for each teacher.
        const collegeData = {
            ...sampleCollegeData,
            teachers: sampleCollegeData.teachers.map(teacher => ({
                ...teacher,
                weeklyWorkload:
                    Object.hasOwn(teacherWorkloads, teacher.id)
                        ? Number(teacherWorkloads[teacher.id])
                        : teacher.weeklyWorkload
            }))
        };

        // Gemini interprets the prompt using the supplied teacher limits.
        const aiRequirements = await extractTimetableRequirements(
            prompt,
            collegeData
        );

        // Convert the requirements into solver input.
        const solverData = buildSolverData(
            aiRequirements,
            collegeData
        );

        // OR-Tools generates the timetable.
        const timetable = await generateTimetable(solverData);

        // Independently validate the timetable.
        const validation = validateTimetable(
            timetable,
            solverData
        );

        if (!validation.valid) {
            return res.status(422).json({
                success: false,
                message: "The generated timetable failed validation.",
                aiRequirements,
                timetable,
                validation
            });
        }

        return res.json({
            success: true,
            message: "Timetable generated successfully.",
            aiRequirements,
            teacherWorkloads,
            timetable,
            validation
        });

    } catch (error) {
        console.error("AI timetable generation error:", error);

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Timetable generation failed."
        });
    }
}


/*
=========================================================
TIMETABLE MODIFICATION
POST /api/timetable/modify

There are two modes:

1. With a "modification" object:
   Does not call Gemini. Useful when the Gemini quota is
   exhausted.

2. Without a "modification" object:
   Asks Gemini to interpret the natural-language prompt.

Both modes apply and validate the change.
=========================================================
*/
export async function modifyWithAI(req, res) {
    try {
        // IMPORTANT: Declare suppliedModification here.
        const {
            prompt,
            currentTimetable,
            aiRequirements,
            modification: suppliedModification
        } = req.body;

        // Validate the prompt.
        if (
            typeof prompt !== "string" ||
            !prompt.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "prompt is required."
            });
        }

        // Validate the existing timetable.
        if (!Array.isArray(currentTimetable)) {
            return res.status(400).json({
                success: false,
                message: "currentTimetable must be an array."
            });
        }

        if (currentTimetable.length === 0) {
            return res.status(400).json({
                success: false,
                message:
                    "currentTimetable cannot be empty. " +
                    "Send the full timetable from your latest API response."
            });
        }

        // Validate AI requirements.
        if (
            !aiRequirements ||
            !Array.isArray(aiRequirements.classes) ||
            aiRequirements.classes.length === 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "aiRequirements.classes must contain the class requirements."
            });
        }

        // Step 1: Rebuild the solver configuration.
        const solverData = buildSolverData(
            aiRequirements,
            sampleCollegeData
        );

        let modification;

        // Step 2: Use supplied instructions when available.
        // This path does NOT call Gemini.
        if (suppliedModification !== undefined) {
            if (
                !suppliedModification ||
                typeof suppliedModification !== "object" ||
                Array.isArray(suppliedModification)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "modification must be a JSON object."
                });
            }

            modification = suppliedModification;

            // Check essential fields before applying the change.
            const requiredFields = [
                "className",
                "subjectName",
                "fromDay",
                "fromPeriod",
                "targetDay",
                "targetPeriod"
            ];

            const missingFields = requiredFields.filter(
                (field) =>
                    modification[field] === undefined ||
                    modification[field] === null ||
                    modification[field] === ""
            );

            if (missingFields.length > 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Missing modification fields: " +
                        missingFields.join(", ")
                });
            }

            if (
                !Number.isInteger(modification.fromPeriod) ||
                !Number.isInteger(modification.targetPeriod)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "fromPeriod and targetPeriod must be integers."
                });
            }

            console.log(
                "Using supplied modification. Gemini will not be called."
            );
        } else {
            // Step 2 alternative: Use Gemini only when no
            // modification object was supplied.
            modification = await extractModificationRequest(
                prompt,
                currentTimetable,
                solverData
            );
        }

        console.log(
            "Modification request:",
            JSON.stringify(modification, null, 2)
        );

        // Step 3: Apply the change if the slot is conflict-free.
        const result = applyTimetableModification(
            currentTimetable,
            modification,
            solverData
        );

        // Step 4: Independently validate the modified timetable.
        const validation = validateTimetable(
            result.timetable,
            solverData
        );

        if (!validation.valid) {
            return res.status(422).json({
                success: false,
                message:
                    "The modified timetable did not pass validation. " +
                    "The change has not been accepted.",
                validation
            });
        }

        // Step 5: Return the updated timetable.
        return res.json({
            success: true,
            message: "Timetable modified successfully.",
            modification,
            change: result.change,
            timetable: result.timetable,
            validation
        });
    } catch (error) {
        console.error(
            "Timetable modification error:",
            error
        );

        return res.status(422).json({
            success: false,
            message:
                error.message ||
                "Timetable modification failed."
        });
    }
}
