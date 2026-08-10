const cron = require("node-cron");
const config = require("./config");
const { runAllBriefings } = require("./pipeline");

/**
 * In "internal" mode, node-cron fires inside this process on config.briefingCron
 * — requires an always-on host (e.g. Render's paid Starter tier or above).
 *
 * In "external" mode, no cron is scheduled here at all; an outside scheduler
 * is expected to call POST /trigger-all instead, which lets the app run on a
 * host that spins down between requests (e.g. a free tier).
 */
function startScheduler() {
  if (config.schedulerMode === "external") {
    console.log(
      "[Jarvis] SCHEDULER_MODE=external — no in-process cron. " +
        "Point an outside scheduler at POST /trigger-all to run briefings."
    );
    return { stop: () => {} };
  }

  if (!config.team.salespeople.length) {
    console.warn("[Jarvis] No salespeople configured — scheduler is running but has nothing to brief.");
  }

  const task = cron.schedule(config.briefingCron, async () => {
    console.log(`[Jarvis] Running scheduled briefing for ${config.team.salespeople.length} salesperson(s)...`);

    const results = await runAllBriefings({ isTest: false });
    for (const result of results) {
      if (result.error) {
        console.error(`[Jarvis] ${result.name} briefing failed: ${result.error}`);
      } else {
        console.log(
          `[Jarvis] Briefed ${result.name}: ${result.openLeads} open leads, ${result.hotDeals} hot deals ` +
            `(slack: ${result.delivery.slack.delivered}, email: ${result.delivery.email.delivered})`
        );
      }
    }
  });

  console.log(`[Jarvis] Scheduler started (internal mode) with cron "${config.briefingCron}".`);
  return task;
}

module.exports = { startScheduler };
