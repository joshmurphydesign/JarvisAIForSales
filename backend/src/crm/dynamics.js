const DYNAMICS_API_VERSION = "v9.2";

// statecode 0 = Open on the standard Opportunity entity. closeprobability
// (0-100) is the standard field used as the "hot deal" threshold, mirroring
// the Salesforce Probability check.
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

module.exports = { fetchDynamicsMetrics };
