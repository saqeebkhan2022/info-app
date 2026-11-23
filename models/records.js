import bcrypt from "bcryptjs";
import { db, fail } from "../db/index.js";
const catalogs = ["pools", "brokers"];
const money = ["first_deposit", "re_deposit", "withdrawal"];
const trades = ["Standard", "VIP", "Islamic", "Raw"];
const resources = {
  roles: "select id,name,profile,builtin from roles",
  users:
    "select u.id,u.name,u.email,u.active,u.created_at,u.role_id,r.name role,r.profile from users u join roles r on r.id=u.role_id",
  clients: "select * from clients",
  pools: "select * from pools where active",
  brokers: "select * from brokers where active",
  operations: `select o.*,c.name client,c.phone,c.email,p.name pool,b.name broker,u.name retainer,m.name manager
 from operations o join clients c on c.id=o.client_id join pools p on p.id=o.pool_id join brokers b on b.id=o.broker_id
 left join users u on u.id=o.retainer_id left join users m on m.id=o.manager_id where o.deleted_at is null`,
};
function checkAccess(kind, user, write = false) {
  if (!Object.hasOwn(resources, kind)) fail("Unknown module.", 404);
  if (kind === "roles" && user.profile !== "Administrator")
    fail("Administrator access required.", 403);
  if (
    (kind === "users" || (write && catalogs.includes(kind))) &&
    user.profile === "Retainer"
  )
    fail("Management access required.", 403);
}
function conditions(kind, user, q = {}) {
  const args = [],
    parts = [];
  const bind = (v) => {
    args.push(v);
    return "$" + args.length;
  };
  if (kind === "operations" && user.profile === "Retainer")
    parts.push("retainer_id=" + bind(user.id));
  if (q.search) {
    const cols = {
      users: ["name", "email", "role"],
      roles: ["name", "profile"],
      clients: ["name", "phone", "email"],
      operations: ["client", "phone", "account_no", "email"],
      pools: ["name", "color"],
      brokers: ["name", "color"],
    }[kind];
    const param = bind("%" + String(q.search) + "%");
    parts.push("(" + cols.map((c) => c + " ilike " + param).join(" or ") + ")");
  }
  for (const field of {
    users: ["role_id", "active"],
    roles: ["profile"],
    operations: [
      "pool_id",
      "broker_id",
      "retainer_id",
      "manager_id",
      "trading_type",
    ],
  }[kind] || []) {
    if (q[field])
      parts.push(
        field +
          "::text = any(" +
          bind(String(q[field]).split(",")) +
          "::text[])",
      );
  }
  if (["clients", "operations", "users"].includes(kind)) {
    for (const [key, op] of [
      ["from", ">="],
      ["to", "<="],
    ])
      if (q[key])
        parts.push(
          "(created_at at time zone 'Asia/Dubai')::date " +
            op +
            bind(q[key]) +
            "::date",
        );
  }
  if (kind === "operations" && q.entry) {
    const selected = String(q.entry).split(",");
    if (!selected.every((x) => money.includes(x))) fail("Unknown entry type.");
    parts.push("(" + selected.map((x) => x + ">0").join(" or ") + ")");
  }
  return {
    from:
      " from (" +
      resources[kind] +
      ") records " +
      (parts.length ? "where " + parts.join(" and ") : ""),
    args,
  };
}
const totals = money.map((x) => "coalesce(sum(" + x + "),0) " + x).join(",");
async function valuesFor(kind, body, user, row, c) {
  const str = (k) => String(body[k] ?? "").trim();
  const required = (k) => str(k) || fail(k + " is required.");
  const data = {};
  if (kind !== "operations") data.name = required("name");
  if (kind === "roles") {
    if (!["Manager", "Retainer"].includes(body.profile))
      fail("Choose a valid access profile.");
    data.profile = body.profile;
  } else if (kind === "users") {
    data.email = required("email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) fail("Invalid email.");
    const role = (
      await c.query("select profile from roles where id=$1 for share", [
        required("role_id"),
      ])
    ).rows[0];
    if (!role || (user.profile === "Manager" && role.profile !== "Retainer"))
      fail("Cannot assign this role.", 403);
    data.role_id = body.role_id;
    data.active = body.active !== false && body.active !== "false";
    if (!row || body.password) {
      const pw = body.password;
      if (
        typeof pw !== "string" ||
        pw.length < 12 ||
        Buffer.byteLength(pw) > 72
      )
        fail("Use a password of at least 12 characters and at most 72 bytes.");
      data.password_hash = await bcrypt.hash(pw, 12);
    }
    if (row) data.version = row.version + 1;
  } else if (kind === "clients") {
    data.phone = required("phone");
    data.email = str("email");
  } else if (catalogs.includes(kind)) {
    if (!/^#[a-f0-9]{6}$/i.test(str("color"))) fail("Invalid color.");
    data.color = str("color");
  } else {
    data.client_id = required("client_id");
    for (const [key, table] of [
      ["pool_id", "pools"],
      ["broker_id", "brokers"],
      ["retainer_id", "users"],
      ["manager_id", "users"],
    ]) {
      let value = str(key) || null;
      if (key === "retainer_id" && user.profile === "Retainer") value = user.id;
      if (key !== "manager_id" && !value) fail(key + " is required.");
      if (value && table === "users") {
        const profile = key === "manager_id" ? "Manager" : "Retainer";
        const eligible = await c.query(
          "select u.id from users u join roles r on r.id=u.role_id where u.id=$1 and u.active and r.profile=$2 for share",
          [value, profile]
        );
        if (!eligible.rowCount) fail("Choose an active " + profile + ".");
      } else if (
        value &&
        String(row?.[key]) !== String(value) &&
        !(
          await c.query(
            "select id from " + table + " where id=$1 and active for share",
            [value],
          )
        ).rowCount
      )
        fail("Choose an active " + key);
      data[key] = value;
    }
    data.account_no = str("account_no");
    data.platform = str("platform");
    data.trading_type = required("trading_type");
    if (!trades.includes(data.trading_type)) fail("Invalid trading type.");
    for (const k of money) {
      const v = str(k) || "0";
      if (!/^\d{1,14}(\.\d{1,2})?$/.test(v))
        fail("Enter a valid amount for " + k);
      data[k] = v;
    }
  }
  return data;
}

export { catalogs, money, checkAccess, conditions, totals, valuesFor };
