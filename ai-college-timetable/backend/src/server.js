import "dotenv/config";
import authRoutes from "./routes/authRoutes.js";
import portalRoutes from "./routes/portalRoutes.js";
import express from "express";
import cors from "cors";

import timetableRoutes from "./routes/timetableRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/portal", portalRoutes);
/*
 * Home route
 */
app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "AI College Timetable Generator Backend"
    });
});


/*
 * Health check
 */
app.get("/api/health", (req, res) => {

    res.json({
        success: true,
        message: "Backend is running"
    });
});


/*
 * Timetable routes
 */
app.use(
    "/api/timetable",
    timetableRoutes
);


/*
 * Unknown route
 */
app.use((req, res) => {

    res.status(404).json({

        success: false,

        message: "Route not found"
    });
});


/*
 * Global error handler
 */
app.use((err, req, res, next) => {

    console.error(err);

    res.status(500).json({

        success: false,

        message:
            err.message ||
            "Internal server error"
    });
});


const PORT =
    process.env.PORT || 5000;


app.listen(PORT, () => {

    console.log(
        `Server running on http://localhost:${PORT}`
    );
});