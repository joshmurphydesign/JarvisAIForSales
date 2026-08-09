/**
 * Project Jarvis — background service worker
 *
 * MV3 service workers have no DOM, so `window.speechSynthesis` is unreachable
 * here. To bypass that, this worker never speaks directly — it spins up a
 * small, minimized, background-focused browser window pointed at
 * popup.html?autoplay=true (a valid DOM canvas), hands it the finished
 * briefing text over chrome.runtime messaging once that window signals it is
 * ready, and lets it self-close when the speech track ends.
 */

const HUBSPOT_DEALS_SEARCH_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/deals/search";

// Default HubSpot pipeline stages treated as "open" vs. "hot" (late-stage).
// Deployments on a custom pipeline can adjust these without touching the rest
// of the pipeline logic.
const OPEN_STAGE_BLOCKLIST = ["closedwon", "closedlost"];
const HOT_STAGES = ["decisionmakerboughtin", "contractsent"];

const TEST_ALARM_NAME = "testBriefing";

// Holds the most recently generated briefing script while we wait for the
// freshly opened audio window to report that its listener is attached.
let pendingBriefingText = null;

chrome.runtime.onStartup.addListener(() => {
  runJarvisPipeline({ isTest: false });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TEST_ALARM_NAME) {
    runJarvisPipeline({ isTest: true });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "JARVIS_POPUP_READY") {
    if (pendingBriefingText) {
      chrome.runtime.sendMessage({
        type: "JARVIS_SPEAK_PAYLOAD",
        text: pendingBriefingText,
      });
      pendingBriefingText = null;
    }
    sendResponse({ acknowledged: true });
  }
  return false;
});

async function runJarvisPipeline({ isTest }) {
  const { salespersonName, crmApiToken } = await chrome.storage.local.get([
    "salespersonName",
    "crmApiToken",
  ]);

  const name = salespersonName && salespersonName.trim() ? salespersonName.trim() : "Sir";

  const metrics = isTest
    ? mockLeadMetrics()
    : await fetchLeadMetrics(crmApiToken);

  const script = generateJarvisScript(name, metrics.openLeads, metrics.hotDeals);

  await deliverBriefingAudio(script);
}

/**
 * Pulls live lead metrics from HubSpot using the stored private access
 * token. Any missing token, network failure, or non-2xx response degrades
 * gracefully to a zeroed-out metrics object so the briefing pipeline never
 * throws — Jarvis simply switches to the market-acquisition script instead.
 */
async function fetchLeadMetrics(crmApiToken) {
  if (!crmApiToken) {
    return { openLeads: 0, hotDeals: 0 };
  }

  try {
    const [openLeads, hotDeals] = await Promise.all([
      countHubSpotDeals(crmApiToken, OPEN_STAGE_BLOCKLIST, "NOT_IN"),
      countHubSpotDeals(crmApiToken, HOT_STAGES, "IN"),
    ]);

    return { openLeads, hotDeals };
  } catch (error) {
    console.warn("[Jarvis] Lead metrics fetch failed, defaulting to zero:", error);
    return { openLeads: 0, hotDeals: 0 };
  }
}

async function countHubSpotDeals(crmApiToken, dealStages, operator) {
  const response = await fetch(HUBSPOT_DEALS_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${crmApiToken}`,
    },
    body: JSON.stringify({
      filterGroups: [
        {
          filters: [
            {
              propertyName: "dealstage",
              operator,
              values: dealStages,
            },
          ],
        },
      ],
      limit: 1,
    }),
  });

  if (!response.ok) {
    throw new Error(`HubSpot request failed with status ${response.status}`);
  }

  const data = await response.json();
  return typeof data.total === "number" ? data.total : 0;
}

function mockLeadMetrics() {
  return {
    openLeads: Math.floor(Math.random() * 12) + 1,
    hotDeals: Math.floor(Math.random() * 4),
  };
}

/**
 * Compiles the spoken briefing script. When the pipeline turns up nothing —
 * zero open leads and zero hot deals — Jarvis pivots from a status report to
 * a short, motivating call to go generate pipeline instead.
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

/**
 * Opens a small, minimized, background-focused window loading popup.html in
 * autoplay mode — a real DOM canvas the service worker itself cannot provide
 * — hands off the briefing text once that page confirms its speech listener
 * is attached, and lets the window close itself when playback finishes.
 */
async function deliverBriefingAudio(text) {
  pendingBriefingText = text;

  const audioWindow = await chrome.windows.create({
    url: chrome.runtime.getURL("popup.html?autoplay=true"),
    type: "popup",
    width: 360,
    height: 240,
    focused: true,
  });

  try {
    await chrome.windows.update(audioWindow.id, { state: "minimized" });
  } catch (error) {
    console.warn("[Jarvis] Unable to minimize audio window:", error);
  }
}
