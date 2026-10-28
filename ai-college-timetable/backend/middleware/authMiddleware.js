import { getSession } from "../services/authService.js";

export function requireAuth(req, res, next) {
    const authorization = req.headers.authorization || "";
    const [scheme, token] = authorization.split(" ");
    const user = scheme === "Bearer" ? getSession(token) : null;

    if (!user) {
        return res.status(401).json({
            success: false,
            message: "Please log in to access this feature.",
        });
    }

    req.user = user;
    req.sessionToken = token;
    return next();
}

export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: "You do not have permission to perform this action.",
            });
        }
        return next();
    };
}
