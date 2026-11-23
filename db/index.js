import "dotenv/config";
import pg from "pg";
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
export const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function initialize() {
  if (!process.env.DATABASE_URL || (process.env.JWT_SECRET || "").length < 32)
    throw Error("Configure DATABASE_URL and JWT_SECRET in backend/.env.");
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query("select pg_advisory_xact_lock(724921)");
    await c.query(
      await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8"),
    );
    // Seed a local administrator only if this email is missing; never reset an existing password.
    const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (email && !(await c.query("select 1 from users where lower(email)=$1", [email])).rowCount) {
      if ((process.env.ADMIN_PASSWORD || "").length < 12)
        throw Error("Set ADMIN_PASSWORD to at least 12 characters.");
      await c.query(
        "insert into users(name,email,password_hash,role_id) select 'Super Admin',$1,$2,id from roles where profile='Administrator'",
        [
          email,
          await bcrypt.hash(process.env.ADMIN_PASSWORD, 12),
        ],
      );
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
export function fail(message, status = 400) {
  throw Object.assign(Error(message), { status });
}
