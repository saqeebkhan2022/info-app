import * as ctrl from "../controllers/records.js";
import { fail } from "../db/index.js";
const allowed = new Set(["clients", "operations", "roles"]);
const guardKind = (req, _res, next) => allowed.has(req.params.kind) ? next() : next(Object.assign(new Error("Unknown module."), {status:404}));
export function recordsRoutes(app) {
  app.get("/api/clients/:id/delete-preview", ctrl.clientDeletePreview);
  app.get("/api/lookups", ctrl.lookups);
  app.get("/api/dashboard/income", ctrl.monthlyIncome);
  app.get("/api/dashboard", ctrl.dashboard);
  app.get("/api/operations/export", ctrl.exportOperations);
  app.get("/api/:kind", guardKind, ctrl.list);
  app.post("/api/:kind", guardKind, ctrl.mutate);
  app.route("/api/:kind/:id").all(guardKind).put(ctrl.mutate).delete(ctrl.mutate);
}
