import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { sampleCollegeData } from "../data/sampleData.js";

const DATA_DIR = fileURLToPath(new URL("../../data/", import.meta.url));
const STORE_PATH = path.join(DATA_DIR, "portal-store.json");
let initPromise;

export function createPasswordRecord(password) {
    const salt = randomBytes(16).toString("hex");
    const passwordHash = scryptSync(String(password), salt, 64).toString("hex");
    return { salt, passwordHash };
}

export function verifyPassword(password, salt, passwordHash) {
    try {
        const actual = scryptSync(String(password), salt, 64);
        const expected = Buffer.from(passwordHash, "hex");
        return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
        return false;
    }
}

function publicUser(user) {
    return {
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        teacherId: user.teacherId || null,
    };
}

function defaultMetadata() {
    return {
        collegeName: "RAMAIAH INSTITUTE OF TECHNOLOGY",
        departmentName: "DEPARTMENT OF COMPUTER SCIENCE & ENGINEERING",
        effectiveDate: "",
        academicYear: "2026-2027",
        term: "",
    };
}

async function createInitialStore() {
    await mkdir(DATA_DIR, { recursive: true });
    const collegeData = structuredClone(sampleCollegeData);
    const users = [];

    for (const [username, displayName] of [
        ["creator1", "Timetable Creator"],
    ]) {
        users.push({
            username,
            displayName,
            role: "creator",
            teacherId: null,
            ...createPasswordRecord(process.env.CREATOR_DEFAULT_PASSWORD || "Creator@123"),
        });
    }

    for (const teacher of collegeData.teachers || []) {
        users.push({
            username: teacher.id,
            displayName: teacher.name,
            role: "teacher",
            teacherId: teacher.id,
            ...createPasswordRecord(process.env.TEACHER_DEFAULT_PASSWORD || "Teacher@123"),
        });
    }

    return {
        collegeData,
        timetable: [],
        aiRequirements: null,
        metadata: defaultMetadata(),
        users,
    };
}

async function initialize() {
    await mkdir(DATA_DIR, { recursive: true });
    try {
        await readFile(STORE_PATH, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
        const initial = await createInitialStore();
        await writeFile(STORE_PATH, JSON.stringify(initial, null, 2), "utf8");
    }

    // Every registered teacher can log in using their teacher ID.
    const store = JSON.parse(await readFile(STORE_PATH, "utf8"));
    let changed = false;
    store.users ||= [];
    store.metadata ||= defaultMetadata();
    store.timetable ||= [];

    // This portal has exactly one creator account. Remove legacy extra creator accounts.
    const originalUserCount = store.users.length;
    store.users = store.users.filter(
        (user) => user.role !== "creator" || user.username === "creator1"
    );
    if (store.users.length !== originalUserCount) changed = true;

    for (const [username, displayName] of [
        ["creator1", "Timetable Creator"],
    ]) {
        if (!store.users.some((user) => user.role === "creator" && user.username === username)) {
            store.users.push({
                username,
                displayName,
                role: "creator",
                teacherId: null,
                ...createPasswordRecord(process.env.CREATOR_DEFAULT_PASSWORD || "Creator@123"),
            });
            changed = true;
        }
    }

    for (const teacher of store.collegeData?.teachers || []) {
        const existing = store.users.find(
            (user) => user.role === "teacher" && user.teacherId === teacher.id
        );
        if (!existing) {
            store.users.push({
                username: teacher.id,
                displayName: teacher.name,
                role: "teacher",
                teacherId: teacher.id,
                ...createPasswordRecord(process.env.TEACHER_DEFAULT_PASSWORD || "Teacher@123"),
            });
            changed = true;
        } else if (existing.displayName !== teacher.name) {
            existing.displayName = teacher.name;
            changed = true;
        }
    }

    if (changed) await writeStore(store);
}

async function writeStore(store) {
    await mkdir(DATA_DIR, { recursive: true });
    const tempPath = `${STORE_PATH}.tmp`;
    await writeFile(tempPath, JSON.stringify(store, null, 2), "utf8");
    await rename(tempPath, STORE_PATH);
}

export async function readStore() {
    if (!initPromise) initPromise = initialize();
    await initPromise;
    return JSON.parse(await readFile(STORE_PATH, "utf8"));
}

export async function saveStore(store) {
    if (!initPromise) initPromise = initialize();
    await initPromise;
    await writeStore(store);
}

export function safeUser(user) {
    return publicUser(user);
}

export function ensureTeacherAccounts(store) {
    for (const teacher of store.collegeData?.teachers || []) {
        let user = store.users.find(
            (item) => item.role === "teacher" && item.teacherId === teacher.id
        );
        if (!user) {
            user = {
                username: teacher.id,
                displayName: teacher.name,
                role: "teacher",
                teacherId: teacher.id,
                ...createPasswordRecord(process.env.TEACHER_DEFAULT_PASSWORD || "Teacher@123"),
            };
            store.users.push(user);
        } else {
            user.username = teacher.id;
            user.displayName = teacher.name;
        }
    }
}
