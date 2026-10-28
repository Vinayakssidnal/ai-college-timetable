/*
 * ---------------------------------------------
 * GET ALL CLASSES
 * ---------------------------------------------
 */
function getClasses(data) {

    if (Array.isArray(data.classes)) {

        return data.classes;
    }

    if (Array.isArray(data.semesters)) {

        return data.semesters.flatMap(
            semester =>
                Array.isArray(semester.classes)
                    ? semester.classes
                    : []
        );
    }

    throw new Error(
        "College data must contain " +
        "'classes' or 'semesters'."
    );
}


/*
 * ---------------------------------------------
 * VALIDATE TIMETABLE
 * ---------------------------------------------
 */
export function validateTimetable(
    timetable,
    data
) {

    const errors = [];


    /*
     * Resource sets
     */
    const classSlots =
        new Set();

    const teacherSlots =
        new Set();

    const roomSlots =
        new Set();


    /*
     * Maps
     */
    const roomMap =
        new Map(
            data.rooms.map(
                room =>
                    [room.id, room]
            )
        );


    const teacherMap =
        new Map(
            data.teachers.map(
                teacher =>
                    [teacher.id, teacher]
            )
        );


    /*
     * ---------------------------------------------
     * EXPECTED SUBJECT PERIODS
     *
     * Key:
     *
     * classId + subjectId
     *
     * so the same subject in different classes
     * is validated separately.
     * ---------------------------------------------
     */
    const expectedSubjectPeriods =
        new Map();


    /*
     * ---------------------------------------------
     * ACTUAL SUBJECT PERIODS
     * ---------------------------------------------
     */
    const actualSubjectPeriods =
        new Map();


    /*
     * ---------------------------------------------
     * EXPECTED TEACHER WORKLOAD
     * ---------------------------------------------
     */
    const expectedTeacherWorkload =
        new Map();


    /*
     * ---------------------------------------------
     * BUILD EXPECTED DATA
     * ---------------------------------------------
     */
    const classes =
        getClasses(data);


    for (
        const cls
        of classes
    ) {

        for (
            const subject
            of cls.subjects
        ) {

            const subjectKey =
                `${cls.id}_${subject.id}`;


            expectedSubjectPeriods.set(
                subjectKey,
                subject.periodsPerWeek
            );


            /*
             * Teacher expected workload
             */
            const teacherCurrent =
                expectedTeacherWorkload.get(
                    subject.teacherId
                ) || 0;

            expectedTeacherWorkload.set(

                subject.teacherId,

                teacherCurrent +
                subject.periodsPerWeek
            );
        }
    }


    /*
     * ---------------------------------------------
     * CHECK EACH GENERATED TIMETABLE ENTRY
     * ---------------------------------------------
     */
    for (
        const item
        of timetable
    ) {

        /*
         * -----------------------------------------
         * CLASS CONFLICT
         * -----------------------------------------
         */
        const classKey =
            `${item.classId}` +
            `_${item.day}` +
            `_${item.period}`;


        if (
            classSlots.has(classKey)
        ) {

            errors.push(

                `Class conflict: ` +
                `${item.classId} ` +
                `on ${item.day} ` +
                `Period ${item.period}`
            );
        }


        classSlots.add(
            classKey
        );


        /*
         * -----------------------------------------
         * TEACHER CONFLICT
         * -----------------------------------------
         */
        const teacherKey =
            `${item.teacherId}` +
            `_${item.day}` +
            `_${item.period}`;


        if (
            teacherSlots.has(
                teacherKey
            )
        ) {

            errors.push(

                `Teacher conflict: ` +
                `${item.teacherId} ` +
                `on ${item.day} ` +
                `Period ${item.period}`
            );
        }


        teacherSlots.add(
            teacherKey
        );


        /*
         * -----------------------------------------
         * ROOM CONFLICT
         * -----------------------------------------
         */
        const roomKey =
            `${item.room}` +
            `_${item.day}` +
            `_${item.period}`;


        if (
            roomSlots.has(roomKey)
        ) {

            errors.push(

                `Room conflict: ` +
                `${item.room} ` +
                `on ${item.day} ` +
                `Period ${item.period}`
            );
        }


        roomSlots.add(
            roomKey
        );


        /*
         * -----------------------------------------
         * ROOM EXISTENCE
         * -----------------------------------------
         */
        const room =
            roomMap.get(
                item.room
            );


        if (!room) {

            errors.push(
                `Room ${item.room} ` +
                `does not exist.`
            );
        }


        /*
         * -----------------------------------------
         * ROOM TYPE
         * -----------------------------------------
         */
        else {

            if (
                item.type === "lab" &&
                room.type !== "lab"
            ) {

                errors.push(

                    `${item.subject} is a lab ` +
                    `but room ${item.room} ` +
                    `is not a lab room.`
                );
            }


            if (
                item.type === "theory" &&
                room.type !== "classroom"
            ) {

                errors.push(

                    `${item.subject} is theory ` +
                    `but room ${item.room} ` +
                    `is not a classroom.`
                );
            }
        }


        /*
         * -----------------------------------------
         * ACTUAL SUBJECT PERIOD COUNT
         * -----------------------------------------
         */
        const subjectKey =
            `${item.classId}_${item.subjectId}`;


        const actualCurrent =
            actualSubjectPeriods.get(
                subjectKey
            ) || 0;


        actualSubjectPeriods.set(
            subjectKey,
            actualCurrent + 1
        );
    }


    /*
     * ---------------------------------------------
     * CHECK SUBJECT WEEKLY PERIODS
     * ---------------------------------------------
     */
    for (
        const [
            subjectKey,
            expected
        ]
        of expectedSubjectPeriods
    ) {

        const actual =
            actualSubjectPeriods.get(
                subjectKey
            ) || 0;


        if (
            actual !== expected
        ) {

            errors.push(

                `Subject ${subjectKey}: ` +
                `required ${expected} periods, ` +
                `but generated ${actual}.`
            );
        }
    }


    /*
     * ---------------------------------------------
     * CALCULATE ACTUAL TEACHER WORKLOAD
     * ---------------------------------------------
     */
    const actualTeacherWorkload =
        new Map();


    for (
        const item
        of timetable
    ) {

        const current =
            actualTeacherWorkload.get(
                item.teacherId
            ) || 0;


        actualTeacherWorkload.set(

            item.teacherId,

            current + 1
        );
    }


    /*
     * ---------------------------------------------
     * CHECK TEACHER WORKLOAD
     * ---------------------------------------------
     */
    for (
        const [
            teacherId,
            expected
        ]
        of expectedTeacherWorkload
    ) {

        const actual =
            actualTeacherWorkload.get(
                teacherId
            ) || 0;


        /*
         * Teacher should receive exactly
         * the required number of periods.
         */
        if (
            actual !== expected
        ) {

            errors.push(

                `Teacher ${teacherId}: ` +
                `expected ${expected} periods, ` +
                `but timetable contains ${actual}.`
            );
        }


        /*
         * Check against workload limit.
         */
        const teacher =
            teacherMap.get(
                teacherId
            );


        if (!teacher) {

            errors.push(

                `Teacher ${teacherId} ` +
                `does not exist.`
            );

            continue;
        }


        if (
            actual >
            teacher.weeklyWorkload
        ) {

            errors.push(

                `Teacher ${teacher.name} ` +
                `has ${actual} periods, ` +
                `but workload limit is ` +
                `${teacher.weeklyWorkload}.`
            );
        }
    }


    /*
     * ---------------------------------------------
     * CHECK LAB CONSECUTIVENESS
     * ---------------------------------------------
     *
     * A 2-period lab should occupy:
     *
     * P1 + P2
     *
     * or
     *
     * P3 + P4
     *
     * etc.
     *
     * ---------------------------------------------
     */
    const labGroups =
        new Map();


    for (
        const item
        of timetable
    ) {

        if (
            item.type !== "lab"
        ) {

            continue;
        }


        const key =
            `${item.classId}` +
            `_${item.subjectId}` +
            `_${item.day}` +
            `_${item.room}`;


        if (
            !labGroups.has(key)
        ) {

            labGroups.set(
                key,
                []
            );
        }


        labGroups.get(key).push(
            item.period
        );
    }


    for (
        const [
            key,
            periods
        ]
        of labGroups
    ) {

        periods.sort(
            (a, b) => a - b
        );


        for (
            let i = 1;
            i < periods.length;
            i++
        ) {

            if (
                periods[i] !==
                periods[i - 1] + 1
            ) {

                errors.push(

                    `Lab ${key} does not have ` +
                    `consecutive periods.`
                );

                break;
            }
        }
    }


    /*
     * ---------------------------------------------
     * FINAL RESULT
     * ---------------------------------------------
     */
    return {

        valid:
            errors.length === 0,

        errors,

        summary: {

            totalEntries:
                timetable.length,

            totalClasses:
                classes.length,

            totalTeachers:
                data.teachers.length,

            totalRooms:
                data.rooms.length
        }
    };
}