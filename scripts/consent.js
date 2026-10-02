// ═══════════════════════════════════════════════
//  ANALYTICS CONSENT
//  Google Analytics loads only after the player allows it. Until then nothing
//  is sent and no analytics cookie is set. The choice is remembered on this
//  device and can be changed in Settings at any time.
// ═══════════════════════════════════════════════
(function () {
  const KEY = "monopoly_analytics_consent";
  const GA_ID = "G-QPMD9QD5H7";
  let loaded = false;

  function readChoice() {
    try {
      const v = localStorage.getItem(KEY);
      return v === "granted" || v === "denied" ? v : "";
    } catch (_err) {
      return "denied";
    }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { anonymize_ip: true });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
  }

  // An anonymous event, sent only with consent. Used for error counts.
  window.trackEvent = function (name, params) {
    if (readChoice() !== "granted" || typeof window.gtag !== "function") return;
    try {
      window.gtag("event", name, params || {});
    } catch (_err) {}
  };

  window.analyticsAllowed = () => readChoice() === "granted";

  window.setAnalyticsConsent = function (allow) {
    try {
      localStorage.setItem(KEY, allow ? "granted" : "denied");
    } catch (_err) {}
    const banner = document.getElementById("consent-banner");
    if (banner) banner.remove();
    if (allow) load();
    else if (loaded) {
      // Turning it off stops further sending on this page; it stays off after a reload.
      window["ga-disable-" + GA_ID] = true;
    }
    if (typeof refreshSettingsViews === "function") refreshSettingsViews();
  };

  function showBanner() {
    if (document.getElementById("consent-banner") || !document.body) return;
    const bar = document.createElement("div");
    bar.id = "consent-banner";
    bar.className = "consent-banner";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Usage statistics");
    bar.innerHTML =
      '<p><strong>Help improve the game?</strong> Allow anonymous usage statistics (Google Analytics). No ads and nothing that identifies you. <a href="whats-new.html#privacy">Privacy</a></p>' +
      '<div class="consent-actions"><button type="button" class="consent-no">No thanks</button><button type="button" class="consent-yes">Allow</button></div>';
    bar.querySelector(".consent-no").addEventListener("click", () => window.setAnalyticsConsent(false));
    bar.querySelector(".consent-yes").addEventListener("click", () => window.setAnalyticsConsent(true));
    // On the home screen it is a card in the page, not a bar floating over
    // it: a floating bar sat on top of buttons on phones and took their taps.
    const slot = document.getElementById("consent-slot");
    if (slot) {
      bar.classList.add("is-inline");
      slot.appendChild(bar);
    } else {
      document.body.appendChild(bar);
    }
  }

  if (readChoice() === "granted") load();
  // Only the main page asks; the other pages just follow the choice.
  if (!readChoice() && document.documentElement.dataset.consentPrompt === "1") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showBanner);
    else showBanner();
  }
})();
