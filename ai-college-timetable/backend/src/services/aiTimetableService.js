/*
 * =========================================================
 * NORMALIZE TEXT
 * =========================================================
 */
function normalize(value) {

    return String(value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}


/*
 * =========================================================
 * CONVERT AI RESULT TO SOLVER DATA
 * =========================================================
 *
 * The LLM gives us names.
 *
 * The solver needs IDs.
 *
 * So this function performs the deterministic
 * mapping.
 * =========================================================
 */
export function buildSolverData(
    aiRequirements,
    collegeData
) {

    const teacherMap =
        new Map();

    /*
     * Teacher name → teacher object
     */
    for (
        const teacher
        of collegeData.teachers
    ) {

        teacherMap.set(
            normalize(teacher.name),
            teacher
        );
    }


    const classes = [];


    /*
     * Process every class selected
     * by the LLM.
     */
    for (
        const aiClass
        of aiRequirements.classes
    ) {

        const subjects = [];


        /*
         * Process subjects
         */
        for (
            let index = 0;
            index < aiClass.subjects.length;
            index++
        ) {

            const aiSubject =
                aiClass.subjects[index];


            /*
             * Find teacher
             */
            const teacher =
                teacherMap.get(
                    normalize(
                        aiSubject.teacherName
                    )
                );


            if (!teacher) {

                throw new Error(

                    `Teacher "${aiSubject.teacherName}" ` +
                    `does not exist in college data.`
                );
            }


            /*
             * Find matching existing subject,
             * when possible.
             */
            const matchingClass =
                collegeData.classes.find(
                    cls =>
                        normalize(
                            cls.name
                        ) ===
                        normalize(
                            aiClass.className
                        )
                );


            let matchingSubject = null;


            if (matchingClass) {

                matchingSubject =
                    matchingClass.subjects.find(
                        subject => {

                            const subjectTeacher =
                                collegeData.teachers.find(
                                    t =>
                                        t.id ===
                                        subject.teacherId
                                );

                            return (

                                normalize(
                                    subject.name
                                ) ===
                                normalize(
                                    aiSubject.subjectName
                                )

                                &&

                                subjectTeacher

                                &&

                                normalize(
                                    subjectTeacher.name
                                ) ===
                                normalize(
                                    aiSubject.teacherName
                                )
                            );
                        }
                    );
            }


            /*
             * Create deterministic subject ID.
             */
            const subjectId =
                matchingSubject
                    ? matchingSubject.id
                    : `${aiClass.className
                        .replace(/\s+/g, "-")
                        .toUpperCase()}-SUB-${index + 1}`;


            subjects.push({

                id:
                    subjectId,

                name:
                    aiSubject.subjectName,

                teacherId:
                    teacher.id,

                periodsPerWeek:
                    Number(
                        aiSubject.periodsPerWeek
                    ),

                type:
                    aiSubject.type
            });
        }


        classes.push({

            id:
                aiClass.className
                    .replace(/\s+/g, "-")
                    .toUpperCase(),

            name:
                aiClass.className,

            semester:
                aiClass.semester,

            subjects
        });
    }


    /*
     * Create solver data.
     *
     * We keep the college-wide resources
     * from our existing configuration.
     */
    return {
        days: collegeData.days,
        periodsPerDay: collegeData.periodsPerDay,
        lunchAfterPeriod: collegeData.lunchAfterPeriod,
        rooms: collegeData.rooms,
        teachers: collegeData.teachers,
        classes,
        preferences: aiRequirements.preferences
    };
}