const express = require("express");
const helmet = require("helmet");
const config = require("./config");
const store = require("./store");
const { runBriefingPipeline, runAllBriefings } = require("./pipeline");

function requireApiKey(req, res, next) {
  const authHeader = req.get("authorization") || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!config.apiKey || provided !== config.apiKey) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function createServer() {
  const app = express();
  app.use(helmet());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", salespeopleConfigured: config.team.salespeople.length });
  });

  app.get("/briefings", requireApiKey, (_req, res) => {
    res.json(store.getAllLatest());
  });

  app.get("/briefings/:name", requireApiKey, (req, res) => {
    const briefing = store.getLatest(req.params.name);
    if (!briefing) {
      return res.status(404).json({ error: `No briefing on record for "${req.params.name}".` });
    }
    res.json(briefing);
  });

  app.post("/trigger", requireApiKey, async (req, res) => {
    const { name, isTest } = req.body || {};

    if (!name) {
      return res.status(400).json({ error: '"name" is required in the request body.' });
    }

    const person = config.team.salespeople.find((p) => p.name === name);
    if (!person) {
      return res.status(404).json({ error: `No salesperson named "${name}" in the team config.` });
    }

    try {
      const briefing = await runBriefingPipeline(person, { isTest: Boolean(isTest) });
      res.json(briefing);
    } catch (error) {
      console.error(`[Jarvis] Manual trigger failed for ${name}:`, error);
      res.status(500).json({ error: "Briefing pipeline failed. Check server logs." });
    }
  });

  // Intended target for an external scheduler when SCHEDULER_MODE=external
  // (e.g. a GitHub Actions cron or cron-job.org hitting this daily). Briefs
  // every configured salesperson in one call — the same batch the internal
  // cron would otherwise run.
  app.post("/trigger-all", requireApiKey, async (req, res) => {
    const { isTest } = req.body || {};

    try {
      const results = await runAllBriefings({ isTest: Boolean(isTest) });
      res.json(results);
    } catch (error) {
      console.error("[Jarvis] /trigger-all failed:", error);
      res.status(500).json({ error: "Briefing pipeline failed. Check server logs." });
    }
  });

  // Keep error details out of responses; full error is already logged where thrown.
  app.use((err, _req, res, _next) => {
    console.error("[Jarvis] Unhandled server error:", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = { createServer };
