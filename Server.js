import "dotenv/config";
import app from "./App.js";
import { initialize, db } from "./db/index.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  await initialize();
  const server = app.listen(PORT, HOST, () => {
    console.log(`InfoPanel API listening on http://${HOST}:${PORT}`);
  });
  const shutdown = async signal => {
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
      await db.end();
      process.exit(0);
    });
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(error => {
  console.error("InfoPanel startup failed:", error);
  process.exit(1);
});
