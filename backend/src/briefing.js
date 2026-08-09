/**
 * Compiles the briefing text. When the pipeline turns up nothing — zero open
 * leads and zero hot deals — Jarvis pivots from a status report to a short,
 * motivating call to go generate pipeline instead.
 */
function generateJarvisScript(name, openLeads, hotDeals) {
  const greeting = getTimeOfDayGreeting();

  if (!openLeads && !hotDeals) {
    return (
      `${greeting}, ${name}. Internal systems are online, and I have completed a full sweep of the CRM. ` +
      `The pipeline is currently clear — no open leads and no active deals are logged against your name. ` +
      `This is not a setback, it is an opportunity. Every quota-crushing quarter began with an empty board. ` +
      `I recommend opening the prospecting queue and initiating three new outbound touches within the hour. ` +
      `I will be monitoring, and I will let you know the moment the CRM shows movement. Let's build something today.`
    );
  }

  const leadsPhrase = pluralize(openLeads, "open lead", "open leads");
  const dealsPhrase = pluralize(hotDeals, "hot deal", "hot deals");

  const urgencyLine = hotDeals > 0
    ? `Of particular note, ${dealsPhrase} ${hotDeals === 1 ? "is" : "are"} sitting in a late stage and ${hotDeals === 1 ? "is" : "are"} ready for your personal attention before the day advances.`
    : `None of your current leads have reached a late stage yet, so today is the day to move at least one of them forward.`;

  return (
    `${greeting}, ${name}. Internal systems are online. I have synchronized with the CRM and completed your briefing. ` +
    `You currently have ${leadsPhrase} awaiting engagement, with ${dealsPhrase} flagged as high priority. ` +
    `${urgencyLine} ` +
    `I have prioritized your queue and will keep monitoring activity in the background. Good hunting, ${name}.`
  );
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getTimeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

module.exports = { generateJarvisScript };
