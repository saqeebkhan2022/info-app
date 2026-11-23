import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, fail } from "../db/index.js";
import { requireAuth, currentUserQuery } from "../middleware/AuthMiddleware.js";
const cookie = {
  httpOnly: true,
  sameSite: ["strict", "lax", "none"].includes(process.env.COOKIE_SAME_SITE) ? process.env.COOKIE_SAME_SITE : "lax",
  secure: process.env.COOKIE_SECURE === "true",
  path: "/",
};
if (process.env.COOKIE_SAME_SITE === "none" && process.env.COOKIE_SECURE !== "true") {
  throw new Error("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true");
}
const select = currentUserQuery;
const refreshCookie = {...cookie, path: "/api"};
function issue(user, type, lifetime) {
  return jwt.sign({sub:String(user.id), v:user.version, type}, process.env.JWT_SECRET,
    {algorithm:"HS256", expiresIn:lifetime});
}
function setAccess(res,user) {
  return res.cookie("session",issue(user,"access",900),{...cookie,maxAge:900000});
}
function clearSession(res) {
  return res.clearCookie("session",cookie).clearCookie("refresh",refreshCookie);
}
export function authRoutes(app) {
  app.post(
    "/api/login",
    rateLimit({
      windowMs: 900000,
      limit: 10,
      skipSuccessfulRequests: true,
      message: { error: "Too many login attempts. Try again later." },
    }),
    async (req, res) => {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const {
        rows: [u],
      } = await db.query(
        select.replace("u.version,", "u.version,u.password_hash,") +
          "u.email=$1",
        [email],
      );
      if (
        !u ||
        !(await bcrypt.compare(
          String(req.body?.password || ""),
          u.password_hash,
        ))
      )
        fail("Invalid email or password.", 401);
      setAccess(res,u).cookie("refresh",issue(u,"refresh",604800),
        {...refreshCookie,maxAge:604800000}).json({ok:true});
    },
  );
  app.post("/api/refresh", async(req,res)=>{
    let claims;
    try {
      claims=jwt.verify(req.cookies.refresh,process.env.JWT_SECRET,{algorithms:["HS256"]});
      if(claims.type!=="refresh") throw Error();
    } catch { fail("Please sign in again.",401); }
    const {rows:[user]}=await db.query(select+"u.id=$1 and u.version=$2",[claims.sub,claims.v]);
    if(!user) fail("Session expired. Please sign in again.",401);
    setAccess(res,user).json({ok:true});
  });
  // All endpoints below require a valid session cookie.
  app.use("/api", requireAuth);
  app.get("/api/me", (req, res) => res.json(req.user));
  app.post("/api/logout", async (req, res) => {
    await db.query("update users set version=version+1 where id=$1", [
      req.user.id,
    ]);
    clearSession(res).json({ ok: true });
  });
  app.post("/api/password", async (req, res) => {
    const { oldPassword, password } = req.body;
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      Buffer.byteLength(password) > 72
    )
      fail("Use at least 12 characters and at most 72 bytes.");
    const {
      rows: [u],
    } = await db.query("select password_hash from users where id=$1", [
      req.user.id,
    ]);
    if (!(await bcrypt.compare(String(oldPassword || ""), u.password_hash)))
      fail("Current password is incorrect.");
    const result = await db.query(
      "update users set password_hash=$1,version=version+1 where id=$2 and version=$3",
      [await bcrypt.hash(password, 12), req.user.id, req.user.version],
    );
    if (!result.rowCount) fail("Session changed. Sign in again.", 401);
    clearSession(res).json({ ok: true });
  });
}
