import { db, fail } from "../db/index.js";
import Excel from "exceljs";
import {
  catalogs,
  money,
  checkAccess,
  conditions,
  totals,
  valuesFor,
} from "../models/records.js";
export async function lookups(req, res) {
  const result = {};
  for (const table of ["pools", "brokers", "clients"])
    result[table] = (
      await db.query(
        "select id,name from " +
          table +
          (table === "clients" ? "" : " where active") +
          " order by name",
      )
    ).rows;
  const staff = (await db.query(
    `select u.id,u.name,r.profile from users u join roles r on r.id=u.role_id
     where u.active and (r.profile='Manager' or
       (r.profile='Retainer' and ($1::boolean or u.id=$2))) order by u.name,u.id`,
    [req.user.profile !== "Retainer",req.user.id]
  )).rows;
  result.managers = staff.filter(person => person.profile === "Manager");
  result.retainers = staff.filter(person => person.profile === "Retainer");
  result.roles =
    req.user.profile === "Retainer"
      ? []
      : (
          await db.query(
            "select id,name from roles " +
              (req.user.profile === "Manager"
                ? "where profile='Retainer'"
                : "") +
              " order by name",
          )
        ).rows;
  res.json(result);
}
export async function dashboard(req, res) {
  const { from, args } = conditions("operations", req.user, req.query);
  const grouped = async (key) =>
    (
      await db.query(
        "select " +
          key +
          " as name," +
          totals +
          from +
          " group by " +
          key +
          " order by " +
          key,
        args,
      )
    ).rows;
  res.json({
    totals: (await db.query("select " + totals + from, args)).rows[0],
    pools: await grouped("pool"),
    brokers: await grouped("broker"),
  });
}
export async function monthlyIncome(req, res) {
  const { from, to } = req.query;
  const validDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value.slice(0,4) !== "0000" && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0,10) === value;
  if (!validDate(from) || !validDate(to) || from > to) fail("Choose a valid start and end date.");
  const scoped = conditions("operations", req.user, {from, to});
  const first = "$" + (scoped.args.length + 1);
  const last = "$" + (scoped.args.length + 2);
  const result = await db.query(
    `with sums as (
      select date_trunc('month',created_at at time zone 'Asia/Dubai') as month,
             sum(first_deposit+re_deposit) as deposits ${scoped.from} group by 1
    )
    select to_char(m.month,'YYYY-MM') as month, coalesce(s.deposits,0) as deposits
    from generate_series(date_trunc('month',${first}::date::timestamp),
         date_trunc('month',${last}::date::timestamp),interval '1 month') m(month)
    left join sums s using(month) order by m.month`,
    [...scoped.args, from, to]
  );
  res.json(result.rows);
}
export async function exportOperations(req, res) {
  const { from, args } = conditions("operations", req.user, req.query);
  const fields = [
    "client",
    "account_no",
    "email",
    "phone",
    "platform",
    "pool",
    "broker",
    "manager",
    "retainer",
    ...money,
    "trading_type",
    "created_at",
  ];
  const rows = (
    await db.query(
      "select " + fields.join(",") + from + " order by id desc",
      args,
    )
  ).rows;
  const book = new Excel.Workbook(),
    sheet = book.addWorksheet("Operations");
  sheet.columns = fields.map((key) => ({
    key,
    header: key.replaceAll("_", " "),
    width: 22,
  }));
  for (const row of rows) {
    for (const k of money) row[k] = Number(row[k]);
    row.created_at = row.created_at.toLocaleString("en-GB", {
      timeZone: "Asia/Dubai",
    });
    sheet.addRow(row);
  }
  res
    .attachment("Client-Operations.xlsx")
    .send(Buffer.from(await book.xlsx.writeBuffer()));
}
export async function list(req, res) {
  const { kind } = req.params;
  checkAccess(kind, req.user);
  const { from, args } = conditions(kind, req.user, req.query);
  const limit = Number(req.query.limit || 10),
    requested = Number(req.query.page || 1);
  if (
    ![10, 25, 50, 100].includes(limit) ||
    !Number.isSafeInteger(requested) ||
    requested < 1
  )
    fail("Invalid pagination.");
  const summary = (
    await db.query(
      "select count(*)::int total" +
        (kind === "operations" ? "," + totals : "") +
        from,
      args,
    )
  ).rows[0];
  const page = Math.min(
    requested,
    Math.max(1, Math.ceil(summary.total / limit)),
  );
  const rows = (
    await db.query(
      "select *" +
        from +
        " order by id desc limit " +
        limit +
        " offset " +
        (page - 1) * limit,
      args,
    )
  ).rows;
  res.json({ rows, page, ...summary });
}
async function linkedOperations(connection, id) {
  const {rows:[row]} = await connection.query(
    "select count(*)::int as count from operations where client_id=$1", [id]
  );
  return row.count;
}
export async function clientDeletePreview(req,res) {
  if(req.user.profile==="Retainer") fail("Management access required.",403);
  res.json({count:await linkedOperations(db,req.params.id)});
}
export async function mutate(req, res) {
  const method = req.method.toLowerCase();
  const { kind, id } = req.params;
  const user = req.user;
  checkAccess(kind, user, true);
  const c = await db.connect();
  try {
    await c.query("begin");
    const row = id
      ? (
          await c.query("select * from " + kind + " where id=$1 for update", [
            id,
          ])
        ).rows[0]
      : null;
    if (id && (!row || row.deleted_at)) fail("Record not found.", 404);
    if (kind === "roles" && row?.builtin)
      fail("Built-in roles are protected.", 403);
    if (kind === "users" && row) {
      if (row.id === user.id) fail("Use Change password for your own account.");
      const target = (
        await c.query("select profile from roles where id=$1", [row.role_id])
      ).rows[0];
      if (user.profile === "Manager" && target.profile !== "Retainer")
        fail("This account is protected.", 403);
    }
    if (
      kind === "operations" &&
      row &&
      user.profile === "Retainer" &&
      row.retainer_id !== user.id
    )
      fail("Access denied.", 403);
    if (method === "delete") {
      if (
        ["clients", "operations"].includes(kind) &&
        user.profile === "Retainer"
      )
        fail("Management access required.", 403);
      if(kind==="clients") {
        const count=await linkedOperations(c,id);
        if(count && (req.body?.cascade!==true || req.body?.expectedCount!==count))
          fail("Linked operations changed. Review the updated count before deleting.",409);
        if(count) await c.query("delete from operations where client_id=$1",[id]);
      }
      const sql = catalogs.includes(kind)
        ? "update " + kind + " set active=false"
        : kind === "operations"
          ? "update operations set deleted_at=now()"
          : "delete from " + kind;
      await c.query(sql + " where id=$1", [id]);
    } else {
      const data = await valuesFor(kind, req.body, user, row, c);
      const keys = Object.keys(data),
        vals = Object.values(data),
        params = vals.map((_, i) => "$" + (i + 1));
      if (id)
        await c.query(
          "update " +
            kind +
            " set " +
            keys.map((k, i) => k + "=" + params[i]).join(",") +
            " where id=$" +
            (vals.length + 1),
          [...vals, id],
        );
      else
        await c.query(
          "insert into " +
            kind +
            "(" +
            keys.join(",") +
            ") values(" +
            params.join(",") +
            ")",
          vals,
        );
    }
    await c.query("commit");
    res.json({ ok: true });
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
