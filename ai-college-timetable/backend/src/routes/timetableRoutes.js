import express from "express";

import {
    generate,
    generateWithAI,
    geminiTest,
    modifyWithAI
} from "../controllers/timetableController.js";
const router = express.Router();

/*
 * OR-Tools test
 */
router.get(
    "/generate-test",
    generate
);

/*
 * Gemini connection test
 */
router.get(
    "/gemini-test",
    geminiTest
);

/*
 * Gemini + OR-Tools
 */
router.post(
    "/generate-ai",
    generateWithAI
);

router.post(
    "/modify",
    modifyWithAI
);

export default router;