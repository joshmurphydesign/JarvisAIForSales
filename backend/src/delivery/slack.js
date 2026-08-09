const config = require("../config");

/**
 * Delivers a briefing to Slack. Prefers a per-person incoming webhook (no
 * bot/app setup required); falls back to a shared bot token DMing the
 * person's Slack user ID if a webhook isn't configured for them.
 */
async function deliverToSlack(person, text) {
  const slackConfig = (person.delivery && person.delivery.slack) || {};
  if (!slackConfig.enabled) {
    return { delivered: false, reason: "disabled" };
  }

  if (slackConfig.webhookUrl) {
    return sendViaWebhook(slackConfig.webhookUrl, text);
  }

  if (slackConfig.userId && config.slack.botToken) {
    return sendViaBotDm(slackConfig.userId, text);
  }

  return { delivered: false, reason: "no webhookUrl or (userId + SLACK_BOT_TOKEN) configured" };
}

async function sendViaWebhook(webhookUrl, text) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    throw new Error(`Slack webhook delivery failed with status ${response.status}`);
  }

  return { delivered: true, channel: "webhook" };
}

async function sendViaBotDm(userId, text) {
  const openResponse = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: userId }),
  });
  const openPayload = await openResponse.json();

  if (!openPayload.ok) {
    throw new Error(`Slack conversations.open failed: ${openPayload.error}`);
  }

  const channelId = openPayload.channel.id;

  const postResponse = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slack.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const postPayload = await postResponse.json();

  if (!postPayload.ok) {
    throw new Error(`Slack chat.postMessage failed: ${postPayload.error}`);
  }

  return { delivered: true, channel: "bot-dm" };
}

module.exports = { deliverToSlack };
