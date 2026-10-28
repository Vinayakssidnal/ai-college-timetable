import { Router } from "express";
import {
    readStore,
    safeUser,
    verifyPassword,
} from "../services/portalStore.js";
import {
    createSession,
    deleteSession,
} from "../services/authService.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = Router();

router.post("/login", async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();
        const password = String(req.body?.password || "");

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: "Username and password are required.",
            });
        }

        const store = await readStore();
        const user = store.users.find(
            (item) => item.username.toLowerCase() === username.toLowerCase()
        );

        if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
            return res.status(401).json({
                success: false,
                message: "Invalid username or password.",
            });
        }

        if (user.role === "teacher") {
            const teacherExists = store.collegeData.teachers.some(
                (teacher) => teacher.id === user.teacherId
            );
            if (!teacherExists) {
                return res.status(403).json({
                    success: false,
                    message: "This teacher account is not currently registered.",
                });
            }
        }

        const token = createSession(user);
        return res.json({ success: true, token, user: safeUser(user) });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({
            success: false,
            message: "Login failed. Check the backend terminal for details.",
        });
    }
});

router.get("/me", requireAuth, (req, res) => {
    return res.json({ success: true, user: req.user });
});

router.post("/logout", requireAuth, (req, res) => {
    deleteSession(req.sessionToken);
    return res.json({ success: true, message: "Logged out successfully." });
});

export default router;
