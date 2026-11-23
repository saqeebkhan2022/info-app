import { list, mutate } from "./records.js";
// Keep the genuine Express request object: spreading req loses req.query.
// All shared CRUD logic, including access control and transactions, remains intact.
function scoped(handler) {
  return (req, res, next) => {
    req.params.kind = "brokers";
    return Promise.resolve(handler(req, res)).catch(next);
  };
}
export const listBroker = scoped(list);
export const createBroker = scoped(mutate);
export const updateBroker = scoped(mutate);
export const deleteBroker = scoped(mutate);
