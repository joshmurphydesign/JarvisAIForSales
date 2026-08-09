const MONDAY_ENDPOINT = "https://api.monday.com/v2";

// Monday boards are fully user-defined, so "open leads" here means "items on
// the configured (or auto-detected) sales board," capped at the first 100
// items. "Hot deals" means items carrying a status/color column labeled with
// something matching MONDAY_HOT_LABEL_PATTERN. This is a best-effort
// heuristic, not a guarantee — configure a specific board ID for reliable
// results on accounts with several boards.
const MONDAY_HOT_LABEL_PATTERN = /hot|high|urgent|priority/i;
const MONDAY_BOARD_NAME_PATTERN = /lead|deal|pipeline|sales|crm/i;

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

module.exports = { fetchMondayMetrics };
