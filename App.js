import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authRoutes } from "./routes/auth.js";
import { recordsRoutes } from "./routes/records.js";
import usersRouter from "./routes/UserRoutes.js";
import poolsRouter from "./routes/PoolRoutes.js";
import brokersRouter from "./routes/BrokerRoutes.js";
import { apiRateLimit, protectMutations, setSecurityHeaders } from "./middleware/SecurityMiddleware.js";

const app = express();
app.disable("x-powered-by");
app.use(setSecurityHeaders);
app.set("trust proxy", 1);

// For a separately hosted Render frontend, set FRONTEND_URL to its HTTPS origin.
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",").map(value => value.trim().replace(/\/$/, "")).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.vary("Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});

app.get("/health", (_req, res) => res.status(200).json({ status: "ok", service: "InfoPanel API" }));
app.use(express.json({ limit: "48kb" }), cookieParser());
app.use("/api", apiRateLimit, protectMutations, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method) && !req.is("application/json")) {
    return res.status(415).json({ error: "JSON required." });
  }
  next();
});

authRoutes(app);
app.use("/api/users", usersRouter);
app.use("/api/pools", poolsRouter);
app.use("/api/brokers", brokersRouter);
recordsRoutes(app);
app.use("/api", (_req, res) => res.status(404).json({ error: "Endpoint not found." }));

// Optional combined deployment: SERVE_FRONTEND=true after building frontend/dist.
if (process.env.SERVE_FRONTEND === "true") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, "../frontend/dist");
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((error, _req, res, _next) => {
  const errors = {
    23505: "That value already exists.",
    23503: "This record is linked to another record.",
    22007: "Invalid date.",
    "22P02": "Invalid field value.",
    22008: "Invalid date."
  };
  const status = Number(error.status) || (errors[error.code] ? 400 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({
    error: errors[error.code] || (status < 500 ? error.message : "Unexpected server error.")
  });
});

export default app;
