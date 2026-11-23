import rateLimit from "express-rate-limit";

export const apiRateLimit = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false });

// Cookie authentication requires origin validation on all state-changing requests.
// For browsers, Origin is validated. Non-browser clients must include an exact
// allowed Origin as well when using cookies for authenticated writes.
export function protectMutations(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.headers.origin;
  const configured = (process.env.FRONTEND_URL || "").split(",").map(s=>s.trim().replace(/\/$/, "")).filter(Boolean);
  const host = req.get("host");
  const sameOrigin = host && `${req.protocol}://${host}` === origin;
  if (!origin || !(sameOrigin || configured.includes(origin))) {
    return res.status(403).json({ error: "Invalid request origin." });
  }
  next();
}

export function setSecurityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}
