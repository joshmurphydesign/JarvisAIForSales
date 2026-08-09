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

const config = {
  port: Number(process.env.PORT) || 3000,
  apiKey: process.env.BACKEND_API_KEY || "",
  briefingCron: process.env.BRIEFING_CRON || "0 8 * * 1-5",
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
