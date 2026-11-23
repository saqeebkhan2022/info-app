// User repository facade: shared validated PostgreSQL transaction logic
// lives in models/records.js and is reused to keep existing client features compatible.
import { conditions, checkAccess, valuesFor } from "./records.js";
export const resource = "users";
export function checkUserAccess(user, write = false) { return checkAccess(resource, user, write); }
export function userFilters(user, filters) { return conditions(resource, user, filters); }
export function validateUser(body, actor, existing, connection) {
  return valuesFor(resource, body, actor, existing, connection);
}
