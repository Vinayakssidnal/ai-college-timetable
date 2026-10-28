import {
    CpModel,
    CpSolver
} from "or-tools-wasm/cp-sat";


/*
 * =========================================================
 * GET ALL CLASSES
 * Supports data.classes and data.semesters[].classes
 * =========================================================
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
        "College data must contain 'classes' or 'semesters'."
    );
}


/*
 * =========================================================
 * VALIDATE TEACHER WORKLOADS
 * =========================================================
 */
function checkTeacherWorkloads(data) {
    const workloadLimits = new Map();

    for (const teacher of data.teachers) {
        if (
            teacher.id == null ||
            !Number.isInteger(Number(teacher.weeklyWorkload)) ||
            Number(teacher.weeklyWorkload) < 0
        ) {
            throw new Error(
                `Invalid weekly workload for teacher ${teacher.name}.`
            );
        }

        workloadLimits.set(
            teacher.id,
            Number(teacher.weeklyWorkload)
        );
    }

    const requiredWorkloads = new Map();

    for (const cls of getClasses(data)) {
        for (const subject of cls.subjects) {
            const periods = Number(subject.periodsPerWeek);

            if (
                !Number.isInteger(periods) ||
                periods <= 0
            ) {
                throw new Error(
                    `${subject.name} must have a positive integer periodsPerWeek.`
                );
            }

            if (!workloadLimits.has(subject.teacherId)) {
                throw new Error(
                    `Teacher ${subject.teacherId} does not exist.`
                );
            }

            const current =
                requiredWorkloads.get(subject.teacherId) || 0;

            requiredWorkloads.set(
                subject.teacherId,
                current + periods
            );
        }
    }

    for (const [teacherId, required] of requiredWorkloads) {
        const limit = workloadLimits.get(teacherId);

        if (required > limit) {
            throw new Error(
                `Teacher ${teacherId} requires ${required} periods, ` +
                `but the weekly workload limit is ${limit}.`
            );
        }
    }
}


/*
 * =========================================================
 * CHECK ROOM COMPATIBILITY
 *
 * Theory -> classroom
 * Lab    -> lab room
 * =========================================================
 */
function isRoomCompatible(subjectType, roomType) {
    if (subjectType === "theory") {
        return roomType === "classroom";
    }

    if (subjectType === "lab") {
        return roomType === "lab";
    }

    return false;
}


/*
 * =========================================================
 * CREATE LESSONS
 *
 * Theory with 4 periods/week:
 *   4 individual lessons
 *
 * Lab with 2 periods/week:
 *   1 block occupying 2 consecutive periods
 *
 * Lab with 4 periods/week:
 *   2 blocks, each occupying 2 consecutive periods
 * =========================================================
 */
function createLessons(data) {
    const lessons = [];

    for (const cls of getClasses(data)) {
        for (const subject of cls.subjects) {
            const periods = Number(subject.periodsPerWeek);

            if (
                !Number.isInteger(periods) ||
                periods <= 0
            ) {
                throw new Error(
                    `${subject.name} must have a positive integer periodsPerWeek.`
                );
            }

            if (subject.type === "theory") {
                for (
                    let occurrence = 0;
                    occurrence < periods;
                    occurrence++
                ) {
                    lessons.push({
                        classId: cls.id,
                        className: cls.name || cls.id,
                        semester: cls.semester ?? null,
                        subjectId: subject.id,
                        subjectName: subject.name,
                        teacherId: subject.teacherId,
                        type: "theory",
                        duration: 1,
                        occurrence
                    });
                }
            } else if (subject.type === "lab") {
                if (periods % 2 !== 0) {
                    throw new Error(
                        `${subject.name} must have an even number ` +
                        `of weekly periods because labs use 2-period blocks.`
                    );
                }

                const blockCount = periods / 2;

                for (
                    let block = 0;
                    block < blockCount;
                    block++
                ) {
                    lessons.push({
                        classId: cls.id,
                        className: cls.name || cls.id,
                        semester: cls.semester ?? null,
                        subjectId: subject.id,
                        subjectName: subject.name,
                        teacherId: subject.teacherId,
                        type: "lab",
                        duration: 2,
                        occurrence: block
                    });
                }
            } else {
                throw new Error(
                    `Invalid subject type '${subject.type}' for ${subject.name}.`
                );
            }
        }
    }

    return lessons;
}


/*
 * =========================================================
 * GENERATE TIMETABLE
 * =========================================================
 */
export async function generateTimetable(data) {
    /*
     * STEP 1: Validate basic input
     */
    if (
        !Array.isArray(data.days) ||
        data.days.length === 0
    ) {
        throw new Error("At least one working day is required.");
    }

    if (
        !Number.isInteger(data.periodsPerDay) ||
        data.periodsPerDay <= 0
    ) {
        throw new Error(
            "periodsPerDay must be a positive integer."
        );
    }

    if (
        !Array.isArray(data.rooms) ||
        data.rooms.length === 0
    ) {
        throw new Error("At least one room is required.");
    }

    if (!Array.isArray(data.teachers)) {
        throw new Error("teachers must be an array.");
    }

    for (const room of data.rooms) {
        if (!["classroom", "lab"].includes(room.type)) {
            throw new Error(
                `Room ${room.id} must have type 'classroom' or 'lab'.`
            );
        }
    }

    /*
     * STEP 2: Check weekly teacher workloads
     */
    checkTeacherWorkloads(data);

    /*
     * STEP 3: Create model and lessons
     */
    const model = new CpModel();
    const lessons = createLessons(data);

    if (lessons.length === 0) {
        throw new Error("No lessons found.");
    }

    const preferences = data.preferences || {};

    /*
     * lunchAfterPeriod is the number of periods
     * before lunch. For six periods, 3 means
     * periods 1-3 are before lunch.
     */
    const lunchAfterPeriod =
        Number.isInteger(data.lunchAfterPeriod) &&
            data.lunchAfterPeriod >= 0 &&
            data.lunchAfterPeriod < data.periodsPerDay
            ? data.lunchAfterPeriod
            : Math.floor(data.periodsPerDay / 2);

    /*
     * STEP 4: Create valid placements
     *
     * Each placement selects:
     *   lesson + day + starting period + room
     */
    const placements = [];

    for (
        let lessonIndex = 0;
        lessonIndex < lessons.length;
        lessonIndex++
    ) {
        const lesson = lessons[lessonIndex];
        const validPlacements = [];

        for (
            let dayIndex = 0;
            dayIndex < data.days.length;
            dayIndex++
        ) {
            const maxStartPeriod =
                data.periodsPerDay - lesson.duration;

            for (
                let periodIndex = 0;
                periodIndex <= maxStartPeriod;
                periodIndex++
            ) {
                /*
                 * HARD PREFERENCE:
                 * A lab must start after lunch.
                 */
                if (
                    preferences.labsAfterLunch === true &&
                    lesson.type === "lab" &&
                    periodIndex < lunchAfterPeriod
                ) {
                    continue;
                }

                for (
                    let roomIndex = 0;
                    roomIndex < data.rooms.length;
                    roomIndex++
                ) {
                    const room = data.rooms[roomIndex];

                    /*
                     * Only create valid room assignments.
                     */
                    if (
                        !isRoomCompatible(
                            lesson.type,
                            room.type
                        )
                    ) {
                        continue;
                    }

                    const variable = model.newBoolVar(
                        `lesson_${lessonIndex}` +
                        `_day_${dayIndex}` +
                        `_period_${periodIndex}` +
                        `_room_${roomIndex}`
                    );

                    validPlacements.push({
                        variable,
                        lessonIndex,
                        dayIndex,
                        periodIndex,
                        roomIndex
                    });
                }
            }
        }

        if (validPlacements.length === 0) {
            throw new Error(
                `No valid placement exists for ${lesson.subjectName}. ` +
                `Check room availability, lunch preferences, and working periods.`
            );
        }

        /*
         * Every lesson must be assigned exactly once.
         */
        model.addExactlyOne(
            validPlacements.map(
                placement => placement.variable
            )
        );

        placements.push(...validPlacements);
    }

    /*
     * STEP 5: Build resource maps
     *
     * A key represents:
     *   class + day + period
     *   teacher + day + period
     *   room + day + period
     *
     * Lab placements occupy two consecutive periods.
     */
    const classSlots = new Map();
    const teacherSlots = new Map();
    const roomSlots = new Map();

    function addToMap(map, key, variable) {
        if (!map.has(key)) {
            map.set(key, []);
        }

        map.get(key).push(variable);
    }

    for (const placement of placements) {
        const lesson = lessons[placement.lessonIndex];
        const room = data.rooms[placement.roomIndex];

        for (
            let offset = 0;
            offset < lesson.duration;
            offset++
        ) {
            const periodIndex =
                placement.periodIndex + offset;

            addToMap(
                classSlots,
                `${lesson.classId}_${placement.dayIndex}_${periodIndex}`,
                placement.variable
            );

            addToMap(
                teacherSlots,
                `${lesson.teacherId}_${placement.dayIndex}_${periodIndex}`,
                placement.variable
            );

            addToMap(
                roomSlots,
                `${room.id}_${placement.dayIndex}_${periodIndex}`,
                placement.variable
            );
        }
    }

    /*
     * STEP 6: HARD CONSTRAINT - NO CLASS CONFLICT
     */
    for (const variables of classSlots.values()) {
        model.addAtMostOne(variables);
    }

    /*
     * STEP 7: HARD CONSTRAINT - NO TEACHER CONFLICT
     */
    for (const variables of teacherSlots.values()) {
        model.addAtMostOne(variables);
    }

    /*
     * STEP 8: HARD CONSTRAINT - NO ROOM CONFLICT
     */
    for (const variables of roomSlots.values()) {
        model.addAtMostOne(variables);
    }

    /*
     * STEP 9: PREFERENCE - NO SUBJECT REPEATS IN THE SAME DAY
     *
     * When enabled, a class may have at most one
     * occurrence of a particular subject per day.
     *
     * A two-period lab is treated as one occurrence.
     */
    if (preferences.avoidRepeatedSubjectSameDay === true) {
        const subjectGroups = new Map();

        for (let i = 0; i < lessons.length; i++) {
            const lesson = lessons[i];
            const key =
                `${lesson.classId}::${lesson.subjectId}`;

            if (!subjectGroups.has(key)) {
                subjectGroups.set(key, []);
            }

            subjectGroups.get(key).push(i);
        }

        for (const lessonIndexes of subjectGroups.values()) {
            if (lessonIndexes.length <= 1) {
                continue;
            }

            const lessonIndexSet = new Set(lessonIndexes);

            for (
                let dayIndex = 0;
                dayIndex < data.days.length;
                dayIndex++
            ) {
                const possiblePlacements = placements
                    .filter(
                        placement =>
                            lessonIndexSet.has(
                                placement.lessonIndex
                            ) &&
                            placement.dayIndex === dayIndex
                    )
                    .map(
                        placement => placement.variable
                    );

                if (possiblePlacements.length > 0) {
                    model.addAtMostOne(possiblePlacements);
                }
            }
        }
    }

    /*
     * STEP 10: SOLVE
     */
    const solver = new CpSolver();

    // Your installed or-tools-wasm version uses numWorkers.
    solver.parameters.numWorkers = 4;

    console.log("Starting OR-Tools solver...");

    const status = await solver.solve(model);
    const statusName = solver.statusName(status);

    console.log(`OR-Tools status: ${statusName}`);

    if (
        statusName !== "OPTIMAL" &&
        statusName !== "FEASIBLE"
    ) {
        throw new Error(
            "No feasible timetable could be generated. " +
            "Check weekly workloads, room types, and timetable preferences."
        );
    }

    /*
     * STEP 11: Extract the selected placements
     */
    const timetable = [];

    for (const placement of placements) {
        if (
            !solver.booleanValue(placement.variable)
        ) {
            continue;
        }

        const lesson = lessons[placement.lessonIndex];
        const room = data.rooms[placement.roomIndex];

        /*
         * Expand a lab block into two timetable entries.
         */
        for (
            let offset = 0;
            offset < lesson.duration;
            offset++
        ) {
            timetable.push({
                semester: lesson.semester,
                classId: lesson.classId,
                className: lesson.className,
                subjectId: lesson.subjectId,
                subject: lesson.subjectName,
                teacherId: lesson.teacherId,
                type: lesson.type,
                day: data.days[placement.dayIndex],
                period: placement.periodIndex + offset + 1,
                room: room.id
            });
        }
    }

    /*
     * STEP 12: Sort by class, day, and period
     */
    const dayOrder = new Map(
        data.days.map(
            (day, index) => [day, index]
        )
    );

    timetable.sort((a, b) => {
        if (a.classId !== b.classId) {
            return a.classId.localeCompare(b.classId);
        }

        const dayDifference =
            dayOrder.get(a.day) - dayOrder.get(b.day);

        if (dayDifference !== 0) {
            return dayDifference;
        }

        return a.period - b.period;
    });

    return timetable;
}