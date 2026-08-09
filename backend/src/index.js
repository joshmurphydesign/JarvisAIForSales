const config = require("./config");
const { createServer } = require("./server");
const { startScheduler } = require("./scheduler");

const app = createServer();
const server = app.listen(config.port, () => {
  console.log(`[Jarvis] Briefing service listening on port ${config.port}`);
});

const scheduledTask = startScheduler();

function shutdown(signal) {
  console.log(`[Jarvis] Received ${signal}, shutting down...`);
  scheduledTask.stop();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
