// Broker repository facade: shared validated PostgreSQL transaction logic
// lives in models/records.js and is reused to keep existing client features compatible.
import { conditions, checkAccess, valuesFor } from "./records.js";
export const resource = "brokers";
export function checkBrokerAccess(user, write = false) { return checkAccess(resource, user, write); }
export function brokerFilters(user, filters) { return conditions(resource, user, filters); }
export function validateBroker(body, actor, existing, connection) {
  return valuesFor(resource, body, actor, existing, connection);
}
