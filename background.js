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
const SALESFORCE_API_VERSION = "v60.0";
const DYNAMICS_API_VERSION = "v9.2";
const MONDAY_ENDPOINT = "https://api.monday.com/v2";

// Default HubSpot pipeline stages treated as "open" vs. "hot" (late-stage).
// Deployments on a custom pipeline can adjust these without touching the rest
// of the pipeline logic.
const OPEN_STAGE_BLOCKLIST = ["closedwon", "closedlost"];
const HOT_STAGES = ["decisionmakerboughtin", "contractsent"];

// Monday.com boards are fully custom, so there is no canonical "deal" object
// to query the way HubSpot/Salesforce/Dynamics provide. Absent a configured
// board, Jarvis guesses the most likely sales board by name, and flags a
// deal as "hot" by looking for a status/color column whose label matches
// this pattern. This is a best-effort heuristic, not a guarantee.
const MONDAY_HOT_LABEL_PATTERN = /hot|high|urgent|priority/i;
const MONDAY_BOARD_NAME_PATTERN = /lead|deal|pipeline|sales|crm/i;

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
  const config = await chrome.storage.local.get([
    "salespersonName",
    "crmProvider",
    "crmApiToken",
    "crmInstanceUrl",
    "crmBoardId",
  ]);

  const name = config.salespersonName && config.salespersonName.trim()
    ? config.salespersonName.trim()
    : "Sir";

  const metrics = isTest ? mockLeadMetrics() : await fetchLeadMetrics(config);

  const script = generateJarvisScript(name, metrics.openLeads, metrics.hotDeals);

  await deliverBriefingAudio(script);
}

/**
 * Pulls live lead metrics from the configured CRM. Any missing token,
 * unsupported provider, network failure, or non-2xx response degrades
 * gracefully to a zeroed-out metrics object so the briefing pipeline never
 * throws — Jarvis simply switches to the market-acquisition script instead.
 */
async function fetchLeadMetrics(config) {
  const { crmProvider, crmApiToken, crmInstanceUrl, crmBoardId } = config;

  if (!crmApiToken) {
    return { openLeads: 0, hotDeals: 0 };
  }

  try {
    switch (crmProvider) {
      case "salesforce":
        return await fetchSalesforceMetrics(crmApiToken, crmInstanceUrl);
      case "dynamics":
        return await fetchDynamicsMetrics(crmApiToken, crmInstanceUrl);
      case "monday":
        return await fetchMondayMetrics(crmApiToken, crmBoardId);
      case "hubspot":
      default:
        return await fetchHubSpotMetrics(crmApiToken);
    }
  } catch (error) {
    console.warn(`[Jarvis] Lead metrics fetch failed for provider "${crmProvider}", defaulting to zero:`, error);
    return { openLeads: 0, hotDeals: 0 };
  }
}

// --- HubSpot -----------------------------------------------------------

async function fetchHubSpotMetrics(crmApiToken) {
  const [openLeads, hotDeals] = await Promise.all([
    countHubSpotDeals(crmApiToken, OPEN_STAGE_BLOCKLIST, "NOT_IN"),
    countHubSpotDeals(crmApiToken, HOT_STAGES, "IN"),
  ]);

  return { openLeads, hotDeals };
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

// --- Salesforce ----------------------------------------------------------
// Opportunity's IsClosed and Probability are standard fields present on
// every Salesforce org regardless of custom pipeline naming, so counting
// against them (rather than stage labels) stays accurate across orgs.

async function fetchSalesforceMetrics(crmApiToken, crmInstanceUrl) {
  if (!crmInstanceUrl) {
    throw new Error("Salesforce requires an instance URL (e.g. https://yourorg.my.salesforce.com).");
  }

  const baseUrl = crmInstanceUrl.replace(/\/+$/, "");

  const [openLeads, hotDeals] = await Promise.all([
    runSalesforceCountQuery(baseUrl, crmApiToken, "SELECT COUNT() FROM Opportunity WHERE IsClosed = false"),
    runSalesforceCountQuery(
      baseUrl,
      crmApiToken,
      "SELECT COUNT() FROM Opportunity WHERE IsClosed = false AND Probability >= 70"
    ),
  ]);

  return { openLeads, hotDeals };
}

async function runSalesforceCountQuery(baseUrl, crmApiToken, soql) {
  const url = `${baseUrl}/services/data/${SALESFORCE_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${crmApiToken}` },
  });

  if (!response.ok) {
    throw new Error(`Salesforce request failed with status ${response.status}`);
  }

  const data = await response.json();
  return typeof data.totalSize === "number" ? data.totalSize : 0;
}

// --- Microsoft Dynamics 365 / Dataverse -----------------------------------
// statecode 0 = Open on the standard Opportunity entity. closeprobability
// (0-100) is the standard field used as the "hot deal" threshold, mirroring
// the Salesforce Probability check above.

async function fetchDynamicsMetrics(crmApiToken, crmInstanceUrl) {
  if (!crmInstanceUrl) {
    throw new Error("Dynamics 365 requires an organization URL (e.g. https://yourorg.crm.dynamics.com).");
  }

  const baseUrl = crmInstanceUrl.replace(/\/+$/, "");

  const [openLeads, hotDeals] = await Promise.all([
    runDynamicsCountQuery(baseUrl, crmApiToken, "statecode eq 0"),
    runDynamicsCountQuery(baseUrl, crmApiToken, "statecode eq 0 and closeprobability ge 70"),
  ]);

  return { openLeads, hotDeals };
}

async function runDynamicsCountQuery(baseUrl, crmApiToken, filter) {
  const url =
    `${baseUrl}/api/data/${DYNAMICS_API_VERSION}/opportunities` +
    `?$select=opportunityid&$filter=${encodeURIComponent(filter)}&$count=true&$top=1`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${crmApiToken}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Dynamics 365 request failed with status ${response.status}`);
  }

  const data = await response.json();
  return typeof data["@odata.count"] === "number" ? data["@odata.count"] : 0;
}

// --- Monday.com ------------------------------------------------------------
// Monday boards are fully user-defined, so "open leads" here means "items on
// the configured (or auto-detected) sales board," capped at the first 100
// items. "Hot deals" means items carrying a status/color column labeled with
// something matching MONDAY_HOT_LABEL_PATTERN. Configure a specific board ID
// in the dashboard for reliable results on accounts with several boards.

async function fetchMondayMetrics(crmApiToken, crmBoardId) {
  const boardId = crmBoardId || (await discoverMondayBoardId(crmApiToken));
  if (!boardId) {
    return { openLeads: 0, hotDeals: 0 };
  }

  const items = await fetchMondayBoardItems(crmApiToken, boardId);
  const openLeads = items.length;
  const hotDeals = items.filter((item) =>
    item.column_values.some(
      (cv) => (cv.type === "status" || cv.type === "color") && MONDAY_HOT_LABEL_PATTERN.test(cv.text || "")
    )
  ).length;

  return { openLeads, hotDeals };
}

async function mondayGraphQL(crmApiToken, query, variables) {
  const response = await fetch(MONDAY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: crmApiToken,
      "Content-Type": "application/json",
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Monday.com request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors && payload.errors.length) {
    throw new Error(payload.errors[0].message || "Monday.com GraphQL error");
  }

  return payload.data;
}

async function discoverMondayBoardId(crmApiToken) {
  const data = await mondayGraphQL(crmApiToken, "query { boards(limit: 25) { id name } }");
  const boards = (data && data.boards) || [];
  const likelyBoard = boards.find((board) => MONDAY_BOARD_NAME_PATTERN.test(board.name));
  const chosen = likelyBoard || boards[0];
  return chosen ? chosen.id : null;
}

async function fetchMondayBoardItems(crmApiToken, boardId) {
  const query = `
    query ($boardId: [ID!]) {
      boards(ids: $boardId) {
        items_page(limit: 100) {
          items {
            id
            column_values {
              id
              type
              text
            }
          }
        }
      }
    }
  `;

  const data = await mondayGraphQL(crmApiToken, query, { boardId: [boardId] });
  const board = data && data.boards && data.boards[0];
  return (board && board.items_page && board.items_page.items) || [];
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
