const { fetchHubSpotMetrics } = require("./hubspot");
const { fetchSalesforceMetrics } = require("./salesforce");
const { fetchDynamicsMetrics } = require("./dynamics");
const { fetchMondayMetrics } = require("./monday");

/**
 * Pulls live lead metrics from the salesperson's configured CRM. Any missing
 * token, unsupported provider, network failure, or non-2xx response degrades
 * gracefully to a zeroed-out metrics object so the briefing pipeline never
 * throws — Jarvis simply switches to the market-acquisition script instead.
 */
async function fetchLeadMetrics(person) {
  const { crmProvider, crmApiToken, crmInstanceUrl, crmBoardId } = person;

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
    console.warn(
      `[Jarvis] Lead metrics fetch failed for "${person.name}" (provider "${crmProvider}"), defaulting to zero:`,
      error.message
    );
    return { openLeads: 0, hotDeals: 0 };
  }
}

function mockLeadMetrics() {
  return {
    openLeads: Math.floor(Math.random() * 12) + 1,
    hotDeals: Math.floor(Math.random() * 4),
  };
}

module.exports = { fetchLeadMetrics, mockLeadMetrics };
