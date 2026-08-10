// In-memory store for each salesperson's most recent briefing. Resets on
// restart — swap for a real database if briefing history needs to persist
// across deploys.
const lastBriefings = new Map();

function setLatest(name, briefing) {
  lastBriefings.set(name, briefing);
}

function getLatest(name) {
  return lastBriefings.get(name) || null;
}

function getAllLatest() {
  return Object.fromEntries(lastBriefings.entries());
}

module.exports = { setLatest, getLatest, getAllLatest };
