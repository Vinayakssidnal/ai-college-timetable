import {
    GoogleGenAI,
    Type
} from "@google/genai";

import dotenv from "dotenv";

dotenv.config();


/*
 * =========================================================
 * GEMINI CLIENT
 * =========================================================
 */

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});


const MODEL =
    process.env.GEMINI_MODEL ||
    "gemini-3.6-flash";


/*
 * =========================================================
 * RETRY HELPER
 * =========================================================
 *
 * Handles temporary Gemini 503 / UNAVAILABLE errors.
 * =========================================================
 */

async function generateWithRetry(
    request,
    maxRetries = 3
) {

    let lastError = null;

    for (
        let attempt = 1;
        attempt <= maxRetries;
        attempt++
    ) {

        try {

            return await ai.models.generateContent(
                request
            );

        } catch (error) {

            lastError = error;

            const message =
                error?.message || "";

            const isTemporaryError =
                message.includes("503") ||
                message.includes("UNAVAILABLE") ||
                message.includes("high demand") ||
                message.includes("temporarily");

            /*
             * Authentication, invalid model,
             * malformed request, etc.
             *
             * should not be retried.
             */
            if (!isTemporaryError) {

                throw error;
            }

            console.log(
                `Gemini temporary failure ` +
                `(attempt ${attempt}/${maxRetries})`
            );


            /*
             * Don't wait after the final attempt.
             */
            if (
                attempt === maxRetries
            ) {

                break;
            }


            /*
             * Exponential backoff:
             *
             * 2 sec
             * 4 sec
             * 8 sec
             */
            const delay =
                2000 *
                Math.pow(
                    2,
                    attempt - 1
                );


            console.log(
                `Waiting ${delay / 1000}s ` +
                `before retry...`
            );


            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        delay
                    )
            );
        }
    }

    throw lastError;
}


/*
 * =========================================================
 * TEST GEMINI
 * =========================================================
 */

export async function testGemini() {

    if (
        !process.env.GEMINI_API_KEY
    ) {

        throw new Error(
            "GEMINI_API_KEY is not configured."
        );
    }


    console.log(
        `Testing Gemini model: ${MODEL}`
    );


    const response =
        await generateWithRetry({

            model: MODEL,

            contents:
                "Reply with exactly: " +
                "Gemini API is working."
        });


    return response.text;
}


/*
 * =========================================================
 * TIMETABLE REQUIREMENT SCHEMA
 * =========================================================
 */

const timetableSchema = {

    type: Type.OBJECT,

    properties: {

        classes: {

            type: Type.ARRAY,

            items: {

                type: Type.OBJECT,

                properties: {

                    className: {
                        type: Type.STRING
                    },

                    semester: {
                        type: Type.INTEGER
                    },

                    subjects: {

                        type: Type.ARRAY,

                        items: {

                            type: Type.OBJECT,

                            properties: {

                                subjectName: {
                                    type: Type.STRING
                                },

                                teacherName: {
                                    type: Type.STRING
                                },

                                periodsPerWeek: {
                                    type: Type.INTEGER
                                },

                                type: {

                                    type: Type.STRING,

                                    enum: [
                                        "theory",
                                        "lab"
                                    ]
                                }
                            },

                            required: [
                                "subjectName",
                                "teacherName",
                                "periodsPerWeek",
                                "type"
                            ]
                        }
                    }
                },

                required: [
                    "className",
                    "semester",
                    "subjects"
                ]
            }
        },

        preferences: {

            type: Type.OBJECT,

            properties: {

                labsAfterLunch: {
                    type: Type.BOOLEAN
                },

                avoidRepeatedSubjectSameDay: {
                    type: Type.BOOLEAN
                }
            },

            required: [
                "labsAfterLunch",
                "avoidRepeatedSubjectSameDay"
            ]
        }
    },

    required: [
        "classes",
        "preferences"
    ]
};


/*
 * =========================================================
 * EXTRACT TIMETABLE REQUIREMENTS
 * =========================================================
 */

export async function extractTimetableRequirements(
    userPrompt,
    collegeData
) {

    if (
        !process.env.GEMINI_API_KEY
    ) {

        throw new Error(
            "GEMINI_API_KEY is not configured."
        );
    }


    /*
     * -----------------------------------------
     * Prepare authoritative college data
     * -----------------------------------------
     */

    const collegeContext = {

        teachers:
            collegeData.teachers.map(
                teacher => ({

                    id:
                        teacher.id,

                    name:
                        teacher.name,

                    weeklyWorkload:
                        teacher.weeklyWorkload
                })
            ),

        classes:
            collegeData.classes.map(
                cls => ({

                    id:
                        cls.id,

                    name:
                        cls.name,

                    semester:
                        cls.semester,

                    subjects:
                        cls.subjects.map(
                            subject => {

                                const teacher =
                                    collegeData.teachers.find(
                                        t =>
                                            t.id ===
                                            subject.teacherId
                                    );

                                return {

                                    id:
                                        subject.id,

                                    name:
                                        subject.name,

                                    teacherId:
                                        subject.teacherId,

                                    teacherName:
                                        teacher
                                            ? teacher.name
                                            : "",

                                    periodsPerWeek:
                                        subject.periodsPerWeek,

                                    type:
                                        subject.type
                                };
                            }
                        )
                })
            )
    };


    /*
     * -----------------------------------------
     * Prompt
     * -----------------------------------------
     */

    const prompt = `

You are a college timetable
requirement extraction assistant.

Your job is ONLY to understand the
user's timetable request.

You do NOT generate days,
periods, rooms, or the final timetable.

OR-Tools will generate the actual
conflict-free timetable.

COLLEGE DATA:

${JSON.stringify(
        collegeContext,
        null,
        2
    )}

RULES:

1. Use existing teachers from the
   college data.

2. Do not invent teachers.

3. Use existing subjects when possible.

4. Preserve existing weekly periods
   unless the user explicitly changes them.

5. Preserve existing subject type
   unless the user explicitly changes it.

6. Understand user preferences.

7. Do not solve teacher conflicts.

8. Do not solve class conflicts.

9. Do not assign rooms.

10. Return structured timetable
    requirements only.

USER REQUEST:

${userPrompt}
`;


    console.log(
        `Calling Gemini model: ${MODEL}`
    );


    /*
     * -----------------------------------------
     * Gemini request
     * -----------------------------------------
     */

    const response =
        await generateWithRetry({

            model: MODEL,

            contents: prompt,

            config: {

                responseMimeType:
                    "application/json",

                responseSchema:
                    timetableSchema
            }
        });


    /*
     * -----------------------------------------
     * Extract text
     * -----------------------------------------
     */

    const text =
        response.text;


    if (!text) {

        throw new Error(
            "Gemini returned an empty response."
        );
    }


    /*
     * -----------------------------------------
     * Parse JSON
     * -----------------------------------------
     */

    try {

        return JSON.parse(text);

    } catch (error) {

        throw new Error(
            "Gemini returned invalid JSON: " +
            error.message
        );
    }
}

/*
 * =========================================================
 * PARSE TIMETABLE MODIFICATION
 * =========================================================
 */
export async function extractModificationRequest(
    userPrompt,
    currentTimetable,
    collegeData
) {
    const modificationSchema = {
        type: Type.OBJECT,
        properties: {
            className: {
                type: Type.STRING
            },
            subjectName: {
                type: Type.STRING
            },
            fromDay: {
                type: Type.STRING
            },
            fromPeriod: {
                type: Type.INTEGER
            },
            targetDay: {
                type: Type.STRING
            },
            targetPeriod: {
                type: Type.INTEGER
            },
            targetTime: {
                type: Type.STRING,
                enum: [
                    "exact",
                    "morning",
                    "afternoon",
                    "any"
                ]
            }
        },
        required: [
            "className",
            "subjectName",
            "fromDay",
            "fromPeriod",
            "targetDay",
            "targetPeriod",
            "targetTime"
        ]
    };

    const context = {
        classes: collegeData.classes.map(cls => ({
            id: cls.id,
            name: cls.name,
            semester: cls.semester,
            subjects: cls.subjects.map(subject => ({
                id: subject.id,
                name: subject.name
            }))
        })),
        currentTimetable: currentTimetable.map(entry => ({
            className: entry.className,
            subject: entry.subject,
            day: entry.day,
            period: entry.period,
            room: entry.room
        }))
    };

    const prompt = `
You interpret requests to modify an existing college timetable.

Return structured modification details only.
Do not generate a timetable.

Available college data and current timetable:
${JSON.stringify(context, null, 2)}

Rules:
- Use the actual class and subject names from the data.
- If the user does not specify a source day, return an empty string for fromDay.
- If the user does not specify a source period, return 0 for fromPeriod.
- If the user does not specify an exact target period, return 0 for targetPeriod.
- Use targetTime "exact" for a specified period.
- Use "morning" or "afternoon" for those time ranges.
- Use "any" if no target time is specified.
- targetDay must be a day from the college's working days.
- Do not invent class or subject names.

User request:
${userPrompt}
`;

    const response = await generateWithRetry({
        model: MODEL,
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: modificationSchema
        }
    });

    if (!response.text) {
        throw new Error(
            "Gemini returned an empty modification response."
        );
    }

    return JSON.parse(response.text);
}