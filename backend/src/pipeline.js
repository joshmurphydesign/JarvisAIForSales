const config = require("./config");
const { fetchLeadMetrics, mockLeadMetrics } = require("./crm");
const { generateJarvisScript } = require("./briefing");
const { deliverToSlack } = require("./delivery/slack");
const { deliverToEmail } = require("./delivery/email");
const store = require("./store");

/**
 * Runs the full briefing pipeline for one salesperson: fetch metrics,
 * compile the script, deliver it over every enabled channel, and record the
 * result. Delivery failures on one channel don't block the other.
 */
async function runBriefingPipeline(person, { isTest = false } = {}) {
  const metrics = isTest ? mockLeadMetrics() : await fetchLeadMetrics(person);
  const text = generateJarvisScript(person.name, metrics.openLeads, metrics.hotDeals);

  const [slackResult, emailResult] = await Promise.all([
    deliverToSlack(person, text).catch((error) => ({ delivered: false, reason: error.message })),
    deliverToEmail(person, text).catch((error) => ({ delivered: false, reason: error.message })),
  ]);

  const briefing = {
    name: person.name,
    text,
    openLeads: metrics.openLeads,
    hotDeals: metrics.hotDeals,
    timestamp: Date.now(),
    isTest,
    delivery: { slack: slackResult, email: emailResult },
  };

  store.setLatest(person.name, briefing);
  return briefing;
}

/**
 * Runs the pipeline for every configured salesperson in one batch. Shared by
 * the internal cron scheduler and the external-trigger endpoint (POST
 * /trigger-all) so both modes brief the whole team the same way. A failure
 * for one person doesn't stop the rest.
 */
async function runAllBriefings({ isTest = false } = {}) {
  const results = [];

  for (const person of config.team.salespeople) {
    try {
      results.push(await runBriefingPipeline(person, { isTest }));
    } catch (error) {
      console.error(`[Jarvis] Briefing pipeline threw for ${person.name}:`, error);
      results.push({ name: person.name, error: error.message });
    }
  }

  return results;
}

module.exports = { runBriefingPipeline, runAllBriefings };
