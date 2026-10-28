export const sampleCollegeData = {

    // Working days
    days: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday"
    ],

    // Number of periods per day
    periodsPerDay: 6,

    // Periods 1-3 are before lunch; periods 4-6 are after lunch
    lunchAfterPeriod: 3,

    // Rooms
    // classroom -> theory subjects
    // lab       -> laboratory subjects
    rooms: [
        {
            id: "R101",
            type: "classroom"
        },
        {
            id: "R102",
            type: "classroom"
        },
        {
            id: "R103",
            type: "classroom"
        },
        {
            id: "LAB1",
            type: "lab"
        },
        {
            id: "LAB2",
            type: "lab"
        }
    ],

    // Teachers and their maximum weekly workloads
    teachers: [
        {
            id: "T1",
            name: "Ravi",
            weeklyWorkload: 16
        },
        {
            id: "T2",
            name: "Kumar",
            weeklyWorkload: 16
        },
        {
            id: "T3",
            name: "Anitha",
            weeklyWorkload: 14
        },
        {
            id: "T4",
            name: "Raj",
            weeklyWorkload: 12
        }
    ],

    // Classes by semester
    classes: [
        {
            id: "CSE-A",
            name: "CSE-A",
            semester: 5,

            subjects: [
                {
                    id: "SUB001",
                    name: "DBMS",
                    teacherId: "T1",
                    periodsPerWeek: 4,
                    type: "theory"
                },
                {
                    id: "SUB002",
                    name: "Operating Systems",
                    teacherId: "T2",
                    periodsPerWeek: 4,
                    type: "theory"
                },
                {
                    id: "SUB003",
                    name: "Artificial Intelligence",
                    teacherId: "T3",
                    periodsPerWeek: 3,
                    type: "theory"
                },
                {
                    id: "SUB004",
                    name: "Computer Networks",
                    teacherId: "T4",
                    periodsPerWeek: 3,
                    type: "theory"
                },
                {
                    id: "SUB005",
                    name: "DBMS Lab",
                    teacherId: "T1",
                    periodsPerWeek: 2,
                    type: "lab"
                }
            ]
        },

        {
            id: "CSE-B",
            name: "CSE-B",
            semester: 5,

            subjects: [
                {
                    id: "SUB006",
                    name: "DBMS",
                    teacherId: "T1",
                    periodsPerWeek: 4,
                    type: "theory"
                },
                {
                    id: "SUB007",
                    name: "Operating Systems",
                    teacherId: "T2",
                    periodsPerWeek: 4,
                    type: "theory"
                },
                {
                    id: "SUB008",
                    name: "Artificial Intelligence",
                    teacherId: "T3",
                    periodsPerWeek: 3,
                    type: "theory"
                },
                {
                    id: "SUB009",
                    name: "Computer Networks",
                    teacherId: "T4",
                    periodsPerWeek: 3,
                    type: "theory"
                }
            ]
        }
    ]
};