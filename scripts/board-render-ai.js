// ═══════════════════════════════════════════════
//  BOARD BUILDER
// ═══════════════════════════════════════════════
// Top and bottom squares on a phone are ~30px wide, narrower than words like
// "Sadarghat", so the browser split them wherever it ran out of room
// ("Sadarg|hat"). Browsers cannot hyphenate place names on their own, so mark
// syllable breaks with soft hyphens: they are invisible unless a break is
// needed, and then render as "Sadar-ghat".
//
// Rule: in each run of consonants between two vowels, break before the last
// consonant (Ka-ma-la-pur, Farm-gate, Dhan-mondi). Consonant + "h" is kept as
// one sound, which matters for romanised Bangla (Sadar-ghat, Moti-jheel).
// Each side of a break keeps at least three letters.
const SOFT_HYPHEN = "­";
function hyphenateWord(word) {
  if (word.length < 6 || !/^[A-Za-z]+$/.test(word)) return word;
  const lower = word.toLowerCase();
  const units = [];
  for (let i = 0; i < lower.length; i++) {
    const pair = lower.slice(i, i + 2);
    const len = /^[bcdgjkpstr]h$/.test(pair) ? 2 : 1;
    units.push({ start: i, len, text: lower.slice(i, i + len) });
    i += len - 1;
  }
  const isVowel = (u, idx) => {
    if (!u || u.len > 1) return false;
    if ("aeiou".includes(u.text)) return true;
    // "y" is a vowel unless a vowel follows it (Mymensingh vs Sayedabad).
    return u.text === "y" && idx > 0 && !isVowel(units[idx + 1], idx + 1);
  };
  const breaks = [];
  for (let k = 1; k < units.length - 1; k++) {
    if (isVowel(units[k], k) || !isVowel(units[k + 1], k + 1)) continue;
    // units[k] is the last consonant before a vowel; find the vowel before the run.
    let j = k - 1;
    while (j >= 0 && !isVowel(units[j], j)) j--;
    if (j < 0) continue;
    const at = units[k].start;
    if (at >= 3 && word.length - at >= 3) breaks.push(at);
  }
  if (!breaks.length) return word;
  let out = "";
  let last = 0;
  for (const at of breaks) {
    out += word.slice(last, at) + SOFT_HYPHEN;
    last = at;
  }
  return out + word.slice(last);
}

function boardLabelHtml(name) {
  return escHtml(
    String(name || "").replace(/[A-Za-z]+/g, (w) => hyphenateWord(w)),
  );
}

// What a square is, in words: for screen readers and the keyboard board.
function spaceAccessibleName(id) {
  const sp = SPACES[id];
  if (!sp) return "";
  const parts = [sp.name];
  if (sp.type === "property" || sp.type === "railroad" || sp.type === "utility") {
    const prop = G?.properties?.[id];
    const owner = prop && prop.owner !== null && prop.owner !== undefined ? G.players[prop.owner] : null;
    parts.push(fmtCurrency(sp.price || 0));
    parts.push(owner ? `owned by ${owner.name}` : "for sale");
    if (prop?.hotel) parts.push("hotel");
    else if (prop?.houses) parts.push(`${prop.houses} house${prop.houses === 1 ? "" : "s"}`);
    if (prop?.mortgaged) parts.push("mortgaged");
  } else if (sp.type === "tax") {
    parts.push(`pay ${fmtCurrency(sp.amount || 0)}`);
  }
  const here = (G?.players || []).filter((p) => !p.bankrupt && p.pos === id).map((p) => p.name);
  if (here.length) parts.push(`${here.join(", ")} ${here.length === 1 ? "is" : "are"} here`);
  return uiText(parts.join(", "));
}

function buildBoard() {
  const board = document.getElementById("game-board");
  board.innerHTML = "";

  const die1Value = Number.isInteger(Number(G?.dice?.[0]))
    ? Math.max(1, Math.min(6, Number(G.dice[0])))
    : 1;
  const die2Value = Number.isInteger(Number(G?.dice?.[1]))
    ? Math.max(1, Math.min(6, Number(G.dice[1])))
    : 1;

  SPACES.forEach((s) => {
    const el = document.createElement("div");
    el.className = "space";
    // The left and right columns are short and wide, the opposite of the top
    // and bottom rows, so they need their own type scale.
    if ((s.id > 10 && s.id < 20) || (s.id > 30 && s.id < 40)) {
      el.classList.add("side");
    }
    el.id = `sp${s.id}`;
    el.onclick = () => showSpaceInfo(s.id);
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", spaceAccessibleName(s.id));
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showSpaceInfo(s.id);
      }
    };

    let inner = "";
    if (s.type === "property") {
      const c = COLOR[s.color];
      inner = `<div class="color-bar" style="background:${c};height:18%"></div>
               <div class="sp-name">${boardLabelHtml(s.name)}</div>
               <div class="sp-price">${fmtCurrency(s.price)}</div>
               <div class="sp-rent">Rent ${fmtCurrency(s.rent?.[0] || 0)}</div>`;
    } else if (s.type === "railroad") {
      inner = `<div class="sp-icon">🚂</div><div class="sp-name">${boardLabelHtml(s.name)}</div><div class="sp-price">${fmtCurrency(s.price)}</div><div class="sp-rent">Rent ${fmtCurrency(s.rent?.[0] || 0)}</div>`;
    } else if (s.type === "utility") {
      inner = `<div class="sp-icon">${escHtml(s.icon)}</div><div class="sp-name">${boardLabelHtml(s.name)}</div><div class="sp-price">${fmtCurrency(s.price)}</div>`;
    } else if (s.type === "go") {
      inner = `<div class="sp-name"><div style="font-size:1.6em">🏁</div><div style="color:#c0392b;font-weight:900;font-size:1.1em;font-family: var(--font-body)">GO</div><div style="font-size:.65em;color:#1a5c1a">Collect ${escHtml((window.ACTIVE_THEME || BOARD_THEMES.dhaka).currency)}${Number((window.ACTIVE_THEME || BOARD_THEMES.dhaka).goSalary) || 0}</div></div>`;
    } else if (s.type === "jail") {
      inner = `<div class="sp-name"><div style="font-size:1.2em">⛓️</div><div style="font-family: var(--font-body);font-weight:700">JAIL</div><div style="font-size:.75em">Just Visiting</div></div>`;
    } else if (s.type === "parking") {
      inner = `<div class="sp-name"><div style="font-size:1.5em">🅿️</div><div style="font-family: var(--font-body);font-weight:700">FREE</div><div style="font-size:.75em">Parking</div></div>`;
    } else if (s.type === "gotojail") {
      inner = `<div class="sp-name"><div style="font-size:1.3em">🚔</div><div style="color:#c0392b;font-size:.9em;font-family: var(--font-body)">GO TO</div><div style="color:#c0392b;font-weight:900;font-family: var(--font-body)">JAIL</div></div>`;
    } else if (s.type === "chance") {
      inner = `<div class="sp-name"><div style="font-size:1.5em">❓</div><div style="color:#e67e22;font-weight:700;font-size:.8em;font-family: var(--font-body)">CHANCE</div></div>`;
    } else if (s.type === "community") {
      inner = `<div class="sp-name"><div style="font-size:1.3em">📦</div><div style="font-size:.75em;color:#2563eb;font-weight:700;font-family: var(--font-body)">${boardLabelHtml("COMMUNITY")}</div><div style="font-size:.7em;color:#2563eb;font-family: var(--font-body)">CHEST</div></div>`;
    } else if (s.type === "tax") {
      inner = `<div class="sp-name"><div style="font-size:1.3em">${escHtml(s.icon)}</div><div style="font-size:.8em;font-family: var(--font-body);font-weight:700">${boardLabelHtml(s.name)}</div><div class="sp-price">${fmtCurrency(s.amount)}</div></div>`;
    }
    el.innerHTML = inner;
    board.appendChild(el);
  });

  // Center area
  const center = document.createElement("div");
  center.className = "center-area";
  const t = window.ACTIVE_THEME || BOARD_THEMES.dhaka;
  center.innerHTML = `
    <div class="center-title">MONOPOLY</div>
    <div class="center-sub">${escHtml(t.flag)} ${escHtml(String(t.name).toUpperCase())} EDITION</div>
    <div class="dice-row">
      <div class="die" id="die1" data-v="${die1Value}">${'<span class="dot"></span>'.repeat(7)}</div>
      <div class="die" id="die2" data-v="${die2Value}">${'<span class="dot"></span>'.repeat(7)}</div>
    </div>
    <div class="center-actions" id="center-actions">
      <button id="roll-btn" class="center-btn" onclick="rollDice()">Roll dice</button>
      <button id="center-end-btn" class="center-btn" onclick="endTurn()">End turn</button>
    </div>
    <div id="center-msg" style="font-size:clamp(.6rem,1.2vmin,.8rem);color:#1a5c1a;margin-top:.3rem;font-weight:700;font-family: var(--font-body)"></div>
  `;
  board.appendChild(center);
}

function renderDiceFromState() {
  const d1 = Number.isInteger(Number(G?.dice?.[0]))
    ? Math.max(1, Math.min(6, Number(G.dice[0])))
    : 1;
  const d2 = Number.isInteger(Number(G?.dice?.[1]))
    ? Math.max(1, Math.min(6, Number(G.dice[1])))
    : 1;
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  if (die1) die1.dataset.v = String(d1);
  if (die2) die2.dataset.v = String(d2);
}

// ═══════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════
function renderAll() {
  if (typeof renderRulesHud === "function") renderRulesHud();
  renderPlayerCards();
  renderMarkers();
  renderBoardOwnership();
  renderDiceFromState();
  renderGameLog();
  renderChatLog();
  syncAuctionOverlay();
  updateTopBar();
  updateActionButtons();
  maybeScheduleOfflineAiTurn();
  if (typeof scheduleSave === "function") scheduleSave();
  if (window.Board3D && typeof window.Board3D.wake === "function") window.Board3D.wake();
  if (typeof maybeShowTurnBanner === "function") maybeShowTurnBanner();
  document.body.classList.toggle("is-local-game", !isOnlineGame());
  // The flat HTML board (no WebGL) keeps its squares' spoken names current.
  if (!document.body.classList.contains("board-gl")) {
    SPACES.forEach((sp) => document.getElementById(`sp${sp.id}`)?.setAttribute("aria-label", spaceAccessibleName(sp.id)));
  }
}

function syncAuctionOverlay() {
  const overlay = document.getElementById("auction-overlay");
  if (!overlay) return;

  if (G?.gameOver) {
    closeOverlay("auction-overlay");
    return;
  }

  if (G.auctionState) {
    renderAuction();
    openOverlay("auction-overlay");
  } else {
    closeOverlay("auction-overlay");
  }
}

// Last log entry read out to screen readers, so each is announced once
// whether it was written here or arrived from another player.
let LAST_ANNOUNCED_LOG = "";

function announceNewLogEntries() {
  if (typeof announce !== "function" || !Array.isArray(G?.log) || !G.log.length) return;
  const keys = G.log.map(getLogEntryKey);
  const from = LAST_ANNOUNCED_LOG ? keys.lastIndexOf(LAST_ANNOUNCED_LOG) + 1 : G.log.length - 1;
  LAST_ANNOUNCED_LOG = keys[keys.length - 1];
  const screen = document.getElementById("game-screen");
  if (!screen || screen.classList.contains("hidden")) return;
  G.log.slice(Math.max(0, from), G.log.length).slice(-4).forEach((e) => announce(e.text));
}

function renderGameLog() {
  const el = document.getElementById("game-log");
  if (!el || !Array.isArray(G.log)) return;
  appendLogsToArchive(G.log);
  announceNewLogEntries();
  // Only follow new entries when the reader is already at the bottom; someone
  // scrolled up to read an earlier turn should not be yanked back down.
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  el.innerHTML = renderLogFeedHtml(G.log);
  if (atBottom || !el.dataset.rendered) el.scrollTop = el.scrollHeight;
  el.dataset.rendered = "1";
  const drawerFeed = document.getElementById("drawer-log-feed");
  if (drawerFeed) {
    const drawerAtBottom =
      drawerFeed.scrollHeight - drawerFeed.scrollTop - drawerFeed.clientHeight < 24;
    drawerFeed.innerHTML = renderLogFeedHtml(G.log);
    if (drawerAtBottom) drawerFeed.scrollTop = drawerFeed.scrollHeight;
  }
}

function renderChatLog() {
  const el = document.getElementById("chat-log");
  if (!el || !G.chat) return;
  if (!G.chat.length) {
    el.innerHTML = `<div class="chat-empty">${escHtml(uiText(isOnlineGame() ? "No messages yet. Say hello!" : "Chat is for online games."))}</div>`;
    return;
  }
  const muted = chatMutedSet();
  let lastMutedUid = "";
  el.innerHTML = G.chat
    .map((m) => {
      // Shown as the player who sent it, not as whatever name the message
      // carries, so nobody can post under someone else's name.
      const seat = m.uid ? (G.players || []).find((p) => p.uid === m.uid || p.reservedUid === m.uid) : null;
      const whoColor = sanitizeColor(seat?.color || m.color, "#ffffff");
      const token = escHtml(String(seat?.token || m.token || "💬"));
      const who = escHtml(seat?.reservedName || seat?.name || m.name || "Player");
      const text = escHtml(m.text || "");
      const other = isOnlineGame() && m.uid && m.uid !== ONLINE.localUid;
      if (other && muted.has(m.uid)) {
        // One line per run of muted messages, with a way back.
        if (lastMutedUid === m.uid) return "";
        lastMutedUid = m.uid;
        return `<div class="chat-msg chat-muted"><button type="button" class="chat-unmute" onclick="toggleChatMute('${escAttr(m.uid)}')">${who} ${escHtml(uiText("is muted · show messages"))}</button></div>`;
      }
      lastMutedUid = "";
      const whoHtml = other
        ? `<button type="button" class="chat-who" style="color:${whoColor}" title="${escAttr(uiText("Mute this player"))}" onclick="toggleChatMute('${escAttr(m.uid)}')">${token} ${who}:</button>`
        : `<span class="chat-who" style="color:${whoColor}">${token} ${who}:</span>`;
      return `<div class="chat-msg">${whoHtml}<span class="chat-text">${text}</span></div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
}

// Players muted in this room's chat, for this browser tab.
function chatMuteKey() {
  return `monopoly_chat_muted_${ONLINE.roomId || "local"}`;
}
function chatMutedSet() {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(chatMuteKey()) || "[]"));
  } catch (_err) {
    return new Set();
  }
}
function toggleChatMute(uid) {
  const set = chatMutedSet();
  const seat = (G.players || []).find((p) => p.uid === uid);
  const name = seat?.name || "This player";
  if (set.has(uid)) {
    set.delete(uid);
    toast(`${name} is no longer muted`, "gold");
  } else {
    set.add(uid);
    toast(`${name} is muted. Tap the line in chat to show them again.`, "gold");
  }
  try {
    sessionStorage.setItem(chatMuteKey(), JSON.stringify([...set]));
  } catch (_err) {}
  renderChatLog();
  const dc = document.getElementById("drawer-chat");
  if (dc) dc.innerHTML = document.getElementById("chat-log")?.innerHTML || "";
}

// An unowned space stores owner === null, and Number(null) is 0 - which would
// silently match player 0. Ownership must be established before comparing.
function isOwnedBy(prop, playerId) {
  if (!prop || prop.owner === null || prop.owner === undefined) return false;
  return Number(prop.owner) === Number(playerId);
}

// Cash plus what everything would fetch if liquidated right now: list price for
// clear title, mortgage value for mortgaged title, half cost back on buildings.
function playerNetWorth(player) {
  if (!player) return 0;
  let total = Number(player.money) || 0;
  (G.properties || []).forEach((prop, id) => {
    if (!prop || !isOwnedBy(prop, player.id)) return;
    const sp = SPACES[id];
    if (!sp) return;
    total += prop.mortgaged
      ? mortgageValueForSpace(sp)
      : Number(sp.price) || 0;
    const houses = prop.hotel ? 5 : Math.max(0, Number(prop.houses) || 0);
    total += Math.floor((Number(sp.house) || 0) / 2) * houses;
  });
  return total;
}

// One pip per colour group the player has a stake in; filled when the set is
// complete and therefore buildable.
function playerGroupProgress(player) {
  if (!player) return [];
  const byGroup = new Map();
  SPACES.forEach((sp, id) => {
    if (!sp || sp.type !== "property") return;
    const g = sp.group;
    if (!byGroup.has(g)) byGroup.set(g, { owned: 0, total: 0, color: sp.color });
    const entry = byGroup.get(g);
    entry.total += 1;
    if (isOwnedBy(G.properties[id], player.id)) entry.owned += 1;
  });
  return [...byGroup.values()]
    .filter((e) => e.owned > 0)
    .map((e) => ({
      color: COLOR[e.color] || "#666",
      complete: e.owned === e.total,
    }));
}

function playerTagsHtml(p) {
  return (
    (isAiPlayer(p) ? '<span class="ptag">AI</span>' : "") +
    (p.bankrupt ? '<span class="ptag out">OUT</span>' : "") +
    (!p.bankrupt && isLowOnCash(p) ? `<span class="ptag low" title="${escAttr(uiText("Could not pay the biggest rent on the board"))}">${escHtml(uiText("Low cash"))}</span>` : "")
  );
}

// Short of the biggest rent another player could charge right now: one
// unlucky roll from having to mortgage or sell.
function isLowOnCash(p) {
  if (!p || !G || !Array.isArray(G.properties)) return false;
  let worst = 0;
  G.properties.forEach((prop, id) => {
    if (!prop || prop.owner === null || prop.owner === undefined || Number(prop.owner) === p.id || prop.mortgaged) return;
    const sp = SPACES[id];
    if (!sp) return;
    const rent = sp.type === "utility" ? 7 * (getThemeUtilityRentMultipliers(G.boardThemeId || selectedThemeId)?.one || 4) : calcRent(sp, prop);
    if (rent > worst) worst = rent;
  });
  return worst > 0 && Number(p.money) < worst;
}

function renderPlayerCards() {
  const el = document.getElementById("player-cards");
  const mobileEl = document.getElementById("mobile-player-strip");
  if (el) el.innerHTML = "";
  if (mobileEl) mobileEl.innerHTML = "";

  G.players.forEach((p, i) => {
    const active = i === G.currentPlayerIdx;
    const bankruptCls = p.bankrupt ? " bankrupt" : "";
    const propDots =
      p.properties
        .map((pid) => {
          const sp = SPACES[pid];
          if (!sp) return "";
          return `<div class="pprop-dot" style="background:${COLOR[sp.color] || "#666"}" title="${escHtml(sp.name)}"></div>`;
        })
        .join("") +
      p.railroads
        .map(
          () =>
            `<div class="pprop-dot" style="background:#333" title="Railroad"></div>`,
        )
        .join("");
    const location = p.inJail ? "In jail" : SPACES[p.pos]?.name || "On board";
    const groupPips = playerGroupProgress(p);

    if (el) {
      const div = document.createElement("div");
      div.className = "pcard" + (active ? " active-turn" : "") + bankruptCls;
      div.innerHTML = `
        <div class="prow1">
          <div class="ptoken" style="color:${sanitizeColor(p.color)}">${escHtml(p.token)}</div>
          <div class="pmain">
            <div class="pname" title="${escHtml(p.name)}"><span class="pname-text">${escHtml(p.name)}</span>${playerTagsHtml(p)}</div>
            <div class="pmoney">${fmtCurrency(p.money)}</div>
          </div>
        </div>
        <div class="ppos">${p.inJail ? "In jail" : escHtml(SPACES[p.pos]?.name || "On board")}</div>
        <div class="pworth">Net worth ${fmtCurrency(playerNetWorth(p))}</div>
        ${
          groupPips.length
            ? `<div class="pgroups">${groupPips
                .map(
                  (g) =>
                    `<div class="pgroup-pip${g.complete ? " complete" : ""}" style="background:${g.color}"></div>`,
                )
                .join("")}</div>`
            : ""
        }
        ${propDots ? `<div class="pprops">${propDots}</div>` : ""}
      `;
      div.title = `Tap to view ${p.name}'s portfolio and money log`;
      div.onclick = () => showPlayerPortfolio(i);
      div.setAttribute("role", "button");
      div.tabIndex = 0;
      div.setAttribute("aria-label", `${p.name}, ${fmtCurrency(p.money)}${active ? ", playing now" : ""}${p.bankrupt ? ", out of the game" : ""}`);
      div.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          showPlayerPortfolio(i);
        }
      };
      el.appendChild(div);
    }

    if (mobileEl) {
      const chip = document.createElement("div");
      chip.className =
        "mobile-player-chip" + (active ? " active-turn" : "") + bankruptCls;
      chip.innerHTML = `
        <div class="mobile-player-main">
          <span class="mobile-player-token" style="color:${sanitizeColor(p.color)}">${escHtml(p.token)}</span>
          <span class="mobile-player-name" title="${escHtml(p.name)}">${escHtml(p.name)}</span>${playerTagsHtml(p)}
        </div>
        <div class="mobile-player-meta"><span class="mobile-player-cash">${fmtCurrency(p.money)}</span> • net ${fmtCurrency(playerNetWorth(p))}</div>
      `;
      chip.title = `Tap to view ${p.name}'s portfolio and money log`;
      chip.onclick = () => showPlayerPortfolio(i);
      chip.setAttribute("role", "button");
      chip.tabIndex = 0;
      chip.setAttribute("aria-label", `${p.name}, ${fmtCurrency(p.money)}${active ? ", playing now" : ""}`);
      mobileEl.appendChild(chip);
    }
  });
  if (typeof trackMoneyFx === "function") trackMoneyFx();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pulseBoardSpace(spaceId, className, duration = 320) {
  const spEl = document.getElementById(`sp${spaceId}`);
  if (!spEl || !className) return;
  spEl.classList.remove(className);
  void spEl.offsetWidth;
  spEl.classList.add(className);
  setTimeout(() => {
    spEl.classList.remove(className);
  }, duration);
}

function animatePropertyPurchase(spaceId) {
  pulseBoardSpace(spaceId, "buy-celebrate", 930);
}

async function playRemoteSnapshotAnimations(prevVisualState, options = {}) {
  if (!isOnlineGame() || !prevVisualState || REMOTE_FX.running) return;
  if (!Array.isArray(G.players) || !G.players.length) return;

  const expectedRevision =
    Number(options.expectedRevision) || Number(ONLINE.revision) || 0;
  const expectedEpoch =
    Number(options.expectedEpoch) || Number(REMOTE_FX.epoch) || 0;
  const shouldAbort = () => {
    if (!isOnlineGame()) return true;
    if (Number(REMOTE_FX.epoch) !== expectedEpoch) return true;
    if (ONLINE.queuedSnapshot) return true;
    return (Number(ONLINE.revision) || 0) !== expectedRevision;
  };

  if (shouldAbort()) return;

  REMOTE_FX.running = true;
  try {
    if (shouldAbort()) return;
    const beforePlayers = Array.isArray(prevVisualState.players)
      ? prevVisualState.players
      : [];
    const localIdx = resolveLocalPlayerIndex();
    let mover = null;

    for (let i = 0; i < G.players.length; i++) {
      if (i === localIdx) continue;
      const before = beforePlayers[i];
      const now = G.players[i];
      if (!before || !now || now.bankrupt) continue;

      const from = before.inJail ? 10 : before.pos;
      const to = now.inJail ? 10 : now.pos;
      const changed = from !== to || !!before.inJail !== !!now.inJail;
      if (!changed) continue;

      const stepsForward = (to - from + 40) % 40;
      mover = {
        id: i,
        from,
        to,
        stepsForward,
        stepAnim: !now.inJail && stepsForward > 0 && stepsForward <= 12,
      };
      break;
    }

    if (shouldAbort()) return;

    if (mover) {
      const liveStart = getLivePlayer(mover.id);
      if (liveStart) {
        const finalPos = liveStart.pos;
        const finalInJail = liveStart.inJail;
        liveStart.inJail = false;
        liveStart.pos = mover.from;
        renderMarkers();

        if (mover.stepAnim) {
          await waitMs(70);
          if (shouldAbort()) return;
          await animatePlayerStepMovement(mover.id, mover.stepsForward, {
            canContinue: () => !shouldAbort(),
          });
        } else {
          pulseBoardSpace(mover.to, "step-arrive", 360);
          await waitMs(220);
        }

        if (shouldAbort()) return;
        const liveEnd = getLivePlayer(mover.id);
        if (liveEnd) {
          liveEnd.pos = finalPos;
          liveEnd.inJail = finalInJail;
          renderMarkers();
        }
      }
    }

    if (shouldAbort()) return;

    const prevOwners = Array.isArray(prevVisualState.owners)
      ? prevVisualState.owners
      : [];
    const bought = [];
    for (let id = 0; id < G.properties.length; id++) {
      const prop = G.properties[id];
      if (!prop || typeof prop !== "object") continue;

      const oldOwner =
        prevOwners[id] === null || prevOwners[id] === undefined
          ? null
          : Number.isInteger(Number(prevOwners[id]))
            ? Number(prevOwners[id])
            : null;
      const newOwner =
        prop.owner === null || prop.owner === undefined
          ? null
          : Number.isInteger(Number(prop.owner))
            ? Number(prop.owner)
            : null;

      if (oldOwner === null && newOwner !== null && newOwner !== localIdx) {
        bought.push(id);
      }
    }

    for (let i = 0; i < bought.length; i++) {
      if (shouldAbort()) return;
      animatePropertyPurchase(bought[i]);
      if (i < bought.length - 1) await waitMs(120);
    }
  } finally {
    REMOTE_FX.running = false;
  }
}

function renderMarkers(hopPlayerId = null) {
  // Remove old markers
  document.querySelectorAll(".pmarker").forEach((m) => m.remove());
  // Group players by position
  const byPos = {};
  G.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const pos = p.inJail ? 10 : p.pos;
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push({ p, i });
  });
  G.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const pos = p.inJail ? 10 : p.pos;
    const spEl = document.getElementById(`sp${pos}`);
    if (!spEl) return;
    const group = byPos[pos];
    const idx = group.findIndex((x) => x.i === i);
    const marker = document.createElement("div");
    marker.className = "pmarker";
    if (i === G.currentPlayerIdx) marker.classList.add("current-turn");
    if (Number.isInteger(hopPlayerId) && i === hopPlayerId)
      marker.classList.add("step-hop");
    marker.id = `pmarker-${i}`;
    marker.textContent = p.token;
    marker.style.background = p.color;
    // Offset multiple players
    const offsets = [
      { top: "6%", left: "6%" },
      { top: "6%", left: "52%" },
      { top: "52%", left: "6%" },
      { top: "52%", left: "52%" },
      { top: "28%", left: "28%" },
      { top: "68%", left: "68%" },
      { top: "68%", left: "10%" },
      { top: "10%", left: "68%" },
    ];
    const off = offsets[idx % offsets.length];
    marker.style.top = off.top;
    marker.style.left = off.left;
    spEl.appendChild(marker);
  });
}

async function animatePlayerStepMovement(player, steps, options = {}) {
  const startPlayer = getLivePlayer(player);
  if (!startPlayer || !Number.isInteger(steps) || steps <= 0) return false;
  const playerId = startPlayer.id;
  const canContinue =
    typeof options.canContinue === "function"
      ? options.canContinue
      : () => true;

  if (!canContinue()) return false;

  MOVE_FX.active = true;
  MOVE_FX.playerId = playerId;
  updateActionButtons();

  try {
    for (let i = 0; i < steps; i++) {
      if (!canContinue()) return false;
      const livePlayer = getLivePlayer(playerId);
      if (!livePlayer || livePlayer.bankrupt) return false;
      livePlayer.pos = ((Number(livePlayer.pos) || 0) + 1) % 40;
      renderMarkers(playerId);
      pulseBoardSpace(
        livePlayer.pos,
        i === steps - 1 ? "step-arrive" : "step-trail",
        i === steps - 1 ? 340 : 240,
      );
      await waitMs(Math.round(180 * (MOVE_SPEED?.factor || 1) * (typeof reduceMotionOn === "function" && reduceMotionOn() ? 0.45 : 1)));
      if (!canContinue()) return false;
    }
  } finally {
    MOVE_FX.active = false;
    MOVE_FX.playerId = null;
    updateActionButtons();
  }

  return true;
}

function renderBoardOwnership() {
  // Clear old dots
  document.querySelectorAll(".own-dot,.bldg-badge").forEach((e) => e.remove());
  document
    .querySelectorAll(".space.owned-by-me,.space.owned-by-other,.space.is-mortgaged")
    .forEach((el) =>
      el.classList.remove("owned-by-me", "owned-by-other", "is-mortgaged"),
    );
  const myIdx = isOnlineGame() ? resolveLocalPlayerIndex() : G.currentPlayerIdx;
  G.properties.forEach((prop, id) => {
    if (!prop || prop.owner === null) return;
    const spEl = document.getElementById(`sp${id}`);
    if (!spEl) return;
    const owner = G.players[prop.owner];
    if (!owner) return;
    // A glance should answer "is this mine, theirs, or dead weight".
    spEl.classList.add(
      Number(prop.owner) === Number(myIdx) ? "owned-by-me" : "owned-by-other",
    );
    if (prop.mortgaged) spEl.classList.add("is-mortgaged");
    spEl.style.setProperty("--own-mine", owner.color || "#2ecc71");

    const dot = document.createElement("div");
    dot.className = "own-dot";
    if (prop.mortgaged) dot.classList.add("mortgaged");
    // Colour alone identifies the owner (it matches their token and panel);
    // the old "PR 3" label was cryptic and covered names on short squares.
    dot.title = `${owner.name}${prop.mortgaged ? " (mortgaged)" : ""}`;
    dot.setAttribute("aria-label", `Owned by ${dot.title}`);
    dot.style.setProperty("--own-color", owner.color || "#334155");
    spEl.appendChild(dot);
    if (prop.houses > 0 || prop.hotel) {
      const badge = document.createElement("div");
      badge.className = "bldg-badge";
      // Drawn on the colour bar like a physical board. The old emoji pill sat
      // in the bottom corner, on top of the price and, on phones, the name.
      badge.innerHTML = prop.hotel
        ? '<i class="bldg-hotel"></i>'
        : '<i class="bldg-house"></i>'.repeat(Math.min(4, prop.houses));
      badge.title = prop.hotel
        ? "Hotel"
        : `${prop.houses} house${prop.houses === 1 ? "" : "s"}`;
      badge.setAttribute("aria-label", badge.title);
      spEl.appendChild(badge);
    }
  });
}

function updateTopBar() {
  const p = curPlayer();
  document.getElementById("tb-token").textContent = p.token;
  document.getElementById("tb-name").textContent =
    `${p.name}${isAiPlayer(p) ? " (AI)" : ""}`;
  document.getElementById("tb-money").textContent = fmtCurrency(p.money);
  if (typeof applyMoneyTweens === "function") applyMoneyTweens();
  const jailTag = document.getElementById("tb-jail-tag");
  jailTag.style.display = p.inJail ? "" : "none";
  const leaveBtn = document.getElementById("leave-game-btn");
  if (leaveBtn)
    leaveBtn.style.display =
      isOnlineGame() && ONLINE.status === "playing" ? "" : "none";
}

function isAiPlayer(player) {
  return !!player && normalizePlayerKind(player.kind) === "ai";
}

function getAiTurnKey() {
  return offlineAiStateKey();
}

function uniqueConnectedRoomUids() {
  const uids = indexedObjectToArray(lobbyPlayers)
    .map((p) => String(p?.uid || ""))
    .filter(Boolean);
  return [...new Set(uids)].sort();
}

function activeOnlineRunnerUid(now = serverNow()) {
  if (!isOnlineGame()) return String(ONLINE.localUid || "");

  const lease =
    ONLINE.aiRunner && typeof ONLINE.aiRunner === "object"
      ? ONLINE.aiRunner
      : null;
  const leaseUid = String(lease?.uid || "");
  const leaseTurnKey = String(lease?.turnKey || "");
  const leaseUntil = Number(lease?.until) || 0;
  if (leaseUid && leaseTurnKey === getAiTurnKey() && leaseUntil > now)
    return leaseUid;

  // Prefer the host only if they're still connected (present in lobbyPlayers)
  const connectedUids = uniqueConnectedRoomUids();
  const host = String(ONLINE.hostUid || "");
  if (host && connectedUids.includes(host)) return host;

  // Fall back to any connected player, then local uid
  return connectedUids[0] || String(ONLINE.localUid || "");
}

function hasValidAiRunnerLease(now = serverNow()) {
  if (!isOnlineGame()) return true;
  const lease =
    ONLINE.aiRunner && typeof ONLINE.aiRunner === "object"
      ? ONLINE.aiRunner
      : null;
  if (!lease) return false;
  if (String(lease.turnKey || "") !== getAiTurnKey()) return false;
  return (Number(lease.until) || 0) > now;
}

async function ensureAiRunnerLease(force = false) {
  if (!isOnlineGame() || !FIREBASE.api || !ONLINE.connected || !ONLINE.localUid)
    return false;

  const now = serverNow();
  // Use a longer debounce (half of lease duration) to prevent rapid steal attempts
  const debounceMs = force ? 150 : Math.floor(AI_RUNNER_LEASE_MS / 2);
  if (
    !force &&
    ONLINE.aiRunnerRequestAt &&
    now - ONLINE.aiRunnerRequestAt < debounceMs
  )
    return false;
  ONLINE.aiRunnerRequestAt = now;

  const turnKey = getAiTurnKey();
  let mine = false;

  try {
    const txResult = await FIREBASE.api.runTransaction(
      getRoomRef(),
      (current) => {
        if (!current || typeof current !== "object") return current;
        if ((current.status || "lobby") !== "playing") return current;

        const raw =
          current.aiRunner && typeof current.aiRunner === "object"
            ? current.aiRunner
            : null;
        const rawUid = String(raw?.uid || "");
        const rawTurnKey = String(raw?.turnKey || "");
        const rawUntil = Number(raw?.until) || 0;
        // Use a small clock-skew buffer (200ms) when checking staleness
        const stale = rawUntil <= now + 200;
        const turnChanged = rawTurnKey !== turnKey;
        // Only take lease if: no owner, turn changed, lease is stale, we already own it, or forced
        // Never steal a valid lease that belongs to a different uid
        const canTake =
          !rawUid ||
          turnChanged ||
          stale ||
          rawUid === ONLINE.localUid ||
          force;

        if (canTake) {
          current.aiRunner = {
            uid: ONLINE.localUid,
            turnKey,
            until: now + AI_RUNNER_LEASE_MS,
          };
          mine = true;
        } else {
          mine = false;
        }

        return current;
      },
    );

    // Try to read the committed state from the transaction result
    let nextData = null;
    try {
      nextData = txResult?.snapshot?.val ? txResult.snapshot.val() : null;
    } catch (_) {}
    const nextRaw =
      nextData?.aiRunner && typeof nextData.aiRunner === "object"
        ? nextData.aiRunner
        : null;
    if (nextRaw) {
      ONLINE.aiRunner = {
        uid: String(nextRaw.uid || ""),
        turnKey: String(nextRaw.turnKey || ""),
        until: Number(nextRaw.until) || 0,
      };
    }
    // If we didn't get a snapshot back but know we won the transaction, set locally
    if (!ONLINE.aiRunner && mine) {
      ONLINE.aiRunner = {
        uid: ONLINE.localUid,
        turnKey,
        until: now + AI_RUNNER_LEASE_MS,
      };
    }
  } catch (err) {
    console.error(err);
    // Fallback: if transaction failed but we intended to take it, set optimistically
    if (mine) {
      ONLINE.aiRunner = {
        uid: ONLINE.localUid,
        turnKey,
        until: now + AI_RUNNER_LEASE_MS,
      };
    }
  }

  const lease = ONLINE.aiRunner;
  return (
    !!lease &&
    String(lease.uid || "") === String(ONLINE.localUid || "") &&
    String(lease.turnKey || "") === turnKey &&
    (Number(lease.until) || 0) > serverNow()
  );
}

function canRunAiController(now = serverNow()) {
  if (!isOnlineGame()) return true;
  if (!ONLINE.localUid) return false;
  if (!hasValidAiRunnerLease(now)) return false;
  return String(ONLINE.aiRunner?.uid || "") === String(ONLINE.localUid || "");
}

// Two different questions, previously conflated:
//   shouldAutoActForAi - may THIS client compute the AI's move? (needs the lease)
//   isAiSeat           - is this seat AI-controlled at all?      (lease-agnostic)
// Every modal decision belongs to the second. Using the first meant a lease that
// lapsed mid-turn popped the AI's buy/card/jail dialog onto a human's screen.
function shouldAutoActForAi(player) {
  return !!player && isAiPlayer(player) && canRunAiController();
}

function isAiSeat(player) {
  return isAiPlayer(player);
}

function isOfflineAiAuctionTurn() {
  if (!G || !G.auctionState || !Array.isArray(G.players)) return false;
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return false;
  const bidder = G.players[bidderId];
  return isAiPlayer(bidder) && !bidder.bankrupt;
}

function clearOfflineAiTimer(resetKey = false) {
  if (AI_CTRL.timerId) {
    clearTimeout(AI_CTRL.timerId);
    AI_CTRL.timerId = null;
  }
  if (resetKey) AI_CTRL.lastKey = "";
}

function offlineAiStateKey() {
  if (!G || !Array.isArray(G.players) || !G.players.length) return "";
  const current = curPlayer();
  const bidderId = currentAuctionBidderId();
  const auctionPart = G.auctionState
    ? `${G.auctionState.propId}:${bidderId}:${Number(G.auctionState.currentBid) || 0}`
    : "no-auction";
  const tradePart = G.pendingTrade
    ? `${G.pendingTrade.id || "trade"}:${G.pendingTrade.fromId}:${G.pendingTrade.toId}`
    : "no-trade";
  const debtRaw =
    G.debtPrompt &&
    typeof G.debtPrompt === "object" &&
    G.debtPrompt.active !== false
      ? G.debtPrompt
      : null;
  const debtPart = debtRaw
    ? [
        Number.isInteger(Number(debtRaw.payerId))
          ? Number(debtRaw.payerId)
          : "na",
        Math.max(0, Number(debtRaw.amount) || 0),
        Number.isInteger(Number(debtRaw.recipientId))
          ? Number(debtRaw.recipientId)
          : "bank",
        debtRaw.toParking ? 1 : 0,
      ].join(":")
    : "no-debt";
  return [
    G.currentPlayerIdx,
    current?.kind || "human",
    G.phase,
    G.pendingBuy === null ? "no-buy" : G.pendingBuy,
    auctionPart,
    tradePart,
    debtPart,
    current?.inJail ? 1 : 0,
    current?.bankrupt ? 1 : 0,
  ].join("|");
}

function estimateAssetValue(spaceId) {
  const sp = SPACES[spaceId];
  if (!sp) return 0;
  const price = Number(sp.price) || 0;
  if (price > 0) return price;
  return Math.max(0, Math.floor(mortgageValueForSpace(sp) * 2));
}

function aiEconomyScale(themeId = G?.boardThemeId || selectedThemeId) {
  const goSalary = getThemeGoSalary(themeId);
  if (!Number.isFinite(goSalary) || goSalary <= 0) return 1;
  return Math.max(0.1, goSalary / 2000);
}

function aiCashReserve(player) {
  const scale = aiEconomyScale();
  if (!player) return Math.floor(1500 * scale);
  const owned =
    (player.properties?.length || 0) +
    (player.railroads?.length || 0) +
    (player.utilities?.length || 0);
  const floorReserve = Math.max(120, Math.floor(1500 * scale));
  const dynamicReserve = Math.floor((900 + owned * 180) * scale);
  // Easy keeps a fat cushion and so builds and bids less; hard plays lean.
  const level = aiLevel();
  const factor = level === "easy" ? 1.25 : level === "hard" ? 0.75 : 1;
  return Math.floor(Math.max(floorReserve, dynamicReserve) * factor);
}

// Rent a colour set could earn once built to three houses, the level where
// rent jumps. Used to price handing a set to an opponent.
function aiSetDangerValue(groupIds, ownerCash) {
  const houseCost = groupIds.reduce((sum, id) => sum + (Number(SPACES[id]?.house) || 0), 0);
  const rentAt3 = groupIds.reduce((sum, id) => sum + (Number(SPACES[id]?.rent?.[3]) || 0), 0);
  // An opponent who cannot afford houses is less dangerous for a while.
  const canBuild = houseCost > 0 ? Math.min(1, Math.max(0.35, ownerCash / (houseCost * 3))) : 1;
  return Math.floor(rentAt3 * 1.5 * canBuild);
}

// Groups that `playerId` would complete (own entirely) only after the trade.
function aiGroupsCompletedByTrade(trade, playerId) {
  const overrides = aiTradeOwnerOverrides(trade);
  const touched = new Set();
  [...(trade.fromProps || []), ...(trade.toProps || [])].forEach((id) => {
    const sp = SPACES[Number(id)];
    if (sp && sp.type === "property") touched.add(sp.group);
  });
  const out = [];
  touched.forEach((group) => {
    const ids = SPACES.filter((s) => s.type === "property" && s.group === group).map((s) => s.id);
    if (!aiPlayerOwnsFullGroup(playerId, ids) && aiPlayerOwnsFullGroup(playerId, ids, overrides)) out.push(ids);
  });
  return out;
}

function aiPropertyGroupIds(spaceId) {
  const sp = SPACES[spaceId];
  if (!sp || sp.type !== "property") return [];
  return SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
}

function aiOwnerForSpace(spaceId, ownerOverrides = null) {
  if (ownerOverrides instanceof Map && ownerOverrides.has(spaceId)) {
    return ownerOverrides.get(spaceId);
  }
  const prop = G?.properties?.[spaceId];
  return prop ? prop.owner : null;
}

function aiCountGroupOwnedByPlayer(playerId, groupIds, ownerOverrides = null) {
  if (!Number.isInteger(playerId) || !Array.isArray(groupIds)) return 0;
  return groupIds.filter(
    (id) => aiOwnerForSpace(id, ownerOverrides) === playerId,
  ).length;
}

function aiPlayerOwnsFullGroup(playerId, groupIds, ownerOverrides = null) {
  if (
    !Number.isInteger(playerId) ||
    !Array.isArray(groupIds) ||
    !groupIds.length
  )
    return false;
  return groupIds.every(
    (id) => aiOwnerForSpace(id, ownerOverrides) === playerId,
  );
}

function aiCountOpponentMonopolyThreats(
  spaceId,
  excludedPlayerId = null,
  candidatePlayerIds = null,
  ownerOverrides = null,
) {
  const groupIds = aiPropertyGroupIds(spaceId);
  if (!groupIds.length) return 0;
  const ownerNow = aiOwnerForSpace(spaceId, ownerOverrides);
  const eligibleIds = Array.isArray(candidatePlayerIds)
    ? candidatePlayerIds
    : Array.isArray(G?.players)
      ? G.players.filter((p) => p && !p.bankrupt).map((p) => p.id)
      : [];

  let threats = 0;
  eligibleIds.forEach((pidRaw) => {
    const pid = Number(pidRaw);
    if (!Number.isInteger(pid)) return;
    if (Number.isInteger(excludedPlayerId) && pid === excludedPlayerId) return;
    if (ownerNow === pid) return;
    const owned = aiCountGroupOwnedByPlayer(pid, groupIds, ownerOverrides);
    if (owned === groupIds.length - 1) threats++;
  });

  return threats;
}

function aiEvaluateTradeGroupSwing(trade, aiPlayerId) {
  const base = {
    aiMonopoliesGained: 0,
    aiMonopoliesLost: 0,
    oppMonopoliesGained: 0,
    oppMonopoliesLost: 0,
    aiProgressDelta: 0,
    oppProgressDelta: 0,
  };
  if (!trade || !Number.isInteger(aiPlayerId)) return { ...base };

  const fromId = Number(trade.fromId);
  const toId = Number(trade.toId);
  const opponentId = aiPlayerId === fromId ? toId : fromId;
  if (!Number.isInteger(opponentId)) return { ...base };

  const ownerOverrides = new Map();
  (trade.fromProps || []).forEach((idRaw) => {
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return;
    ownerOverrides.set(id, toId);
  });
  (trade.toProps || []).forEach((idRaw) => {
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return;
    ownerOverrides.set(id, fromId);
  });

  const affectedGroups = new Set();
  [...(trade.fromProps || []), ...(trade.toProps || [])].forEach((idRaw) => {
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return;
    const sp = SPACES[id];
    if (sp && sp.type === "property") affectedGroups.add(sp.group);
  });

  const result = { ...base };
  affectedGroups.forEach((group) => {
    const groupIds = SPACES.filter(
      (s) => s.type === "property" && s.group === group,
    ).map((s) => s.id);
    if (!groupIds.length) return;

    const aiBefore = aiPlayerOwnsFullGroup(aiPlayerId, groupIds);
    const aiAfter = aiPlayerOwnsFullGroup(aiPlayerId, groupIds, ownerOverrides);
    if (aiAfter && !aiBefore) result.aiMonopoliesGained++;
    if (!aiAfter && aiBefore) result.aiMonopoliesLost++;

    const oppBefore = aiPlayerOwnsFullGroup(opponentId, groupIds);
    const oppAfter = aiPlayerOwnsFullGroup(opponentId, groupIds, ownerOverrides);
    if (oppAfter && !oppBefore) result.oppMonopoliesGained++;
    if (!oppAfter && oppBefore) result.oppMonopoliesLost++;

    const aiOwnedBefore = aiCountGroupOwnedByPlayer(aiPlayerId, groupIds);
    const aiOwnedAfter = aiCountGroupOwnedByPlayer(
      aiPlayerId,
      groupIds,
      ownerOverrides,
    );
    const oppOwnedBefore = aiCountGroupOwnedByPlayer(opponentId, groupIds);
    const oppOwnedAfter = aiCountGroupOwnedByPlayer(
      opponentId,
      groupIds,
      ownerOverrides,
    );
    result.aiProgressDelta += (aiOwnedAfter - aiOwnedBefore) / groupIds.length;
    result.oppProgressDelta +=
      (oppOwnedAfter - oppOwnedBefore) / groupIds.length;
  });

  return result;
}

// What everything `playerId` holds is worth to them under an ownership map.
// Set synergy is priced in, so completing a colour group (or breaking one) moves
// the number far more than the cards' list prices alone.
function aiPortfolioValue(playerId, ownerOverrides = null) {
  if (!Number.isInteger(playerId)) return 0;
  let total = 0;
  let railroads = 0;
  let utilities = 0;
  const groups = new Map();

  SPACES.forEach((sp) => {
    if (!sp || !G.properties?.[sp.id]) return;
    if (!["property", "railroad", "utility"].includes(sp.type)) return;
    const price = Number(sp.price) || estimateAssetValue(sp.id);
    if (sp.type === "property") {
      if (!groups.has(sp.group)) groups.set(sp.group, { n: 0, k: 0, sum: 0 });
      const g = groups.get(sp.group);
      g.n++;
      g.sum += price;
      if (aiOwnerForSpace(sp.id, ownerOverrides) !== playerId) return;
      g.k++;
    } else if (aiOwnerForSpace(sp.id, ownerOverrides) !== playerId) {
      return;
    } else if (sp.type === "railroad") {
      railroads++;
    } else {
      utilities++;
    }
    total += price;
    // A mortgaged card still has to be bought back before it earns.
    if (G.properties[sp.id].mortgaged) {
      total -= Math.floor(mortgageValueForSpace(sp) * 1.1);
    }
  });

  groups.forEach((g) => {
    if (!g.k) return;
    if (g.k === g.n) total += Math.floor(g.sum * 1.6);
    else if (g.k === g.n - 1) total += Math.floor(g.sum * (g.n >= 3 ? 0.3 : 0.1));
  });

  const scale = aiEconomyScale();
  if (railroads > 1) total += Math.floor((railroads - 1) * 600 * scale);
  if (utilities > 1) total += Math.floor(350 * scale);
  return total;
}

function aiTradeOwnerOverrides(trade) {
  const overrides = new Map();
  (trade.fromProps || []).forEach((id) =>
    overrides.set(Number(id), Number(trade.toId)),
  );
  (trade.toProps || []).forEach((id) =>
    overrides.set(Number(id), Number(trade.fromId)),
  );
  return overrides;
}

function aiMortgageInterestOn(propIds) {
  return (propIds || []).reduce((sum, id) => {
    if (!G.properties[id]?.mortgaged) return sum;
    return sum + Math.ceil(mortgageValueForSpace(SPACES[id]) * 0.1);
  }, 0);
}

// How a trade looks from `playerId`'s side: their own gain, the counterparty's
// gain, and the bar their gain has to clear. `accept` means the deal is fair or
// better for them without handing the other side much more than they get.
function aiTradeTerms(trade, playerId) {
  const fromId = Number(trade.fromId);
  const toId = Number(trade.toId);
  const otherId = playerId === fromId ? toId : fromId;
  const me = G.players[playerId];
  const overrides = aiTradeOwnerOverrides(trade);
  const fromMoney = Math.max(0, Number(trade.fromMoney) || 0);
  const toMoney = Math.max(0, Number(trade.toMoney) || 0);
  const iAmFrom = playerId === fromId;
  const cashIn = iAmFrom ? toMoney : fromMoney;
  const cashOut = iAmFrom ? fromMoney : toMoney;
  const myInterest = aiMortgageInterestOn(
    iAmFrom ? trade.toProps : trade.fromProps,
  );
  const otherInterest = aiMortgageInterestOn(
    iAmFrom ? trade.fromProps : trade.toProps,
  );

  const reserve = aiCashReserve(me);
  const critical = (me?.money || 0) < Math.floor(reserve * 0.24);
  const netCash = cashIn - cashOut;
  // A Get Out of Jail Free card is worth a bit less than the bail it saves.
  const cardValue = Math.floor(getThemeJailBail(G.boardThemeId || selectedThemeId) * 0.8);
  const cardsIn = Math.max(0, Number(iAmFrom ? trade.toCards : trade.fromCards) || 0);
  const cardsOut = Math.max(0, Number(iAmFrom ? trade.fromCards : trade.toCards) || 0);
  const netCards = (cardsIn - cardsOut) * cardValue;
  // When broke, cash in hand is worth more than cards.
  const cashWeight = critical && netCash > 0 ? 1.3 : 1;

  const assetGain =
    aiPortfolioValue(playerId, overrides) - aiPortfolioValue(playerId);
  const otherAssetGain =
    aiPortfolioValue(otherId, overrides) - aiPortfolioValue(otherId);
  const gain = assetGain + Math.floor(netCash * cashWeight) + netCards - myInterest;
  let otherGain = otherAssetGain - netCash - netCards - otherInterest;

  const swing = aiEvaluateTradeGroupSwing(trade, playerId);
  const level = aiLevel();
  // Handing an opponent a full set without getting one back is the dangerous
  // case: their gain counts for more, and on normal and hard the rent that
  // set could earn is added on top, so a set can't be bought cheaply.
  const handsOverSet = swing.oppMonopoliesGained > swing.aiMonopoliesGained && !critical;
  if (handsOverSet && level !== "easy") {
    const other = G.players[otherId];
    const otherCashAfter = Math.max(0, (other?.money || 0) - netCash);
    aiGroupsCompletedByTrade(trade, otherId).forEach((ids) => {
      otherGain += aiSetDangerValue(ids, otherCashAfter);
    });
  }
  const alpha = handsOverSet
    ? level === "hard" ? 1.25 : level === "easy" ? 0.6 : 1
    : 0.5;
  const margin = Math.floor((level === "easy" ? 60 : 120) * aiEconomyScale());
  const listPrice = (ids) =>
    (ids || []).reduce((sum, id) => sum + estimateAssetValue(Number(id)), 0);
  const listDelta = iAmFrom
    ? listPrice(trade.toProps) - listPrice(trade.fromProps)
    : listPrice(trade.fromProps) - listPrice(trade.toProps);
  // Only dip deep into the reserve for set value. Buying a lone card on the
  // cheap and then dumping it back to raise cash is just churn.
  const hasSetValue = assetGain - listDelta > margin;
  const moneyAfter = (me?.money || 0) + netCash - myInterest;
  const affordable =
    cashOut <= 0 ||
    moneyAfter >= Math.floor(reserve * (hasSetValue ? 0.25 : 0.6));

  return {
    gain,
    otherGain,
    assetGain,
    otherAssetGain,
    alpha,
    margin,
    accept: affordable && gain >= margin && gain >= alpha * otherGain + margin,
  };
}

// The AI's answer to an offer made to it. On top of the value test, every
// offer it has already turned down from the same player this turn makes it
// firmer, and a small random demand means its exact limit can't be found by
// lowering the cash one step at a time.
function aiAcceptsOffer(trade, recipient) {
  const terms = aiTradeTerms(trade, recipient.id);
  if (!AI_CTRL.haggle || AI_CTRL.haggle.turn !== G.turnCount) AI_CTRL.haggle = { turn: G.turnCount, tries: {} };
  const key = `${Number(trade.fromId)}>${recipient.id}`;
  const tries = Number(AI_CTRL.haggle.tries[key]) || 0;
  const extra = Math.floor(terms.margin * (0.6 * tries + Math.random() * 0.5));
  const ok = terms.accept && terms.gain >= terms.alpha * terms.otherGain + terms.margin + extra;
  if (!ok) AI_CTRL.haggle.tries[key] = tries + 1;
  return ok;
}

function aiTradeMemoryForPlayer(playerId) {
  if (!Number.isInteger(playerId)) return null;
  if (!AI_CTRL.tradeByPlayer || typeof AI_CTRL.tradeByPlayer !== "object") {
    AI_CTRL.tradeByPlayer = {};
  }
  const key = String(playerId);
  if (
    !AI_CTRL.tradeByPlayer[key] ||
    typeof AI_CTRL.tradeByPlayer[key] !== "object"
  ) {
    AI_CTRL.tradeByPlayer[key] = {
      lastOfferKey: "",
      sameOfferCount: 0,
      declineStreak: 0,
      cooldownMoves: 0,
      lastCooldownTickTurnKey: "",
      lastCooldownBlockTurnKey: "",
    };
  }
  return AI_CTRL.tradeByPlayer[key];
}

function aiTradeOfferSignature({
  fromId,
  toId,
  fromProps = [],
  toProps = [],
  fromMoney = 0,
  toMoney = 0,
} = {}) {
  const normProps = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((id) => Number(id))
      .filter(Number.isInteger)
      .sort((a, b) => a - b)
      .join(".");
  return [
    Number(fromId),
    Number(toId),
    normProps(fromProps),
    normProps(toProps),
    Math.max(0, Number(fromMoney) || 0),
    Math.max(0, Number(toMoney) || 0),
  ].join("|");
}

function aiCanProposeTradeOffer(memory, offerKey) {
  if (!memory || !offerKey) return true;
  return !(
    memory.lastOfferKey === offerKey &&
    memory.sameOfferCount >= AI_TRADE_SAME_OFFER_LIMIT
  );
}

function aiRecordTradeProposal(memory, offerKey) {
  if (!memory || !offerKey) return;
  if (memory.lastOfferKey === offerKey) {
    memory.sameOfferCount = (Number(memory.sameOfferCount) || 0) + 1;
  } else {
    memory.lastOfferKey = offerKey;
    memory.sameOfferCount = 1;
  }
  memory.lastCooldownBlockTurnKey = "";
}

function aiShouldSkipTradeProposalsThisTurn(memory, turnKey) {
  if (!memory) return false;
  if (memory.lastCooldownBlockTurnKey === turnKey) return true;
  if ((Number(memory.cooldownMoves) || 0) > 0) {
    if (memory.lastCooldownTickTurnKey !== turnKey) {
      memory.cooldownMoves = Math.max(
        0,
        (Number(memory.cooldownMoves) || 0) - 1,
      );
      memory.lastCooldownTickTurnKey = turnKey;
    }
    memory.lastCooldownBlockTurnKey = turnKey;
    return true;
  }
  return false;
}

function aiRecordTradeResolution(trade, accepted) {
  if (!trade) return;
  const proposerId = Number(trade.fromId);
  if (!Number.isInteger(proposerId)) return;
  const proposer = G.players?.[proposerId];
  if (!isAiPlayer(proposer)) return;

  const memory = aiTradeMemoryForPlayer(proposerId);
  if (!memory) return;

  if (accepted) {
    memory.declineStreak = 0;
    memory.cooldownMoves = 0;
    memory.lastCooldownTickTurnKey = "";
    memory.lastCooldownBlockTurnKey = "";
    return;
  }

  memory.declineStreak = (Number(memory.declineStreak) || 0) + 1;
  if (memory.declineStreak >= AI_TRADE_DECLINE_STREAK_COOLDOWN) {
    memory.cooldownMoves = Math.max(
      Number(memory.cooldownMoves) || 0,
      AI_TRADE_PROPOSAL_COOLDOWN_MOVES,
    );
    memory.declineStreak = 0;
    memory.lastCooldownTickTurnKey = "";
    memory.lastCooldownBlockTurnKey = "";
  }
}

// Early on, getting out to buy property is worth the bail. Late in the game,
// with opponents' sets built up, jail is the safest square on the board, so
// normal and hard stay and roll until the third turn forces them out.
function aiShouldLeaveJailEarly(p, bailAmount) {
  const level = aiLevel();
  if (level === "easy") {
    return p.jailTurns >= 2 || (p.money >= bailAmount * 6 && Math.random() < 0.55);
  }
  const unowned = SPACES.filter(
    (s) => ["property", "railroad", "utility"].includes(s.type) && G.properties[s.id] && G.properties[s.id].owner === null,
  ).length;
  const danger = SPACES.filter((s) => {
    const pr = G.properties[s.id];
    return pr && pr.owner !== null && pr.owner !== p.id && (pr.hotel || pr.houses >= (level === "hard" ? 2 : 3));
  }).length;
  if (danger >= 3) return false;
  if (p.jailFreeCards > 0) return unowned >= 4;
  return unowned >= 6 && p.money >= bailAmount * 3;
}

function aiPropertyPriority(player, spaceId) {
  const sp = SPACES[spaceId];
  if (!sp || !player) return 0;
  const price = Number(sp.price) || estimateAssetValue(spaceId);
  let score = price;

  if (sp.type === "property") {
    const groupIds = aiPropertyGroupIds(spaceId);
    const groupSize = groupIds.length || 1;
    const ownedNow = aiCountGroupOwnedByPlayer(player.id, groupIds);
    const wouldGainControl = aiOwnerForSpace(spaceId) !== player.id;
    const ownedAfter = Math.min(
      groupSize,
      ownedNow + (wouldGainControl ? 1 : 0),
    );

    if (ownedAfter >= groupSize) {
      score += Math.floor(price * 1.35);
    } else if (ownedAfter === groupSize - 1) {
      score += Math.floor(price * 0.62);
    } else if (ownedAfter > 1) {
      score += Math.floor(price * 0.22 * (ownedAfter - 1));
    }

    score += Math.floor((ownedAfter / groupSize) * price * 0.34);

    const threatCount = aiCountOpponentMonopolyThreats(spaceId, player.id);
    if (threatCount > 0) {
      score += Math.floor(
        price * (0.45 + 0.12 * Math.min(2, threatCount - 1)),
      );
    }
  } else if (sp.type === "railroad") {
    score += (player.railroads?.length || 0) * 700;
  } else if (sp.type === "utility") {
    score += (player.utilities?.length || 0) * 450;
  }

  return score;
}

// Assets the AI can mortgage without hurting itself: never a property from a
// colour set it owns outright (that would stop it building there). Cheapest
// first, so it gives up as little rent as possible.
function aiSpareMortgageAssets(player) {
  if (!player) return [];
  return [...player.properties, ...player.railroads, ...player.utilities]
    .filter((id) => canMortgageAsset(player, id))
    .filter((id) => SPACES[id]?.type !== "property" || !aiPlayerOwnsFullGroup(player.id, aiPropertyGroupIds(id)))
    .sort((a, b) => mortgageValueForSpace(SPACES[a]) - mortgageValueForSpace(SPACES[b]));
}

// Cash the AI could raise from spare mortgages.
function aiSpareMortgageValue(player) {
  return aiSpareMortgageAssets(player).reduce((sum, id) => sum + mortgageValueForSpace(SPACES[id]), 0);
}

function aiTryMortgageToTarget(player, targetCash) {
  if (!player || player.bankrupt || player.money >= targetCash) return false;

  const assets = aiSpareMortgageAssets(player);

  if (!assets.length) return false;
  const id = assets[0];
  const sp = SPACES[id];
  const prop = G.properties[id];
  if (!sp || !prop || prop.owner !== player.id || prop.mortgaged) return false;
  const mortgageValue = mortgageValueForSpace(sp);
  prop.mortgaged = true;
  player.money += mortgageValue;
  playSfx("mortgage");
  addLog(
    `${player.name} mortgaged ${sp.name} for ${fmtCurrency(mortgageValue)}.`,
    "important",
  );
  renderAll();
  updateTopBar();
  return true;
}

function aiTryUnmortgage(player) {
  if (!player || player.bankrupt) return false;

  const reserve = aiCashReserve(player);
  const flexibleReserve = Math.floor(reserve * 0.6);
  const mortgaged = [
    ...player.properties,
    ...player.railroads,
    ...player.utilities,
  ]
    .filter((id) => {
      const prop = G.properties[id];
      return prop && prop.owner === player.id && prop.mortgaged;
    })
    .sort((a, b) => {
      const inSet = (id) => {
        const ids = aiPropertyGroupIds(id);
        return ids.length && aiPlayerOwnsFullGroup(player.id, ids) ? 1 : 0;
      };
      const aCost = unmortgageCostFor(player, a);
      const bCost = unmortgageCostFor(player, b);
      return inSet(b) - inSet(a) || aCost - bCost;
    });

  for (let i = 0; i < mortgaged.length; i++) {
    const id = mortgaged[i];
    const sp = SPACES[id];
    const prop = G.properties[id];
    const cost = unmortgageCostFor(player, id);
    if (!prop || player.money - cost < flexibleReserve) continue;
    prop.mortgaged = false;
    clearFreshMortgage(id);
    player.money -= cost;
    playSfx("unmortgage");
    addLog(
      `${player.name} unmortgaged ${sp.name} for ${fmtCurrency(cost)}.`,
      "important",
    );
    renderAll();
    updateTopBar();
    return true;
  }

  return false;
}

function aiTryBuildOne(player) {
  if (
    !player ||
    player.bankrupt ||
    hasPendingBuy() ||
    G.auctionState ||
    G.pendingTrade
  )
    return false;

  const groups = buildableGroups(player);
  if (!groups.length) return false;
  const level = aiLevel();
  // Money kept back after building. Three houses is where rent jumps, so
  // normal and hard dig deeper into the reserve to get there.
  const reserve = Math.floor(aiCashReserve(player) * (level === "easy" ? 1.1 : level === "hard" ? 0.45 : 0.7));
  const maxHouses = level === "easy" ? 2 : 5;

  let best = null;
  groups.forEach((ids) => {
    if (ids.some((id) => G.properties[id]?.mortgaged)) return;
    ids.forEach((id) => {
      const sp = SPACES[id];
      const prop = G.properties[id];
      if (!sp || !prop || prop.owner !== player.id || prop.hotel) return;
      if (prop.houses >= maxHouses) return;
      const cost = Number(sp.house) || 0;
      if (cost <= 0) return;
      if (player.money - cost < reserve) return;
      // Respect the same rules the human is held to, or buildHouse rejects the
      // pick and the AI retries the identical move forever.
      if (!canBuildEvenly(id)) return;
      if (prop.houses >= 4 ? hotelsAvailable() <= 0 : housesAvailable() <= 0)
        return;

      const currentRent =
        prop.houses > 0 ? sp.rent[prop.houses] || 0 : sp.rent[0] || 0;
      const nextRent =
        prop.houses >= 4
          ? sp.rent[5] || currentRent
          : sp.rent[prop.houses + 1] || currentRent;
      const toThree = prop.houses < 3 ? 1.5 : 1;
      const score = (nextRent - currentRent) * toThree + (4 - prop.houses) * 25;
      if (!best || score > best.score) {
        best = { id, score };
      }
    });
  });

  if (!best) return false;
  buildHouse(best.id);
  return true;
}

function aiTryProposeTrade(player) {
  if (
    !player ||
    player.bankrupt ||
    !canRunAiController() ||
    G.pendingTrade ||
    G.auctionState ||
    hasPendingBuy()
  )
    return false;

  const turnKey = `${player.id}|${player.pos}|${G.phase}|${G.dice?.join("-") || "0-0"}`;
  if (AI_CTRL.lastTradeAttemptKey === turnKey) return false;
  AI_CTRL.lastTradeAttemptKey = turnKey;
  const tradeMemory = aiTradeMemoryForPlayer(player.id);
  if (aiShouldSkipTradeProposalsThisTurn(tradeMemory, turnKey)) return false;

  const reserve = aiCashReserve(player);
  let bestOffer = null;

  const tradable = (p) =>
    [...p.properties, ...p.railroads, ...p.utilities].filter(
      (id) =>
        G.properties[id]?.owner === p.id && !tradeAssetBuildingBlockReason(id),
    );
  const myAssets = tradable(player);

  const considerOffer = (owner, giveIds, takeIds) => {
    const base = {
      fromId: player.id,
      toId: owner.id,
      fromProps: giveIds,
      toProps: takeIds,
      fromMoney: 0,
      toMoney: 0,
    };
    // Price the cash so the deal just clears the recipient's own bar.
    const r0 = aiTradeTerms(base, owner.id);
    const need = Math.max(
      r0.margin - r0.gain,
      (r0.alpha * r0.otherGain + r0.margin - r0.gain) / (1 + r0.alpha),
    );
    let cash = Math.ceil(need / 10) * 10;
    if (cash < 0) {
      const ownerSpare = Math.max(
        0,
        owner.money - Math.floor(aiCashReserve(owner) * 0.25),
      );
      cash = -Math.min(-cash, Math.floor(ownerSpare / 10) * 10);
    }
    // Don't spend down into the range where we'd have to sell something back.
    if (cash > 0 && player.money - cash < Math.floor(reserve * 0.6)) return;
    const offer = {
      ...base,
      fromMoney: Math.max(0, cash),
      toMoney: Math.max(0, -cash),
    };
    if (!aiTradeTerms(offer, owner.id).accept) return;
    const mine = aiTradeTerms(offer, player.id);
    if (!mine.accept) return;
    const offerKey = aiTradeOfferSignature(offer);
    if (!aiCanProposeTradeOffer(tradeMemory, offerKey)) return;
    if (!bestOffer || mine.gain > bestOffer.score) {
      bestOffer = { offer, score: mine.gain, offerKey };
    }
  };

  const level = aiLevel();
  // Cards to offer: the least valuable few, so combinations stay cheap to try.
  const giveable = [...myAssets]
    .sort((a, b) => estimateAssetValue(a) - estimateAssetValue(b))
    .slice(0, level === "hard" ? 7 : 5);
  const givePairs = [];
  for (let i = 0; i < giveable.length; i++)
    for (let j = i + 1; j < giveable.length; j++) givePairs.push([giveable[i], giveable[j]]);

  // Easy never proposes swaps; it only answers them (and still sells a card
  // for cash when broke, below).
  G.players.forEach((owner) => {
    if (level === "easy" || !owner || owner.bankrupt || owner.id === player.id) return;
    const theirs = tradable(owner);
    // Single cards, plus pairs from one colour group, which is how a set
    // missing two pieces held by one player gets completed.
    const takeSets = theirs.map((id) => [id]);
    for (let i = 0; i < theirs.length; i++)
      for (let j = i + 1; j < theirs.length; j++) {
        const a = SPACES[theirs[i]];
        const b = SPACES[theirs[j]];
        if (a?.type === "property" && b?.type === "property" && a.group === b.group) takeSets.push([theirs[i], theirs[j]]);
      }
    takeSets.forEach((take) => {
      considerOffer(owner, [], take);
      myAssets.forEach((giveId) => considerOffer(owner, [giveId], take));
      givePairs.forEach((pair) => considerOffer(owner, pair, take));
    });
  });

  if (bestOffer) {
    const target = G.players[bestOffer.offer.toId];
    aiRecordTradeProposal(tradeMemory, bestOffer.offerKey);
    G.pendingTrade = {
      id: `tr_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ...bestOffer.offer,
      createdAt: Date.now(),
    };
    tradeReviewShownKey = "";
    addLog(`${player.name} proposed a trade to ${target.name}.`, "important");
    renderAll();
    updateActionButtons();
    return true;
  }

  // If low on cash, try selling a low-impact asset for quick liquidity.
  if (player.money < Math.floor(reserve * 0.6)) {
    const myAssets = [
      ...player.properties,
      ...player.railroads,
      ...player.utilities,
    ]
      .filter((id) => {
        const prop = G.properties[id];
        return (
          prop &&
          prop.owner === player.id &&
          !prop.mortgaged &&
          !tradeAssetBuildingBlockReason(id)
        );
      })
      .sort((a, b) => estimateAssetValue(a) - estimateAssetValue(b));

    const buyers = G.players
      .filter((op) => op.id !== player.id && !op.bankrupt)
      .sort((a, b) => b.money - a.money);

    if (myAssets.length && buyers.length) {
      const severeStress = player.money < Math.floor(reserve * 0.25);
      let bestLiquidation = null;

      myAssets.forEach((propId) => {
        buyers.forEach((buyer) => {
          if (!buyer || buyer.money <= 0) return;
          // A round number, as a person would ask: 2,184 becomes 2,100.
          const rawAsk = Math.min(
            buyer.money,
            Math.max(Math.floor(350 * aiEconomyScale()), Math.floor(estimateAssetValue(propId) * 0.78)),
          );
          const step = Math.max(1, 10 ** Math.floor(Math.log10(Math.max(10, rawAsk)) - 1));
          const ask = Math.floor(rawAsk / step) * step;
          if (ask <= 0) return;

          const swing = aiEvaluateTradeGroupSwing(
            {
              fromId: player.id,
              toId: buyer.id,
              fromProps: [propId],
              toProps: [],
            },
            player.id,
          );
          const createsOpponentMonopoly = swing.oppMonopoliesGained > 0;
          const breaksMyMonopoly = swing.aiMonopoliesLost > 0;
          if (!severeStress && (createsOpponentMonopoly || breaksMyMonopoly))
            return;

          const offerKey = aiTradeOfferSignature({
            fromId: player.id,
            toId: buyer.id,
            fromProps: [propId],
            toProps: [],
            fromMoney: 0,
            toMoney: ask,
          });
          if (!aiCanProposeTradeOffer(tradeMemory, offerKey)) return;

          const liquidationScore =
            ask -
            Math.floor(estimateAssetValue(propId) * 0.7) -
            swing.oppMonopoliesGained * Math.floor(900 * aiEconomyScale()) -
            swing.aiMonopoliesLost * Math.floor(1200 * aiEconomyScale()) +
            (severeStress ? ask : 0);

          if (!bestLiquidation || liquidationScore > bestLiquidation.score) {
            bestLiquidation = {
              propId,
              buyerId: buyer.id,
              ask,
              score: liquidationScore,
              offerKey,
            };
          }
        });
      });

      if (bestLiquidation) {
        const buyer = G.players[bestLiquidation.buyerId];
        aiRecordTradeProposal(tradeMemory, bestLiquidation.offerKey);
        G.pendingTrade = {
          id: `tr_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          fromId: player.id,
          toId: buyer.id,
          fromProps: [bestLiquidation.propId],
          toProps: [],
          fromMoney: 0,
          toMoney: bestLiquidation.ask,
          createdAt: Date.now(),
        };
        tradeReviewShownKey = "";
        addLog(
          `${player.name} offered ${SPACES[bestLiquidation.propId]?.name || "a property"} to ${buyer.name} for ${fmtCurrency(bestLiquidation.ask)}.`,
          "important",
        );
        renderAll();
        updateActionButtons();
        return true;
      }
    }
  }

  return false;
}

function maybeScheduleOfflineAiTurn() {
  if (!G || G.gameOver || !Array.isArray(G.players) || !G.players.length) {
    clearOfflineAiTimer(true);
    return;
  }
  if (isGamePaused()) {
    clearOfflineAiTimer(true);
    return;
  }

  const gameScreen = document.getElementById("game-screen");
  if (!gameScreen || gameScreen.classList.contains("hidden")) {
    clearOfflineAiTimer(true);
    return;
  }

  if (isOnlineGame() && ONLINE.isApplyingRemote) {
    clearOfflineAiTimer(false);
    return;
  }

  if (isOnlineGame() && ONLINE.syncInFlight) {
    clearOfflineAiTimer(false);
    return;
  }

  const current = curPlayer();
  const bidderId = currentAuctionBidderId();
  const bidder = Number.isInteger(bidderId) ? G.players[bidderId] : null;
  const tradeRecipient = G.pendingTrade
    ? G.players[Number(G.pendingTrade.toId)]
    : null;
  const debtRaw = DEBT_PROMPT.active
    ? DEBT_PROMPT
    : G?.debtPrompt && G.debtPrompt.active
      ? G.debtPrompt
      : null;
  const debtPayerId = Number(debtRaw?.payerId);
  const debtPayer = Number.isInteger(debtPayerId)
    ? G.players[debtPayerId]
    : null;
  const debtTurnMismatch = !!(
    debtRaw &&
    debtPayer &&
    !debtPayer.bankrupt &&
    Number(G.currentPlayerIdx) !== debtPayer.id
  );
  const aiDebtNeedsAction = !!(
    debtRaw &&
    debtPayer &&
    !debtPayer.bankrupt &&
    isAiPlayer(debtPayer)
  );
  const aiNeedsAction =
    (isAiPlayer(current) && !current.bankrupt) ||
    (isAiPlayer(current) && current.bankrupt) ||
    (!!G.auctionState && isAiPlayer(bidder) && !bidder.bankrupt) ||
    (!!G.pendingTrade &&
      isAiPlayer(tradeRecipient) &&
      !tradeRecipient.bankrupt) ||
    aiDebtNeedsAction ||
    debtTurnMismatch;

  if (!aiNeedsAction) {
    clearOfflineAiTimer(true);
    return;
  }

  const stateKey = offlineAiStateKey();
  const now = serverNow();
  if (isOnlineGame()) {
    if (!canRunAiController(now)) {
      const runnerUid = activeOnlineRunnerUid(now) || "none";
      // If the designated runner is not us and IS a connected player, wait for them
      const connectedUids = uniqueConnectedRoomUids();
      const runnerIsConnected =
        runnerUid !== "none" && connectedUids.includes(runnerUid);
      const runnerIsUs = runnerUid === String(ONLINE.localUid || "");
      // If runner is absent or is us (stale lease), try to claim lease immediately
      if (!runnerIsConnected || runnerIsUs) {
        clearOfflineAiTimer(false);
        AI_CTRL.lastKey = "";
        ensureAiRunnerLease(true).then(() => maybeScheduleOfflineAiTurn());
        return;
      }
      const waitKey = `${stateKey}:lease:${runnerUid}`;
      if (AI_CTRL.timerId && AI_CTRL.lastKey === waitKey) return;
      clearOfflineAiTimer(false);
      AI_CTRL.lastKey = waitKey;
      AI_CTRL.timerId = setTimeout(async () => {
        AI_CTRL.timerId = null;
        await ensureAiRunnerLease();
        maybeScheduleOfflineAiTurn();
      }, 520);
      return;
    }

    const leaseRemaining = (Number(ONLINE.aiRunner?.until) || 0) - now;
    if (leaseRemaining < AI_RUNNER_RENEW_MS) {
      ensureAiRunnerLease(true);
    }
  } else if (!canRunAiController(now)) {
    clearOfflineAiTimer(true);
    return;
  }

  if (AI_CTRL.timerId && AI_CTRL.lastKey === stateKey) return;

  clearOfflineAiTimer(false);
  AI_CTRL.lastKey = stateKey;
  // Slow enough to follow what the AI is doing; the AI speed setting scales it.
  AI_CTRL.timerId = setTimeout(runOfflineAiStep, aiStepDelayMs());
}

function tryAutoResolveAiDebtPrompt() {
  if (!hasPendingDebtPromptForCurrentPlayer()) return false;

  const payer = curPlayer();
  if (!payer || !isAiPlayer(payer)) return false;
  if (payer.bankrupt) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return true;
  }

  const due = Math.max(0, Number(DEBT_PROMPT.amount) || 0);
  if (due <= 0) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return true;
  }

  if (tryResolveDebtPrompt()) return true;

  const raised = aiRaiseCash(payer, due);
  if (raised > 0) {
    addLog(`${payer.name} raised ${fmtCurrency(raised)} to settle the debt.`, "important");
  }

  if (tryResolveDebtPrompt()) return true;

  const recipient =
    DEBT_PROMPT.recipientId !== null
      ? G.players[DEBT_PROMPT.recipientId]
      : null;
  const toParking = !!DEBT_PROMPT.toParking;
  resetDebtPrompt();
  declareBankruptcy(
    payer,
    recipient && !recipient.bankrupt ? recipient : null,
    due,
    toParking,
  );
  return true;
}

function syncAiDirectMutation(reason) {
  if (!isOnlineGame() || ONLINE.isApplyingRemote) return;
  syncRoomState(reason).catch((err) => {
    console.error(err);
  });
}

function runOfflineAiStep() {
  AI_CTRL.timerId = null;
  if (isGamePaused()) {
    AI_CTRL.lastKey = "";
    return;
  }

  if (!G || G.gameOver || !Array.isArray(G.players) || !G.players.length) {
    AI_CTRL.lastKey = "";
    return;
  }
  if (!canRunAiController()) {
    AI_CTRL.lastKey = "";
    maybeScheduleOfflineAiTurn();
    return;
  }

  if (isOnlineGame() && ONLINE.syncInFlight) {
    AI_CTRL.lastKey = "";
    maybeScheduleOfflineAiTurn();
    return;
  }

  if (isOnlineGame() && ONLINE.isApplyingRemote) {
    AI_CTRL.lastKey = "";
    maybeScheduleOfflineAiTurn();
    return;
  }

  const gameScreen = document.getElementById("game-screen");
  if (!gameScreen || gameScreen.classList.contains("hidden")) return;
  if (MOVE_FX.active) {
    maybeScheduleOfflineAiTurn();
    return;
  }
  const cardFxPending = (Number(ONLINE.pendingCardResolutions) || 0) > 0;
  if (cardFxPending) {
    maybeScheduleOfflineAiTurn();
    return;
  }

  restoreDebtPromptFromGameState();
  const debtStateAdjusted = normalizeDebtPromptTurn();
  if (debtStateAdjusted) {
    renderAll();
    updateActionButtons();
    syncAiDirectMutation("normalize-debt-turn");
    return;
  }

  if (G.pendingTrade) {
    const trade = G.pendingTrade;
    const recipient = G.players[Number(trade.toId)];
    if (isAiPlayer(recipient) && !recipient.bankrupt) {
      respondTrade(aiAcceptsOffer(trade, recipient));
      return;
    }
  }

  if (G.auctionState) {
    const bidderId = currentAuctionBidderId();
    const bidder = Number.isInteger(bidderId) ? G.players[bidderId] : null;
    if (isAiPlayer(bidder) && !bidder.bankrupt) {
      const a = G.auctionState;
      const reserve = aiCashReserve(bidder);
      const steps = auctionBidSteps(SPACES[a.propId]?.price);
      const nextBid = (Number(a.currentBid) || 0) + steps[0];

      const threatCount = aiCountOpponentMonopolyThreats(
        a.propId,
        bidder.id,
        a.activePlayers,
      );
      const basePrice =
        Number(SPACES[a.propId]?.price) || estimateAssetValue(a.propId);
      const defensePremium =
        threatCount > 0
          ? Math.floor(basePrice * (0.24 + 0.08 * Math.min(2, threatCount - 1)))
          : 0;
      const valueCap = Math.floor(
        (aiPropertyPriority(bidder, a.propId) + defensePremium) *
          (0.93 + Math.random() * 0.16),
      );
      const reserveFactor = threatCount > 0 ? 0.3 : 0.45;
      // Mortgaging to win is only worth it for a card that completes its own
      // set or blocks someone else's. The cap is worked out from that potential
      // cash first, so it never mortgages and then passes anyway.
      const groupIds = aiPropertyGroupIds(a.propId);
      const completesOwnSet =
        groupIds.length > 0 &&
        aiCountGroupOwnedByPlayer(bidder.id, groupIds) === groupIds.length - 1;
      const extraCash = threatCount > 0 || completesOwnSet ? aiSpareMortgageValue(bidder) : 0;
      const cashCap = Math.max(
        0,
        bidder.money + extraCash - Math.floor(reserve * reserveFactor),
      );
      const maxBid = Math.max(0, Math.min(valueCap, cashCap));

      if (nextBid > maxBid) {
        passAuction();
        return;
      }
      if (bidder.money < nextBid) {
        if (aiTryMortgageToTarget(bidder, nextBid)) {
          syncAiDirectMutation("ai-auction-mortgage");
          return;
        }
        passAuction();
        return;
      }

      const room = maxBid - (Number(a.currentBid) || 0);
      let increment = steps[0];
      for (const step of steps) if (room >= step) increment = step;
      placeBid(increment);
      return;
    }
  }

  const p = curPlayer();
  if (!isAiPlayer(p)) return;

  if (tryAutoResolveAiDebtPrompt()) {
    renderAll();
    updateActionButtons();
    syncAiDirectMutation("ai-debt-resolution");
    return;
  }

  if (p.bankrupt) {
    if (G.phase === "roll") G.phase = "end";
    endTurn();
    return;
  }

  if (hasPendingBuy()) {
    const spaceId = G.pendingBuy;
    const sp = SPACES[spaceId];
    const price = Number(sp?.price) || 0;
    const reserve = aiCashReserve(p);
    const auctionsEnabled = isAuctionSystemEnabled();
    const score = aiPropertyPriority(p, spaceId);
    const level = aiLevel();
    // Decide on cash in hand first. With auctions off, passing leaves the
    // property unsold, so buy whenever it is affordable. Otherwise: easy buys
    // on cash alone, normal and hard on what the card is worth to them (sets,
    // blocking), hard more readily.
    const wantsAt = (cash) =>
      cash >= price &&
      (!auctionsEnabled ||
        (level === "easy"
          ? cash - price >= Math.floor(reserve * 0.5)
          : level === "hard"
            ? score >= Math.floor(price * 1.05) || cash - price >= Math.floor(reserve * 0.7)
            : score >= Math.floor(price * 1.2) || cash - price >= reserve));
    // Only mortgage for a purchase it is sure to make: a card worth clearly
    // more than its price (a set piece or a block), and affordable afterwards.
    if (
      !wantsAt(p.money) &&
      level !== "easy" &&
      score >= Math.floor(price * 1.2) &&
      p.money < price &&
      p.money + aiSpareMortgageValue(p) >= price + Math.floor(reserve * 0.2) &&
      aiTryMortgageToTarget(p, price)
    ) {
      syncAiDirectMutation("ai-buy-prep-mortgage");
      return;
    }
    const shouldBuy = wantsAt(p.money);
    closeOverlay("buy-overlay");
    if (shouldBuy) {
      actionBuy();
    } else if (auctionsEnabled) {
      startAuction();
    } else {
      G.pendingBuy = null;
      addLog(
        `${p.name} passed on ${sp?.name || "this property"}. Auctions are off, so it stays unsold.`,
        "important",
      );
      settleTurnPhase(p);
      renderAll();
      updateActionButtons();
      syncAiDirectMutation("ai-buy-skip-auction-off");
    }
    return;
  }

  if (G.phase === "roll") {
    const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
    // Only try to leave early when it can actually pay (or has a card);
    // a failed payment would leave the AI with nothing to do.
    const canLeave = p.jailFreeCards > 0 || p.money >= bailAmount;
    if (p.inJail && canLeave && aiShouldLeaveJailEarly(p, bailAmount)) {
      payBailout();
      return;
    }
    rollDice();
    return;
  }

  if (G.phase === "action" || G.phase === "end") {
    const reserve = aiCashReserve(p);
    if (
      p.money < Math.floor(reserve * 0.35) &&
      aiTryMortgageToTarget(p, Math.floor(reserve * 0.85))
    ) {
      syncAiDirectMutation("ai-cash-mortgage");
      return;
    }
    if (aiTryUnmortgage(p)) {
      syncAiDirectMutation("ai-unmortgage");
      return;
    }
    if ((G.phase === "action" || G.phase === "end") && aiTryBuildOne(p)) {
      return;
    }
    if (aiTryProposeTrade(p)) {
      const tradeRecipient = G.pendingTrade
        ? G.players[Number(G.pendingTrade.toId)]
        : null;
      if (
        G.pendingTrade &&
        tradeRecipient &&
        !isAiPlayer(tradeRecipient) &&
        G.currentPlayerIdx === p.id
      ) {
        endTurn();
      }
      return;
    }
    endTurn();
  }
}

function updateActionButtons() {
  const p = curPlayer();
  const onProp = G.properties[p.pos];
  const sp = SPACES[p.pos];
  restoreDebtPromptFromGameState();
  const turnOwnedByMe = canLocalControlTurn();
  const aiTurnActive = isAiPlayer(p) && !p.bankrupt;
  const movementLocked = MOVE_FX.active;
  const cardFxPending = (Number(ONLINE.pendingCardResolutions) || 0) > 0;
  const canHumanAct =
    turnOwnedByMe && !aiTurnActive && !movementLocked && !cardFxPending;
  const debtRaw = DEBT_PROMPT.active
    ? DEBT_PROMPT
    : G?.debtPrompt && G.debtPrompt.active
      ? G.debtPrompt
      : null;
  const debtPayerId = Number(debtRaw?.payerId);
  const debtPayer = Number.isInteger(debtPayerId)
    ? G.players[debtPayerId]
    : null;
  const debtPromptActive = !!(debtRaw && debtPayer && !debtPayer.bankrupt);
  const debtPending = debtPromptActive && debtPayer.id === G.currentPlayerIdx;
  const debtShortBy = debtPromptActive
    ? Math.max(0, Number(debtRaw.amount || 0) - Number(debtPayer.money || 0))
    : 0;
  const managementPhase =
    G.phase === "roll" || G.phase === "action" || G.phase === "end";
  const canBuyAny =
    !debtPending && G.phase === "action" && onProp && onProp.owner === null;
  const canBuild =
    !debtPending && managementPhase && buildableGroups(p).length > 0;
  const canMortgage =
    managementPhase &&
    (p.properties.length > 0 ||
      p.railroads.length > 0 ||
      p.utilities.length > 0);
  const canEnd = !debtPending && (G.phase === "action" || G.phase === "end");
  const inJail = p.inJail;

  if (G.gameOver) {
    [
      "btn-buy",
      "mb-buy",
      "btn-build",
      "mb-build",
      "btn-mortgage",
      "mb-mortgage",
      "btn-trade",
      "mb-trade",
      "btn-end",
      "mb-end",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    ["btn-pay-jail", "mb-pay-jail"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });

    const rollBtn = document.getElementById("roll-btn");
    if (rollBtn) rollBtn.disabled = true;
    const endBtnGo = document.getElementById("center-end-btn");
    if (endBtnGo) endBtnGo.disabled = true;
    const rowGo = document.getElementById("center-actions");
    if (rowGo) rowGo.style.display = "none";

    const cm = document.getElementById("center-msg");
    if (cm)
      cm.textContent =
        "Match finished. Use the winner screen to review the board or start a new game.";

    const mobileTurnLine = document.getElementById("mobile-turnline");
    if (mobileTurnLine) mobileTurnLine.textContent = "Match finished";

    stopTimer();
    return;
  }

  ["btn-buy", "mb-buy"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canBuyAny;
  });
  ["btn-build", "mb-build"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canBuild;
  });
  ["btn-mortgage", "mb-mortgage"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canMortgage;
  });
  // Trading is open on anyone's turn (see tradeBlockedReason).
  const tradeOpen = canProposeTradeNow();
  ["btn-trade", "mb-trade"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !tradeOpen;
  });
  ["btn-end", "mb-end"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canEnd;
  });

  // The centre row only appears when there is something for *this* player to
  // press. On anyone else's turn it steps aside and the status line below says
  // what is happening, rather than a disabled button pretending to be a label.
  const centerRow = document.getElementById("center-actions");
  const showCenterRow = turnOwnedByMe && !aiTurnActive;
  if (centerRow) centerRow.style.display = showCenterRow ? "" : "none";

  const rollBtn = document.getElementById("roll-btn");
  const centerEndBtn = document.getElementById("center-end-btn");
  if (rollBtn) {
    rollBtn.disabled = debtPromptActive || G.phase !== "roll" || !canHumanAct;
    rollBtn.textContent = inJail && G.phase === "roll" ? "Roll for doubles" : "Roll dice";
  }
  if (centerEndBtn) {
    centerEndBtn.disabled = !canHumanAct || !canEnd;
    // Before the roll there is nothing to end: show Roll alone, so the next
    // step is obvious. After it, End turn takes its place.
    centerEndBtn.hidden = G.phase === "roll" && !debtPromptActive;
  }
  if (rollBtn) rollBtn.hidden = G.phase !== "roll" && !debtPromptActive;
  // Whichever one applies right now is the filled, primary button.
  if (rollBtn) rollBtn.classList.toggle("is-primary", !rollBtn.disabled);
  if (centerEndBtn) centerEndBtn.classList.toggle("is-primary", !centerEndBtn.disabled);

  // Jail bail button
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
  const bailVis =
    canHumanAct && inJail && G.phase === "roll" && p.money >= bailAmount;
  ["btn-pay-jail", "mb-pay-jail"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = bailVis ? "" : "none";
    el.textContent = `Pay ${fmtCurrency(bailAmount)} bail`;
  });

  // Center message
  const cm = document.getElementById("center-msg");
  if (cm) {
    if (movementLocked)
      cm.textContent = `${p.name} is moving…`;
    else if (cardFxPending) cm.textContent = "Resolving card effect…";
    else if (debtPromptActive) {
      cm.textContent = debtPending
        ? `Short by ${fmtCurrency(debtShortBy)}. Mortgage, sell buildings, or declare bankruptcy.`
        : `${debtPayer?.name || "Player"} is settling a debt (short ${fmtCurrency(debtShortBy)}).`;
    } else if (aiTurnActive)
      cm.textContent = `${p.name} is making a move`;
    else if (!turnOwnedByMe) cm.textContent = `Watching ${p.name}'s turn`;
    else if (inJail && G.phase === "roll")
      cm.textContent = `Roll doubles or pay ${fmtCurrency(bailAmount)} bail`;
    else if (G.phase === "roll")
      cm.textContent = "Roll the dice";
    else if (G.phase === "action") cm.textContent = `Landed on ${sp.name}`;
    else
      cm.textContent =
        TIMER.duration > 0
          ? `Turn ends in ${TIMER.intervalId ? TIMER.remaining : TIMER.duration}s`
          : `End turn when ready`;
  }

  const mobileTurnLine = document.getElementById("mobile-turnline");
  if (mobileTurnLine) {
    if (movementLocked)
      mobileTurnLine.textContent = `${p.name} is moving…`;
    else if (cardFxPending)
      mobileTurnLine.textContent = "Resolving card effect…";
    else if (debtPromptActive) {
      mobileTurnLine.textContent = debtPending
        ? `Short ${fmtCurrency(debtShortBy)} — mortgage, sell, or bankrupt`
        : `${debtPayer?.name || "Player"} is settling a debt`;
    } else if (aiTurnActive)
      mobileTurnLine.textContent = `${p.name} is thinking…`;
    else if (!turnOwnedByMe)
      mobileTurnLine.textContent = `Watching ${p.name}'s turn`;
    else if (inJail && G.phase === "roll")
      mobileTurnLine.textContent = `In jail — roll doubles or pay ${fmtCurrency(bailAmount)}`;
    else if (G.phase === "roll")
      mobileTurnLine.textContent = "Your turn: roll the dice";
    else if (G.phase === "action")
      mobileTurnLine.textContent = `${sp.name} — choose an action`;
    else
      mobileTurnLine.textContent =
        TIMER.duration > 0
          ? `Turn ends in ${TIMER.intervalId ? TIMER.remaining : TIMER.duration}s`
          : "End your turn when ready";
  }

  // Prompt jailed player with clear choices at the start of their roll phase.
  if (canHumanAct && inJail && G.phase === "roll") {
    const promptKey = `${G.currentPlayerIdx}:${p.jailTurns}:${G.phase}`;
    if (
      jailPromptShownKey !== promptKey &&
      !document.querySelector(".overlay.show")
    ) {
      jailPromptShownKey = promptKey;
      showJailPrompt(p, "turn");
    }
  }

  maybeShowPendingTradeReview();

  syncTurnTimer();
  updatePauseButton();
  maybeShowTip();
}

