import jwt from "jsonwebtoken";
import { db, fail } from "../db/index.js";

export const currentUserQuery = `select u.id,u.name,u.email,u.version,r.name as role,r.profile
  from users u join roles r on r.id=u.role_id where u.active and `;

export async function requireAuth(req, _res, next) {
  let claims;
  try {
    claims = jwt.verify(req.cookies?.session || "", process.env.JWT_SECRET, { algorithms: ["HS256"] });
    if (claims.type !== "access") throw new Error("Incorrect token type");
  } catch { return next(Object.assign(new Error("Please sign in."), { status: 401 })); }
  try {
    const { rows: [user] } = await db.query(currentUserQuery + "u.id=$1 and u.version=$2", [claims.sub, claims.v]);
    if (!user) fail("Session expired. Please sign in.", 401);
    req.user = user;
    next();
  } catch (error) { next(error); }
}

export function requireRoles(...profiles) {
  return (req, _res, next) => req.user && profiles.includes(req.user.profile)
    ? next() : next(Object.assign(new Error("Access denied."), { status: 403 }));
}
