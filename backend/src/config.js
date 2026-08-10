const fs = require("fs");
const path = require("path");

require("dotenv").config();

const TEAM_CONFIG_PATH = path.resolve(process.cwd(), process.env.TEAM_CONFIG_PATH || "./config/team.json");

function loadTeamConfig() {
  if (!fs.existsSync(TEAM_CONFIG_PATH)) {
    console.warn(
      `[Jarvis] No team config found at ${TEAM_CONFIG_PATH}. ` +
        `Copy config/team.example.json to that path and fill in real values.`
    );
    return { salespeople: [] };
  }

  const raw = fs.readFileSync(TEAM_CONFIG_PATH, "utf8");
  const parsed = JSON.parse(raw);

  if (!Array.isArray(parsed.salespeople)) {
    throw new Error(`Team config at ${TEAM_CONFIG_PATH} is missing a "salespeople" array.`);
  }

  return parsed;
}

const SCHEDULER_MODE = process.env.SCHEDULER_MODE === "external" ? "external" : "internal";

const config = {
  port: Number(process.env.PORT) || 3000,
  apiKey: process.env.BACKEND_API_KEY || "",
  briefingCron: process.env.BRIEFING_CRON || "0 8 * * 1-5",
  // "internal": node-cron fires inside this process — needs an always-on host.
  // "external": no in-process cron; an outside scheduler (e.g. a GitHub
  // Actions cron, or a free service like cron-job.org) hits POST
  // /trigger-all instead, so the app can run on a free tier that spins down
  // between requests. Switching later is just this one env var — no code
  // changes needed either direction.
  schedulerMode: SCHEDULER_MODE,
  slack: {
    botToken: process.env.SLACK_BOT_TOKEN || "",
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "Project Jarvis <jarvis@yourcompany.com>",
  },
  team: loadTeamConfig(),
};

if (!config.apiKey) {
  console.warn(
    "[Jarvis] BACKEND_API_KEY is not set — the /trigger and /briefings endpoints will reject every request " +
      "until it is configured. Set it in your .env file before deploying."
  );
}

module.exports = config;
