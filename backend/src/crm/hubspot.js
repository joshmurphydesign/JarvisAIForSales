const HUBSPOT_DEALS_SEARCH_ENDPOINT = "https://api.hubapi.com/crm/v3/objects/deals/search";

const OPEN_STAGE_BLOCKLIST = ["closedwon", "closedlost"];
const HOT_STAGES = ["decisionmakerboughtin", "contractsent"];

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

module.exports = { fetchHubSpotMetrics };
