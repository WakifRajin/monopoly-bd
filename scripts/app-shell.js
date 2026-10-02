// ═══════════════════════════════════════════════
//  APP SHELL
//  Reduced motion, installing the app, the "new version" prompt, launch
//  shortcuts, and dialog accessibility (roles, focus, announcements).
// ═══════════════════════════════════════════════

// ── Reduced motion ─────────────────────────────────────────────────────────
// On when the device asks for less motion, or when the player turns it on.
const MOTION_KEY = "monopoly_reduce_motion";

function reduceMotionFromDevice() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_err) {
    return false;
  }
}

function reduceMotionSetting() {
  try {
    return localStorage.getItem(MOTION_KEY) === "1";
  } catch (_err) {
    return false;
  }
}

function reduceMotionOn() {
  return reduceMotionSetting() || reduceMotionFromDevice();
}

function applyReduceMotion() {
  const on = reduceMotionOn();
  document.documentElement.classList.toggle("reduce-motion", on);
  if (window.Board3D && typeof window.Board3D.setReducedMotion === "function") {
    window.Board3D.setReducedMotion(on);
  }
}

function setReduceMotion(on) {
  try {
    if (on) localStorage.setItem(MOTION_KEY, "1");
    else localStorage.removeItem(MOTION_KEY);
  } catch (_err) {
    /* not remembered, but still applied for this visit */
  }
  applyReduceMotion();
  refreshSettingsViews();
}

function installReduceMotion() {
  applyReduceMotion();
  try {
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => {
      applyReduceMotion();
      refreshSettingsViews();
    });
  } catch (_err) {
    /* old browsers: the setting still works */
  }
}

// ── Install ────────────────────────────────────────────────────────────────
const INSTALL = {
  prompt: null,
  available: false,
  installed: false,
};

function detectInstalled() {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch (_err) {
    return false;
  }
}

function renderInstallEntry() {
  const btn = document.getElementById("hp-install");
  if (btn) btn.hidden = !INSTALL.available || INSTALL.installed;
}

async function installApp() {
  if (!INSTALL.prompt) {
    toast("Use your browser's menu and choose Install app or Add to Home Screen.", "gold");
    return;
  }
  const evt = INSTALL.prompt;
  INSTALL.prompt = null;
  INSTALL.available = false;
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice?.outcome === "accepted") INSTALL.installed = true;
  } catch (err) {
    console.warn("Install prompt failed:", err);
  }
  renderInstallEntry();
  refreshSettingsViews();
}

function installInstallPrompt() {
  INSTALL.installed = detectInstalled();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    INSTALL.prompt = e;
    INSTALL.available = true;
    renderInstallEntry();
    refreshSettingsViews();
  });
  window.addEventListener("appinstalled", () => {
    INSTALL.installed = true;
    INSTALL.available = false;
    INSTALL.prompt = null;
    renderInstallEntry();
    refreshSettingsViews();
    toast("Installed. You can open the game from your home screen.", "gold");
  });
  renderInstallEntry();
}

// ── New version prompt ─────────────────────────────────────────────────────
// A new version installs in the background and waits. The page says so and
// lets the player reload when it suits them; a game on this device is saved
// and carries on after the reload.
const UPDATE = { reg: null, lastCheck: 0, reloading: false };

function showUpdateBanner() {
  if (document.getElementById("update-banner")) return;
  const bar = document.createElement("div");
  bar.id = "update-banner";
  bar.className = "update-banner";
  bar.setAttribute("role", "status");
  const inGame = !!(G && Array.isArray(G.players) && !G.gameOver && !document.getElementById("game-screen")?.classList.contains("hidden"));
  const note = inGame && !isOnlineGame() ? " Your game is saved." : "";
  bar.innerHTML = `<span>A new version of the game is ready.${note}</span><div class="update-banner-actions"><button type="button" class="update-later">Later</button><button type="button" class="update-now">Reload</button></div>`;
  bar.querySelector(".update-now").addEventListener("click", applyUpdate);
  bar.querySelector(".update-later").addEventListener("click", () => bar.remove());
  document.body.appendChild(bar);
}

function applyUpdate() {
  if (typeof saveGameNow === "function") saveGameNow();
  const waiting = UPDATE.reg && UPDATE.reg.waiting;
  UPDATE.reloading = true;
  if (waiting) {
    // The reload happens once the new worker has taken over (controllerchange).
    waiting.postMessage({ type: "SKIP_WAITING" });
    setTimeout(() => window.location.reload(), 3000);
  } else {
    window.location.reload();
  }
}

// An installed app can stay open for days; look for a new version when it
// comes back to the foreground, at most every half hour.
function checkForUpdate(force = false) {
  const reg = UPDATE.reg;
  if (!reg || typeof reg.update !== "function") return;
  if (!force && Date.now() - UPDATE.lastCheck < 30 * 60000) return;
  UPDATE.lastCheck = Date.now();
  reg.update().catch(() => {});
}

function watchRegistration(reg) {
  UPDATE.reg = reg;
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner();
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      // "installed" with a controller already in place means an update.
      if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner();
    });
  });
}

function installUpdatePrompt() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (UPDATE.reloading) window.location.reload();
  });
  navigator.serviceWorker.ready.then(watchRegistration).catch(() => {});
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
  setInterval(() => checkForUpdate(true), 60 * 60000);
}

// ── Unexpected errors ──────────────────────────────────────────────────────
// A script error used to fail silently. Now it is logged, the player gets one
// calm message with a way to report it, and (only with analytics allowed) an
// anonymous error event is counted.
const ERRORS = { shownAt: 0, count: 0 };

function isIgnorableError(message) {
  const m = String(message || "");
  return (
    !m ||
    m === "Script error." ||
    /ResizeObserver loop/i.test(m) ||
    /AbortError|The play\(\) request was interrupted|NotAllowedError/i.test(m) ||
    /Failed to fetch dynamically imported module|Loading chunk/i.test(m)
  );
}

function reportUnexpectedError(message) {
  if (isIgnorableError(message)) return;
  ERRORS.count += 1;
  if (typeof trackEvent === "function") trackEvent("exception", { description: String(message).slice(0, 150), fatal: false });
  const now = Date.now();
  if (now - ERRORS.shownAt < 60000) return;
  ERRORS.shownAt = now;
  if (typeof toast === "function") {
    toast("Something went wrong. If it keeps happening, use Report a bug.", "danger");
  }
}

window.addEventListener("error", (e) => reportUnexpectedError(e?.error?.message || e?.message));
window.addEventListener("unhandledrejection", (e) => {
  const reason = e?.reason;
  const msg = reason && (reason.message || reason.code) ? reason.message || reason.code : String(reason || "");
  // Network trouble in online play already has its own messages.
  if (/permission|network|offline|disconnect|Lost connection|The host did not answer/i.test(msg)) return;
  reportUnexpectedError(msg);
});

// ── Launch shortcuts (manifest "shortcuts") ────────────────────────────────
function handleLaunchShortcut() {
  let dest = "";
  let room = "";
  try {
    const params = new URLSearchParams(window.location.search);
    dest = params.get("open") || "";
    room = params.get("room") || "";
  } catch (_err) {
    return;
  }
  if (room && typeof joinFromInviteLink === "function") {
    joinFromInviteLink(room);
    return;
  }
  if (!dest) return;
  if (dest === "offline") openOfflineSetupPage();
  else if (dest === "online") openOnlineSetupPage("host");
  else if (dest === "lan") openLanPage();
  else if (dest === "rules") appNavigate("rules");
}

// ── Dialogs: roles, focus and announcements ────────────────────────────────
const DIALOG_FOCUS = new Map();
// How the player last interacted. A dialog opened by mouse or touch takes
// focus on itself (no visible ring on its first button); one opened from the
// keyboard puts focus on the button you would press.
const INPUT_MODE = { keyboard: false };
document.addEventListener("keydown", (e) => { if (!e.ctrlKey && !e.metaKey) INPUT_MODE.keyboard = true; }, true);
document.addEventListener("pointerdown", () => { INPUT_MODE.keyboard = false; }, true);
const FOCUSABLE = 'button:not([disabled]):not([hidden]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function labelDialogs() {
  document.querySelectorAll(".overlay > .modal").forEach((modal, i) => {
    const overlay = modal.parentElement;
    modal.setAttribute("role", overlay.id === "bankrupt-overlay" || overlay.id === "exit-guard-overlay" ? "alertdialog" : "dialog");
    modal.setAttribute("aria-modal", "true");
    if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
    const heading = modal.querySelector("h2");
    if (heading) {
      if (!heading.id) heading.id = `${overlay.id || "dialog-" + i}-title`;
      modal.setAttribute("aria-labelledby", heading.id);
    }
  });
}

function focusablesIn(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length > 0 && !n.closest("[hidden]"));
}

// Called by openOverlay when a dialog goes from closed to open.
// Centred dialogs keep their title centred around the close button (main.css).
function markCenteredDialog(modal) {
  const title = modal.querySelector(":scope > h2");
  modal.classList.toggle("is-centered", !!title && getComputedStyle(title).textAlign === "center");
}

function onDialogOpened(overlay) {
  const modal = overlay?.querySelector(".modal");
  if (!modal) return;
  if (!modal.getAttribute("role")) labelDialogs();
  markCenteredDialog(modal);
  const active = document.activeElement;
  if (active && active !== document.body && !overlay.contains(active)) DIALOG_FOCUS.set(overlay.id, active);
  // Wait a frame: some dialogs fill in their buttons right after opening.
  requestAnimationFrame(() => {
    if (!overlay.classList.contains("show")) return;
    if (overlay.contains(document.activeElement)) return;
    const target = INPUT_MODE.keyboard
      ? modal.querySelector(".btn-primary:not([disabled])") ||
        focusablesIn(modal).find((n) => !n.classList.contains("modal-close")) ||
        modal
      : modal;
    try {
      target.focus({ preventScroll: true });
    } catch (_err) {
      /* nothing focusable yet */
    }
  });
}

// Called by closeOverlay: focus goes back to whatever opened the dialog.
function onDialogClosed(overlay) {
  const back = DIALOG_FOCUS.get(overlay?.id);
  DIALOG_FOCUS.delete(overlay?.id);
  if (document.querySelector(".overlay.show")) return;
  if (back && document.contains(back) && back.getClientRects().length) {
    try {
      back.focus({ preventScroll: true });
    } catch (_err) {
      /* element went away */
    }
  }
}

// Tab stays inside the open dialog.
function installDialogFocusTrap() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const open = [...document.querySelectorAll(".overlay.show")].pop();
    const modal = open?.querySelector(".modal");
    if (!modal) return;
    const items = focusablesIn(modal);
    if (!items.length) {
      e.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (!modal.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });
}

// Screen readers hear each game event once, from a hidden live region, rather
// than the whole log being re-read.
const ANNOUNCE = { queue: [], timer: 0 };

function announce(text) {
  const clean = (typeof uiText === "function" ? uiText(text) : String(text || "")).trim();
  if (!clean) return;
  ANNOUNCE.queue.push(clean);
  if (ANNOUNCE.timer) return;
  ANNOUNCE.timer = setTimeout(() => {
    ANNOUNCE.timer = 0;
    const el = document.getElementById("sr-announcer");
    if (!el) return;
    el.textContent = ANNOUNCE.queue.splice(0).slice(-4).join(" ");
  }, 250);
}

function installAppShell() {
  installReduceMotion();
  installInstallPrompt();
  installUpdatePrompt();
  labelDialogs();
  installDialogFocusTrap();
}
