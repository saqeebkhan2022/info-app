import { list, mutate } from "./records.js";
// Keep the genuine Express request object: spreading req loses req.query.
// All shared CRUD logic, including access control and transactions, remains intact.
function scoped(handler) {
  return (req, res, next) => {
    req.params.kind = "pools";
    return Promise.resolve(handler(req, res)).catch(next);
  };
}
export const listPool = scoped(list);
export const createPool = scoped(mutate);
export const updatePool = scoped(mutate);
export const deletePool = scoped(mutate);
