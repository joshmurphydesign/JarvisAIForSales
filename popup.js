const VOICE_PITCH = 0.9;
const VOICE_RATE = 0.95;
const TEST_ALARM_NAME = "testBriefing";

const PROVIDER_META = {
  hubspot: {
    tokenLabel: "CRM API Private Access Token",
    tokenPlaceholder: "pat-••••••••••••••••",
    showInstanceUrl: false,
    showBoardId: false,
  },
  salesforce: {
    tokenLabel: "Access Token",
    tokenPlaceholder: "00D••••••••••••••••",
    showInstanceUrl: true,
    instanceLabel: "Instance URL",
    instancePlaceholder: "https://yourorg.my.salesforce.com",
    showBoardId: false,
  },
  dynamics: {
    tokenLabel: "Access Token",
    tokenPlaceholder: "eyJ0eXAiOi••••••••••",
    showInstanceUrl: true,
    instanceLabel: "Organization URL",
    instancePlaceholder: "https://yourorg.crm.dynamics.com",
    showBoardId: false,
  },
  monday: {
    tokenLabel: "API Token",
    tokenPlaceholder: "eyJhbGciOi••••••••••",
    showInstanceUrl: false,
    showBoardId: true,
  },
};

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);

  if (params.get("autoplay") === "true") {
    initAudioMode();
  } else {
    initDashboardMode();
  }
});

/**
 * Autoplay mode: this window was opened by background.js as the DOM canvas
 * used to work around the service worker having no access to
 * window.speechSynthesis. It announces readiness, then waits for the
 * background thread to hand over the compiled briefing text.
 */
function initAudioMode() {
  document.body.classList.add("audio-mode");

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.type === "JARVIS_SPEAK_PAYLOAD" && message.text) {
      speakBriefing(message.text);
    }
  });

  chrome.runtime.sendMessage({ type: "JARVIS_POPUP_READY" });
}

// Cycled (not random) per-sentence pitch/rate offsets so consecutive
// sentences don't land on the same inflection, breaking up the flat,
// monotone cadence of a single long utterance without sounding erratic.
const SENTENCE_CADENCE = [
  { pitch: 0.02, rate: 0.015 },
  { pitch: -0.015, rate: -0.01 },
  { pitch: 0.01, rate: 0.02 },
  { pitch: -0.02, rate: 0.005 },
];

const SENTENCE_SPLIT_PATTERN = /(?<=[.!?])\s+(?=[A-Z"'])/;

function speakBriefing(text) {
  const voice = selectBritishMaleVoice();
  const sentences = text.split(SENTENCE_SPLIT_PATTERN).filter((s) => s.trim().length > 0);

  if (!sentences.length) {
    window.close();
    return;
  }

  let remaining = sentences.length;
  const finishSentence = () => {
    remaining -= 1;
    if (remaining <= 0) {
      setTimeout(() => window.close(), 400);
    }
  };

  sentences.forEach((rawSentence, index) => {
    const sentence = rawSentence.trim();
    const utterance = new SpeechSynthesisUtterance(sentence);

    if (voice) {
      utterance.voice = voice;
    } else {
      utterance.lang = "en-GB";
    }

    const cadence = SENTENCE_CADENCE[index % SENTENCE_CADENCE.length];
    const emphasis = /[!?]$/.test(sentence) ? 0.03 : 0;

    utterance.pitch = clampVoiceParam(VOICE_PITCH + cadence.pitch + emphasis);
    utterance.rate = clampVoiceParam(VOICE_RATE + cadence.rate + emphasis / 2);

    utterance.onend = finishSentence;
    utterance.onerror = finishSentence;

    window.speechSynthesis.speak(utterance);
  });
}

function clampVoiceParam(value) {
  return Math.min(2, Math.max(0.1, value));
}

/**
 * Voice lists load asynchronously in Chrome, so if getVoices() returns
 * nothing yet we fall back to lang="en-GB" on the utterance and let the
 * synthesis engine pick its own default British voice. Ranked roughly by
 * how natural each tier tends to sound: OS-level neural voices first,
 * then Chrome's network-quality voice, then legacy compact voices.
 */
const VOICE_QUALITY_PATTERNS = [
  /Natural/i, // Windows 11 neural voices, e.g. "Microsoft Ryan Online (Natural)"
  /Enhanced|Premium/i, // macOS enhanced/premium voices, e.g. "Daniel (Enhanced)"
  /Google UK English Male/i, // Chrome's network-quality British voice
  /Microsoft Ryan|Microsoft George|Microsoft Thomas/i,
  /Daniel/i,
];

function selectBritishMaleVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    return null;
  }

  const british = voices.filter((v) => /en-GB|en_GB/i.test(v.lang));
  const pool = british.length ? british : voices;

  for (const pattern of VOICE_QUALITY_PATTERNS) {
    const match = pool.find((v) => pattern.test(v.name));
    if (match) return match;
  }

  return pool[0] || null;
}

/**
 * Dashboard mode: the normal extension popup UI for configuring the
 * salesperson's identity and CRM token, and for manually kicking off a test
 * briefing.
 */
function initDashboardMode() {
  const nameInput = document.getElementById("salespersonName");
  const providerSelect = document.getElementById("crmProvider");
  const instanceUrlField = document.getElementById("instanceUrlField");
  const instanceUrlLabel = document.getElementById("instanceUrlLabel");
  const instanceUrlInput = document.getElementById("crmInstanceUrl");
  const tokenLabel = document.getElementById("tokenLabel");
  const tokenInput = document.getElementById("crmApiToken");
  const boardIdField = document.getElementById("boardIdField");
  const boardIdInput = document.getElementById("crmBoardId");
  const initButton = document.getElementById("initButton");
  const testButton = document.getElementById("testButton");
  const statusLine = document.getElementById("statusLine");

  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");
  const lastSync = document.getElementById("lastSync");
  const openLeadsValue = document.getElementById("openLeadsValue");
  const hotDealsValue = document.getElementById("hotDealsValue");
  const briefingText = document.getElementById("briefingText");

  function renderHud(lastBriefing, hasToken) {
    if (!lastBriefing) {
      openLeadsValue.textContent = "—";
      hotDealsValue.textContent = "—";
      lastSync.textContent = "Never synced";
      briefingText.textContent =
        'No briefing delivered yet. Click "Test Briefing Audio" below, or wait for the next browser startup.';
    } else {
      openLeadsValue.textContent = lastBriefing.openLeads;
      hotDealsValue.textContent = lastBriefing.hotDeals;
      lastSync.textContent = formatRelativeTime(lastBriefing.timestamp);
      briefingText.textContent = lastBriefing.text;
    }

    const online = Boolean(hasToken);
    statusText.textContent = online ? "SYSTEMS ONLINE" : "AWAITING CONFIGURATION";
    statusDot.classList.toggle("idle", !online);
  }

  function applyProviderUI(provider) {
    const meta = PROVIDER_META[provider] || PROVIDER_META.hubspot;

    tokenLabel.textContent = meta.tokenLabel;
    tokenInput.placeholder = meta.tokenPlaceholder;

    instanceUrlField.classList.toggle("hidden", !meta.showInstanceUrl);
    if (meta.showInstanceUrl) {
      instanceUrlLabel.textContent = meta.instanceLabel;
      instanceUrlInput.placeholder = meta.instancePlaceholder;
    }

    boardIdField.classList.toggle("hidden", !meta.showBoardId);
  }

  chrome.storage.local.get(
    ["salespersonName", "crmProvider", "crmApiToken", "crmInstanceUrl", "crmBoardId", "lastBriefing"],
    (result) => {
      if (result.salespersonName) nameInput.value = result.salespersonName;
      if (result.crmApiToken) tokenInput.value = result.crmApiToken;
      if (result.crmInstanceUrl) instanceUrlInput.value = result.crmInstanceUrl;
      if (result.crmBoardId) boardIdInput.value = result.crmBoardId;

      const provider = result.crmProvider && PROVIDER_META[result.crmProvider] ? result.crmProvider : "hubspot";
      providerSelect.value = provider;
      applyProviderUI(provider);

      renderHud(result.lastBriefing, Boolean(result.crmApiToken));
    }
  );

  // Keeps the HUD numbers and readout in sync with the audio the moment a
  // briefing completes, if the dashboard happens to be open when it runs.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    if (changes.lastBriefing) {
      renderHud(changes.lastBriefing.newValue, Boolean(tokenInput.value.trim()));
    }
    if (changes.crmApiToken) {
      statusText.textContent = changes.crmApiToken.newValue ? "SYSTEMS ONLINE" : "AWAITING CONFIGURATION";
      statusDot.classList.toggle("idle", !changes.crmApiToken.newValue);
    }
  });

  providerSelect.addEventListener("change", () => {
    applyProviderUI(providerSelect.value);
  });

  initButton.addEventListener("click", () => {
    const salespersonName = nameInput.value.trim();
    const crmProvider = providerSelect.value;
    const crmApiToken = tokenInput.value.trim();
    const crmInstanceUrl = instanceUrlInput.value.trim();
    const crmBoardId = boardIdInput.value.trim();

    chrome.storage.local.set(
      { salespersonName, crmProvider, crmApiToken, crmInstanceUrl, crmBoardId },
      () => {
        setStatus(statusLine, "Configuration saved. Systems ready.", "ok");
      }
    );
  });

  testButton.addEventListener("click", () => {
    setStatus(statusLine, "Dispatching test briefing…", "ok");
    chrome.alarms.create(TEST_ALARM_NAME, { delayInMinutes: 0.02 });
  });
}

function formatRelativeTime(timestamp) {
  const diffMinutes = Math.round((Date.now() - timestamp) / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

function setStatus(element, message, kind) {
  element.textContent = message;
  element.className = kind || "";
}
