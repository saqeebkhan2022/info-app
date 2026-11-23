import { list, mutate } from "./records.js";
// Keep the genuine Express request object: spreading req loses req.query.
// All shared CRUD logic, including access control and transactions, remains intact.
function scoped(handler) {
  return (req, res, next) => {
    req.params.kind = "users";
    return Promise.resolve(handler(req, res)).catch(next);
  };
}
export const listUser = scoped(list);
export const createUser = scoped(mutate);
export const updateUser = scoped(mutate);
export const deleteUser = scoped(mutate);
