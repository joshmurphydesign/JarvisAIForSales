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

function speakBriefing(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = VOICE_PITCH;
  utterance.rate = VOICE_RATE;

  const voice = selectBritishMaleVoice();
  if (voice) {
    utterance.voice = voice;
  } else {
    utterance.lang = "en-GB";
  }

  const closeWindow = () => setTimeout(() => window.close(), 400);
  utterance.onend = closeWindow;
  utterance.onerror = closeWindow;

  window.speechSynthesis.speak(utterance);
}

/**
 * Voice lists load asynchronously in Chrome, so if getVoices() returns
 * nothing yet we fall back to lang="en-GB" on the utterance and let the
 * synthesis engine pick its own default British voice.
 */
function selectBritishMaleVoice() {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) {
    return null;
  }

  const byNamePreference = voices.find((v) =>
    /Google UK English Male|Microsoft Ryan|Microsoft George|Daniel/i.test(v.name)
  );
  if (byNamePreference) return byNamePreference;

  const anyBritish = voices.find((v) => /en-GB|en_GB/i.test(v.lang));
  if (anyBritish) return anyBritish;

  return null;
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
    ["salespersonName", "crmProvider", "crmApiToken", "crmInstanceUrl", "crmBoardId"],
    (result) => {
      if (result.salespersonName) nameInput.value = result.salespersonName;
      if (result.crmApiToken) tokenInput.value = result.crmApiToken;
      if (result.crmInstanceUrl) instanceUrlInput.value = result.crmInstanceUrl;
      if (result.crmBoardId) boardIdInput.value = result.crmBoardId;

      const provider = result.crmProvider && PROVIDER_META[result.crmProvider] ? result.crmProvider : "hubspot";
      providerSelect.value = provider;
      applyProviderUI(provider);
    }
  );

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

function setStatus(element, message, kind) {
  element.textContent = message;
  element.className = kind || "";
}
