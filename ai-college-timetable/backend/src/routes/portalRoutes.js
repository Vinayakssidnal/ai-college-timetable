import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/authMiddleware.js";
import { readStore, saveStore, ensureTeacherAccounts } from "../services/portalStore.js";
import { buildSolverData } from "../services/aiTimetableService.js";
import { generateTimetable } from "../services/solverService.js";
import { validateTimetable } from "../services/validatorService.js";
import { applyTimetableModification } from "../services/modificationService.js";
import { extractTimetableRequirements } from "../services/llmService.js";

const router = Router();

function cleanPublicData(store) {
    return {
        collegeData: store.collegeData,
        timetable: store.timetable || [],
        aiRequirements: store.aiRequirements || null,
        metadata: store.metadata || {},
    };
}

function structuredRequirements(collegeData, preferences = {}) {
    const teachers = new Map(
        (collegeData.teachers || []).map((teacher) => [teacher.id, teacher])
    );

    return {
        classes: (collegeData.classes || []).map((cls) => ({
            className: cls.name,
            semester: Number(cls.semester),
            subjects: (cls.subjects || []).map((subject) => ({
                subjectName: subject.name,
                teacherName: teachers.get(subject.teacherId)?.name || subject.teacherId,
                periodsPerWeek: Number(subject.periodsPerWeek),
                type: subject.type || "theory",
            })),
        })),
        preferences: {
            labsAfterLunch: preferences.labsAfterLunch !== false,
            avoidRepeatedSubjectSameDay:
                preferences.avoidRepeatedSubjectSameDay !== false,
        },
    };
}

function validateCollegeData(data) {
    const errors = [];
    if (!data || typeof data !== "object") return ["collegeData must be an object."];
    if (!Array.isArray(data.days) || data.days.length === 0) errors.push("Add at least one weekday.");
    if (!Number.isInteger(Number(data.periodsPerDay)) || Number(data.periodsPerDay) < 1) {
        errors.push("periodsPerDay must be a positive whole number.");
    }
    if (!Array.isArray(data.teachers) || data.teachers.length === 0) errors.push("Add at least one teacher.");
    if (!Array.isArray(data.rooms) || data.rooms.length === 0) errors.push("Add at least one room.");
    if (!Array.isArray(data.classes) || data.classes.length === 0) errors.push("Add at least one class/section.");

    const teacherIds = new Set();
    for (const teacher of data.teachers || []) {
        if (!teacher.id || !teacher.name) errors.push("Every teacher needs an ID and name.");
        if (teacherIds.has(teacher.id)) errors.push(`Duplicate teacher ID: ${teacher.id}.`);
        teacherIds.add(teacher.id);
        const limit = Number(teacher.weeklyWorkload);
        if (!Number.isInteger(limit) || limit < 0) {
            errors.push(`Weekly workload for ${teacher.name || teacher.id} must be a non-negative whole number.`);
        }
    }

    const roomIds = new Set();
    for (const room of data.rooms || []) {
        if (!room.id || !["classroom", "lab"].includes(String(room.type).toLowerCase())) {
            errors.push("Each room needs an ID and type 'classroom' or 'lab'.");
        }
        if (roomIds.has(room.id)) errors.push(`Duplicate room ID: ${room.id}.`);
        roomIds.add(room.id);
    }

    const classIds = new Set();
    const subjectIds = new Set();
    const teacherDemand = new Map();
    for (const cls of data.classes || []) {
        if (!cls.id || !cls.name || !Number.isInteger(Number(cls.semester))) {
            errors.push("Every class needs an ID, name, and semester number.");
        }
        if (classIds.has(cls.id)) errors.push(`Duplicate class ID: ${cls.id}.`);
        classIds.add(cls.id);
        if (!Array.isArray(cls.subjects) || cls.subjects.length === 0) {
            errors.push(`Add at least one subject to ${cls.name || cls.id}.`);
            continue;
        }
        for (const subject of cls.subjects) {
            if (!subject.id || !subject.name || !subject.teacherId) {
                errors.push(`Every subject in ${cls.name} needs an ID, name, and assigned teacher.`);
            }
            if (subjectIds.has(`${cls.id}:${subject.id}`)) {
                errors.push(`Duplicate subject ID ${subject.id} in ${cls.name}.`);
            }
            subjectIds.add(`${cls.id}:${subject.id}`);
            if (!teacherIds.has(subject.teacherId)) {
                errors.push(`Teacher ${subject.teacherId} assigned to ${subject.name} does not exist.`);
            }
            const periods = Number(subject.periodsPerWeek);
            if (!Number.isInteger(periods) || periods < 1) {
                errors.push(`Periods per week for ${subject.name} must be a positive whole number.`);
            }
            if (String(subject.type).toLowerCase() === "lab" && periods % 2 !== 0) {
                errors.push(`Lab ${subject.name} must have an even number of periods per week for 2-period lab blocks.`);
            }
            if (teacherIds.has(subject.teacherId) && Number.isInteger(periods) && periods > 0) {
                teacherDemand.set(subject.teacherId, (teacherDemand.get(subject.teacherId) || 0) + periods);
            }
        }
    }

    for (const teacher of data.teachers || []) {
        const demand = teacherDemand.get(teacher.id) || 0;
        if (demand > Number(teacher.weeklyWorkload)) {
            errors.push(
                `${teacher.name} is assigned ${demand} periods, exceeding the maximum workload of ${teacher.weeklyWorkload}.`
            );
        }
    }

    return errors;
}

// Public viewer: no login needed. The UI must select one class to display.
router.get("/public", async (_req, res) => {
    try {
        const store = await readStore();
        return res.json({ success: true, ...cleanPublicData(store) });
    } catch (error) {
        console.error("Public timetable error:", error);
        return res.status(500).json({ success: false, message: "Could not load the public timetable." });
    }
});

// Creator sees all timetable entries. A teacher sees all entries taught by them across all classes.
router.get("/data", requireAuth, async (req, res) => {
    try {
        const store = await readStore();
        const timetable = req.user.role === "teacher"
            ? (store.timetable || []).filter((entry) => entry.teacherId === req.user.teacherId)
            : (store.timetable || []);

        return res.json({
            success: true,
            ...cleanPublicData({ ...store, timetable }),
            user: req.user,
        });
    } catch (error) {
        console.error("Portal data error:", error);
        return res.status(500).json({ success: false, message: "Could not load timetable data." });
    }
});

// Only timetable creators can change the teacher/class/subject/room master data.
router.put("/data", requireAuth, requireRole("creator"), async (req, res) => {
    try {
        const { collegeData, metadata } = req.body || {};
        const errors = validateCollegeData(collegeData);
        if (errors.length) {
            return res.status(400).json({ success: false, message: "Please fix the college data.", errors });
        }

        const store = await readStore();
        const normalizedCollegeData = {
            ...collegeData,
            periodsPerDay: Number(collegeData.periodsPerDay),
            lunchAfterPeriod: Number.isInteger(Number(collegeData.lunchAfterPeriod))
                ? Number(collegeData.lunchAfterPeriod)
                : 3,
            teachers: collegeData.teachers.map((teacher) => ({
                ...teacher,
                weeklyWorkload: Number(teacher.weeklyWorkload),
            })),
            classes: collegeData.classes.map((cls) => ({
                ...cls,
                semester: Number(cls.semester),
                subjects: cls.subjects.map((subject) => ({
                    ...subject,
                    periodsPerWeek: Number(subject.periodsPerWeek),
                    type: String(subject.type || "theory").toLowerCase(),
                })),
            })),
        };
        const collegeDataChanged = JSON.stringify(store.collegeData) !== JSON.stringify(normalizedCollegeData);
        store.collegeData = normalizedCollegeData;
        store.metadata = { ...(store.metadata || {}), ...(metadata || {}) };

        // Invalidate only if scheduling inputs changed; metadata-only edits keep the schedule.
        if (collegeDataChanged) {
            store.timetable = [];
            store.aiRequirements = null;
        }
        ensureTeacherAccounts(store);
        await saveStore(store);

        return res.json({
            success: true,
            message: "Teachers, classes, subjects and rooms saved. Generate a new timetable next.",
            ...cleanPublicData(store),
        });
    } catch (error) {
        console.error("Save college data error:", error);
        return res.status(500).json({ success: false, message: error.message || "Could not save college data." });
    }
});

// Generate from explicit creator-entered data. Gemini can enrich prompt interpretation;
// if quota is unavailable, structured inputs still permit deterministic scheduling.
router.post("/generate", requireAuth, requireRole("creator"), async (req, res) => {
    try {
        const prompt = String(req.body?.prompt || "").trim();
        const requestedPreferences = req.body?.preferences || {};
        if (!prompt) {
            return res.status(400).json({ success: false, message: "Please enter a timetable prompt." });
        }

        const store = await readStore();
        const dataErrors = validateCollegeData(store.collegeData);
        if (dataErrors.length) {
            return res.status(400).json({ success: false, message: "Complete the teacher, class, subject and room setup first.", errors: dataErrors });
        }

        let aiRequirements = structuredRequirements(store.collegeData, requestedPreferences);
        let usedStructuredFallback = false;
        try {
            const interpreted = await extractTimetableRequirements(prompt, store.collegeData);
            // Explicit creator-entered assignments are the source of truth; only accept prompt preferences.
            if (interpreted?.preferences) {
                aiRequirements.preferences = {
                    ...aiRequirements.preferences,
                    ...interpreted.preferences,
                    ...requestedPreferences,
                };
            }
        } catch (aiError) {
            usedStructuredFallback = true;
            console.warn("Gemini unavailable; using the entered structured data and explicit preferences:", aiError.message);
            const text = prompt.toLowerCase();
            if (text.includes("before lunch")) aiRequirements.preferences.labsAfterLunch = false;
            if (text.includes("after lunch")) aiRequirements.preferences.labsAfterLunch = true;
            if (text.includes("allow repeated") || text.includes("repeat subjects")) {
                aiRequirements.preferences.avoidRepeatedSubjectSameDay = false;
            }
            if (text.includes("avoid repeat") || text.includes("no repeated") || text.includes("not repeat")) {
                aiRequirements.preferences.avoidRepeatedSubjectSameDay = true;
            }
            aiRequirements.preferences = { ...aiRequirements.preferences, ...requestedPreferences };
        }

        const solverData = buildSolverData(aiRequirements, store.collegeData);
        const timetable = await generateTimetable(solverData);
        const validation = validateTimetable(timetable, solverData);

        if (!validation.valid) {
            return res.status(422).json({ success: false, message: "Generated timetable failed validation.", validation });
        }

        store.timetable = timetable;
        store.aiRequirements = aiRequirements;
        await saveStore(store);

        return res.json({
            success: true,
            message: usedStructuredFallback
                ? "Timetable generated from entered data. Gemini was unavailable; supported preferences were applied from the prompt and controls."
                : "Timetable generated successfully.",
            aiRequirements,
            timetable,
            validation,
            usedStructuredFallback,
            collegeData: store.collegeData,
            metadata: store.metadata,
        });
    } catch (error) {
        console.error("Portal timetable generation error:", error);
        return res.status(422).json({ success: false, message: error.message || "Could not generate a timetable." });
    }
});

// Creator-only direct modification. It never calls Gemini when a modification object is supplied.
router.post("/modify", requireAuth, requireRole("creator"), async (req, res) => {
    try {
        const store = await readStore();
        if (!Array.isArray(store.timetable) || store.timetable.length === 0) {
            return res.status(400).json({ success: false, message: "Generate a timetable before modifying it." });
        }
        const modification = req.body?.modification;
        if (!modification || typeof modification !== "object") {
            return res.status(400).json({ success: false, message: "A modification object is required." });
        }

        const aiRequirements = store.aiRequirements || structuredRequirements(store.collegeData);
        const solverData = buildSolverData(aiRequirements, store.collegeData);
        const result = applyTimetableModification(store.timetable, modification, solverData);
        const validation = validateTimetable(result.timetable, solverData);

        if (!validation.valid) {
            return res.status(422).json({ success: false, message: "Modified timetable failed validation.", validation });
        }

        store.timetable = result.timetable;
        await saveStore(store);

        return res.json({
            success: true,
            message: "Timetable modified successfully.",
            modification,
            change: result.change,
            timetable: store.timetable,
            validation,
            collegeData: store.collegeData,
            aiRequirements,
            metadata: store.metadata,
        });
    } catch (error) {
        console.error("Portal timetable modification error:", error);
        return res.status(422).json({ success: false, message: error.message || "Timetable modification failed." });
    }
});

export default router;
