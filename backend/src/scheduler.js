const cron = require("node-cron");
const config = require("../src/config");
const { runBriefingPipeline } = require("./pipeline");

function startScheduler() {
  if (!config.team.salespeople.length) {
    console.warn("[Jarvis] No salespeople configured — scheduler is running but has nothing to brief.");
  }

  const task = cron.schedule(config.briefingCron, async () => {
    console.log(`[Jarvis] Running scheduled briefing for ${config.team.salespeople.length} salesperson(s)...`);

    for (const person of config.team.salespeople) {
      try {
        const briefing = await runBriefingPipeline(person, { isTest: false });
        console.log(
          `[Jarvis] Briefed ${person.name}: ${briefing.openLeads} open leads, ${briefing.hotDeals} hot deals ` +
            `(slack: ${briefing.delivery.slack.delivered}, email: ${briefing.delivery.email.delivered})`
        );
      } catch (error) {
        console.error(`[Jarvis] Briefing pipeline threw for ${person.name}:`, error);
      }
    }
  });

  console.log(`[Jarvis] Scheduler started with cron "${config.briefingCron}".`);
  return task;
}

module.exports = { startScheduler };
