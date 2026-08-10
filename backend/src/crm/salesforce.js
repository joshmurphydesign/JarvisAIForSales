const SALESFORCE_API_VERSION = "v60.0";

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

module.exports = { fetchSalesforceMetrics };
