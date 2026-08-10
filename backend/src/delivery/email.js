const nodemailer = require("nodemailer");
const config = require("../config");

let cachedTransport = null;

function getTransport() {
  if (!config.smtp.host) {
    return null;
  }

  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }

  return cachedTransport;
}

async function deliverToEmail(person, text) {
  const emailConfig = (person.delivery && person.delivery.email) || {};
  if (!emailConfig.enabled) {
    return { delivered: false, reason: "disabled" };
  }

  if (!emailConfig.to) {
    return { delivered: false, reason: "no recipient configured" };
  }

  const transport = getTransport();
  if (!transport) {
    return { delivered: false, reason: "SMTP not configured (set SMTP_HOST etc. in .env)" };
  }

  await transport.sendMail({
    from: config.smtp.from,
    to: emailConfig.to,
    subject: `Your Jarvis Briefing — ${new Date().toLocaleDateString()}`,
    text,
  });

  return { delivered: true, channel: "email" };
}

module.exports = { deliverToEmail };
