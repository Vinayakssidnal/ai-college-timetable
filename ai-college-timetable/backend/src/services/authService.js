import { randomBytes } from "node:crypto";

// Demo session store. Sessions expire when the backend process restarts.
const sessions = new Map();

export function createSession(user) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, {
        username: user.username,
        role: user.role,
        displayName: user.displayName,
        teacherId: user.teacherId || null,
        createdAt: Date.now(),
    });
    return token;
}

export function getSession(token) {
    return token ? sessions.get(token) || null : null;
}

export function deleteSession(token) {
    if (token) sessions.delete(token);
}
