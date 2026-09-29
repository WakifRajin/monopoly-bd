// ═══════════════════════════════════════════════
//  SHOW PROPERTY INFO
// ═══════════════════════════════════════════════
// Dark or light text, whichever reads better on `hex`. White on the light
// property colours (light blue, yellow, pink) measured as low as 1.7:1.
function readableTextOn(hex) {
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  // Pick whichever of white / near-black (#111, L≈0.0056) contrasts more.
  const onWhite = 1.05 / (L + 0.05);
  const onDark = (L + 0.05) / 0.0556;
  return onWhite >= onDark ? "#fff" : "#111";
}

// Player colours are chosen to be recognisable, not to be readable on dark
// green; red and blue names measured 3.2–3.8:1. Lift them toward white so the
// hue survives but the text clears AA.
function playerTextColor(color) {
  const c = sanitizeColor(color, "#ffffff");
  return `color-mix(in srgb, ${c} 58%, #ffffff)`;
}

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
      <div class="prop-color-header" style="background:linear-gradient(135deg,${c},${c}cc);color:${readableTextOn(c)};${readableTextOn(c) === "#111" ? "text-shadow:none" : ""}">${escHtml(sp.name)}</div>
      ${owner ? `<div style="color:rgba(255,255,255,.78);font-size:var(--fs-sm);margin-bottom:.75rem">Owned by <span style="color:${playerTextColor(owner.color)};font-weight:700">${escHtml(owner.token)} ${escHtml(owner.name)}</span>${prop.mortgaged ? " (Mortgaged)" : ""}</div>` : '<div style="color:rgba(255,255,255,.75);font-size:var(--fs-sm);margin-bottom:.75rem">For sale — ' + fmtCurrency(sp.price) + "</div>"}
      <table class="prop-table">
        <tr><td>Purchase price</td><td>${fmtCurrency(sp.price)}</td></tr>
        <tr><td>Rent</td><td>${fmtCurrency(sp.rent[0])}</td></tr>
        <tr><td>Rent w/ Monopoly</td><td>${fmtCurrency(sp.rent[0] * 2)}</td></tr>
        <tr><td>Rent 1 House</td><td>${fmtCurrency(sp.rent[1])}</td></tr>
        <tr><td>Rent 2 Houses</td><td>${fmtCurrency(sp.rent[2])}</td></tr>
        <tr><td>Rent 3 Houses</td><td>${fmtCurrency(sp.rent[3])}</td></tr>
        <tr><td>Rent 4 Houses</td><td>${fmtCurrency(sp.rent[4])}</td></tr>
        <tr><td>Rent with hotel</td><td>${fmtCurrency(sp.rent[5])}</td></tr>
        <tr><td>House cost</td><td>${fmtCurrency(sp.house)}</td></tr>
        <tr><td>Mortgage value</td><td>${fmtCurrency(mortgageValueForSpace(sp))}</td></tr>
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
      <div class="prop-color-header" style="background:linear-gradient(135deg,#333,#555)">🚂 ${escHtml(sp.name)}</div>
      ${owner ? `<div style="color:rgba(255,255,255,.78);font-size:var(--fs-sm);margin-bottom:.75rem">Owned by <span style="color:${playerTextColor(owner.color)};font-weight:700">${escHtml(owner.token)} ${escHtml(owner.name)}</span></div>` : '<div style="color:rgba(255,255,255,.75);font-size:var(--fs-sm);margin-bottom:.75rem">For sale — ' + fmtCurrency(sp.price) + "</div>"}
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
      <div style="font-size:2.5rem;text-align:center;margin-bottom:.75rem">${escHtml(sp.icon || "📋")}</div>
      <h2 style="color:#fff;text-align:center;margin-bottom:.5rem">${escHtml(sp.name)}</h2>
      <p style="color:rgba(255,255,255,.6);text-align:center">${escHtml(sp.desc || "")}</p>
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
  document.getElementById("winner-name").textContent = p.name + " wins";
  document.getElementById("winner-sub").textContent =
    `${p.name} finished with ${fmtCurrency(p.money)} on the ${(window.ACTIVE_THEME || BOARD_THEMES.dhaka).name} board.`;
  renderWinnerLeaderboard(p.id);
  // Confetti
  const cont = document.getElementById("confetti-container");
  cont.innerHTML = "";
  const emojis = ["✦", "✧", "◆"];
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
  if (active.length > 1) return false;

  const winnerScreen = document.getElementById("winner-screen");
  if (winnerScreen && !winnerScreen.classList.contains("hidden")) return true;

  if (active.length === 1) {
    showWinner(active[0]);
    return true;
  }

  // Everyone is bankrupt — a cascade can take the last two out together.
  // Award it to whoever survived longest rather than leaving the match hung.
  const lastStanding = G.players.reduce((best, player) => {
    const order = Number(player.bankruptOrder);
    if (!Number.isInteger(order) || order <= 0) return best;
    const bestOrder = Number(best?.bankruptOrder) || 0;
    return order > bestOrder ? player : best;
  }, null);
  const winner = lastStanding || G.players[0];
  if (!winner) return false;
  addLog(
    `All players are bankrupt. ${winner.name} survived longest and takes the match.`,
    "important",
  );
  showWinner(winner);
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

// Turn markers used to be plain text ("─── Name's turn ───", type important);
// entries from older clients and saved games still arrive that way.
const LEGACY_TURN_RE = /^[─—-]{3,}\s*(.+?)'s turn\s*[─—-]{3,}$/;

function logTurnName(entry) {
  const text = String(entry?.text || "");
  if (entry?.type === "turn") return text.replace(/'s turn$/, "");
  const m = text.match(LEGACY_TURN_RE);
  return m ? m[1] : null;
}

// Escapes the text, then tints player names and highlights money amounts.
// Works on the escaped string so nothing a player typed becomes markup.
function decorateLogText(text, type) {
  let html = escHtml(text || "");
  const players = (G.players || [])
    .filter((p) => p && p.name)
    .sort((a, b) => b.name.length - a.name.length);
  if (players.length) {
    const byName = new Map(players.map((p) => [escHtml(p.name), p]));
    const re = new RegExp(
      [...byName.keys()].map(escapeRegExp).join("|"),
      "g",
    );
    html = html.replace(re, (name) => {
      const p = byName.get(name);
      return `<span class="log-name" style="color:${playerTextColor(p.color)}">${name}</span>`;
    });
  }
  const symbols = Array.from(
    new Set(
      Object.values(BOARD_THEMES || {})
        .map((t) => escHtml(String(t?.currency || "").trim()))
        .filter(Boolean),
    ),
  );
  if (symbols.length) {
    const moneyRe = new RegExp(
      // Digits may contain separators but must end on a digit, so a
      // sentence's closing full stop stays outside the highlight.
      `-?(?:${symbols.map(escapeRegExp).join("|")})\\s?\\d(?:[\\d,.]*\\d)?`,
      "g",
    );
    const tone =
      type === "danger" ? " is-loss" : type === "success" ? " is-gain" : "";
    html = html.replace(moneyRe, (m) => `<span class="log-amt${tone}">${m}</span>`);
  }
  return html;
}

// One shared renderer for the desktop panel and the mobile drawer. Entries are
// grouped under the turn they happened in; the time appears once per turn.
function renderLogFeedHtml(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let html = "";
  let open = false;
  const openGroup = (head, cls = "", color = "") => {
    if (open) html += "</div>";
    html += `<div class="log-turn${cls}"${color ? ` style="--turn-color:${color}"` : ""}>${head}`;
    open = true;
  };
  for (const entry of list) {
    if (!entry) continue;
    const time = formatLogTime(entry.time);
    const turnName = logTurnName(entry);
    if (turnName !== null) {
      const p = (G.players || []).find((x) => x && x.name === turnName);
      const color = p ? sanitizeColor(p.color, "#ffffff") : "#ffffff";
      openGroup(
        `<div class="log-turn-head"><span class="log-turn-dot"></span>` +
          `<span class="log-turn-title"><span style="color:${playerTextColor(color)}">${escHtml(turnName)}</span>'s turn</span>` +
          `<time class="log-time">${time}</time></div>`,
        "",
        color,
      );
      continue;
    }
    if (!open) {
      openGroup(
        `<div class="log-turn-head"><span class="log-turn-dot"></span>` +
          `<span class="log-turn-title">Match</span><time class="log-time">${time}</time></div>`,
        " is-system",
      );
    }
    const type = String(entry.type || "");
    const cls = ["important", "danger", "success"].includes(type)
      ? ` log-${type}`
      : "";
    html += `<div class="log-entry${cls}">${decorateLogText(entry.text, type)}</div>`;
  }
  if (open) html += "</div>";
  return html || '<div class="log-empty">Nothing has happened yet.</div>';
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
  const text = inp.value.trim().slice(0, 300);
  if (!text) return;
  inp.value = "";
  if (!G.chat) G.chat = [];
  const p = isOnlineGame()
    ? (G.players || []).find((x) => x.uid === ONLINE.localUid)
    : curPlayer();
  if (!p) return;

  const message = {
    uid: p.uid || null,
    name: p.name,
    token: p.token,
    color: p.color,
    text,
    time: Date.now(),
  };

  if (isOnlineGame() && FIREBASE.api?.push) {
    // Append-only: two people typing at the same moment each get their own key,
    // so neither message can overwrite the other.
    FIREBASE.api
      .push(FIREBASE.api.ref(FIREBASE.db, `rooms/${ONLINE.roomId}/chat`), message)
      .catch((err) => {
        console.error(err);
        toast("Message could not be sent.", "danger");
      });
    return;
  }

  G.chat.push(message);
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
  CURRENT_DRAWER = type;
  const content = document.getElementById("drawer-content");
  if (type === "players") {
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-heading)">Players</h3>
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
          <div style="font-size:var(--fs-lg);color:${color}">${escHtml(p.token)}</div>
          <div style="min-width:0;flex:1">
            <div style="color:#fff;font-weight:700;font-size:var(--fs-sm);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}${p.bankrupt ? " (out)" : ""}</div>
            <div style="color:rgba(255,255,255,.5);font-size:var(--fs-xs);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(where)}</div>
          </div>
          <div style="font-size:var(--fs-sm);color:var(--gold-light);font-weight:700">${fmtCurrency(p.money)}</div>
        </div>`;
        })
        .join("")}
      <p style="color:rgba(255,255,255,.45);font-size:var(--fs-xs);margin-top:.35rem">Tap a player card to view full portfolio and assets.</p>
    `;
  } else if (type === "log") {
    content.innerHTML =
      '<h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-heading)">Game log</h3>' +
      `<div id="drawer-log-feed" class="log-feed drawer-log-feed">${renderLogFeedHtml(G.log || [])}</div>`;
    const feed = document.getElementById("drawer-log-feed");
    if (feed) requestAnimationFrame(() => (feed.scrollTop = feed.scrollHeight));
  } else if (type === "chat") {
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-heading)">Chat</h3>
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
    // Opened from the home screen there is no match to quit.
    const inMatch = !document
      .getElementById("game-screen")
      ?.classList.contains("hidden");
    // On phones the top bar keeps only Log, Chat and Settings; everything it
    // drops has to live here instead, or it becomes unreachable.
    const leaveBlock = `<hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:1rem 0">
         <div style="display:grid;gap:.5rem">
           <button onclick="closeDrawer();openBugReport()" style="width:100%;padding:.65rem .9rem;border:1px solid rgba(255,255,255,.18);border-radius:8px;background:rgba(255,255,255,.07);color:#fff;font-weight:600;cursor:pointer;font-family:var(--font-body)">Report a bug</button>
           ${
             !inMatch
               ? ""
               : canLeave
               ? `<button onclick="closeDrawer();openLeaveGameModal()" style="width:100%;padding:.65rem .9rem;border:none;border-radius:8px;background:linear-gradient(135deg,#7f1d1d,#c0392b);color:#fff;font-weight:700;cursor:pointer;font-family:var(--font-body)">Leave online match</button>`
               : `<button onclick="closeDrawer();requestExitMatch()" style="width:100%;padding:.65rem .9rem;border:1px solid rgba(192,57,43,.5);border-radius:8px;background:rgba(192,57,43,.18);color:#ffb3ae;font-weight:600;cursor:pointer;font-family:var(--font-body)">Quit to menu</button>`
           }
         </div>`;
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:1rem;font-family:var(--font-heading)">Timer and sound</h3>
      <div style="margin-bottom:1rem;padding:.75rem;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.05)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.65rem">
          <div>
            <div style="color:#fff;font-size:var(--fs-sm);font-weight:700">Sound effects</div>
            <div style="color:rgba(255,255,255,.52);font-size:var(--fs-xs)">Dice, rent, jail, auction, and win sounds</div>
          </div>
          <button onclick="toggleSfxEnabled()" style="padding:.42rem .75rem;border:1px solid ${sfxEnabled ? "rgba(45,160,90,.5)" : "rgba(255,255,255,.25)"};background:${sfxEnabled ? "rgba(45,160,90,.22)" : "rgba(255,255,255,.07)"};color:${sfxEnabled ? "#86efac" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:var(--fs-xs);font-weight:700">${sfxEnabled ? "On" : "Off"}</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.65rem">
          <div>
            <div style="color:#fff;font-size:var(--fs-sm);font-weight:700">Background music</div>
            <div style="color:rgba(255,255,255,.52);font-size:var(--fs-xs)">Plays during active match</div>
          </div>
          <button onclick="toggleBgmEnabled()" style="padding:.42rem .75rem;border:1px solid ${bgmEnabled ? "rgba(240,192,64,.5)" : "rgba(255,255,255,.25)"};background:${bgmEnabled ? "rgba(240,192,64,.18)" : "rgba(255,255,255,.07)"};color:${bgmEnabled ? "var(--gold-light)" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:var(--fs-xs);font-weight:700">${bgmEnabled ? "On" : "Off"}</button>
        </div>
        <label style="color:rgba(255,255,255,.72);font-size:var(--fs-sm);display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">
          <span>Volume</span>
          <span id="sfx-volume-label">${sfxVolumePct}%</span>
        </label>
        <input type="range" min="0" max="100" value="${sfxVolumePct}" oninput="document.getElementById('sfx-volume-label').textContent=this.value+'%';setSfxVolume(Number(this.value)/100,false)" onchange="setSfxVolume(Number(this.value)/100,true)" style="width:100%;accent-color:var(--gold-light)">
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:1rem;padding:.75rem;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.05)">
        <div>
          <div style="color:#fff;font-size:var(--fs-sm);font-weight:700">3D view</div>
          <div style="color:rgba(255,255,255,.52);font-size:var(--fs-xs)">Tilt the table; off shows it from above (V)</div>
        </div>
        <button onclick="toggleBoard3d()" style="padding:.42rem .75rem;border:1px solid ${BOARD_VIEW.is3d ? "rgba(240,192,64,.5)" : "rgba(255,255,255,.25)"};background:${BOARD_VIEW.is3d ? "rgba(240,192,64,.18)" : "rgba(255,255,255,.07)"};color:${BOARD_VIEW.is3d ? "var(--gold-light)" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:var(--fs-xs);font-weight:700">${BOARD_VIEW.is3d ? "On" : "Off"}</button>
      </div>
      <p style="color:rgba(255,255,255,.6);font-size:var(--fs-sm);margin-bottom:1rem">
        After a player finishes their move, a countdown begins. When it hits zero, the turn automatically advances — even if they haven't clicked End Turn.
      </p>
      <div style="margin-bottom:1rem">
        <label style="color:rgba(255,255,255,.7);font-size:var(--fs-sm);display:block;margin-bottom:.4rem">Auto-advance delay</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${[0, 10, 20, 30, 45, 60].map((v) => `<button onclick="setTimerDuration(${v})" style="padding:.5rem .9rem;border:1px solid ${dur === v ? "var(--gold-light)" : "rgba(255,255,255,.2)"};background:${dur === v ? "rgba(201,151,28,.25)" : "rgba(255,255,255,.07)"};color:${dur === v ? "var(--gold-light)" : "rgba(255,255,255,.7)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:var(--fs-sm);font-weight:600">${v === 0 ? "Off" : v + "s"}</button>`).join("")}
        </div>
      </div>
      <p style="color:rgba(255,255,255,.4);font-size:var(--fs-xs)">Timer only runs during the "end turn" phase (after rolling & landing). It pauses while modals are open.</p>
      <div style="margin:1rem 0">
        <label style="color:rgba(255,255,255,.7);font-size:var(--fs-sm);display:block;margin-bottom:.4rem">Movement speed</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${[["Fast", 0.4], ["Normal", 1], ["Slow", 1.8]]
            .map(([label, v]) => {
              const on = Math.abs((MOVE_SPEED.factor || 1) - v) < 0.05;
              return `<button onclick="setMoveSpeed(${v})" style="padding:.5rem .9rem;border:1px solid ${on ? "var(--gold-light)" : "rgba(255,255,255,.2)"};background:${on ? "rgba(201,151,28,.25)" : "rgba(255,255,255,.07)"};color:${on ? "var(--gold-light)" : "rgba(255,255,255,.7)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:var(--fs-sm);font-weight:600">${label}</button>`;
            })
            .join("")}
        </div>
      </div>
      <div style="margin-bottom:1rem;padding:.7rem .8rem;border:1px solid rgba(255,255,255,.12);border-radius:10px;background:rgba(255,255,255,.04)">
        <div style="color:#fff;font-size:var(--fs-sm);font-weight:700;margin-bottom:.4rem">Keyboard</div>
        <div style="color:rgba(255,255,255,.55);font-size:var(--fs-xs);line-height:1.7">
          <b style="color:rgba(255,255,255,.8)">Space</b> roll, or end turn ·
          <b style="color:rgba(255,255,255,.8)">Enter</b> confirm dialog ·
          <b style="color:rgba(255,255,255,.8)">Esc</b> close ·
          <b style="color:rgba(255,255,255,.8)">B</b> buy ·
          <b style="color:rgba(255,255,255,.8)">H</b> build ·
          <b style="color:rgba(255,255,255,.8)">M</b> mortgage ·
          <b style="color:rgba(255,255,255,.8)">T</b> trade
        </div>
      </div>
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
  CURRENT_DRAWER = "";
  document.getElementById("mobile-drawer").classList.remove("open");
}

// ═══════════════════════════════════════════════
//  OVERLAYS
// ═══════════════════════════════════════════════
// Dialogs kept their scroll position between openings, so a reopened portfolio
// could start halfway down. Reset only on a genuine closed-to-open transition:
// several dialogs re-open themselves while already showing (build refreshes
// after each house, the auction on each bid), and those must keep your place.
function resetModalScroll(overlay) {
  const m = overlay?.querySelector(".modal");
  if (!m) return;
  m.scrollTop = 0;
  m.classList.remove("is-scrolled");
}

function openOverlay(id) {
  const el = document.getElementById(id);
  const wasOpen = el.classList.contains("show");
  el.classList.add("show");
  if (!wasOpen) resetModalScroll(el);
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
    toast(SFX.enabled ? "Sound on" : "Sound muted", "gold");
}

function toggleSfxEnabled() {
  setSfxEnabled(!SFX.enabled, true);
  refreshSettingsViews();
}

function setBgmEnabled(enabled, notify = true) {
  SFX.bgmEnabled = !!enabled;
  persistSfxPreferences();
  syncBgmForScreen();
  if (notify)
    toast(SFX.bgmEnabled ? "Music on" : "Music muted", "gold");
}

function toggleBgmEnabled() {
  setBgmEnabled(!SFX.bgmEnabled, true);
  refreshSettingsViews();
}

function setSfxVolume(volume, notify = false) {
  SFX.volume = clampSfxVolume(volume);
  persistSfxPreferences();
  ensureSfxEngine();
  updateSfxMasterGain();
  if (notify) toast(`Volume ${Math.round(SFX.volume * 100)}%`, "gold");
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
// Treat a missing pendingBuy the same as an explicit null: Firebase does not
// round-trip nulls, so both spellings reach us for "nothing to buy".
function hasPendingBuy(state = G) {
  const raw = state?.pendingBuy;
  // Number(null) is 0, so null must be rejected before any numeric coercion.
  if (raw === null || raw === undefined || raw === "") return false;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 && id < SPACES.length;
}

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
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("en-BD");
}
// Renders the sign: a player in debt must read as -৳500, not ৳500.
function fmtCurrency(n) {
  const t = window.ACTIVE_THEME || BOARD_THEMES.dhaka;
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  const sign = safe < 0 ? "-" : "";
  return `${sign}${t.currency}${Math.abs(safe).toLocaleString(t.locale)}`;
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}
// Attribute values need exactly the same escaping as text nodes now that
// escHtml covers quotes; kept as a separate name for call-site clarity.
function escAttr(t) {
  return escHtml(t);
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

  if (/\b(won|wins) the auction\b/.test(lower)) return { kind: "debit", amount };
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
    // Turn markers say nothing about the player's activity on their own.
    if (logTurnName(entry) !== null) continue;
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
  // A different tab is different content; start it at the top.
  resetModalScroll(document.getElementById("portfolio-overlay"));
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
    ? "Bankrupt"
    : p.inJail
      ? "In jail"
      : SPACES[p.pos].name;

  const logHistory = getPlayerActivityHistory(playerIdx);
  const totalCredit = logHistory
    .filter((x) => x.kind === "credit")
    .reduce((sum, x) => sum + x.amount, 0);
  const totalDebit = logHistory
    .filter((x) => x.kind === "debit")
    .reduce((sum, x) => sum + x.amount, 0);

  let propsHtml = "";
  if (allProps.length === 0) {
    propsHtml = `<div style="color:rgba(255,255,255,.7);font-size:var(--fs-md);text-align:center;padding:1.5rem 0">No properties owned yet</div>`;
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
          ? ' <span style="color:#f59e0b;font-size:var(--fs-2xs)">[Mortgaged]</span>'
          : "";
        propsHtml += `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.35rem;border-left:3px solid ${c}">
            <div style="font-size:var(--fs-md);flex:1;color:#fff;font-weight:600">${escHtml(sp.name)}${mortgStr}</div>
            ${buildings ? `<div style="font-size:var(--fs-md)">${buildings}</div>` : ""}
            <div style="font-size:var(--fs-xs);color:rgba(255,255,255,.7)">${fmtCurrency(sp.price || 0)}</div>
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
          // Only money movements get a label; the log's internal entry types
          // ("important", "danger") are styling hints, not words for players.
          const tagLabel = credit ? "Received" : debit ? "Paid" : "";
          const sign = credit ? "+" : debit ? "-" : "";
          const amountHtml = hasMoneyTag
            ? `<span style="font-size:var(--fs-sm);font-weight:700;color:${pillColor}">${sign}${fmtCurrency(item.amount)}</span>`
            : "";
          return `
          <div style="padding:.6rem .7rem;border-radius:8px;margin-bottom:.42rem;border:1px solid rgba(201,151,28,.22);background:rgba(255,255,255,.08)">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
              ${tagLabel ? `<span style="font-size:var(--fs-2xs);font-weight:700;padding:.1rem .42rem;border-radius:999px;background:${pillBg};color:${pillColor}">${tagLabel}</span>` : ""}
              ${amountHtml}
              <span style="margin-left:auto;font-size:var(--fs-2xs);color:rgba(255,255,255,.7)">${formatLogTime(item.time)}</span>
            </div>
            <div style="font-size:var(--fs-xs);color:rgba(255,255,255,.72);line-height:1.4">${escHtml(item.text)}</div>
          </div>
        `;
        })
        .join("")
    : `<div style="color:rgba(255,255,255,.7);font-size:var(--fs-md);text-align:center;padding:1.5rem 0">Nothing has happened for this player yet</div>`;

  const propertiesTabBtnStyle =
    activeTab === "properties"
      ? "background:rgba(201,151,28,.25);border:1px solid rgba(201,151,28,.45);color:var(--gold-light);"
      : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);";
  const logTabBtnStyle =
    activeTab === "log"
      ? "background:rgba(37,99,235,.25);border:1px solid rgba(125,211,252,.45);color:#dbeafe;"
      : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);";

  modal.innerHTML = `
    <div class="portfolio-head" style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem">
      <div style="font-size:var(--fs-3xl);color:${sanitizeColor(p.color)}">${escHtml(p.token)}</div>
      <div>
        <div style="font-family:var(--font-heading);font-size:var(--fs-xl);color:#fff;font-weight:700">${escHtml(p.name)}${p.bankrupt ? " (out)" : ""}</div>
        <div style="font-size:var(--fs-xs);color:rgba(255,255,255,.7);margin-top:.15rem">${statusIcon}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:var(--fs-lg);font-weight:800;color:var(--gold-light)">${fmtCurrency(p.money)}</div>
        <div style="font-size:var(--fs-2xs);color:rgba(255,255,255,.7)">${allProps.length} ${allProps.length === 1 ? "property" : "properties"}</div>
      </div>
    </div>
    ${p.jailFreeCards > 0 ? `<div style="background:rgba(201,151,28,.15);border:1px solid rgba(201,151,28,.3);border-radius:7px;padding:.5rem .8rem;margin-bottom:.75rem;color:var(--gold-light);font-size:var(--fs-sm)">🎴 ${p.jailFreeCards}× Get Out of Jail Free card</div>` : ""}
    <div style="display:flex;gap:.45rem;margin-bottom:.75rem">
      <button style="flex:1;padding:.45rem .6rem;border-radius:8px;cursor:pointer;font-size:var(--fs-sm);font-weight:700;${propertiesTabBtnStyle}" onclick="setPortfolioTab('properties')">Properties</button>
      <button style="flex:1;padding:.45rem .6rem;border-radius:8px;cursor:pointer;font-size:var(--fs-sm);font-weight:700;${logTabBtnStyle}" onclick="setPortfolioTab('log')">History</button>
    </div>
    <div style="display:${activeTab === "properties" ? "" : "none"}">
      <div style="font-size:var(--fs-xs);font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Properties</div>
      ${propsHtml}
    </div>
    <div style="display:${activeTab === "log" ? "" : "none"}">
      <div style="display:flex;gap:.6rem;margin-bottom:.6rem">
        <div style="flex:1;background:rgba(45,160,90,.15);border:1px solid rgba(45,160,90,.35);border-radius:8px;padding:.42rem .55rem">
          <div style="font-size:var(--fs-2xs);letter-spacing:.05em;text-transform:uppercase;color:#86efac">Total credit</div>
          <div style="font-size:var(--fs-md);font-weight:800;color:#86efac">+${fmtCurrency(totalCredit)}</div>
        </div>
        <div style="flex:1;background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.35);border-radius:8px;padding:.42rem .55rem">
          <div style="font-size:var(--fs-2xs);letter-spacing:.05em;text-transform:uppercase;color:#fca5a5">Total debit</div>
          <div style="font-size:var(--fs-md);font-weight:800;color:#fca5a5">-${fmtCurrency(totalDebit)}</div>
        </div>
      </div>
      <div style="font-size:var(--fs-xs);font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Whole match</div>
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
  if (id === "home-screen") refreshHomeScreen();
  if (id === "online-screen" || id === "lan-screen") renderOnlineServiceNotice();
  if (id === "game-screen") ensureBoardScene();
  syncAppNav(id);
  if (id === "game-screen") armExitGuard();
  else disarmExitGuard();
}

// ═══════════════════════════════════════════════
//  EXIT GUARD
// ═══════════════════════════════════════════════
// On a phone the back button — and worse, the edge-swipe gesture, which is easy
// to trigger by accident while tapping near the screen edge — navigates away and
// takes the match with it. A history entry is pushed when the board opens; the
// gesture pops that entry instead of leaving, and we immediately push it back
// and ask what the player actually wanted.
const EXIT_GUARD = { armed: false, prompting: false };

function matchInProgress() {
  return !!(
    G &&
    Array.isArray(G.players) &&
    G.players.length &&
    !G.gameOver &&
    !document.getElementById("game-screen")?.classList.contains("hidden")
  );
}

function onExitGuardPop() {
  if (!EXIT_GUARD.armed) return;
  if (!matchInProgress()) {
    disarmExitGuard();
    openHomePage();
    return;
  }
  // Put the guard entry back so the browser stays on the board, then ask.
  history.pushState({ mbdExitGuard: true }, "");
  if (EXIT_GUARD.prompting) return;
  EXIT_GUARD.prompting = true;
  closeDrawer();
  openOverlay("exit-guard-overlay");
}

function onExitGuardBeforeUnload(e) {
  if (!matchInProgress()) return;
  e.preventDefault();
  e.returnValue = "";
  return "";
}

function armExitGuard() {
  if (EXIT_GUARD.armed) return;
  EXIT_GUARD.armed = true;
  try {
    history.pushState({ mbdExitGuard: true }, "");
  } catch (err) {
    /* history can be unavailable in some embedded contexts */
  }
  window.addEventListener("popstate", onExitGuardPop);
  window.addEventListener("beforeunload", onExitGuardBeforeUnload);
}

function disarmExitGuard() {
  if (!EXIT_GUARD.armed) return;
  EXIT_GUARD.armed = false;
  EXIT_GUARD.prompting = false;
  window.removeEventListener("popstate", onExitGuardPop);
  window.removeEventListener("beforeunload", onExitGuardBeforeUnload);
  closeOverlay("exit-guard-overlay");
}

// Explicit "quit" from a menu: same confirmation as the back gesture.
function requestExitMatch() {
  if (!matchInProgress()) {
    openHomePage();
    return;
  }
  EXIT_GUARD.prompting = true;
  openOverlay("exit-guard-overlay");
}

// "Keep playing" is the default action, and the only one a stray swipe can reach.
function dismissExitGuard() {
  EXIT_GUARD.prompting = false;
  closeOverlay("exit-guard-overlay");
}

function confirmExitMatch() {
  EXIT_GUARD.prompting = false;
  closeOverlay("exit-guard-overlay");
  if (isOnlineGame() && ONLINE.status === "playing") {
    // Online has its own choice of how to hand over the seat.
    openLeaveGameModal();
    return;
  }
  disarmExitGuard();
  stopTimer();
  clearOfflineAiTimer(true);
  openHomePage();
}

// ═══════════════════════════════════════════════
//  AUTO-ADVANCE TIMER
// ═══════════════════════════════════════════════
const TIMER = {
  duration: 30, // seconds; 0 = off
  remaining: 0,
  intervalId: null,
  paused: false,
  turnKey: "",
};

// Identifies one player's turn. The timer restarts when this changes and not
// before, so a render, a chat message or a remote snapshot cannot keep pushing
// the deadline back.
function currentTurnKey() {
  if (!G || !Array.isArray(G.players)) return "";
  return `${G.gameStartedAt || 0}:${G.currentPlayerIdx}:${G.players[G.currentPlayerIdx]?.bankruptOrder || 0}`;
}

// Only modal decisions should hold the clock. An informational overlay left
// open used to pause it indefinitely.
const TIMER_BLOCKING_OVERLAYS = [
  "buy-overlay",
  "auction-overlay",
  "trade-overlay",
  "trade-review-overlay",
  "bankrupt-overlay",
  "card-overlay",
  "mortgage-overlay",
  "build-overlay",
];

function timerIsBlocked() {
  return TIMER_BLOCKING_OVERLAYS.some((id) =>
    document.getElementById(id)?.classList.contains("show"),
  );
}

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
    startTimer(true);
  }
  // Re-open settings with updated state
  openDrawer("settings");
  toast(next === 0 ? "Turn timer off" : `Turn timer set to ${next}s`, "gold");
  syncLobbySettingsToRoom().catch((err) => {
    console.error(err);
    toast("Failed to sync timer setting online.", "danger");
  });
}

function startTimer(force = false) {
  if (TIMER.duration === 0) return;
  const key = currentTurnKey();
  // Already counting down for this same turn - leave it running.
  if (!force && TIMER.intervalId && TIMER.turnKey === key) return;
  stopTimer();
  TIMER.turnKey = key;
  TIMER.remaining = TIMER.duration;
  TIMER.paused = false;
  updateTimerUI();
  document.getElementById("timer-wrap").classList.remove("hidden");
  TIMER.intervalId = setInterval(() => {
    if (TIMER.paused) return;
    if (timerIsBlocked()) return;
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
  TIMER.turnKey = "";
  document.getElementById("timer-wrap").classList.add("hidden");
}

function updateTimerUI() {
  // The countdown text on the board and in the mobile turn line was written
  // once and never updated, so it read "30s" while the ring counted down.
  if (TIMER.intervalId && G?.phase === "end") {
    const line = `Turn ends in ${TIMER.remaining}s`;
    for (const id of ["center-msg", "mobile-turnline"]) {
      const el = document.getElementById(id);
      if (el && /^Turn ends in \d+s$/.test(el.textContent)) el.textContent = line;
    }
  }
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

// ═══════════════════════════════════════════════
//  DEBUG: STATE AUDIT
// ═══════════════════════════════════════════════
// Enabled with ?debug in the URL. The project has no test suite, so this is the
// cheapest available guard against the bug class where a transfer credits one
// side without debiting the other, or an asset list drifts from G.properties.
const STATE_AUDIT = {
  enabled: (() => {
    try {
      return new URLSearchParams(window.location.search).has("debug");
    } catch (err) {
      return false;
    }
  })(),
  lastTotalCash: null,
};

function totalPlayerCash(state = G) {
  return (state?.players || []).reduce(
    (sum, p) => sum + (Number(p?.money) || 0),
    0,
  );
}

function auditGameState(label = "") {
  if (!STATE_AUDIT.enabled) return [];
  if (!G || !Array.isArray(G.players) || !G.players.length) return [];
  const problems = [];

  G.players.forEach((p) => {
    if (!p) return;
    if (!p.bankrupt && Number(p.money) < 0 && !DEBT_PROMPT.active) {
      problems.push(`${p.name} holds ${p.money} with no debt prompt open`);
    }
    const owned = [
      ...(p.properties || []),
      ...(p.railroads || []),
      ...(p.utilities || []),
    ];
    const seen = new Set();
    owned.forEach((id) => {
      if (seen.has(id)) problems.push(`${p.name} lists space ${id} twice`);
      seen.add(id);
      const prop = G.properties?.[id];
      if (!prop) {
        problems.push(`${p.name} lists space ${id}, which is not ownable`);
      } else if (prop.owner !== p.id) {
        problems.push(
          `${p.name} lists space ${id}, but G.properties says owner ${prop.owner}`,
        );
      }
    });
  });

  (G.properties || []).forEach((prop, id) => {
    if (!prop) return;
    if (prop.owner !== null && prop.owner !== undefined) {
      const owner = G.players[prop.owner];
      if (!owner) {
        problems.push(`Space ${id} is owned by missing player ${prop.owner}`);
      } else {
        const owned = [
          ...(owner.properties || []),
          ...(owner.railroads || []),
          ...(owner.utilities || []),
        ];
        if (!owned.includes(id)) {
          problems.push(
            `Space ${id} is owned by ${owner.name}, who does not list it`,
          );
        }
      }
    }
    const houses = Number(prop.houses) || 0;
    if (houses < 0 || houses > 4) {
      problems.push(`Space ${id} has ${houses} houses (must be 0-4)`);
    }
    if (prop.hotel && houses !== 0) {
      problems.push(`Space ${id} has a hotel and ${houses} houses`);
    }
  });

  const cash = totalPlayerCash();
  const delta =
    STATE_AUDIT.lastTotalCash === null ? 0 : cash - STATE_AUDIT.lastTotalCash;
  STATE_AUDIT.lastTotalCash = cash;

  if (problems.length) {
    console.error(
      `[audit${label ? " after " + label : ""}] ${problems.length} problem(s); total cash ${cash} (${delta >= 0 ? "+" : ""}${delta})`,
    );
    problems.forEach((msg) => console.error("  •", msg));
  } else {
    console.debug(
      `[audit${label ? " after " + label : ""}] ok; total cash ${cash} (${delta >= 0 ? "+" : ""}${delta})`,
    );
  }
  return problems;
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
      auditGameState(name);
      if (isOnlineGame()) {
        if (
          name === "rollDice" &&
          (Number(ONLINE.pendingCardResolutions) || 0) > 0
        ) {
          return result;
        }
        if (ONLINE.isApplyingRemote) {
          // A remote snapshot is mid-apply. Dropping the sync here lost the
          // move outright - the next snapshot simply reverted it - so queue it
          // and let the apply flush it when it finishes.
          ONLINE.syncQueuedReason = name;
        } else {
          await syncRoomState(name);
        }
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
      saveLobbyPrefs();
      syncLobbySettingsToRoom();
    });
  }

  if (timerSelect) {
    timerSelect.addEventListener("change", () => {
      saveLobbyPrefs();
      syncLobbySettingsToRoom();
    });
  }

  if (auctionSelect) {
    auctionSelect.addEventListener("change", () => {
      saveLobbyPrefs();
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
      pulsePresence();
      maybeTakeOverAbsentSeat();
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
    if (enforceAuctionBidderTimeout()) return;
    if (enforcePendingTradeTimeout()) return;
    maybeScheduleOfflineAiTurn();
  }, 1400);
}

// ═══════════════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════
// Space rolls, Enter confirms the open dialog, Escape closes a dismissable one.
// Every shortcut routes through the same handler the button uses, so turn
// ownership and every guard still apply.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function primaryButtonIn(overlayId) {
  const o = document.getElementById(overlayId);
  if (!o || !o.classList.contains("show")) return null;
  return o.querySelector(".btn-primary:not([disabled]), .btn:not([disabled])");
}

// ═══════════════════════════════════════════════
//  DIALOG CLOSE BUTTONS
// ═══════════════════════════════════════════════
// Dialogs that are safe to dismiss get an X in their top corner. Each maps to
// what "close" means for that dialog. Deliberately absent: the auction (bid or
// pass), the debt prompt, buy-or-auction, and a trade you have been offered —
// those are decisions the game is waiting on, and dismissing them would stall
// the match or quietly skip a rule (closing buy would skip the auction).
const DISMISSABLE_OVERLAYS = {
  "prop-overlay": () => closeOverlay("prop-overlay"),
  "portfolio-overlay": () => closeOverlay("portfolio-overlay"),
  "build-overlay": () => closeOverlay("build-overlay"),
  "mortgage-overlay": () => closeOverlay("mortgage-overlay"),
  "trade-overlay": () => closeOverlay("trade-overlay"),
  "rent-overlay": () => closeOverlay("rent-overlay"),
  "jail-overlay": () => closeOverlay("jail-overlay"),
  "leave-game-overlay": () => closeOverlay("leave-game-overlay"),
  // Closing the back-button prompt means staying in the game.
  "exit-guard-overlay": () => dismissExitGuard(),
  // A card cannot be refused, so closing it acknowledges it.
  "card-overlay": () =>
    document.querySelector("#card-overlay .modal > .btn, #card-overlay .modal .btn:not(.modal-close)")?.click(),
};

const MODAL_CLOSE_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function ensureModalCloseButton(modal, overlayId) {
  if (modal.querySelector(":scope > .modal-close-bar")) return;
  // A zero-height sticky bar holds the button: it takes no space in the flow
  // (so full-bleed headers keep their width) and stays pinned to the top of
  // dialogs long enough to scroll.
  const bar = document.createElement("div");
  bar.className = "modal-close-bar";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "modal-close";
  btn.setAttribute("aria-label", "Close");
  btn.title = "Close";
  btn.innerHTML = MODAL_CLOSE_ICON;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    DISMISSABLE_OVERLAYS[overlayId]?.();
  });
  bar.appendChild(btn);
  modal.prepend(bar);
  // Once the dialog scrolls, a solid band appears behind the button so content
  // slides under the band rather than under a bare floating circle.
  if (!modal.dataset.closeScrollBound) {
    modal.dataset.closeScrollBound = "1";
    modal.addEventListener(
      "scroll",
      () => modal.classList.toggle("is-scrolled", modal.scrollTop > 2),
      { passive: true },
    );
  }
  modal.classList.toggle("is-scrolled", modal.scrollTop > 2);
}

// Several dialogs rebuild their whole contents with innerHTML each time they
// open, which would wipe a static button. Re-attach whenever that happens.
function installModalCloseButtons() {
  for (const id of Object.keys(DISMISSABLE_OVERLAYS)) {
    const modal = document.getElementById(id)?.querySelector(".modal");
    if (!modal) continue;
    ensureModalCloseButton(modal, id);
    new MutationObserver(() => ensureModalCloseButton(modal, id)).observe(modal, {
      childList: true,
    });
  }
}

// Topmost dismissable dialog that is currently open, if any.
function topDismissableOverlay() {
  const open = [...document.querySelectorAll(".overlay.show")].filter(
    (o) => DISMISSABLE_OVERLAYS[o.id],
  );
  return open.length ? open[open.length - 1].id : null;
}

function installKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(document.activeElement)) return;
    const gameScreen = document.getElementById("game-screen");
    if (!gameScreen || gameScreen.classList.contains("hidden")) return;

    const openOverlay = document.querySelector(".overlay.show");

    if (e.key === "Escape") {
      // Same action as the dialog's X, and only for dialogs that have one.
      const top = topDismissableOverlay();
      if (top) {
        e.preventDefault();
        DISMISSABLE_OVERLAYS[top]();
      }
      return;
    }

    if (e.key === "Enter" && openOverlay) {
      const btn = primaryButtonIn(openOverlay.id);
      if (btn) {
        e.preventDefault();
        btn.click();
      }
      return;
    }

    if (openOverlay) return;

    if (e.code === "Space" || e.key === " ") {
      const roll = document.getElementById("roll-btn");
      const end = document.getElementById("btn-end");
      e.preventDefault();
      if (roll && !roll.disabled) roll.click();
      else if (end && !end.disabled) end.click();
      return;
    }
    if (e.key === "b" || e.key === "B") document.getElementById("btn-buy")?.click();
    else if (e.key === "t" || e.key === "T") document.getElementById("btn-trade")?.click();
    else if (e.key === "m" || e.key === "M") document.getElementById("btn-mortgage")?.click();
    else if (e.key === "h" || e.key === "H") document.getElementById("btn-build")?.click();
    else if (e.key === "v" || e.key === "V") toggleBoard3d();
  });
}

// ═══════════════════════════════════════════════
//  REMEMBERED LOBBY SETTINGS
// ═══════════════════════════════════════════════
const LOBBY_PREFS_KEY = "monopoly_lobby_prefs";

function saveLobbyPrefs() {
  try {
    const prefs = {
      startMoney: document.getElementById("starting-money")?.value,
      timer: document.getElementById("lobby-timer")?.value,
      auction: document.getElementById("auction-enabled")?.value,
      theme: selectedThemeId,
      speed: MOVE_SPEED.factor,
    };
    localStorage.setItem(LOBBY_PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    /* storage can be unavailable; preferences are a convenience only */
  }
}

function loadLobbyPrefs() {
  let prefs = null;
  try {
    prefs = JSON.parse(localStorage.getItem(LOBBY_PREFS_KEY) || "null");
  } catch (err) {
    prefs = null;
  }
  if (!prefs || typeof prefs !== "object") return;
  const speed = Number(prefs.speed);
  if (Number.isFinite(speed) && speed > 0) MOVE_SPEED.factor = Math.min(3, Math.max(0.25, speed));
  const timer = document.getElementById("lobby-timer");
  if (timer && prefs.timer != null) {
    timer.value = prefs.timer;
    TIMER.duration = Number(prefs.timer) || 0;
  }
  const auction = document.getElementById("auction-enabled");
  if (auction && prefs.auction != null) auction.value = prefs.auction;
  if (prefs.theme && BOARD_THEMES[prefs.theme]) {
    applyThemeById(prefs.theme);
    refreshStartingMoneyUi(prefs.theme, false);
  }
  const money = document.getElementById("starting-money");
  if (money && prefs.startMoney != null) money.value = prefs.startMoney;
}

// ═══════════════════════════════════════════════
//  ANIMATION SPEED
// ═══════════════════════════════════════════════
// 1 = default. Lower is faster. Applied to every per-step movement wait.
const MOVE_SPEED = { factor: 1 };

function setMoveSpeed(factor) {
  const next = Math.min(3, Math.max(0.25, Number(factor) || 1));
  MOVE_SPEED.factor = next;
  saveLobbyPrefs();
  toast(
    next <= 0.5 ? "Animation: fast" : next >= 1.5 ? "Animation: slow" : "Animation: normal",
    "gold",
  );
  refreshSettingsViews();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // ?nosw unregisters and stays off, so a local build can be reloaded without
  // fighting a cached one. Never triggered in normal play.
  try {
    if (new URLSearchParams(window.location.search).has("nosw")) {
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (window.caches?.keys) {
        caches.keys().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
      }
      return;
    }
  } catch (err) {
    /* URL parsing is not worth failing a boot over */
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

// ═══════════════════════════════════════════════
//  HOME
// ═══════════════════════════════════════════════
// Opens the lobby with its board list in view. Waits a frame so the lobby is
// laid out before scrolling to it.
function openBoardPicker() {
  openOfflineSetupPage();
  requestAnimationFrame(() => {
    const card = document.getElementById("board-choice-card");
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
    card.classList.remove("is-spotlit");
    void card.offsetWidth;
    card.classList.add("is-spotlit");
  });
}

function openClassicBoard() {
  applyThemeById("classic");
  refreshStartingMoneyUi("classic", true);
  renderBoardThemeSelector();
  openBoardPicker();
}

// Reflects the browser's connection state. Offline and AI games do not need
// it; online rooms do.
function updateHomeNetStatus() {
  const online = navigator.onLine !== false;
  document.querySelectorAll(".js-net-status").forEach((el) => {
    el.classList.toggle("is-offline", !online);
    el.querySelector("span").textContent = online ? "Online" : "Offline";
    el.title = online
      ? "Connected. Online rooms are available."
      : "No connection. Offline and AI games still work.";
  });
}

// The side menu (tab bar on phones) belongs to the menu pages only; the match
// and the winner screen keep the whole screen.
const APP_NAV_FOR_SCREEN = {
  "home-screen": "home",
  "lobby-screen": "play",
  "online-screen": "play",
  "how-to-screen": "rules",
  "settings-screen": "settings",
  "boards-screen": "boards",
  "lan-screen": "play",
};

function syncAppNav(screenId) {
  const current = APP_NAV_FOR_SCREEN[screenId];
  document.body.classList.toggle("has-app-nav", !!current);
  // The home hero already shows the logo; the rail repeats it elsewhere.
  document.body.classList.toggle("nav-on-home", current === "home");
  document.querySelectorAll("#app-nav [data-nav]").forEach((btn) => {
    const active = btn.dataset.nav === current;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (current) updateHomeNetStatus();
}

// Inside an online room the lobby's Back button leaves the room properly;
// the menu has to do the same, or the seat would be left behind.
async function appNavigate(dest) {
  if (dest === "settings") {
    openSettingsPage();
    return;
  }
  const lobbyOpen = !document
    .getElementById("lobby-screen")
    ?.classList.contains("hidden");
  if (lobbyOpen && isOnlineGame()) {
    try {
      await leaveOnlineRoom(true, true);
    } catch (err) {
      console.error(err);
      toast("Could not leave room cleanly.", "danger");
      return;
    }
  }
  if (dest === "home") openHomePage();
  else if (dest === "play") openOfflineSetupPage();
  else if (dest === "boards") openBoardsPage();
  else if (dest === "rules") showScreen("how-to-screen");
}
window.addEventListener("online", updateHomeNetStatus);
window.addEventListener("offline", updateHomeNetStatus);

// Recent activity is kept in this browser only. The board editor writes to the
// same key (see boardeditor.html), so the two must agree on the entry shape:
// { kind: "local" | "online" | "board", title, detail, themeId?, time }.
const RECENT_ACTIVITY_KEY = "monopoly_recent_activity_v1";
const RECENT_ACTIVITY_LIMIT = 4;

function readRecentActivity() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_ACTIVITY_KEY) || "[]");
    return Array.isArray(list) ? list.filter((e) => e && e.kind && e.time) : [];
  } catch (_err) {
    return [];
  }
}

function recordRecentActivity(entry) {
  if (!entry || !entry.kind) return;
  try {
    const list = readRecentActivity();
    list.unshift({ ...entry, time: Date.now() });
    localStorage.setItem(
      RECENT_ACTIVITY_KEY,
      JSON.stringify(list.slice(0, RECENT_ACTIVITY_LIMIT)),
    );
  } catch (_err) {
    // Private mode or full storage: the list is a convenience, so skip it.
  }
}

function formatRelativeTime(ts) {
  const seconds = Math.round((Number(ts) - Date.now()) / 1000);
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf =
    typeof Intl !== "undefined" && Intl.RelativeTimeFormat
      ? new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "narrow" })
      : null;
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      const value = Math.round(seconds / size);
      return rtf ? rtf.format(value, unit) : `${Math.abs(value)} ${unit}s ago`;
    }
  }
  return "just now";
}

function openRecentActivity(index) {
  const entry = readRecentActivity()[index];
  if (!entry) return;
  if (entry.kind === "lan") {
    openLanPage();
  } else if (entry.kind === "online") {
    openOnlineSetupPage("host");
  } else if (entry.kind === "board") {
    openBoardEditorPage();
  } else {
    if (entry.themeId && BOARD_THEMES[entry.themeId]) {
      applyThemeById(entry.themeId);
      refreshStartingMoneyUi(entry.themeId, true);
      renderBoardThemeSelector();
    }
    openOfflineSetupPage();
  }
}

function renderRecentActivity() {
  const el = document.getElementById("hp-recent-list");
  if (!el) return;
  const list = readRecentActivity();
  if (!list.length) {
    el.innerHTML =
      '<p class="hp-recent-empty">Games you start and boards you edit will show up here.</p>';
    return;
  }
  const chevron =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  el.innerHTML = list
    .map((entry, i) => {
      const dot =
        entry.kind === "online" || entry.kind === "lan" ? " is-online" : entry.kind === "board" ? " is-board" : "";
      const when = formatRelativeTime(entry.time);
      const detail = [entry.detail, when].filter(Boolean).join(" · ");
      return `<button class="hp-recent-item" onclick="openRecentActivity(${i})">
          <span class="hp-recent-dot${dot}" aria-hidden="true"></span>
          <span class="hp-card-text">
            <span class="hp-recent-title">${escHtml(entry.title || "")}</span>
            <span class="hp-recent-detail">${escHtml(detail)}</span>
          </span>
          ${chevron}
        </button>`;
    })
    .join("");
}

function refreshHomeScreen() {
  updateHomeNetStatus();
  renderRecentActivity();
}

// ═══════════════════════════════════════════════
//  SETTINGS PAGE (from the menus)
// ═══════════════════════════════════════════════
// The in-match drawer holds what matters mid-game (timer, sound, leaving).
// This page is the app-wide version: sound, defaults for new games, the
// online name, saved data and app info.
let CURRENT_DRAWER = "";
const APP_VERSION = "0.1.0";

function refreshSettingsViews() {
  if (CURRENT_DRAWER === "settings") openDrawer("settings");
  const page = document.getElementById("settings-screen");
  if (page && !page.classList.contains("hidden")) renderSettingsPage();
}

function openSettingsPage() {
  renderSettingsPage();
  showScreen("settings-screen");
}

function settingsSwitch(id, on, onclick, label) {
  return `<button type="button" class="mp-switch${on ? " is-on" : ""}" id="${id}" role="switch" aria-checked="${on}" aria-label="${escAttr(label)}" onclick="${onclick}"><span></span></button>`;
}

function settingsRow(title, help, control) {
  return `<div class="mp-setting">
      <div class="mp-setting-text">
        <div class="mp-setting-title">${title}</div>
        ${help ? `<div class="mp-setting-help">${help}</div>` : ""}
      </div>
      <div class="mp-setting-control">${control}</div>
    </div>`;
}

function settingsLink(title, help, onclick) {
  return `<button type="button" class="mp-setting mp-setting-link" onclick="${onclick}">
      <span class="mp-setting-text">
        <span class="mp-setting-title">${title}</span>
        ${help ? `<span class="mp-setting-help">${help}</span>` : ""}
      </span>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
    </button>`;
}

function renderSettingsPage() {
  const body = document.getElementById("settings-body");
  if (!body) return;
  const volume = Math.round(clampSfxVolume(SFX.volume) * 100);
  const speed = MOVE_SPEED.factor || 1;
  const speeds = [["Fast", 0.4], ["Normal", 1], ["Slow", 1.8]];
  const timer = String(document.getElementById("lobby-timer")?.value ?? TIMER.duration);
  const timers = [["0", "Off"], ["10", "10 seconds"], ["20", "20 seconds"], ["30", "30 seconds"], ["45", "45 seconds"], ["60", "60 seconds"]];
  let name = "";
  try {
    name = localStorage.getItem("monopoly_online_name") || "";
  } catch (_err) {}
  if (!name) name = document.getElementById("online-player-name")?.value || "";
  const recentCount = readRecentActivity().length;

  body.innerHTML = `
    <section class="mp-card">
      <h2 class="mp-card-title">Sound</h2>
      ${settingsRow("Sound effects", "Dice, rent, jail, auctions and wins", settingsSwitch("set-sfx", !!SFX.enabled, "toggleSfxEnabled()", "Sound effects"))}
      ${settingsRow("Music", "Plays during a match", settingsSwitch("set-bgm", !!SFX.bgmEnabled, "toggleBgmEnabled()", "Music"))}
      <div class="mp-setting mp-setting-stack">
        <div class="mp-setting-text">
          <label class="mp-setting-title" for="set-volume">Volume</label>
        </div>
        <div class="mp-range">
          <input type="range" id="set-volume" min="0" max="100" value="${volume}"
            oninput="document.getElementById('set-volume-value').textContent=this.value+'%';setSfxVolume(Number(this.value)/100,false)"
            onchange="setSfxVolume(Number(this.value)/100,false)" />
          <output id="set-volume-value" for="set-volume">${volume}%</output>
        </div>
      </div>
    </section>

    <section class="mp-card">
      <h2 class="mp-card-title">Board</h2>
      ${settingsRow("3D view", "Tilt the table to look across it. Drag to turn, scroll or pinch to zoom. Off shows the same table from above. Press V during a match to switch.", settingsSwitch("set-board-3d", BOARD_VIEW.is3d, "toggleBoard3d()", "3D view"))}
    </section>

    <section class="mp-card">
      <h2 class="mp-card-title">New games</h2>
      <div class="mp-setting mp-setting-stack">
        <div class="mp-setting-text">
          <div class="mp-setting-title">Animation speed</div>
          <div class="mp-setting-help">How fast tokens move around the board</div>
        </div>
        <div class="mp-segmented mp-segmented-3" role="group" aria-label="Animation speed">
          ${speeds
            .map(([label, v]) => `<button type="button" class="${Math.abs(speed - v) < 0.05 ? "is-selected" : ""}" aria-pressed="${Math.abs(speed - v) < 0.05}" onclick="setMoveSpeed(${v})">${label}</button>`)
            .join("")}
        </div>
      </div>
      ${settingsRow(
        '<label for="set-timer">Turn timer</label>',
        "Default for new games; each lobby can change it",
        `<div class="mp-field mp-field-inline"><select id="set-timer" onchange="setDefaultTurnTimer(this.value)">${timers
          .map(([v, l]) => `<option value="${v}"${v === timer ? " selected" : ""}>${l}</option>`)
          .join("")}</select></div>`,
      )}
    </section>

    <section class="mp-card">
      <h2 class="mp-card-title">Online</h2>
      <div class="mp-field">
        <label for="set-online-name">Your name in online rooms</label>
        <input type="text" id="set-online-name" maxlength="24" placeholder="Enter your name" value="${escAttr(name)}" autocomplete="nickname" onchange="setDefaultOnlineName(this.value)" />
      </div>
    </section>

    <section class="mp-card">
      <h2 class="mp-card-title">Saved data</h2>
      ${settingsRow(
        "Recent activity",
        recentCount ? `${recentCount} item${recentCount === 1 ? "" : "s"} on the home screen` : "Nothing saved",
        `<button type="button" class="mp-btn mp-btn-secondary mp-btn-sm" onclick="clearRecentActivity()" ${recentCount ? "" : "disabled"}>Clear</button>`,
      )}
      ${settingsRow(
        "Reset settings",
        "Sound, speed, timer and lobby choices go back to their defaults",
        `<button type="button" class="mp-btn mp-btn-danger mp-btn-sm" onclick="resetAllSettings()">Reset</button>`,
      )}
    </section>

    <section class="mp-card">
      <h2 class="mp-card-title">About</h2>
      ${settingsRow("Version", "", `<span class="mp-setting-value">${APP_VERSION}</span>`)}
      ${settingsLink("Patch notes", "What changed in each update", "openWhatsNewPage()")}
      ${settingsLink("Report a bug", "Opens the issue form in a new tab", "openBugReport()")}
      <div class="mp-setting mp-setting-stack">
        <div class="mp-setting-text">
          <div class="mp-setting-title">Keyboard shortcuts</div>
          <div class="mp-setting-help">During a match</div>
        </div>
        <dl class="mp-keys">
          <div><dt><kbd>Space</kbd></dt><dd>Roll, or end turn</dd></div>
          <div><dt><kbd>Enter</kbd></dt><dd>Confirm dialog</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Close dialog</dd></div>
          <div><dt><kbd>B</kbd></dt><dd>Buy</dd></div>
          <div><dt><kbd>H</kbd></dt><dd>Build</dd></div>
          <div><dt><kbd>M</kbd></dt><dd>Mortgage</dd></div>
          <div><dt><kbd>T</kbd></dt><dd>Trade</dd></div>
        </dl>
      </div>
    </section>
  `;
}

function setDefaultTurnTimer(value) {
  const secs = Math.max(0, Number(value) || 0);
  const lobbyTimer = document.getElementById("lobby-timer");
  if (lobbyTimer) lobbyTimer.value = String(secs);
  TIMER.duration = secs;
  saveLobbyPrefs();
  toast(secs ? `Turn timer: ${secs} seconds` : "Turn timer off", "gold");
}

function setDefaultOnlineName(value) {
  const name = sanitizeName(value, "Player");
  try {
    localStorage.setItem("monopoly_online_name", name);
  } catch (_err) {}
  const onlineInput = document.getElementById("online-player-name");
  if (onlineInput) onlineInput.value = name;
  const field = document.getElementById("set-online-name");
  if (field) field.value = name;
  toast("Name saved", "gold");
}

function clearRecentActivity() {
  try {
    localStorage.removeItem(RECENT_ACTIVITY_KEY);
  } catch (_err) {}
  renderRecentActivity();
  renderSettingsPage();
  toast("Recent activity cleared", "gold");
}

function resetAllSettings() {
  if (!window.confirm("Reset sound, speed, timer and lobby choices to their defaults?")) return;
  try {
    [
      LOBBY_PREFS_KEY,
      SFX_PREF_ENABLED_KEY,
      SFX_PREF_VOLUME_KEY,
      SFX_PREF_BGM_ENABLED_KEY,
      BOARD_VIEW_KEY,
    ].forEach((k) => localStorage.removeItem(k));
  } catch (_err) {}
  // Defaults live in several modules; a reload is the only reliable way to
  // re-read every one of them.
  window.location.reload();
}

// ═══════════════════════════════════════════════
//  BOARD VIEW (flat / 3D)
// ═══════════════════════════════════════════════
// Both board views come from one WebGL scene (scripts/board3d/main.js,
// bundled as scripts/board3d.min.js): 2D is the table seen from straight
// above, 3D is the same table tilted. Switching animates the camera, so the
// two views are continuous. The scene only draws the game state, so online
// rooms work whatever view each player uses. The preference is per device.
//
// The HTML board (#game-board) is always built and kept up to date. It is
// what shows until the scene has loaded, and the fallback when WebGL is not
// available.
const BOARD_VIEW_KEY = "monopoly_board_3d";
const BOARD_VIEW = {
  gl: false, // the WebGL scene is showing (either view)
  failed: false,
  is3d: (() => {
    try {
      return localStorage.getItem(BOARD_VIEW_KEY) === "1";
    } catch (_err) {
      return false;
    }
  })(),
};

let BOARD3D_LOADING = null;
function loadBoard3d() {
  if (window.Board3D) return Promise.resolve(window.Board3D);
  if (!BOARD3D_LOADING) {
    const build = window.APP_BUILD ? `?v=${window.APP_BUILD}` : "";
    const url = new URL(`scripts/board3d.min.js${build}`, document.baseURI).href;
    BOARD3D_LOADING = import(url)
      .then(() => window.Board3D)
      .catch((err) => {
        BOARD3D_LOADING = null;
        throw err;
      });
  }
  return BOARD3D_LOADING;
}

// The Roll / End turn buttons and turn message live in the HTML board's
// centre; while the scene shows they move into its controls dock. buildBoard()
// recreates them, so this also runs on a timer.
function dockCenterControls(intoScene) {
  const hud = document.getElementById("board3d-hud");
  const centre = document.querySelector("#game-board .center-area");
  if (!hud || !centre) return;
  ["center-actions", "center-msg"].forEach((id) => {
    if (intoScene) {
      const inBoard = centre.querySelector(`#${id}`);
      if (!inBoard) return;
      const stale = hud.querySelector(`#${id}`);
      if (stale && stale !== inBoard) stale.remove();
      hud.appendChild(inBoard);
    } else {
      const el = hud.querySelector(`#${id}`);
      if (!el) return;
      if (centre.querySelector(`#${id}`)) el.remove();
      else centre.appendChild(el);
    }
  });
}
setInterval(() => {
  if (BOARD_VIEW.gl) dockCenterControls(true);
}, 250);

function updateBoardViewButton() {
  document.body.classList.toggle("board-gl", BOARD_VIEW.gl);
  document.body.classList.toggle("board-3d", BOARD_VIEW.gl && BOARD_VIEW.is3d);
  const btn = document.getElementById("board-view-toggle");
  if (!btn) return;
  btn.setAttribute("aria-pressed", BOARD_VIEW.is3d ? "true" : "false");
  const label = document.getElementById("board-view-label");
  if (label) label.textContent = BOARD_VIEW.is3d ? "2D" : "3D";
  btn.title = BOARD_VIEW.is3d ? "Switch to the flat view (V)" : "Switch to the 3D view (V)";
}

// Starts the scene the first time the match screen shows. Quietly keeps the
// HTML board if WebGL is missing or the file cannot load.
async function ensureBoardScene() {
  if (BOARD_VIEW.gl || BOARD_VIEW.failed) return BOARD_VIEW.gl;
  let api = null;
  try {
    api = await loadBoard3d();
  } catch (err) {
    console.error(err);
    return false;
  }
  if (!api || !api.supported) {
    BOARD_VIEW.failed = true;
    return false;
  }
  if (!(await api.enable(BOARD_VIEW.is3d ? "3d" : "2d"))) return false;
  BOARD_VIEW.gl = true;
  dockCenterControls(true);
  updateBoardViewButton();
  // The dock changes size once the buttons are in it; frame again.
  requestAnimationFrame(() => api.setMode(BOARD_VIEW.is3d ? "3d" : "2d", false));
  return true;
}

function setBoard3d(on, notify = true) {
  BOARD_VIEW.is3d = !!on;
  try {
    localStorage.setItem(BOARD_VIEW_KEY, BOARD_VIEW.is3d ? "1" : "0");
  } catch (_err) {}
  if (BOARD_VIEW.gl && window.Board3D) {
    window.Board3D.setMode(BOARD_VIEW.is3d ? "3d" : "2d", true);
  } else if (BOARD_VIEW.is3d && BOARD_VIEW.failed) {
    BOARD_VIEW.is3d = false;
    toast("The 3D view needs WebGL, which this browser does not provide.", "danger");
  } else if (BOARD_VIEW.is3d) {
    const inMatch = !document.getElementById("game-screen")?.classList.contains("hidden");
    if (inMatch) {
      ensureBoardScene().then((ok) => {
        if (!ok && BOARD_VIEW.is3d) {
          BOARD_VIEW.is3d = false;
          updateBoardViewButton();
          toast("Could not load the 3D view. Check your connection and try again.", "danger");
        }
      });
    }
  }
  updateBoardViewButton();
  if (notify) toast(BOARD_VIEW.is3d ? "3D view" : "Flat view", "gold");
  refreshSettingsViews();
}

function toggleBoard3d() {
  setBoard3d(!BOARD_VIEW.is3d);
}

updateBoardViewButton();

// ═══════════════════════════════════════════════
//  BOARDS PAGE
// ═══════════════════════════════════════════════
// A short note on each built-in board. Written for players, so no numbers
// that the facts row already shows.
const BOARD_STORIES = {
  dhaka:
    "A lap of the capital, from Mirpur Road at the cheap end to Karwan Bazar at the top. Kamalapur, the airport, Sadarghat and Sayedabad are the stations, and the power and water bills come from Desco and WASA.",
  bangladesh:
    "Cities across the country instead of streets: start in Narsingdi and work up to Dhaka. The railway stations are Kamalapur, Chittagong, Sylhet and Rajshahi.",
  world:
    "A round-the-world trip from Cairo to New York. Airports in London, New York, Dubai and Tokyo stand in for the railroads.",
  classic:
    "The original streets, from Mediterranean Avenue to Boardwalk, with the original money: a smaller economy where every purchase counts.",
  cities:
    "A Bengali-language board that travels from Sylhet through Mymensingh and Chittagong to Dhaka, from লামা বাজার up to গুলশান. It plays at classic scale and has its own Bengali Chance and Community Chest cards.",
  ancient:
    "Cities of the old world, from Memphis to Chang'an. Trade routes such as the Silk Road and the Spice Route replace the stations.",
};

// Windows has no flag emoji and shows "BD" instead, so draw the flag.
const BD_FLAG_SVG =
  '<svg viewBox="0 0 20 12" width="28" height="17" aria-hidden="true"><rect width="20" height="12" rx="1.5" fill="#006a4e"/><circle cx="9" cy="6" r="3.6" fill="#f42a41"/></svg>';

function openBoardsPage() {
  renderBoardsPage();
  showScreen("boards-screen");
}

function boardMoney(theme, n) {
  const value = Number(n) || 0;
  return `${theme.currency || ""}${value.toLocaleString(theme.locale || "en-US")}`;
}

function renderBoardsPage() {
  const grid = document.getElementById("boards-grid");
  if (!grid) return;
  const themes = Object.values(BOARD_THEMES).filter((t) => t && t.id !== CUSTOM_BOARD_THEME_ID);
  grid.innerHTML = themes
    .map((t) => {
      const props = Array.isArray(t.spaces) ? t.spaces : [];
      const groups = [];
      props.forEach((sp) => {
        if (sp && sp.color && !groups.includes(sp.color)) groups.push(sp.color);
      });
      const cheapest = props[0];
      const top = props[props.length - 1];
      const selected = t.id === selectedThemeId;
      const start = t.startMoneyDefault || getThemeStartMoneyDefault(t.id);
      return `<article class="bd-card${selected ? " is-selected" : ""}">
          <div class="bd-strip" aria-hidden="true">${groups.map((c) => `<i style="background:${COLOR[c] || "#666"}"></i>`).join("")}</div>
          <div class="bd-body">
            <div class="bd-head">
              <span class="bd-flag" aria-hidden="true">${t.id === "bangladesh" ? BD_FLAG_SVG : escHtml(t.flag || "")}</span>
              <div class="bd-titles">
                <h2 class="bd-name">${escHtml(t.name)}</h2>
                <p class="bd-desc">${escHtml(t.desc || "")}</p>
              </div>
              ${selected ? '<span class="mp-badge is-host">Selected</span>' : ""}
            </div>
            <p class="bd-story">${escHtml(BOARD_STORIES[t.id] || "")}</p>
            <dl class="bd-facts">
              <div><dt>Starting money</dt><dd>${boardMoney(t, start)}</dd></div>
              <div><dt>Passing GO</dt><dd>${boardMoney(t, t.goSalary)}</dd></div>
              <div><dt>Properties</dt><dd>${props.length}, in ${groups.length} colour groups</dd></div>
              ${cheapest && top ? `<div><dt>Prices</dt><dd>${escHtml(cheapest.name)} ${boardMoney(t, cheapest.price)} to ${escHtml(top.name)} ${boardMoney(t, top.price)}</dd></div>` : ""}
            </dl>
            <button class="mp-btn mp-btn-primary bd-play" onclick="playBoardFromPage('${t.id}')">Play this board</button>
          </div>
        </article>`;
    })
    .join("");

  const custom = document.getElementById("boards-custom");
  if (!custom) return;
  let saved = "";
  try {
    saved = getStoredCustomBoardSeed() || "";
  } catch (_err) {}
  custom.innerHTML = `
    <h2 class="mp-card-title">Make your own board</h2>
    <p class="bd-story">The board editor lets you rename every space, recolour the groups, change prices and rents, and scale the whole economy up or down. It turns your board into a short seed code you can play here or send to friends; in an online room, the host's board applies to everyone.</p>
    <div class="mp-row">
      <button class="mp-btn mp-btn-primary" onclick="openBoardEditorPage()">Open the board editor</button>
      ${saved ? `<button class="mp-btn mp-btn-secondary" onclick="playSavedCustomBoard()">Play your saved board</button>` : ""}
      <button class="mp-btn mp-btn-ghost" onclick="openCustomSeedInLobby()">Paste a seed code</button>
    </div>`;
}

function playBoardFromPage(themeId) {
  if (!BOARD_THEMES[themeId]) return;
  applyThemeById(themeId);
  refreshStartingMoneyUi(themeId, true);
  renderBoardThemeSelector();
  saveLobbyPrefs();
  openOfflineSetupPage();
}

function playSavedCustomBoard() {
  openOfflineSetupPage();
  loadSavedCustomBoardSeed();
}

// Opens the lobby with the custom-seed section expanded and focused.
function openCustomSeedInLobby() {
  openOfflineSetupPage();
  requestAnimationFrame(() => {
    const box = document.getElementById("custom-board-card");
    if (box) {
      box.open = true;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      document.getElementById("custom-board-seed")?.focus({ preventScroll: true });
    }
  });
}

// Sticky page headers compact once their page scrolls (styles/menu.css,
// .mp-header.is-stuck). One listener per menu screen.
function installStickyHeaders() {
  document.querySelectorAll(".screen.menu-page").forEach((screen) => {
    const header = screen.querySelector(".mp-header");
    if (!header) return;
    const update = () => header.classList.toggle("is-stuck", screen.scrollTop > 8);
    screen.addEventListener("scroll", update, { passive: true });
    update();
  });
}

// Connection state of the online service, shown at the top of the Online
// rooms and Same Wi-Fi pages until it is ready.
function renderOnlineServiceNotice() {
  const state = typeof ONLINE_SERVICE !== "undefined" ? ONLINE_SERVICE.state : "ready";
  const error = typeof ONLINE_SERVICE !== "undefined" ? ONLINE_SERVICE.error : "";
  // The "Online" chip only knows whether the device has internet; while the
  // game's service is not connected it would contradict the notice below.
  document.querySelectorAll("#online-screen .js-net-status").forEach((chip) => {
    chip.hidden = state !== "ready";
  });
  ["online-service-note", "lan-service-note"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (state === "ready" || state === "idle") {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.classList.toggle("is-error", state === "error");
    el.innerHTML =
      state === "error"
        ? `<span>${escHtml(error || "Could not connect to the online service.")}</span><button type="button" class="mp-btn mp-btn-secondary mp-btn-sm" onclick="retryOnlineService()">Try again</button>`
        : '<span class="mp-spinner" aria-hidden="true"></span><span>Connecting to the online service…</span>';
  });
}
