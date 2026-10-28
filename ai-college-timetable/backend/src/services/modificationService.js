
/*
 * =========================================================
 * APPLY A TIMETABLE MODIFICATION
 * =========================================================
 */

function normalize(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function sameValue(a, b) {
    return normalize(a) === normalize(b);
}

function roomMatches(type, roomType) {
    return normalize(type) === "lab"
        ? normalize(roomType) === "lab"
        : normalize(roomType) === "classroom";
}

function getSessionGroups(entries) {
    const groups = new Map();

    for (const entry of entries) {
        const key = `${normalize(entry.day)}::${normalize(entry.room)}`;

        if (!groups.has(key)) {
            groups.set(key, []);
        }

        groups.get(key).push(entry);
    }

    return [...groups.values()].map(group =>
        group.sort((a, b) => Number(a.period) - Number(b.period))
    );
}

function classMatches(entry, classInfo, requestedClassName) {
    return (
        sameValue(entry.classId, classInfo.id) ||
        sameValue(
            entry.className ?? entry.classId,
            requestedClassName
        ) ||
        sameValue(entry.className, classInfo.name)
    );
}

function subjectMatches(entry, subjectInfo, requestedSubjectName) {
    return (
        sameValue(entry.subjectId, subjectInfo.id) ||
        sameValue(
            entry.subject ?? entry.subjectName,
            requestedSubjectName
        ) ||
        sameValue(entry.subject, subjectInfo.name)
    );
}

export function applyTimetableModification(
    currentTimetable,
    modification,
    solverData
) {
    /*
     * STEP 1: Validate input.
     */
    if (!Array.isArray(currentTimetable)) {
        throw new Error("currentTimetable must be an array.");
    }

    if (!solverData || !Array.isArray(solverData.classes)) {
        throw new Error("Solver class configuration is missing.");
    }

    if (!modification || typeof modification !== "object") {
        throw new Error("A valid modification object is required.");
    }

    /*
     * STEP 2: Find the class.
     */
    const classInfo = solverData.classes.find(cls =>
        sameValue(cls.name || cls.id, modification.className) ||
        sameValue(cls.id, modification.className)
    );

    if (!classInfo) {
        throw new Error(
            `Class "${modification.className}" was not found.`
        );
    }

    /*
     * STEP 3: Find the subject belonging to this class.
     */
    const subjectInfo = classInfo.subjects.find(subject =>
        sameValue(subject.name, modification.subjectName) ||
        sameValue(subject.id, modification.subjectName)
    );

    if (!subjectInfo) {
        throw new Error(
            `Subject "${modification.subjectName}" was not found ` +
            `for class ${classInfo.name || classInfo.id}.`
        );
    }

    /*
     * STEP 4: Validate the target day.
     */
    const dayName = solverData.days.find(day =>
        sameValue(day, modification.targetDay)
    );

    if (!dayName) {
        throw new Error(
            `Unknown target day "${modification.targetDay}".`
        );
    }

    /*
     * STEP 5: Find all entries for this class and subject.
     *
     * Match by IDs OR names because timetable fields and
     * solver configuration fields may use different identifiers.
     */
    const matchingEntries = currentTimetable.filter(entry =>
        classMatches(
            entry,
            classInfo,
            modification.className
        ) &&
        subjectMatches(
            entry,
            subjectInfo,
            modification.subjectName
        )
    );

    if (matchingEntries.length === 0) {
        throw new Error(
            `No timetable entries found for "${modification.subjectName}" ` +
            `in class "${modification.className}". ` +
            "Check the currentTimetable and solver configuration."
        );
    }

    /*
     * STEP 6: Group entries into candidate sessions.
     */
    let candidateGroups = getSessionGroups(matchingEntries);

    const requestedFromPeriod = Number(modification.fromPeriod);

    /*
     * Filter by source day and source period together.
     */
    if (modification.fromDay || requestedFromPeriod > 0) {
        candidateGroups = candidateGroups.filter(group =>
            group.some(entry =>
                (
                    !modification.fromDay ||
                    sameValue(entry.day, modification.fromDay)
                ) &&
                (
                    !(requestedFromPeriod > 0) ||
                    Number(entry.period) === requestedFromPeriod
                )
            )
        );
    }

    if (candidateGroups.length === 0) {
        const availableSlots = matchingEntries
            .map(entry => `${entry.day} period ${entry.period}`)
            .join(", ");

        throw new Error(
            `Source lesson not found for ${modification.className}, ` +
            `${modification.subjectName}, ${modification.fromDay}, ` +
            `period ${modification.fromPeriod}. ` +
            `Available entries: ${availableSlots || "none"}.`
        );
    }

    /*
     * STEP 7: Determine the session duration.
     *
     * Theory: one period.
     * Lab: two consecutive periods.
     */
    const duration =
        normalize(subjectInfo.type) === "lab" ? 2 : 1;

    candidateGroups = candidateGroups.filter(group => {
        if (group.length !== duration) {
            return false;
        }

        for (let i = 1; i < group.length; i++) {
            if (
                Number(group[i].period) !==
                Number(group[i - 1].period) + 1
            ) {
                return false;
            }
        }

        return true;
    });

    if (candidateGroups.length === 0) {
        throw new Error(
            "The source lesson is not a valid consecutive session."
        );
    }

    /*
     * STEP 8: Generate possible target periods.
     *
     * Period numbering starts at 1.
     */
    const periodsPerDay = Number(solverData.periodsPerDay);

    if (!Number.isInteger(periodsPerDay) || periodsPerDay < 1) {
        throw new Error("Invalid periodsPerDay configuration.");
    }

    const maxStart = periodsPerDay - duration + 1;

    const configuredLunch = solverData.lunchAfterPeriod;

    const lunchAfter =
        Number.isInteger(configuredLunch)
            ? configuredLunch
            : Math.floor(periodsPerDay / 2);

    let targetPeriods = [];

    if (Number(modification.targetPeriod) > 0) {
        targetPeriods = [Number(modification.targetPeriod)];
    } else if (modification.targetTime === "afternoon") {
        for (
            let period = lunchAfter + 1;
            period <= maxStart;
            period++
        ) {
            targetPeriods.push(period);
        }
    } else if (modification.targetTime === "morning") {
        for (
            let period = 1;
            period <= Math.min(lunchAfter, maxStart);
            period++
        ) {
            targetPeriods.push(period);
        }
    } else {
        for (let period = 1; period <= maxStart; period++) {
            targetPeriods.push(period);
        }
    }

    targetPeriods = targetPeriods.filter(period =>
        Number.isInteger(period) &&
        period >= 1 &&
        period <= maxStart
    );

    if (targetPeriods.length === 0) {
        throw new Error(
            "No valid starting period matches the requested time."
        );
    }

    const preference = solverData.preferences || {};

    /*
     * STEP 9: Try candidate sessions and target slots.
     */
    for (const session of candidateGroups) {
        const entriesToMove = new Set(session);

        for (const startPeriod of targetPeriods) {
            /*
             * Keep labs after lunch when required.
             */
            if (
                preference.labsAfterLunch === true &&
                normalize(subjectInfo.type) === "lab" &&
                startPeriod <= lunchAfter
            ) {
                continue;
            }

            /*
             * Try the current room first, followed by other
             * compatible rooms.
             */
            const existingRoom = session[0].room;

            const compatibleRooms = solverData.rooms
                .filter(room =>
                    roomMatches(subjectInfo.type, room.type)
                )
                .sort((a, b) => {
                    if (sameValue(a.id, existingRoom)) return -1;
                    if (sameValue(b.id, existingRoom)) return 1;
                    return 0;
                });

            for (const room of compatibleRooms) {
                let conflict = false;

                /*
                 * Check class, teacher, and room availability
                 * for every period occupied by this session.
                 */
                for (let offset = 0; offset < duration; offset++) {
                    const period = startPeriod + offset;

                    for (const entry of currentTimetable) {
                        if (entriesToMove.has(entry)) {
                            continue;
                        }

                        const sameSlot =
                            sameValue(entry.day, dayName) &&
                            Number(entry.period) === period;

                        if (!sameSlot) {
                            continue;
                        }

                        const sameClass = classMatches(
                            entry,
                            classInfo,
                            modification.className
                        );

                        const sameTeacher = sameValue(
                            entry.teacherId,
                            subjectInfo.teacherId
                        );

                        const sameRoom = sameValue(
                            entry.room,
                            room.id
                        );

                        if (sameClass || sameTeacher || sameRoom) {
                            conflict = true;
                            break;
                        }
                    }

                    if (conflict) {
                        break;
                    }
                }

                if (conflict) {
                    continue;
                }

                /*
                 * Respect the one-occurrence-per-subject-per-day
                 * preference.
                 */
                if (
                    preference.avoidRepeatedSubjectSameDay === true &&
                    currentTimetable.some(entry =>
                        !entriesToMove.has(entry) &&
                        classMatches(
                            entry,
                            classInfo,
                            modification.className
                        ) &&
                        subjectMatches(
                            entry,
                            subjectInfo,
                            modification.subjectName
                        ) &&
                        sameValue(entry.day, dayName)
                    )
                ) {
                    continue;
                }

                /*
                 * STEP 10: Apply the modification only after
                 * all checks have passed.
                 */
                const movedEntries = session.map((entry, index) => ({
                    ...entry,
                    day: dayName,
                    period: startPeriod + index,
                    room: room.id
                }));

                const updatedTimetable = currentTimetable
                    .filter(entry => !entriesToMove.has(entry))
                    .concat(movedEntries);

                /*
                 * Sort by class, weekday, and period.
                 */
                const dayOrder = new Map(
                    solverData.days.map((day, index) => [day, index])
                );

                updatedTimetable.sort((a, b) => {
                    const classComparison =
                        String(a.classId).localeCompare(
                            String(b.classId)
                        );

                    if (classComparison !== 0) {
                        return classComparison;
                    }

                    const dayDifference =
                        (dayOrder.get(a.day) ?? 999) -
                        (dayOrder.get(b.day) ?? 999);

                    if (dayDifference !== 0) {
                        return dayDifference;
                    }

                    return Number(a.period) - Number(b.period);
                });

                return {
                    timetable: updatedTimetable,
                    change: {
                        className: classInfo.name || classInfo.id,
                        subject: subjectInfo.name,
                        fromDay: session[0].day,
                        fromPeriod: session[0].period,
                        toDay: dayName,
                        toPeriod: startPeriod,
                        room: room.id
                    }
                };
            }
        }
    }

    /*
     * No candidate passed all constraints.
     * The original timetable remains unchanged.
     */
    throw new Error(
        "No conflict-free slot was found for this modification. " +
        "The current timetable has not been changed."
    );
}
