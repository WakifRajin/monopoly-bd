// ═══════════════════════════════════════════════
//  SHOW PROPERTY INFO
// ═══════════════════════════════════════════════
function showSpaceInfo(id) {
  const sp = SPACES[id];
  const prop = G.properties[id];
  const modal = document.getElementById("prop-modal");

  if (sp.type === "property") {
    const owner =
      prop?.owner !== null && prop?.owner !== undefined
        ? G.players[prop.owner]
        : null;
    const c = COLOR[sp.color];
    modal.innerHTML = `
      <div class="prop-color-header" style="background:linear-gradient(135deg,${c},${c}cc)">${sp.name}</div>
      ${owner ? `<div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:.75rem">Owned by <span style="color:${owner.color};font-weight:700">${owner.token} ${owner.name}</span>${prop.mortgaged ? " (Mortgaged)" : ""}</div>` : '<div style="color:rgba(255,255,255,.5);font-size:.82rem;margin-bottom:.75rem">For Sale — ' + fmtCurrency(sp.price) + "</div>"}
      <table class="prop-table">
        <tr><td>Purchase Price</td><td>${fmtCurrency(sp.price)}</td></tr>
        <tr><td>Rent</td><td>${fmtCurrency(sp.rent[0])}</td></tr>
        <tr><td>Rent w/ Monopoly</td><td>${fmtCurrency(sp.rent[0] * 2)}</td></tr>
        <tr><td>Rent 1 House</td><td>${fmtCurrency(sp.rent[1])}</td></tr>
        <tr><td>Rent 2 Houses</td><td>${fmtCurrency(sp.rent[2])}</td></tr>
        <tr><td>Rent 3 Houses</td><td>${fmtCurrency(sp.rent[3])}</td></tr>
        <tr><td>Rent 4 Houses</td><td>${fmtCurrency(sp.rent[4])}</td></tr>
        <tr><td>Rent Hotel</td><td>${fmtCurrency(sp.rent[5])}</td></tr>
        <tr><td>House Cost</td><td>${fmtCurrency(sp.house)}</td></tr>
        <tr><td>Mortgage Value</td><td>${fmtCurrency(mortgageValueForSpace(sp))}</td></tr>
        ${prop ? `<tr><td>Buildings</td><td>${prop.hotel ? "🏨 Hotel" : prop.houses > 0 ? "🏠×" + prop.houses : "None"}</td></tr>` : ""}
      </table>
      <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('prop-overlay')">Close</button>
    `;
  } else if (sp.type === "railroad") {
    const owner =
      prop?.owner !== null && prop?.owner !== undefined
        ? G.players[prop.owner]
        : null;
    modal.innerHTML = `
      <div class="prop-color-header" style="background:linear-gradient(135deg,#333,#555)">🚂 ${sp.name}</div>
      ${owner ? `<div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:.75rem">Owned by <span style="color:${owner.color};font-weight:700">${owner.token} ${owner.name}</span></div>` : '<div style="color:rgba(255,255,255,.5);font-size:.82rem;margin-bottom:.75rem">For Sale — ' + fmtCurrency(sp.price) + "</div>"}
      <table class="prop-table">
        <tr><td>Price</td><td>${fmtCurrency(sp.price)}</td></tr>
        <tr><td>Rent (1 RR)</td><td>${fmtCurrency(sp.rent[0])}</td></tr>
        <tr><td>Rent (2 RRs)</td><td>${fmtCurrency(sp.rent[1])}</td></tr>
        <tr><td>Rent (3 RRs)</td><td>${fmtCurrency(sp.rent[2])}</td></tr>
        <tr><td>Rent (4 RRs)</td><td>${fmtCurrency(sp.rent[3])}</td></tr>
        <tr><td>Mortgage</td><td>${fmtCurrency(mortgageValueForSpace(sp))}</td></tr>
      </table>
      <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('prop-overlay')">Close</button>
    `;
  } else {
    modal.innerHTML = `
      <div style="font-size:2.5rem;text-align:center;margin-bottom:.75rem">${sp.icon || "📋"}</div>
      <h2 style="color:#fff;text-align:center;margin-bottom:.5rem">${sp.name}</h2>
      <p style="color:rgba(255,255,255,.6);text-align:center">${sp.desc || ""}</p>
      <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('prop-overlay')">Close</button>
    `;
  }
  openOverlay("prop-overlay");
}

// ═══════════════════════════════════════════════
//  WINNER
// ═══════════════════════════════════════════════
function showWinner(p) {
  if (!p) return;
  playSfx("win");
  G.gameOver = true;
  G.auctionState = null;
  G.bankAuctionQueue = [];
  closeAllOverlays();
  closeDrawer();
  document.getElementById("winner-trophy").textContent = p.token;
  document.getElementById("winner-name").textContent = p.name + " Wins!";
  document.getElementById("winner-sub").textContent =
    `${p.name} is the ${(window.ACTIVE_THEME || BOARD_THEMES.dhaka).name} Monopoly champion with ${fmtCurrency(p.money)}!`;
  renderWinnerLeaderboard(p.id);
  // Confetti
  const cont = document.getElementById("confetti-container");
  cont.innerHTML = "";
  const emojis = ["🎉", "🎊", "🏆", "⭐", "🌟", "💰", "🎲"];
  for (let i = 0; i < 20; i++) {
    const span = document.createElement("div");
    span.className = "confetti";
    span.textContent = emojis[i % emojis.length];
    span.style.left = Math.random() * 100 + "vw";
    span.style.animationDelay = Math.random() * 3 + "s";
    span.style.animationDuration = 2 + Math.random() * 2 + "s";
    cont.appendChild(span);
  }
  showScreen("winner-screen");
}

function renderWinnerLeaderboard(winnerId) {
  const host = document.getElementById("winner-leaderboard");
  if (!host) return;
  if (!G || !Array.isArray(G.players) || !G.players.length) {
    host.innerHTML = "";
    return;
  }

  const entries = G.players.map((player) => ({
    player,
    cash: Number(player.money) || 0,
    bankruptOrder:
      Number.isInteger(Number(player.bankruptOrder)) &&
      Number(player.bankruptOrder) > 0
        ? Number(player.bankruptOrder)
        : -1,
  }));

  entries.sort((a, b) => {
    const aBankrupt = !!a.player.bankrupt;
    const bBankrupt = !!b.player.bankrupt;
    if (aBankrupt !== bBankrupt) return aBankrupt ? 1 : -1;

    // Rank eliminated players by who survived longer (last bankrupt first).
    if (aBankrupt && bBankrupt && a.bankruptOrder !== b.bankruptOrder) {
      return b.bankruptOrder - a.bankruptOrder;
    }

    if (b.cash !== a.cash) return b.cash - a.cash;
    return String(a.player.name || "").localeCompare(
      String(b.player.name || ""),
    );
  });

  const winnerIdx = entries.findIndex(
    (entry) => Number(entry.player.id) === Number(winnerId),
  );
  if (winnerIdx > 0) {
    const [winnerEntry] = entries.splice(winnerIdx, 1);
    entries.unshift(winnerEntry);
  }

  const others = entries
    .filter((entry) => Number(entry.player.id) !== Number(winnerId))
    .slice(0, 5);

  if (!others.length) {
    host.innerHTML = '<div class="winner-leader-empty">No other players.</div>';
    return;
  }

  host.innerHTML = others
    .map((entry, idx) => {
      const rank = idx + 2;
      const player = entry.player;
      const status = player.bankrupt
        ? entry.bankruptOrder > 0
          ? ` • Bankrupt #${entry.bankruptOrder}`
          : " • Bankrupt"
        : " • Still standing";
      return `
      <div class="winner-leader-row">
        <div class="winner-leader-left">
          <span class="winner-leader-rank">#${rank}</span>
          <span class="winner-leader-token">${escHtml(player.token || "👤")}</span>
          <span class="winner-leader-name">${escHtml(player.name || "Player")}${status}</span>
        </div>
        <span class="winner-leader-money">${fmtCurrency(entry.cash)}</span>
      </div>
    `;
    })
    .join("");
}

function maybeShowWinnerFromState() {
  if (!G || !Array.isArray(G.players) || !G.players.length) return false;
  const active = G.players.filter((player) => !player.bankrupt);
  if (active.length !== 1) return false;
  const winnerScreen = document.getElementById("winner-screen");
  if (winnerScreen && !winnerScreen.classList.contains("hidden")) return true;
  showWinner(active[0]);
  return true;
}

function viewBoardAfterWin() {
  if (!G || !G.gameOver) return;
  closeAllOverlays();
  closeDrawer();
  renderAll();
  showScreen("game-screen");
}

function restartGame() {
  stopTimer();
  clearOfflineAiTimer(true);
  showScreen("lobby-screen");
}

// ═══════════════════════════════════════════════
//  CHAT & LOG
// ═══════════════════════════════════════════════
function normalizeLogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const text = String(entry.text || "").trim();
  if (!text) return null;
  const time = Number(entry.time) || Date.now();
  return {
    id: String(entry.id || ""),
    text,
    type: String(entry.type || ""),
    time,
  };
}

function getLogEntryKey(entry) {
  if (!entry || typeof entry !== "object") return "";
  const explicitId = String(entry.id || "");
  if (explicitId) return explicitId;
  const ts = Number(entry.time) || 0;
  const type = String(entry.type || "");
  const text = String(entry.text || "");
  return `${ts}|${type}|${text}`;
}

function clearLogArchive(gameStartedAt = 0) {
  LOG_ARCHIVE.length = 0;
  LOG_ARCHIVE_KEYS.clear();
  LOG_ARCHIVE_GAME_STARTED_AT = Number(gameStartedAt) || 0;
}

function appendLogsToArchive(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  for (let i = 0; i < entries.length; i++) {
    const normalized = normalizeLogEntry(entries[i]);
    if (!normalized) continue;
    const key = getLogEntryKey(normalized);
    if (!key || LOG_ARCHIVE_KEYS.has(key)) continue;
    LOG_ARCHIVE.push(normalized);
    LOG_ARCHIVE_KEYS.add(key);
  }

  if (LOG_ARCHIVE.length > GAME_LOG_ARCHIVE_LIMIT) {
    const overflow = LOG_ARCHIVE.length - GAME_LOG_ARCHIVE_LIMIT;
    const removed = LOG_ARCHIVE.splice(0, overflow);
    for (let i = 0; i < removed.length; i++) {
      const key = getLogEntryKey(removed[i]);
      if (key) LOG_ARCHIVE_KEYS.delete(key);
    }
  }
}

function getFullLogEntries() {
  if (Array.isArray(G.log) && G.log.length) {
    appendLogsToArchive(G.log);
  }
  if (LOG_ARCHIVE.length) return LOG_ARCHIVE;
  return Array.isArray(G.log) ? G.log : [];
}

function addLog(text, type = "") {
  const entry = normalizeLogEntry({
    id: `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    text,
    type,
    time: Date.now(),
  });
  if (!entry) return;
  if (!G.log) G.log = [];
  G.log.push(entry);
  appendLogsToArchive([entry]);
  if (G.log.length > GAME_LOG_LIMIT) G.log = G.log.slice(-GAME_LOG_LIMIT);
  renderGameLog();
}

function getLastChatMessage() {
  return Array.isArray(G.chat) && G.chat.length
    ? G.chat[G.chat.length - 1]
    : null;
}

function chatMessageKey(msg) {
  if (!msg) return "";
  const ts = Number(msg.time) || 0;
  const who = String(msg.uid || msg.name || "");
  const text = String(msg.text || "");
  return `${ts}|${who}|${text}`;
}

function isChatPanelOpenOnMobile() {
  const drawer = document.getElementById("mobile-drawer");
  if (!drawer || !drawer.classList.contains("open")) return false;
  return !!document.getElementById("drawer-chat");
}

function showChatPreview(msg) {
  const key = chatMessageKey(msg);
  if (!key || CHAT_PREVIEW.lastShownKey === key) return;
  CHAT_PREVIEW.lastShownKey = key;

  const isMobile = !!(
    window.matchMedia && window.matchMedia("(max-width: 899px)").matches
  );
  if (!isMobile || isChatPanelOpenOnMobile()) return;

  const activeId = document.activeElement?.id || "";
  if (activeId === "chat-input" || activeId === "drawer-chat-input") return;

  const token = String(msg.token || "💬");
  const name = String(msg.name || "Player").trim() || "Player";
  const cleanText = String(msg.text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanText) return;
  const preview =
    cleanText.length > 56 ? `${cleanText.slice(0, 56)}...` : cleanText;
  toast(`${token} ${name}: ${preview}`, "chat");
}

function sendChat() {
  const inp = document.getElementById("chat-input");
  const text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  if (!G.chat) G.chat = [];
  const p = isOnlineGame()
    ? (G.players || []).find((x) => x.uid === ONLINE.localUid)
    : curPlayer();
  if (!p) return;
  G.chat.push({
    uid: p.uid || null,
    name: p.name,
    token: p.token,
    color: p.color,
    text,
    time: Date.now(),
  });
  if (G.chat.length > 120) G.chat = G.chat.slice(-120);
  showChatPreview(getLastChatMessage());
  renderChatLog();
  const dc = document.getElementById("drawer-chat");
  if (dc) dc.innerHTML = document.getElementById("chat-log").innerHTML;
}

// ═══════════════════════════════════════════════
//  DRAWER (mobile)
// ═══════════════════════════════════════════════
function openDrawer(type) {
  const content = document.getElementById("drawer-content");
  if (type === "players") {
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-display)">👥 Players</h3>
      ${(G.players || [])
        .map((p, i) => {
          const active = i === G.currentPlayerIdx;
          const where = p.inJail
            ? "In Jail"
            : SPACES[p.pos]?.name || "On board";
          const border = active ? "var(--gold-light)" : "rgba(255,255,255,.14)";
          const bg = active ? "rgba(201,151,28,.12)" : "rgba(255,255,255,.05)";
          const color = sanitizeColor(p.color, "#ffffff");
          return `<div onclick="showPlayerPortfolio(${i});closeDrawer()" style="display:flex;align-items:center;gap:.55rem;padding:.5rem .55rem;border:1px solid ${border};border-radius:8px;background:${bg};margin-bottom:.38rem;cursor:pointer">
          <div style="font-size:1.15rem;color:${color}">${p.token}</div>
          <div style="min-width:0;flex:1">
            <div style="color:#fff;font-weight:700;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}${p.bankrupt ? " 💀" : ""}</div>
            <div style="color:rgba(255,255,255,.5);font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(where)}</div>
          </div>
          <div style="font-size:.82rem;color:var(--gold-light);font-weight:700">${fmtCurrency(p.money)}</div>
        </div>`;
        })
        .join("")}
      <p style="color:rgba(255,255,255,.45);font-size:.74rem;margin-top:.35rem">Tap a player card to view full portfolio and assets.</p>
    `;
  } else if (type === "log") {
    content.innerHTML =
      '<h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-display)">📋 Game Log</h3>' +
      G.log
        .slice(-30)
        .map(
          (l) =>
            `<div class="log-entry${l.type ? " log-" + l.type : ""}">${escHtml(l.text || "")}</div>`,
        )
        .join("");
  } else if (type === "chat") {
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-display)">💬 Chat</h3>
      <div id="drawer-chat" style="max-height:300px;overflow-y:auto"></div>
      <div style="display:flex;gap:.5rem;margin-top:.75rem">
        <input id="drawer-chat-input" type="text" placeholder="Message..." style="flex:1;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:.4rem .6rem;color:#fff;font-family:var(--font-body)">
        <button onclick="sendChatFromDrawer()" style="background:var(--green);border:none;color:#fff;border-radius:6px;padding:.4rem .7rem;cursor:pointer;font-weight:600">Send</button>
      </div>
    `;
    // Clone chat messages
    const dc = document.getElementById("drawer-chat");
    dc.innerHTML = document.getElementById("chat-log").innerHTML;
  } else if (type === "settings") {
    const dur = TIMER.duration;
    const sfxVolumePct = Math.round(clampSfxVolume(SFX.volume) * 100);
    const sfxEnabled = !!SFX.enabled;
    const bgmEnabled = !!SFX.bgmEnabled;
    const canLeave = isOnlineGame() && ONLINE.status === "playing";
    const leaveBlock = canLeave
      ? `<hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:1rem 0">
         <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:.6rem">Online match</div>
         <button onclick="closeDrawer();openLeaveGameModal()" style="width:100%;padding:.6rem .9rem;border:none;border-radius:8px;background:linear-gradient(135deg,#7f1d1d,#c0392b);color:#fff;font-weight:700;cursor:pointer">🚪 Leave Game</button>`
      : "";
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:1rem;font-family:var(--font-display)">⚙️ Timer & Sound Settings</h3>
      <div style="margin-bottom:1rem;padding:.75rem;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.05)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.65rem">
          <div>
            <div style="color:#fff;font-size:.88rem;font-weight:700">Sound Effects</div>
            <div style="color:rgba(255,255,255,.52);font-size:.76rem">Dice, rent, jail, auction, and win sounds</div>
          </div>
          <button onclick="toggleSfxEnabled()" style="padding:.42rem .75rem;border:1px solid ${sfxEnabled ? "rgba(45,160,90,.5)" : "rgba(255,255,255,.25)"};background:${sfxEnabled ? "rgba(45,160,90,.22)" : "rgba(255,255,255,.07)"};color:${sfxEnabled ? "#86efac" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:.8rem;font-weight:700">${sfxEnabled ? "On" : "Off"}</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.65rem">
          <div>
            <div style="color:#fff;font-size:.88rem;font-weight:700">Background Music</div>
            <div style="color:rgba(255,255,255,.52);font-size:.76rem">Plays during active match</div>
          </div>
          <button onclick="toggleBgmEnabled()" style="padding:.42rem .75rem;border:1px solid ${bgmEnabled ? "rgba(240,192,64,.5)" : "rgba(255,255,255,.25)"};background:${bgmEnabled ? "rgba(240,192,64,.18)" : "rgba(255,255,255,.07)"};color:${bgmEnabled ? "var(--gold-light)" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:.8rem;font-weight:700">${bgmEnabled ? "On" : "Off"}</button>
        </div>
        <label style="color:rgba(255,255,255,.72);font-size:.82rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">
          <span>Volume</span>
          <span id="sfx-volume-label">${sfxVolumePct}%</span>
        </label>
        <input type="range" min="0" max="100" value="${sfxVolumePct}" oninput="document.getElementById('sfx-volume-label').textContent=this.value+'%';setSfxVolume(Number(this.value)/100,false)" onchange="setSfxVolume(Number(this.value)/100,true)" style="width:100%;accent-color:var(--gold-light)">
      </div>
      <p style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:1rem">
        After a player finishes their move, a countdown begins. When it hits zero, the turn automatically advances — even if they haven't clicked End Turn.
      </p>
      <div style="margin-bottom:1rem">
        <label style="color:rgba(255,255,255,.7);font-size:.85rem;display:block;margin-bottom:.4rem">Auto-advance delay</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${[0, 10, 20, 30, 45, 60].map((v) => `<button onclick="setTimerDuration(${v})" style="padding:.5rem .9rem;border:1px solid ${dur === v ? "var(--gold-light)" : "rgba(255,255,255,.2)"};background:${dur === v ? "rgba(201,151,28,.25)" : "rgba(255,255,255,.07)"};color:${dur === v ? "var(--gold-light)" : "rgba(255,255,255,.7)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:.85rem;font-weight:600">${v === 0 ? "Off" : v + "s"}</button>`).join("")}
        </div>
      </div>
      <p style="color:rgba(255,255,255,.4);font-size:.78rem">Timer only runs during the "end turn" phase (after rolling & landing). It pauses while modals are open.</p>
      ${leaveBlock}
    `;
  }
  document.getElementById("mobile-drawer").classList.add("open");
}

function sendChatFromDrawer() {
  const inp = document.getElementById("drawer-chat-input");
  if (!inp) return;
  document.getElementById("chat-input").value = inp.value;
  sendChat();
  inp.value = "";
  const dc = document.getElementById("drawer-chat");
  if (dc) dc.innerHTML = document.getElementById("chat-log").innerHTML;
}

function closeDrawer() {
  document.getElementById("mobile-drawer").classList.remove("open");
}

// ═══════════════════════════════════════════════
//  OVERLAYS
// ═══════════════════════════════════════════════
function openOverlay(id) {
  document.getElementById(id).classList.add("show");
}
function closeOverlay(id) {
  document.getElementById(id).classList.remove("show");
}
function closeAllOverlays() {
  document
    .querySelectorAll(".overlay.show")
    .forEach((el) => el.classList.remove("show"));
}

const SFX_EVENT_FILES = Object.freeze({
  dice: ["sounds/dice_roll_sfx.mp3"],
  buy: ["sounds/clicktap_sfx.mp3"],
  rent: ["sounds/decline_sfx.mp3"],
  tax: ["sounds/decline_sfx.mp3"],
  card: ["sounds/clicktap_sfx.mp3"],
  jail: ["sounds/decline_sfx.mp3"],
  bail: ["sounds/clicktap_sfx.mp3"],
  build: ["sounds/clicktap_sfx.mp3"],
  sell: ["sounds/clicktap_sfx.mp3"],
  mortgage: ["sounds/decline_sfx.mp3"],
  unmortgage: ["sounds/clicktap_sfx.mp3"],
  "auction-open": ["sounds/clicktap_sfx.mp3"],
  bid: ["sounds/clicktap_sfx.mp3"],
  "auction-win": ["sounds/clicktap_sfx.mp3"],
  bankrupt: ["sounds/game_over_sfx.mp3"],
  turn: ["sounds/clicktap_sfx.mp3"],
  win: ["sounds/win_sfx.mp3"],
  inability: ["sounds/inability_sfx.mp3"],
});

const SFX_BGM_FILE = "sounds/background_01.mp3";
const SFX_BGM_VOLUME_FACTOR = 0.34;

const SFX = {
  enabled: true,
  bgmEnabled: true,
  volume: SFX_DEFAULT_VOLUME,
  ctx: null,
  master: null,
  noiseBuffer: null,
  lastPlayedAt: {},
  assetPool: {},
  activeClips: new Set(),
  bgmAudio: null,
};

function clampSfxVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SFX_DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, n));
}

function getVisibleScreenId() {
  return document.querySelector(".screen:not(.hidden)")?.id || "";
}

function getSfxFilesForEvent(name) {
  const raw = SFX_EVENT_FILES[String(name || "")];
  if (!raw) return [];
  return Array.isArray(raw) ? raw.filter(Boolean) : [String(raw)];
}

function ensureSfxAssetTemplate(src) {
  if (!src) return null;
  if (SFX.assetPool[src]) return SFX.assetPool[src];
  try {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
    SFX.assetPool[src] = audio;
    return audio;
  } catch (_err) {
    return null;
  }
}

function preloadSfxAssets() {
  const files = new Set();
  Object.values(SFX_EVENT_FILES).forEach((list) => {
    (Array.isArray(list) ? list : [list]).forEach((src) => {
      if (src) files.add(String(src));
    });
  });
  files.add(SFX_BGM_FILE);
  files.forEach((src) => {
    ensureSfxAssetTemplate(src);
  });
}

function ensureBgmAudio() {
  if (SFX.bgmAudio) return SFX.bgmAudio;
  try {
    const bgm = new Audio(SFX_BGM_FILE);
    bgm.preload = "auto";
    bgm.loop = true;
    bgm.volume = clampSfxVolume(SFX.volume * SFX_BGM_VOLUME_FACTOR);
    SFX.bgmAudio = bgm;
    return bgm;
  } catch (_err) {
    return null;
  }
}

function loadSfxPreferences() {
  try {
    const enabledRaw = localStorage.getItem(SFX_PREF_ENABLED_KEY);
    if (enabledRaw === "0" || enabledRaw === "1") {
      SFX.enabled = enabledRaw === "1";
    }
    const bgmRaw = localStorage.getItem(SFX_PREF_BGM_ENABLED_KEY);
    if (bgmRaw === "0" || bgmRaw === "1") {
      SFX.bgmEnabled = bgmRaw === "1";
    }
    const volumeRaw = localStorage.getItem(SFX_PREF_VOLUME_KEY);
    if (volumeRaw !== null) {
      SFX.volume = clampSfxVolume(volumeRaw);
    }
  } catch (_err) {}
}

function persistSfxPreferences() {
  try {
    localStorage.setItem(SFX_PREF_ENABLED_KEY, SFX.enabled ? "1" : "0");
    localStorage.setItem(SFX_PREF_BGM_ENABLED_KEY, SFX.bgmEnabled ? "1" : "0");
    localStorage.setItem(SFX_PREF_VOLUME_KEY, String(SFX.volume));
  } catch (_err) {}
}

function ensureSfxEngine() {
  if (SFX.ctx && SFX.master) return SFX.ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = SFX.enabled ? SFX.volume : 0;
    master.connect(ctx.destination);
    SFX.ctx = ctx;
    SFX.master = master;
    return ctx;
  } catch (_err) {
    return null;
  }
}

function syncBgmForScreen(screenId = getVisibleScreenId()) {
  const bgm = ensureBgmAudio();
  if (!bgm) return;

  bgm.volume = clampSfxVolume(SFX.volume * SFX_BGM_VOLUME_FACTOR);
  const shouldPlay = !!(
    SFX.enabled &&
    SFX.bgmEnabled &&
    screenId === "game-screen" &&
    !G?.gameOver
  );
  if (!shouldPlay) {
    bgm.pause();
    if (screenId !== "game-screen") {
      try {
        bgm.currentTime = 0;
      } catch (_err) {}
    }
    return;
  }

  const p = bgm.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
}

function updateSfxMasterGain() {
  if (SFX.ctx && SFX.master) {
    const target = SFX.enabled ? SFX.volume : 0;
    SFX.master.gain.setTargetAtTime(target, SFX.ctx.currentTime, 0.015);
  }
  syncBgmForScreen();
}

function unlockSfxEngine() {
  const ctx = ensureSfxEngine();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  syncBgmForScreen();
}

function installSfxUnlockListeners() {
  const unlock = () => {
    unlockSfxEngine();
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

function setSfxEnabled(enabled, notify = true) {
  SFX.enabled = !!enabled;
  persistSfxPreferences();
  ensureSfxEngine();
  updateSfxMasterGain();
  if (notify)
    toast(SFX.enabled ? "🔊 Sound enabled" : "🔇 Sound muted", "gold");
}

function toggleSfxEnabled() {
  setSfxEnabled(!SFX.enabled, true);
  openDrawer("settings");
}

function setBgmEnabled(enabled, notify = true) {
  SFX.bgmEnabled = !!enabled;
  persistSfxPreferences();
  syncBgmForScreen();
  if (notify)
    toast(SFX.bgmEnabled ? "🎵 Music enabled" : "🎵 Music muted", "gold");
}

function toggleBgmEnabled() {
  setBgmEnabled(!SFX.bgmEnabled, true);
  openDrawer("settings");
}

function setSfxVolume(volume, notify = false) {
  SFX.volume = clampSfxVolume(volume);
  persistSfxPreferences();
  ensureSfxEngine();
  updateSfxMasterGain();
  if (notify) toast(`🔉 SFX volume ${Math.round(SFX.volume * 100)}%`, "gold");
}

function ensureSfxNoiseBuffer(ctx) {
  if (SFX.noiseBuffer && SFX.noiseBuffer.sampleRate === ctx.sampleRate)
    return SFX.noiseBuffer;
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.9));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  SFX.noiseBuffer = buffer;
  return buffer;
}

function playSfxTone(freq, duration, opts = {}) {
  const ctx = SFX.ctx;
  if (!ctx || !SFX.master || !Number.isFinite(freq) || freq <= 0) return;
  const type = String(opts.type || "sine");
  const gainValue = Math.max(0.0001, Number(opts.gain) || 0.12);
  const attack = Math.max(0.001, Number(opts.attack) || 0.003);
  const release = Math.max(0.01, Number(opts.release) || 0.08);
  const start = ctx.currentTime + Math.max(0, Number(opts.start) || 0) + 0.004;

  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (Number.isFinite(Number(opts.detune))) {
    osc.detune.setValueAtTime(Number(opts.detune), start);
  }

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gainValue, start + attack);
  amp.gain.exponentialRampToValueAtTime(
    0.0001,
    start + Math.max(0.02, duration) + release,
  );

  osc.connect(amp);
  amp.connect(SFX.master);
  osc.start(start);
  osc.stop(start + Math.max(0.02, duration) + release + 0.02);
}

function playSfxNoise(duration, opts = {}) {
  const ctx = SFX.ctx;
  if (!ctx || !SFX.master) return;
  const start = ctx.currentTime + Math.max(0, Number(opts.start) || 0) + 0.004;
  const gainValue = Math.max(0.0001, Number(opts.gain) || 0.05);
  const release = Math.max(0.01, Number(opts.release) || 0.06);
  const freq = Math.max(120, Number(opts.frequency) || 1100);

  const src = ctx.createBufferSource();
  src.buffer = ensureSfxNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(freq, start);
  filter.Q.value = 0.9;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gainValue, start);
  amp.gain.exponentialRampToValueAtTime(
    0.0001,
    start + Math.max(0.02, duration) + release,
  );

  src.connect(filter);
  filter.connect(amp);
  amp.connect(SFX.master);
  src.start(start);
  src.stop(start + Math.max(0.02, duration) + release + 0.02);
}

function canPlaySfx(name, cooldownMs = 80) {
  const now =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const key = String(name || "generic");
  const last = Number(SFX.lastPlayedAt[key]) || 0;
  if (now - last < Math.max(0, cooldownMs)) return false;
  SFX.lastPlayedAt[key] = now;
  return true;
}

function playSfxAsset(name, options = {}) {
  const files = getSfxFilesForEvent(name);
  if (!files.length) return false;
  const src = files.length === 1 ? files[0] : files[rand(0, files.length - 1)];
  const template = ensureSfxAssetTemplate(src);
  if (!template) return false;

  try {
    const clip = template.cloneNode(true);
    clip.preload = "auto";
    clip.volume = clampSfxVolume(
      SFX.volume * Math.max(0, Number(options.volumeFactor) || 1),
    );
    SFX.activeClips.add(clip);
    const clear = () => SFX.activeClips.delete(clip);
    clip.addEventListener("ended", clear, { once: true });
    clip.addEventListener("error", clear, { once: true });
    const p = clip.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        clear();
      });
    }
    return true;
  } catch (_err) {
    return false;
  }
}

function playSfxSynthFallback(name) {
  switch (name) {
    case "dice":
      playSfxNoise(0.09, { gain: 0.04, frequency: 1200 });
      playSfxTone(210 + rand(0, 50), 0.05, {
        type: "triangle",
        gain: 0.07,
      });
      playSfxTone(280 + rand(0, 70), 0.06, {
        type: "triangle",
        gain: 0.06,
        start: 0.055,
      });
      break;
    case "win":
      playSfxTone(392, 0.09, { type: "triangle", gain: 0.08 });
      playSfxTone(523.25, 0.1, {
        type: "triangle",
        gain: 0.08,
        start: 0.1,
      });
      playSfxTone(659.25, 0.12, {
        type: "triangle",
        gain: 0.08,
        start: 0.22,
      });
      playSfxTone(783.99, 0.16, {
        type: "triangle",
        gain: 0.08,
        start: 0.34,
      });
      break;
    case "bankrupt":
      playSfxNoise(0.14, { gain: 0.04, frequency: 420 });
      playSfxTone(165, 0.24, { type: "square", gain: 0.07, start: 0.02 });
      break;
    default:
      playSfxTone(500, 0.05, { type: "sine", gain: 0.04 });
      break;
  }
}

function playSfx(name, options = {}) {
  if (!SFX.enabled) return;
  const ctx = ensureSfxEngine();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const cooldownByName = {
    dice: 130,
    bid: 90,
    build: 90,
    sell: 90,
    mortgage: 110,
    unmortgage: 110,
    turn: 150,
    rent: 130,
    jail: 220,
    card: 120,
    bankrupt: 260,
    win: 550,
    inability: 240,
  };

  if (
    !canPlaySfx(name, Number(options.cooldownMs) || cooldownByName[name] || 90)
  )
    return;
  if (playSfxAsset(name, options)) return;
  playSfxSynthFallback(name);
}

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════
let toastTimer;
function toast(msg, type = "") {
  if (type === "danger") {
    const lower = String(msg || "").toLowerCase();
    if (
      lower.includes("not enough") ||
      lower.includes("must") ||
      lower.includes("cannot") ||
      lower.includes("wait")
    ) {
      playSfx("inability", { cooldownMs: 260 });
    } else {
      playSfx("rent", { cooldownMs: 240 });
    }
  }
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = type ? `toast-${type}` : "";
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════
function curPlayer() {
  return G.players[G.currentPlayerIdx];
}
function getLivePlayer(playerOrId, state = G) {
  if (!state || !Array.isArray(state.players) || !state.players.length)
    return null;
  const id =
    typeof playerOrId === "object" && playerOrId !== null
      ? Number(playerOrId.id)
      : Number(playerOrId);
  if (!Number.isInteger(id) || id < 0 || id >= state.players.length)
    return null;
  return state.players[id] || null;
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function fmt(n) {
  return Math.abs(n).toLocaleString("en-BD");
}
function fmtCurrency(n) {
  const t = window.ACTIVE_THEME || BOARD_THEMES.dhaka;
  return `${t.currency}${Math.abs(n).toLocaleString(t.locale)}`;
}
function formatThemeCurrencyText(text) {
  const raw = String(text || "");
  if (!raw) return "";
  return raw.replace(/৳\s*([0-9][0-9,]*)/g, (m, digits) => {
    const amount = Number(String(digits).replace(/,/g, ""));
    return Number.isFinite(amount) ? fmtCurrency(amount) : m;
  });
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function removeFrom(arr, val) {
  const i = arr.indexOf(val);
  if (i >= 0) arr.splice(i, 1);
}
function escHtml(t) {
  return String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escAttr(t) {
  return escHtml(String(t)).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function rolledDoublesThisTurn() {
  return G.lastDoubles;
}

const PORTFOLIO_VIEW = {
  playerIdx: -1,
  tab: "properties",
};

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMoneyAmountFromText(text) {
  const raw = String(text || "");
  if (!raw) return 0;

  const symbols = Array.from(
    new Set([
      ...Object.values(BOARD_THEMES || {})
        .map((t) => String(t?.currency || "").trim())
        .filter(Boolean),
      "৳",
      "$",
      "⚜",
    ]),
  );
  if (!symbols.length) return 0;

  const pattern = symbols.map(escapeRegExp).join("|");
  const match = raw.match(new RegExp(`(?:${pattern})\\s*([0-9][0-9,]*)`));
  if (!match) return 0;

  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function classifyMoneyLogForPlayer(logEntry, playerName) {
  const text = String(logEntry?.text || "");
  if (!text) return null;

  const lower = text.toLowerCase();
  // Card draw description can contain fee text that is not the final settled amount.
  if (lower.includes("drew chance") || lower.includes("drew community chest"))
    return null;

  const amount = parseMoneyAmountFromText(text);
  if (!amount) return null;

  const safeName = escapeRegExp(playerName);
  const startsWithPlayer = new RegExp(`^${safeName}\\b`).test(text);

  const isRentPayer = new RegExp(
    `^${safeName}\\s+pays\\s+.*\\s+rent\\s+to\\s+`,
  ).test(text);
  if (isRentPayer) return { kind: "debit", amount };

  const isRentReceiver = new RegExp(
    `^.+\\s+pays\\s+.*\\s+rent\\s+to\\s+${safeName}\\b`,
  ).test(text);
  if (isRentReceiver) return { kind: "credit", amount };

  const isDebtPayer = new RegExp(
    `^${safeName}\\s+settled\\s+debt\\s+of\\s+`,
  ).test(text);
  if (isDebtPayer) return { kind: "debit", amount };

  const isDebtReceiver = new RegExp(
    `^.+\\s+settled\\s+debt\\s+of\\s+.*\\s+to\\s+${safeName}\\b`,
  ).test(text);
  if (isDebtReceiver) return { kind: "credit", amount };

  if (!startsWithPlayer) return null;

  if (lower.includes("wins auction")) return { kind: "debit", amount };
  if (
    /\b(pays|paid|bought|unmortgaged|built|tax|bail|must pay|interest)\b/.test(
      lower,
    )
  )
    return { kind: "debit", amount };
  if (
    /\b(collected|collect|sold|mortgaged|refund|dividend|raised|received)\b/.test(
      lower,
    )
  )
    return { kind: "credit", amount };
  return null;
}

function getPlayerActivityHistory(playerIdx) {
  const player = G.players[playerIdx];
  if (!player) return [];
  const allLogs = getFullLogEntries();
  if (!allLogs.length) return [];

  const safeName = escapeRegExp(player.name);
  const nameRegex = new RegExp(`\\b${safeName}\\b`);

  const rows = [];
  for (let i = 0; i < allLogs.length; i++) {
    const entry = allLogs[i] || {};
    const text = String(entry.text || "");
    if (!nameRegex.test(text)) continue;
    const parsedMoney = classifyMoneyLogForPlayer(entry, player.name);
    rows.push({
      kind: parsedMoney?.kind || "",
      amount: parsedMoney?.amount || 0,
      text,
      time: Number(entry.time) || 0,
      type: String(entry.type || ""),
    });
  }
  return rows.reverse();
}

function formatLogTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function setPortfolioTab(tab) {
  if (
    !Number.isInteger(PORTFOLIO_VIEW.playerIdx) ||
    PORTFOLIO_VIEW.playerIdx < 0
  )
    return;
  PORTFOLIO_VIEW.tab = tab === "log" ? "log" : "properties";
  showPlayerPortfolio(PORTFOLIO_VIEW.playerIdx, PORTFOLIO_VIEW.tab);
}

function showPlayerPortfolio(playerIdx, tab = "") {
  const p = G.players[playerIdx];
  if (!p) return;

  const previousPlayerIdx = PORTFOLIO_VIEW.playerIdx;
  PORTFOLIO_VIEW.playerIdx = playerIdx;
  if (tab) PORTFOLIO_VIEW.tab = tab === "log" ? "log" : "properties";
  else if (previousPlayerIdx !== playerIdx) PORTFOLIO_VIEW.tab = "properties";

  const activeTab = PORTFOLIO_VIEW.tab === "log" ? "log" : "properties";
  const modal = document.getElementById("portfolio-modal");
  const allProps = [...p.properties, ...p.railroads, ...p.utilities];

  // Group properties by color group
  const groups = {};
  allProps.forEach((id) => {
    const sp = SPACES[id];
    const prop = G.properties[id];
    const groupKey =
      sp.type === "property"
        ? `prop_${sp.group}`
        : sp.type === "railroad"
          ? "railroad"
          : "utility";
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push({ sp, prop, id });
  });

  const statusIcon = p.bankrupt
    ? "💀 BANKRUPT"
    : p.inJail
      ? "⛓️ In Jail"
      : `📍 ${SPACES[p.pos].name}`;

  const logHistory = getPlayerActivityHistory(playerIdx);
  const totalCredit = logHistory
    .filter((x) => x.kind === "credit")
    .reduce((sum, x) => sum + x.amount, 0);
  const totalDebit = logHistory
    .filter((x) => x.kind === "debit")
    .reduce((sum, x) => sum + x.amount, 0);

  let propsHtml = "";
  if (allProps.length === 0) {
    propsHtml = `<div style="color:rgba(255,255,255,.4);font-size:.9rem;text-align:center;padding:1.5rem 0">No properties owned yet</div>`;
  } else {
    Object.values(groups).forEach((items) => {
      items.forEach(({ sp, prop, id }) => {
        const c =
          sp.type === "property"
            ? COLOR[sp.color]
            : sp.type === "railroad"
              ? "#444"
              : "#557";
        const buildings = prop.hotel
          ? "🏨"
          : prop.houses > 0
            ? "🏠".repeat(prop.houses)
            : "";
        const mortgStr = prop.mortgaged
          ? ' <span style="color:#f59e0b;font-size:.72rem">[Mortgaged]</span>'
          : "";
        propsHtml += `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.35rem;border-left:3px solid ${c}">
            <div style="font-size:.9rem;flex:1;color:#fff;font-weight:600">${sp.name}${mortgStr}</div>
            ${buildings ? `<div style="font-size:.9rem">${buildings}</div>` : ""}
            <div style="font-size:.75rem;color:rgba(255,255,255,.45)">${fmtCurrency(sp.price || 0)}</div>
          </div>`;
      });
    });
  }

  const historyHtml = logHistory.length
    ? logHistory
        .map((item) => {
          const credit = item.kind === "credit";
          const debit = item.kind === "debit";
          const hasMoneyTag = credit || debit;
          const pillBg = credit
            ? "rgba(45,160,90,.28)"
            : debit
              ? "rgba(192,57,43,.28)"
              : "rgba(148,163,184,.26)";
          const pillColor = credit ? "#86efac" : debit ? "#fca5a5" : "#e2e8f0";
          const tagLabel = credit
            ? "CREDIT"
            : debit
              ? "DEBIT"
              : item.type
                ? item.type.toUpperCase()
                : "LOG";
          const sign = credit ? "+" : debit ? "-" : "";
          const amountHtml = hasMoneyTag
            ? `<span style="font-size:.86rem;font-weight:700;color:${pillColor}">${sign}${fmtCurrency(item.amount)}</span>`
            : "";
          return `
          <div style="padding:.6rem .7rem;border-radius:8px;margin-bottom:.42rem;border:1px solid rgba(201,151,28,.22);background:rgba(255,255,255,.08)">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
              <span style="font-size:.72rem;font-weight:700;padding:.1rem .42rem;border-radius:999px;background:${pillBg};color:${pillColor}">${tagLabel}</span>
              ${amountHtml}
              <span style="margin-left:auto;font-size:.72rem;color:rgba(255,255,255,.45)">${formatLogTime(item.time)}</span>
            </div>
            <div style="font-size:.8rem;color:rgba(255,255,255,.72);line-height:1.4">${escHtml(item.text)}</div>
          </div>
        `;
        })
        .join("")
    : `<div style="color:rgba(255,255,255,.45);font-size:.9rem;text-align:center;padding:1.5rem 0">No logs for this player yet</div>`;

  const propertiesTabBtnStyle =
    activeTab === "properties"
      ? "background:rgba(201,151,28,.25);border:1px solid rgba(201,151,28,.45);color:var(--gold-light);"
      : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);";
  const logTabBtnStyle =
    activeTab === "log"
      ? "background:rgba(37,99,235,.25);border:1px solid rgba(125,211,252,.45);color:#dbeafe;"
      : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);";

  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem">
      <div style="font-size:2rem;color:${p.color}">${p.token}</div>
      <div>
        <div style="font-family:var(--font-display);font-size:1.3rem;color:#fff;font-weight:700">${p.name}${p.bankrupt ? " 💀" : ""}</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.5);margin-top:.15rem">${statusIcon}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:1.2rem;font-weight:800;color:var(--gold-light)">${fmtCurrency(p.money)}</div>
        <div style="font-size:.72rem;color:rgba(255,255,255,.4)">${allProps.length} ${allProps.length === 1 ? "property" : "properties"}</div>
      </div>
    </div>
    ${p.jailFreeCards > 0 ? `<div style="background:rgba(201,151,28,.15);border:1px solid rgba(201,151,28,.3);border-radius:7px;padding:.5rem .8rem;margin-bottom:.75rem;color:var(--gold-light);font-size:.82rem">🎴 ${p.jailFreeCards}× Get Out of Jail Free card</div>` : ""}
    <div style="display:flex;gap:.45rem;margin-bottom:.75rem">
      <button style="flex:1;padding:.45rem .6rem;border-radius:8px;cursor:pointer;font-size:.82rem;font-weight:700;${propertiesTabBtnStyle}" onclick="setPortfolioTab('properties')">🏘 Properties</button>
      <button style="flex:1;padding:.45rem .6rem;border-radius:8px;cursor:pointer;font-size:.82rem;font-weight:700;${logTabBtnStyle}" onclick="setPortfolioTab('log')">📋 Game Log</button>
    </div>
    <div style="display:${activeTab === "properties" ? "" : "none"}">
      <div style="font-size:.8rem;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Properties</div>
      ${propsHtml}
    </div>
    <div style="display:${activeTab === "log" ? "" : "none"}">
      <div style="display:flex;gap:.6rem;margin-bottom:.6rem">
        <div style="flex:1;background:rgba(45,160,90,.15);border:1px solid rgba(45,160,90,.35);border-radius:8px;padding:.42rem .55rem">
          <div style="font-size:.68rem;letter-spacing:.05em;text-transform:uppercase;color:rgba(134,239,172,.8)">Total Credit</div>
          <div style="font-size:.95rem;font-weight:800;color:#86efac">+${fmtCurrency(totalCredit)}</div>
        </div>
        <div style="flex:1;background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.35);border-radius:8px;padding:.42rem .55rem">
          <div style="font-size:.68rem;letter-spacing:.05em;text-transform:uppercase;color:rgba(252,165,165,.8)">Total Debit</div>
          <div style="font-size:.95rem;font-weight:800;color:#fca5a5">-${fmtCurrency(totalDebit)}</div>
        </div>
      </div>
      <div style="font-size:.8rem;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Player History (Whole Match)</div>
      ${historyHtml}
    </div>
    <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('portfolio-overlay')">Close</button>
  `;
  openOverlay("portfolio-overlay");
}

function openHomePage() {
  showScreen("home-screen");
}

function openBugReport() {
  let opened = false;
  try {
    const win = window.open(BUG_REPORT_URL, "_blank", "noopener,noreferrer");
    opened = !!win;
    if (opened) {
      try {
        win.opener = null;
      } catch (_e) {}
    }
  } catch (_err) {
    opened = false;
  }
  if (!opened) {
    toast(
      "Could not open bug report in a new tab. Allow pop-ups and try again.",
      "danger",
    );
  }
}

function openWhatsNewPage() {
  if (openWhatsNewPage._busy) return;
  openWhatsNewPage._busy = true;
  const btn = document.getElementById("credits-logs-btn");
  if (btn) btn.disabled = true;
  document.body.classList.add("route-leaving");
  window.setTimeout(() => {
    window.location.href = "whats-new.html";
  }, 170);
}

function openTestLabPage() {
  if (openTestLabPage._busy) return;
  openTestLabPage._busy = true;
  document.body.classList.add("route-leaving");
  window.setTimeout(() => {
    window.location.href = "test-lab.html";
  }, 170);
}

function openBoardEditorPage() {
  if (openBoardEditorPage._busy) return;
  openBoardEditorPage._busy = true;
  document.body.classList.add("route-leaving");
  const seed = String(ACTIVE_CUSTOM_BOARD_SEED || "").trim();
  if (seed) {
    localStorage.setItem(CUSTOM_BOARD_EDITOR_STORAGE_KEY, seed);
  }
  window.setTimeout(() => {
    window.location.href = "boardeditor.html";
  }, 170);
}

function openOfflineSetupPage() {
  LOBBY_CONTEXT = "offline";
  renderLobby();
  updateOnlineLobbyUI();
  showScreen("lobby-screen");
}

function openOnlineSetupPage(mode = "host") {
  LOBBY_CONTEXT = "online";
  setOnlineMode(mode);
  updateOnlineLobbyUI();
  showScreen("online-screen");
}

function openOnlineRoomPage() {
  LOBBY_CONTEXT = "online";
  renderLobby();
  updateOnlineLobbyUI();
  showScreen("lobby-screen");
}

function handleLobbyBack() {
  if (isOnlineGame()) {
    leaveOnlineRoom(true, true).catch((err) => {
      console.error(err);
      toast("Could not leave room cleanly.", "danger");
    });
    return;
  }
  if (LOBBY_CONTEXT === "online") {
    openOnlineSetupPage(ONLINE.mode);
    return;
  }
  openHomePage();
}

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  syncBgmForScreen(id);
}

// ═══════════════════════════════════════════════
//  AUTO-ADVANCE TIMER
// ═══════════════════════════════════════════════
const TIMER = {
  duration: 30, // seconds; 0 = off
  remaining: 0,
  intervalId: null,
  paused: false,
};

function setTimerDuration(secs) {
  if (isOnlineGame() && !ONLINE.isHost) {
    toast("Only the host can change timer settings in online mode.", "danger");
    return;
  }

  const next = Math.max(0, Number(secs) || 0);
  TIMER.duration = next;
  const timerInput = document.getElementById("lobby-timer");
  if (timerInput) timerInput.value = String(next);
  stopTimer();
  if (
    G &&
    Array.isArray(G.players) &&
    G.phase === "end" &&
    canLocalControlTurn()
  ) {
    startTimer();
  }
  // Re-open settings with updated state
  openDrawer("settings");
  toast(next === 0 ? "⏱ Timer disabled" : `⏱ Timer set to ${next}s`, "gold");
  syncLobbySettingsToRoom().catch((err) => {
    console.error(err);
    toast("Failed to sync timer setting online.", "danger");
  });
}

function startTimer() {
  if (TIMER.duration === 0) return;
  stopTimer();
  TIMER.remaining = TIMER.duration;
  TIMER.paused = false;
  updateTimerUI();
  document.getElementById("timer-wrap").classList.remove("hidden");
  TIMER.intervalId = setInterval(() => {
    if (TIMER.paused) return;
    // Pause if any overlay is open
    const anyOpen = document.querySelector(".overlay.show");
    if (anyOpen) return;
    TIMER.remaining--;
    updateTimerUI();
    if (TIMER.remaining <= 0) {
      stopTimer();
      endTurn();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(TIMER.intervalId);
  TIMER.intervalId = null;
  document.getElementById("timer-wrap").classList.add("hidden");
}

function updateTimerUI() {
  const arc = document.getElementById("timer-arc");
  const num = document.getElementById("timer-num");
  if (!arc || !num) return;
  const frac = TIMER.remaining / TIMER.duration;
  const circumference = 94.25; // 2π×15
  arc.style.strokeDashoffset = circumference * (1 - frac);
  const danger = TIMER.remaining <= 5;
  arc.classList.toggle("danger", danger);
  num.classList.toggle("danger", danger);
  num.textContent = TIMER.remaining;
}

function updateViewportHeightVar() {
  const viewportHeight =
    window.visualViewport?.height ||
    window.innerHeight ||
    document.documentElement.clientHeight;
  if (!viewportHeight) return;
  document.documentElement.style.setProperty(
    "--vh",
    `${viewportHeight * 0.01}px`,
  );
}

function installOnlineMutationHooks() {
  ONLINE_MUTATION_FUNCS.forEach((name) => {
    const fn = window[name];
    if (typeof fn !== "function" || fn.__onlineWrapped) return;
    const wrapped = async function (...args) {
      const result = fn.apply(this, args);
      if (result && typeof result.then === "function") {
        await result;
      }
      if (isOnlineGame() && !ONLINE.isApplyingRemote) {
        if (
          name === "rollDice" &&
          (Number(ONLINE.pendingCardResolutions) || 0) > 0
        ) {
          return result;
        }
        await syncRoomState(name);
      }
      return result;
    };
    wrapped.__onlineWrapped = true;
    window[name] = wrapped;
  });
}

function installLobbyEvents() {
  const nameInput = document.getElementById("online-player-name");
  const codeInput = document.getElementById("join-room-code");
  const passInput = document.getElementById("join-room-password");
  const visSelect = document.getElementById("room-visibility");
  const startMoney = document.getElementById("starting-money");
  const timerSelect = document.getElementById("lobby-timer");
  const auctionSelect = document.getElementById("auction-enabled");
  const customSeedInput = document.getElementById("custom-board-seed");

  const rememberedName = localStorage.getItem("monopoly_online_name");
  if (nameInput && rememberedName) nameInput.value = rememberedName;

  if (nameInput) {
    nameInput.addEventListener("change", () => {
      const val = sanitizeName(nameInput.value, "Player");
      nameInput.value = val;
      localStorage.setItem("monopoly_online_name", val);
    });
  }

  if (codeInput) {
    codeInput.addEventListener("input", () => {
      codeInput.value = sanitizeRoomId(codeInput.value);
    });
  }

  if (passInput) {
    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinOnlineRoom();
    });
  }

  if (visSelect) {
    visSelect.addEventListener("change", () => {
      const pass = document.getElementById("host-room-password");
      if (!pass) return;
      const closed = visSelect.value === "closed";
      pass.disabled = !closed;
      pass.placeholder = closed ? "Set password" : "Not needed for open room";
    });
    visSelect.dispatchEvent(new Event("change"));
  }

  if (startMoney) {
    startMoney.addEventListener("change", () => {
      syncLobbySettingsToRoom();
    });
  }

  if (timerSelect) {
    timerSelect.addEventListener("change", () => {
      syncLobbySettingsToRoom();
    });
  }

  if (auctionSelect) {
    auctionSelect.addEventListener("change", () => {
      syncLobbySettingsToRoom();
    });
  }

  if (customSeedInput) {
    const onSeedInputUpdated = () => {
      const normalized = normalizeCustomBoardSeedText(customSeedInput.value);
      if (!normalized) {
        setCustomBoardStatus(
          "No custom board loaded. Paste a seed or use saved seed.",
        );
        return;
      }
      if (normalized === ACTIVE_CUSTOM_BOARD_SEED) {
        setCustomBoardStatus(
          'Seed matches the loaded custom board. Select "Custom" in board themes to play it.',
        );
        return;
      }
      setCustomBoardStatus(
        `Seed ready (${normalized.length} chars). Click "Load Seed" to apply it.`,
      );
    };
    customSeedInput.addEventListener("paste", () => {
      requestAnimationFrame(() => {
        const normalized = normalizeCustomBoardSeedText(customSeedInput.value);
        if (normalized && normalized !== customSeedInput.value) {
          customSeedInput.value = normalized;
        }
        onSeedInputUpdated();
      });
    });
    customSeedInput.addEventListener("input", onSeedInputUpdated);
    customSeedInput.addEventListener("change", onSeedInputUpdated);
  }

  setInterval(() => {
    if (!ONLINE.ready) return;
    if (isOnlineGame()) {
      pulseRoomHeartbeat();
      return;
    }
    if (ONLINE.mode === "join") {
      refreshOpenRoomsList();
      return;
    }
    cleanupAbandonedRooms(null, false).catch((err) => {
      console.error("Background room cleanup failed.", err);
    });
  }, 8000);

  setInterval(() => {
    const gameScreen = document.getElementById("game-screen");
    if (!gameScreen || gameScreen.classList.contains("hidden")) return;
    if (!G || G.gameOver) return;
    maybeScheduleOfflineAiTurn();
  }, 1400);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

