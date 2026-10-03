// ═══════════════════════════════════════════════
//  GAME OPTIONS
//  House rules (G.rules), the Free Parking jackpot, the match time limit,
//  pausing, AI speed and the first-game tips. Rules live in G, so they
//  travel with the game online, over Same Wi-Fi and in saved games.
// ═══════════════════════════════════════════════

const TIME_LIMIT_CHOICES = [0, 30, 45, 60, 90, 120];
const AI_LEVELS = ["easy", "normal", "hard"];

function sanitizeRules(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const limit = Number(r.timeLimitMin);
  return {
    freeParking: r.freeParking === true,
    noRentInJail: r.noRentInJail === true,
    doubleGo: r.doubleGo === true,
    timeLimitMin: TIME_LIMIT_CHOICES.includes(limit) ? limit : 0,
    aiLevel: AI_LEVELS.includes(r.aiLevel) ? r.aiLevel : "normal",
  };
}

function gameRules(state = G) {
  return sanitizeRules(state?.rules);
}

function aiLevel(state = G) {
  return gameRules(state).aiLevel;
}

// The lobby's house-rule controls, as a rules object.
function readLobbyRules() {
  const val = (id) => document.getElementById(id)?.value;
  return sanitizeRules({
    freeParking: val("rule-free-parking") === "on",
    noRentInJail: val("rule-jail-rent") === "off",
    doubleGo: val("rule-go-bonus") === "on",
    timeLimitMin: Number(val("rule-time-limit")) || 0,
    aiLevel: val("ai-difficulty"),
  });
}

function applyRulesToLobbyUi(raw) {
  const r = sanitizeRules(raw);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  set("rule-free-parking", r.freeParking ? "on" : "off");
  set("rule-jail-rent", r.noRentInJail ? "off" : "on");
  set("rule-go-bonus", r.doubleGo ? "on" : "off");
  set("rule-time-limit", String(r.timeLimitMin));
  set("ai-difficulty", r.aiLevel);
}

const LOBBY_RULE_CONTROL_IDS = [
  "ai-difficulty",
  "rule-free-parking",
  "rule-jail-rent",
  "rule-go-bonus",
  "rule-time-limit",
];

// One log line per rule that changes the standard game.
function logActiveHouseRules() {
  const r = gameRules();
  if (r.freeParking) addLog("House rule: taxes, fines and bail collect on Free Parking.", "important");
  if (r.noRentInJail) addLog("House rule: players in jail do not collect rent.", "important");
  if (r.doubleGo) addLog("House rule: landing exactly on GO pays double salary.", "important");
  if (r.timeLimitMin) addLog(`Time limit: ${formatMinutes(r.timeLimitMin)}. The richest player wins when it runs out.`, "important");
  if (G.players.some((p) => p.kind === "ai")) addLog(`AI difficulty: ${r.aiLevel}.`, "important");
}

function formatMinutes(min) {
  if (min < 60) return `${min} minutes`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} hour${h > 1 ? "s" : ""}`;
}

// ── Free Parking jackpot ───────────────────────────────────────────────────
function addToParkingPot(amount) {
  const due = Math.max(0, Math.floor(Number(amount) || 0));
  if (!due || !gameRules().freeParking) return;
  G.parkingPot = (Number(G.parkingPot) || 0) + due;
}

function collectParkingPot(p) {
  const pot = Math.max(0, Number(G.parkingPot) || 0);
  if (!gameRules().freeParking || !p) return;
  if (!pot) {
    addLog(`${p.name} landed on Free Parking. The jackpot is empty.`);
    return;
  }
  p.money += pot;
  G.parkingPot = 0;
  addLog(`${p.name} collected the ${fmtCurrency(pot)} Free Parking jackpot.`, "success");
  toast(`${p.name} won the ${fmtCurrency(pot)} jackpot`, "gold");
  playSfx("passgo");
}

// ── Match time limit ───────────────────────────────────────────────────────
function pausedMsSoFar() {
  const base = Math.max(0, Number(G?.pausedMs) || 0);
  return G?.pausedAt ? base + Math.max(0, Date.now() - Number(G.pausedAt)) : base;
}

function timeLimitLeftMs() {
  const min = gameRules().timeLimitMin;
  if (!min || !G?.gameStartedAt) return Infinity;
  const now = typeof serverNow === "function" && isOnlineGame() ? serverNow() : Date.now();
  return Number(G.gameStartedAt) + min * 60000 + pausedMsSoFar() - now;
}

function timeLimitReached() {
  return !G?.gameOver && timeLimitLeftMs() <= 0;
}

// Called from endTurn: once time is up, the match ends when the round in
// progress is over, and the highest net worth wins. A tie goes to the player
// with more cash in hand.
function finishGameOnTime() {
  const standing = G.players.filter((p) => !p.bankrupt);
  if (!standing.length) return false;
  const ranked = [...standing].sort(
    (a, b) => playerNetWorth(b) - playerNetWorth(a) || (Number(b.money) || 0) - (Number(a.money) || 0),
  );
  const winner = ranked[0];
  G.endReason = "time";
  G.winnerId = winner.id;
  addLog(
    `Time is up. ${winner.name} wins with the highest net worth, ${fmtCurrency(playerNetWorth(winner))}.`,
    "important",
  );
  renderAll();
  showWinner(winner);
  return true;
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Free Parking pot and time left, shown over the board while they apply.
function renderRulesHud() {
  const r = gameRules();
  const pot = document.getElementById("parking-pot-chip");
  if (pot) {
    pot.hidden = !r.freeParking || !!G?.gameOver;
    const v = pot.querySelector("[data-value]");
    if (v) v.textContent = fmtCurrency(Number(G?.parkingPot) || 0);
  }
  const clock = document.getElementById("time-limit-chip");
  if (clock) {
    const left = timeLimitLeftMs();
    clock.hidden = !Number.isFinite(left) || !!G?.gameOver;
    const v = clock.querySelector("[data-value]");
    if (v && Number.isFinite(left)) v.textContent = left > 0 ? formatClock(left) : "Last round";
    clock.classList.toggle("is-low", left < 5 * 60000);
  }
}

setInterval(() => {
  const screen = document.getElementById("game-screen");
  if (!G || document.hidden || !screen || screen.classList.contains("hidden")) return;
  renderRulesHud();
}, 1000);

// ── AI speed ───────────────────────────────────────────────────────────────
// Multiplies the AI's thinking pause between steps. Saved with the lobby prefs.
const AI_SPEED = { factor: 1 };
const AI_SPEED_CHOICES = [
  ["Relaxed", 1.6],
  ["Normal", 1],
  ["Fast", 0.45],
];

function aiStepDelayMs() {
  return Math.round((650 + Math.random() * 300) * (AI_SPEED.factor || 1));
}

function setAiSpeed(factor) {
  AI_SPEED.factor = Math.min(2, Math.max(0.25, Number(factor) || 1));
  saveLobbyPrefs();
  const label = AI_SPEED_CHOICES.find(([, v]) => Math.abs(v - AI_SPEED.factor) < 0.05)?.[0] || "Normal";
  toast(`AI speed: ${label.toLowerCase()}`, "gold");
  refreshSettingsViews();
}

// ── Pause (games on this device only) ──────────────────────────────────────
const PAUSE = { active: false };

function canPauseGame() {
  const screen = document.getElementById("game-screen");
  return !!(G && Array.isArray(G.players) && !G.gameOver && !isOnlineGame() && screen && !screen.classList.contains("hidden"));
}

function isGamePaused() {
  return PAUSE.active;
}

function pauseGame() {
  if (PAUSE.active || !canPauseGame()) return;
  PAUSE.active = true;
  G.pausedAt = Date.now();
  TIMER.paused = true;
  clearOfflineAiTimer(true);
  closeDrawer();
  openOverlay("pause-overlay");
  document.getElementById("pause-resume-btn")?.focus();
}

function resumeGame() {
  if (!PAUSE.active) return;
  PAUSE.active = false;
  const pausedFor = Math.max(0, Date.now() - (Number(G?.pausedAt) || Date.now()));
  if (G) {
    G.pausedMs = (Number(G.pausedMs) || 0) + pausedFor;
    G.pausedAt = null;
    // Deadlines that ran on the wall clock move on by the paused time too.
    if (G.auctionState && Number(G.auctionState.bidderSince)) G.auctionState.bidderSince += pausedFor;
    if (G.pendingTrade && Number(G.pendingTrade.createdAt)) G.pendingTrade.createdAt += pausedFor;
  }
  TIMER.paused = false;
  closeOverlay("pause-overlay");
  renderAll();
  maybeScheduleOfflineAiTurn();
}

function togglePause() {
  if (PAUSE.active) resumeGame();
  else pauseGame();
}

function updatePauseButton() {
  const btn = document.getElementById("pause-game-btn");
  if (btn) btn.hidden = !canPauseGame();
}

// ── First-game tips ────────────────────────────────────────────────────────
const TIPS_KEY = "monopoly_tips_v1";
const TIPS = {
  roll: {
    anchor: "#roll-btn",
    text: "Roll the dice to move. Doubles give you another roll, but three in a row send you to jail.",
  },
  buy: {
    anchor: "#buy-overlay .modal-actions",
    text: "Buy it at the list price, or send it to auction so everyone can bid. Owning a whole colour set doubles its rent.",
  },
  build: {
    anchor: "#btn-build:not([disabled]), #mb-build:not([disabled])",
    text: "You own a full colour set. Build houses to multiply its rent. Three houses is where rent really jumps.",
  },
  trade: {
    anchor: "#btn-trade:not([disabled]), #mb-trade:not([disabled])",
    text: "Trade properties, cash and Get Out of Jail Free cards with anyone, even when it isn't your turn.",
  },
};
const TIP_STATE = { current: "", el: null, follow: 0 };

function readTipsState() {
  try {
    const raw = JSON.parse(localStorage.getItem(TIPS_KEY) || "null");
    if (raw && typeof raw === "object") return { enabled: raw.enabled !== false, seen: Array.isArray(raw.seen) ? raw.seen : [] };
  } catch (_err) {
    /* storage unavailable: tips still show, just not remembered */
  }
  return { enabled: true, seen: [] };
}

function writeTipsState(state) {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify(state));
  } catch (_err) {
    /* see readTipsState */
  }
}

function tipsEnabled() {
  return readTipsState().enabled;
}

function setTipsEnabled(on) {
  const st = readTipsState();
  st.enabled = !!on;
  writeTipsState(st);
  if (!on) hideTip();
  refreshSettingsViews();
}

function resetTips() {
  writeTipsState({ enabled: true, seen: [] });
  toast("Tips will show again in your next game", "gold");
  refreshSettingsViews();
}

function markTipSeen(id) {
  const st = readTipsState();
  if (!st.seen.includes(id)) st.seen.push(id);
  writeTipsState(st);
}

function visibleAnchor(selector) {
  return [...document.querySelectorAll(selector)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
  });
}

function hideTip() {
  TIP_STATE.el?.remove();
  TIP_STATE.el = null;
  TIP_STATE.current = "";
  TIP_STATE.missingSince = 0;
  clearInterval(TIP_STATE.follow);
  TIP_STATE.follow = 0;
}

function dismissTip() {
  if (TIP_STATE.current) markTipSeen(TIP_STATE.current);
  hideTip();
}

function placeTip() {
  const tip = TIP_STATE.el;
  const def = TIPS[TIP_STATE.current];
  if (!tip || !def) return;
  const anchor = visibleAnchor(def.anchor);
  // Buttons blink out during a re-render or a camera move. Wait it out
  // instead of removing the tip, which then popped straight back up.
  if (!anchor) {
    tip.style.visibility = "hidden";
    TIP_STATE.missingSince ||= Date.now();
    if (Date.now() - TIP_STATE.missingSince > 2000) hideTip();
    return;
  }
  TIP_STATE.missingSince = 0;
  // A dialog opened over the anchor: step out of the way until it closes.
  const underDialog =
    [...document.querySelectorAll(".overlay.show")].some((o) => !o.contains(anchor)) ||
    !!document.querySelector("#mobile-drawer.open");
  tip.style.visibility = underDialog ? "hidden" : "";
  if (underDialog) return;
  const r = anchor.getBoundingClientRect();
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const gap = 12;
  const left = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
  // Below or above the anchor, whichever fits and covers fewer of the
  // controls around it (in 3D the roll button sits right over the action row).
  const controls = [...document.querySelectorAll("button, [role='button'], input, select")]
    .filter(
      (el) =>
        el !== anchor &&
        !tip.contains(el) &&
        !anchor.contains(el) &&
        el.getClientRects().length &&
        // Buttons on hidden screens still have a layout box; ignore them.
        (el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true),
    )
    .map((el) => el.getBoundingClientRect());
  const covered = (top) =>
    controls.reduce((sum, c) => {
      const x = Math.max(0, Math.min(left + w, c.right) - Math.max(left, c.left));
      const y = Math.max(0, Math.min(top + h, c.bottom) - Math.max(top, c.top));
      return sum + x * y;
    }, 0);
  const options = [
    { top: r.bottom + gap, below: true },
    { top: r.top - gap - h, below: false },
  ].filter((o) => o.top >= 8 && o.top + h <= innerHeight - 8);
  const pick = options.sort((a, b) => covered(a.top) - covered(b.top))[0] || { top: Math.max(8, r.top - gap - h), below: false };
  const below = pick.below;
  const top = pick.top;
  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  tip.classList.toggle("is-above", !below);
  const arrowX = Math.min(w - 18, Math.max(18, r.left + r.width / 2 - left));
  tip.style.setProperty("--arrow-x", `${Math.round(arrowX)}px`);
}

function showTip(id) {
  const def = TIPS[id];
  if (!def) return;
  hideTip();
  const tip = document.createElement("div");
  tip.className = "coach-tip";
  tip.setAttribute("role", "status");
  tip.innerHTML = `<p>${escHtml(def.text)}</p><div class="coach-tip-actions"><button type="button" class="coach-tip-skip">Turn off tips</button><button type="button" class="coach-tip-ok">Got it</button></div>`;
  tip.querySelector(".coach-tip-ok").addEventListener("click", dismissTip);
  tip.querySelector(".coach-tip-skip").addEventListener("click", () => {
    setTipsEnabled(false);
    toast("Tips turned off. You can turn them back on in settings.", "gold");
  });
  document.body.appendChild(tip);
  TIP_STATE.el = tip;
  TIP_STATE.current = id;
  placeTip();
  // The anchor can move without a render (the camera sliding between the 2D
  // and 3D views carries the roll button with it), so keep following it.
  TIP_STATE.follow = setInterval(() => {
    if (!document.hidden) placeTip();
  }, 250);
}

function humanOwnsFullSet() {
  const me = isOnlineGame() ? G.players[resolveLocalPlayerIndex()] : curPlayer();
  if (!me || isAiPlayer(me)) return false;
  return playerGroupProgress(me).some((g) => g.complete);
}

// Called after the action buttons update and when the buy dialog opens.
function maybeShowTip() {
  if (!G || G.gameOver || PAUSE.active || !tipsEnabled()) {
    if (TIP_STATE.el) hideTip();
    return;
  }
  const screen = document.getElementById("game-screen");
  if (!screen || screen.classList.contains("hidden")) return hideTip();
  const cur = curPlayer();
  const myTurn = cur && !isAiPlayer(cur) && canLocalControlTurn();
  const buyOpen = document.getElementById("buy-overlay")?.classList.contains("show");
  if (TIP_STATE.current) {
    // Doing what the tip says counts as reading it: it won't come back.
    if ((TIP_STATE.current === "roll" && G.phase !== "roll") || (TIP_STATE.current === "buy" && !buyOpen)) dismissTip();
    else placeTip();
    return;
  }
  const seen = new Set(readTipsState().seen);
  const otherOverlay = [...document.querySelectorAll(".overlay.show")].some((o) => o.id !== "buy-overlay");
  if (otherOverlay) return;
  let next = "";
  if (buyOpen && !seen.has("buy")) next = "buy";
  else if (buyOpen) return;
  else if (myTurn && G.phase === "roll" && !seen.has("roll")) next = "roll";
  else if (myTurn && G.phase !== "roll" && humanOwnsFullSet() && !seen.has("build")) next = "build";
  else if (myTurn && G.phase === "end" && seen.has("roll") && (cur.properties.length + cur.railroads.length + cur.utilities.length) > 0 && !seen.has("trade")) next = "trade";
  if (next && visibleAnchor(TIPS[next].anchor)) showTip(next);
}

window.addEventListener("resize", () => placeTip());
