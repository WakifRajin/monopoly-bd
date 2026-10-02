// ═══════════════════════════════════════════════
//  GAME FEEL
//  Money animations, title deeds, card reveals, match stats and the
//  synthesised sound effects. Everything here only reads G (apart from the
//  stats counters), so it behaves the same offline, online and on LAN.
// ═══════════════════════════════════════════════

function prefersReducedMotion() {
  return typeof reduceMotionOn === "function" ? reduceMotionOn() : false;
}

// ── Money: count-up, floating +/- chips, coins between players ────────────
const MONEY_FX = { gameKey: "", last: [], tweens: {}, raf: 0 };
const MONEY_TWEEN_MS = 650;

function moneyElementsFor(i) {
  const out = [];
  const card = document.querySelectorAll("#player-cards > .pcard")[i];
  if (card) out.push(card.querySelector(".pmoney"));
  const chip = document.querySelectorAll("#mobile-player-strip > .mobile-player-chip")[i];
  if (chip) out.push(chip.querySelector(".mobile-player-cash"));
  if (i === Number(G?.currentPlayerIdx)) out.push(document.getElementById("tb-money"));
  return out.filter(Boolean);
}

// The element a chip or coin should start from: whichever copy is on screen.
function visibleMoneyAnchor(i) {
  const el = moneyElementsFor(i).find((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });
  return el ? el.getBoundingClientRect() : null;
}

function bankAnchor() {
  const el = document.body.classList.contains("board-gl")
    ? document.getElementById("board3d")
    : document.getElementById("game-board");
  const r = el?.getBoundingClientRect();
  if (!r || !r.width) return null;
  return { left: r.left + r.width / 2 - 1, top: r.top + r.height / 2 - 1, width: 2, height: 2 };
}

function applyMoneyTweens() {
  const now = performance.now();
  let running = false;
  for (const key of Object.keys(MONEY_FX.tweens)) {
    const i = Number(key);
    const t = MONEY_FX.tweens[key];
    const k = Math.min(1, (now - t.start) / MONEY_TWEEN_MS);
    const eased = 1 - Math.pow(1 - k, 3);
    const value = Math.round(t.from + (t.to - t.from) * eased);
    for (const el of moneyElementsFor(i)) {
      el.textContent = fmtCurrency(value);
      el.classList.toggle("money-up", t.to > t.from && k < 1);
      el.classList.toggle("money-down", t.to < t.from && k < 1);
    }
    if (k >= 1) delete MONEY_FX.tweens[key];
    else running = true;
  }
  if (running && !MONEY_FX.raf) {
    MONEY_FX.raf = requestAnimationFrame(() => {
      MONEY_FX.raf = 0;
      applyMoneyTweens();
    });
  }
}

function spawnMoneyChip(i, delta) {
  const r = visibleMoneyAnchor(i);
  if (!r) return;
  const chip = document.createElement("div");
  chip.className = `money-chip ${delta > 0 ? "is-gain" : "is-loss"}`;
  chip.textContent = `${delta > 0 ? "+" : "−"}${fmtCurrency(Math.abs(delta))}`;
  chip.style.left = `${Math.round(r.left + r.width / 2)}px`;
  chip.style.top = `${Math.round(r.top)}px`;
  document.body.appendChild(chip);
  setTimeout(() => chip.remove(), 1400);
}

function flyCoins(from, to) {
  if (!from || !to || prefersReducedMotion()) return;
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;
  const lift = Math.min(120, Math.hypot(x1 - x0, y1 - y0) * 0.3);
  for (let n = 0; n < 3; n++) {
    const coin = document.createElement("div");
    coin.className = "money-coin";
    coin.textContent = "৳";
    coin.style.left = `${x0}px`;
    coin.style.top = `${y0}px`;
    document.body.appendChild(coin);
    const anim = coin.animate(
      [
        { transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
        { transform: `translate(calc(-50% + ${(x1 - x0) / 2}px), calc(-50% + ${(y1 - y0) / 2 - lift}px)) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(calc(-50% + ${x1 - x0}px), calc(-50% + ${y1 - y0}px)) scale(.7)`, opacity: 0.2 },
      ],
      { duration: 620, delay: n * 80, easing: "cubic-bezier(.3,.1,.3,1)", fill: "both" },
    );
    anim.onfinish = () => coin.remove();
  }
}

// Called after every render of the player cards. Compares each balance with
// the last one seen and animates the difference.
function trackMoneyFx() {
  if (!G || !Array.isArray(G.players)) return;
  const key = `${G.gameStartedAt || 0}:${G.players.length}`;
  const now = G.players.map((p) => Number(p.money) || 0);
  if (MONEY_FX.gameKey !== key) {
    MONEY_FX.gameKey = key;
    MONEY_FX.last = now;
    MONEY_FX.tweens = {};
    return;
  }
  const screen = document.getElementById("game-screen");
  const visible = screen && !screen.classList.contains("hidden");
  const deltas = now.map((v, i) => v - (Number(MONEY_FX.last[i]) || 0));
  MONEY_FX.last = now;
  if (!visible || deltas.every((d) => !d)) {
    applyMoneyTweens();
    return;
  }

  const reduced = prefersReducedMotion();
  deltas.forEach((d, i) => {
    if (!d) return;
    const shown = MONEY_FX.tweens[i];
    const from = shown ? shown.from + (shown.to - shown.from) * Math.min(1, (performance.now() - shown.start) / MONEY_TWEEN_MS) : now[i] - d;
    if (!reduced) MONEY_FX.tweens[i] = { from, to: now[i], start: performance.now() };
    spawnMoneyChip(i, d);
  });

  // Pair each payment with the player who received the same amount; the
  // rest came from, or went to, the bank.
  const gains = deltas.map((d, i) => (d > 0 ? i : -1)).filter((i) => i >= 0);
  const used = new Set();
  deltas.forEach((d, i) => {
    if (d >= 0) return;
    const j = gains.find((g) => !used.has(g) && deltas[g] === -d);
    if (j !== undefined) {
      used.add(j);
      flyCoins(visibleMoneyAnchor(i), visibleMoneyAnchor(j));
    } else {
      flyCoins(visibleMoneyAnchor(i), bankAnchor());
    }
  });
  gains.forEach((j) => {
    if (!used.has(j)) flyCoins(bankAnchor(), visibleMoneyAnchor(j));
  });
  if (gains.length) playSfx("coin");
  applyMoneyTweens();
}

// ── Title deed ─────────────────────────────────────────────────────────────
function propertyDeedHtml(id) {
  const sp = SPACES[id];
  if (!sp) return "";
  // The row that applies right now is marked, once the property is owned.
  const prop = G?.properties?.[id];
  const owned = prop && prop.owner !== null && prop.owner !== undefined;
  let level = -1;
  if (owned && !prop.mortgaged) {
    if (sp.type === "property") {
      const full = SPACES.filter((s2) => s2.type === "property" && s2.group === sp.group).every((s2) => G.properties[s2.id]?.owner === prop.owner);
      level = prop.hotel ? 6 : prop.houses > 0 ? prop.houses + 1 : full ? 1 : 0;
    } else if (sp.type === "railroad") {
      level = Math.max(0, countOwnedSpacesByType(Number(prop.owner), "railroad") - 1);
    } else if (sp.type === "utility") {
      level = countOwnedSpacesByType(Number(prop.owner), "utility") >= 2 ? 1 : 0;
    }
  }
  let rowIdx = -1;
  const row = (label, value, strong = false) => {
    rowIdx++;
    const now = rowIdx === level;
    return `<div class="deed-row${strong ? " is-strong" : ""}${now ? " is-current" : ""}"${now ? ' aria-current="true"' : ""}><span>${label}</span><span>${value}</span></div>`;
  };
  if (sp.type === "property") {
    const c = COLOR[sp.color] || "#666";
    const hotelCost = fmtCurrency(sp.house);
    return `
      <div class="deed">
        <div class="deed-band" style="background:${c};color:${readableTextOn(c)}">
          <span class="deed-kicker">Title deed</span>
          <span class="deed-name">${escHtml(sp.name)}</span>
        </div>
        <div class="deed-body">
          ${row("Rent", fmtCurrency(sp.rent[0]), true)}
          ${row("With the full colour set", fmtCurrency(sp.rent[0] * 2))}
          ${[1, 2, 3, 4].map((n) => row(`With ${n} house${n > 1 ? "s" : ""}`, fmtCurrency(sp.rent[n]))).join("")}
          ${row("With a hotel", fmtCurrency(sp.rent[5]))}
          <div class="deed-foot">
            <span>Houses ${fmtCurrency(sp.house)} each · Hotel ${hotelCost} plus 4 houses</span>
            <span>Mortgage value ${fmtCurrency(mortgageValueForSpace(sp))}</span>
          </div>
        </div>
      </div>`;
  }
  if (sp.type === "railroad") {
    return `
      <div class="deed">
        <div class="deed-band is-dark"><span class="deed-kicker">Station</span><span class="deed-name">🚆 ${escHtml(sp.name)}</span></div>
        <div class="deed-body">
          ${(sp.rent || []).map((v, n) => row(n === 0 ? "Rent" : `If ${n + 1} stations are owned`, fmtCurrency(v), n === 0)).join("")}
          <div class="deed-foot"><span>Mortgage value ${fmtCurrency(mortgageValueForSpace(sp))}</span></div>
        </div>
      </div>`;
  }
  if (sp.type === "utility") {
    const m = getThemeUtilityRentMultipliers(G?.boardThemeId || selectedThemeId);
    return `
      <div class="deed">
        <div class="deed-band is-dark"><span class="deed-kicker">Utility</span><span class="deed-name">${escHtml(sp.icon || "💡")} ${escHtml(sp.name)}</span></div>
        <div class="deed-body">
          ${row("If one utility is owned", `${m.one}× the dice`, true)}
          ${row("If both are owned", `${m.both}× the dice`)}
          <div class="deed-foot"><span>Mortgage value ${fmtCurrency(mortgageValueForSpace(sp))}</span></div>
        </div>
      </div>`;
  }
  return "";
}

// ── Chance / Community Chest reveal ────────────────────────────────────────
function cardEffectText(card, p) {
  if (!card) return { text: "", tone: "" };
  const v = card.value;
  switch (card.action) {
    case "money":
      return v > 0
        ? { text: `+${fmtCurrency(v)}`, tone: "gain" }
        : { text: `−${fmtCurrency(-v)}`, tone: "loss" };
    case "goto": {
      const dest = SPACES[v]?.name || "the square";
      const salary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
      return {
        text: v === 0 ? `Collect ${fmtCurrency(salary)}` : `Move to ${dest}${p && v < p.pos ? ` · collect ${fmtCurrency(salary)}` : ""}`,
        tone: v === 0 ? "gain" : "move",
      };
    }
    case "jail":
      return { text: "Straight to jail", tone: "loss" };
    case "jailcard":
      return { text: "Keep this card until you need it", tone: "gain" };
    case "nearest":
      return v === "utility"
        ? { text: "Nearest utility · ten times the dice if it's owned", tone: "move" }
        : {
            text: `Nearest ${G.boardThemeId === "buet" ? "building" : "station"} · ${Number(card.multiplier) === 3 ? "triple" : "double"} rent if it's owned`,
            tone: "move",
          };
    case "back":
      return { text: `Back ${Number(v) || 3} spaces`, tone: "move" };
    case "payeach": {
      const others = (G.players || []).filter((x) => !x.bankrupt && x.id !== p?.id).length;
      return { text: `−${fmtCurrency((Number(v) || 0) * others)} in all`, tone: "loss" };
    }
    case "repairs": {
      let cost = 0;
      (p?.properties || []).forEach((id) => {
        const pr = G.properties[id];
        if (!pr) return;
        cost += pr.hotel ? v.hotel : pr.houses * v.house;
      });
      return cost > 0 ? { text: `−${fmtCurrency(cost)}`, tone: "loss" } : { text: "No buildings, nothing to pay", tone: "" };
    }
    case "birthday":
      return { text: `+${fmtCurrency(v)} from each player`, tone: "gain" };
    default:
      return { text: "", tone: "" };
  }
}

// Card faces for boards with printed cards of their own (BUET's CGPA and
// BIIS): the deck's emblem, then the card laid out as printed.
const PRINTED_CARD_ART = {
  buet: {
    chance: `<svg viewBox="0 0 120 52" aria-hidden="true"><g font-family="Josefin Sans, DM Sans, sans-serif" font-weight="600" font-size="54" text-anchor="middle"><text x="22" y="46" fill="#d99a5b">?</text><text x="60" y="46" fill="#8fa5b0">?</text><text x="98" y="46" fill="#b9a2d4">?</text></g></svg>`,
    community: `<svg viewBox="0 0 120 52" aria-hidden="true"><rect x="22" y="6" width="50" height="32" rx="2" fill="none" stroke="#111" stroke-width="5"/><rect x="44" y="38" width="6" height="7" fill="#111"/><rect x="33" y="44" width="28" height="4" fill="#111"/><rect x="80" y="4" width="18" height="44" fill="#111"/><rect x="85" y="38" width="8" height="3" fill="#f0f1d8"/></svg>`,
  },
};

function presentCardReveal(type, card, p) {
  const box = document.getElementById("deck-card");
  if (!box) return;
  const isChance = type === "chance";
  const theme = getThemeById(G.boardThemeId || selectedThemeId);
  const deckName = themeDeckName(type, theme.id);
  box.dataset.deck = isChance ? "chance" : "community";
  const backTitle = document.getElementById("card-back-title");
  const backIcon = document.getElementById("card-back-icon");
  if (backTitle) backTitle.textContent = deckName;
  if (backIcon) backIcon.textContent = isChance ? "?" : "📦";
  presentPrintedCard(theme, type, card);
  const effect = cardEffectText(card, p);
  const effectEl = document.getElementById("card-effect");
  if (effectEl) {
    effectEl.textContent = effect.text;
    effectEl.className = `deck-card-effect${effect.tone ? ` is-${effect.tone}` : ""}`;
    effectEl.hidden = !effect.text;
  }
  box.classList.remove("is-revealed");
  void box.offsetWidth;
  setTimeout(() => box.classList.add("is-revealed"), prefersReducedMotion() ? 0 : 320);
}

function presentPrintedCard(theme, type, card) {
  const box = document.getElementById("deck-card");
  const art = PRINTED_CARD_ART[theme.art];
  const artEl = document.getElementById("card-art");
  const headingEl = document.getElementById("card-heading");
  const ruleEl = document.getElementById("card-rule");
  const kicker = document.querySelector("#deck-card .deck-card-kicker");
  if (!box || !artEl || !headingEl || !ruleEl) return;
  if (!art) {
    delete box.dataset.style;
    artEl.hidden = headingEl.hidden = ruleEl.hidden = true;
    if (kicker) kicker.hidden = false;
    return;
  }
  box.dataset.style = theme.art;
  artEl.innerHTML = art[type === "chance" ? "chance" : "community"];
  artEl.hidden = false;
  if (kicker) kicker.hidden = true;
  const title = document.createElement("div");
  title.className = "deck-card-name";
  title.textContent = themeDeckName(type, theme.id);
  artEl.appendChild(title);
  headingEl.textContent = card.heading || "";
  headingEl.hidden = !card.heading;
  // The printed wording, line breaks and all; amounts stay as printed.
  document.getElementById("card-desc").textContent = card.text || "";
  const label = document.getElementById("card-rule-label");
  const amount = document.getElementById("card-rule-amount");
  label.textContent = card.label || "";
  amount.textContent = card.amount || "";
  ruleEl.hidden = !(card.label || card.amount);
  // "ATTEND / SUPPLEMENTARY EXAM" is printed in red capitals, not as a sum.
  ruleEl.classList.toggle("is-words", !/৳/.test(card.amount || ""));
}

// ── Match stats (kept in G so everyone in an online match sees the same) ──
function statsFor(playerId) {
  if (!Array.isArray(G.stats)) G.stats = [];
  const id = Number(playerId);
  if (!Number.isInteger(id) || id < 0 || id >= G.players.length) return null;
  if (!G.stats[id] || typeof G.stats[id] !== "object") {
    G.stats[id] = { rentPaid: 0, rentEarned: 0, bought: 0, passedGo: 0, jailed: 0, biggestRent: 0 };
  }
  return G.stats[id];
}

function recordStat(playerId, key, amount = 1) {
  const s = statsFor(playerId);
  if (s) s[key] = (Number(s[key]) || 0) + amount;
}

function recordRentStat(payerId, ownerId, rent) {
  recordStat(payerId, "rentPaid", rent);
  recordStat(ownerId, "rentEarned", rent);
  const s = statsFor(ownerId);
  if (s && rent > (Number(s.biggestRent) || 0)) s.biggestRent = rent;
}

function normalizeStats(raw, playerCount) {
  const list = indexedObjectToArray(raw);
  const out = [];
  for (let i = 0; i < playerCount; i++) {
    const s = list[i] && typeof list[i] === "object" ? list[i] : {};
    out.push({
      rentPaid: Math.max(0, Number(s.rentPaid) || 0),
      rentEarned: Math.max(0, Number(s.rentEarned) || 0),
      bought: Math.max(0, Number(s.bought) || 0),
      passedGo: Math.max(0, Number(s.passedGo) || 0),
      jailed: Math.max(0, Number(s.jailed) || 0),
      biggestRent: Math.max(0, Number(s.biggestRent) || 0),
    });
  }
  return out;
}

function formatMatchLength(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

function renderMatchSummary(winnerId) {
  const host = document.getElementById("winner-stats");
  if (!host || !G || !Array.isArray(G.players)) return;
  const started = Number(G.gameStartedAt) || 0;
  const length = started ? formatMatchLength(Date.now() - started) : "";
  const turns = Number(G.turnCount) || 0;
  const order = [...G.players].sort((a, b) => {
    if (a.id === winnerId) return -1;
    if (b.id === winnerId) return 1;
    if (!!a.bankrupt !== !!b.bankrupt) return a.bankrupt ? 1 : -1;
    return (Number(b.bankruptOrder) || 0) - (Number(a.bankruptOrder) || 0);
  });
  const stat = (label, value) => `<div class="ws-stat"><span>${label}</span><strong>${value}</strong></div>`;
  host.innerHTML = `
    ${matchAwardsHtml()}
    ${worthChartHtml(winnerId)}
    <div class="winner-leader-title">Match summary${length ? ` · ${length}` : ""}${turns ? ` · ${turns} turn${turns === 1 ? "" : "s"}` : ""}</div>
    <div class="ws-grid">
      ${order
        .map((p) => {
          const s = statsFor(p.id) || {};
          return `<div class="ws-card${p.id === winnerId ? " is-winner" : ""}">
            <div class="ws-name"><span>${escHtml(p.token || "")}</span><span class="ws-name-text">${escHtml(p.name)}</span></div>
            ${stat("Rent earned", fmtCurrency(s.rentEarned || 0))}
            ${stat("Rent paid", fmtCurrency(s.rentPaid || 0))}
            ${stat("Properties bought", s.bought || 0)}
            ${stat("Biggest rent", s.biggestRent ? fmtCurrency(s.biggestRent) : "—")}
          </div>`;
        })
        .join("")}
    </div>`;
}

// Awards for the match, from the stats each player collected. Only awards
// someone actually earned are shown.
function matchAwardsHtml() {
  const players = (G.players || []).map((p) => ({ p, s: statsFor(p.id) || {} }));
  const best = (key) => {
    let top = null;
    players.forEach((x) => {
      const v = Number(x.s[key]) || 0;
      if (v > 0 && (!top || v > top.v)) top = { p: x.p, v };
    });
    return top;
  };
  const awards = [
    ["🏦", "Top landlord", best("rentEarned"), (v) => `${fmtCurrency(v)} in rent`],
    ["💥", "Biggest hit", best("biggestRent"), (v) => `${fmtCurrency(v)} in one go`],
    ["🏘️", "Collector", best("bought"), (v) => `${v} propert${v === 1 ? "y" : "ies"} bought`],
    ["🧾", "Generous tenant", best("rentPaid"), (v) => `${fmtCurrency(v)} paid out`],
    ["🚓", "Regular in jail", best("jailed"), (v) => `${v} time${v === 1 ? "" : "s"} in jail`],
  ].filter((a) => a[2]);
  if (!awards.length) return "";
  return `<div class="winner-awards">${awards
    .map(
      ([icon, title, who, fmt]) => `<div class="winner-award">
        <span class="winner-award-icon" aria-hidden="true">${icon}</span>
        <span class="winner-award-text"><strong>${escHtml(title)}</strong><span>${escHtml(who.p.name)} · ${escHtml(fmt(who.v))}</span></span>
      </div>`,
    )
    .join("")}</div>`;
}

// Net worth over the match, one line per player, as a small inline chart.
function worthChartHtml(winnerId) {
  const rows = Array.isArray(G.worthHistory) ? G.worthHistory : [];
  if (rows.length < 3) return "";
  const n = G.players.length;
  const W = 600;
  const H = 180;
  const pad = 8;
  let max = 1;
  rows.forEach((r) => r.forEach((v) => (max = Math.max(max, Number(v) || 0))));
  const x = (i) => pad + (i / (rows.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((Number(v) || 0) / max) * (H - pad * 2);
  const lines = [];
  for (let k = 0; k < n; k++) {
    const p = G.players[k];
    const pts = rows.map((r, i) => `${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join(" ");
    const win = p.id === winnerId;
    lines.push(
      `<polyline points="${pts}" fill="none" stroke="${sanitizeColor(p.color, "#fff")}" stroke-width="${win ? 3.2 : 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${win ? 1 : 0.75}"/>`,
    );
  }
  const legend = G.players
    .map((p) => `<span class="worth-legend-item"><i style="background:${sanitizeColor(p.color, "#fff")}"></i>${escHtml(p.name)}</span>`)
    .join("");
  return `<div class="winner-chart">
      <div class="winner-leader-title">${escHtml(uiText("Net worth over the match"))}</div>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escAttr(uiText("Net worth of each player after every turn"))}">
        <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="rgba(255,255,255,.18)" stroke-width="1"/>
        ${lines.join("")}
      </svg>
      <div class="worth-legend">${legend}</div>
    </div>`;
}

// Wins and games played by name, on this device.
const RECORDS_KEY = "monopoly_records_v1";
function readRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch (_err) {
    return {};
  }
}
// Once per match on this device (online, every player's device shows the
// winner screen and records only its own player).
const RESULTS_RECORDED = new Set();
function recordMatchResult(winner) {
  if (!G || !Array.isArray(G.players)) return;
  const matchKey = String(G.gameStartedAt || "");
  if (!matchKey || RESULTS_RECORDED.has(matchKey)) return;
  RESULTS_RECORDED.add(matchKey);
  try {
    const rec = readRecords();
    G.players.forEach((p) => {
      if (isAiSeat(p)) return;
      if (isOnlineGame() && p.uid !== ONLINE.localUid) return;
      const key = String(p.name || "").trim().slice(0, 24);
      if (!key) return;
      const r = rec[key] && typeof rec[key] === "object" ? rec[key] : { played: 0, won: 0 };
      r.played = (Number(r.played) || 0) + 1;
      if (winner && p.id === winner.id) r.won = (Number(r.won) || 0) + 1;
      r.last = Date.now();
      rec[key] = r;
    });
    const keys = Object.keys(rec).sort((a, b) => (rec[b].last || 0) - (rec[a].last || 0)).slice(0, 30);
    localStorage.setItem(RECORDS_KEY, JSON.stringify(Object.fromEntries(keys.map((k) => [k, rec[k]]))));
  } catch (_err) {}
  if (typeof recordRecentActivity === "function" && winner) {
    recordRecentActivity({
      kind: "result",
      title: `${winner.name} won`,
      detail: `${G.players.length} players · ${(window.ACTIVE_THEME || {}).name || ""}`.replace(/ · $/, ""),
      themeId: G.boardThemeId,
    });
  }
}

// Share the result: the system share sheet on phones, the clipboard elsewhere.
async function shareMatchResult() {
  const winner = G && Number.isInteger(G.winnerId) ? G.players[G.winnerId] : (G?.players || []).find((p) => !p.bankrupt);
  if (!winner) return;
  const board = (window.ACTIVE_THEME || {}).name || "";
  const text = `${winner.name} won a game of Bangladeshi Monopoly${board ? ` on the ${board} board` : ""} with ${fmtCurrency(playerNetWorth(winner))}.`;
  const url = "https://wakifrajin.github.io/monopoly-bd/";
  try {
    if (navigator.share) {
      await navigator.share({ title: "Bangladeshi Monopoly", text, url });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast("Result copied", "gold");
  } catch (err) {
    if (err && err.name === "AbortError") return;
    toast("Could not share the result.", "danger");
  }
}

// ── Sound effects without audio files ──────────────────────────────────────
// Each event gets its own short patch, so buying, paying and drawing a card
// no longer all make the same click.
const SFX_PATCHES = {
  buy() {
    playSfxNoise(0.03, { gain: 0.05, frequency: 3200 });
    playSfxTone(1046.5, 0.07, { type: "triangle", gain: 0.07, start: 0.04 });
    playSfxTone(1568, 0.14, { type: "triangle", gain: 0.06, start: 0.11 });
  },
  coin() {
    playSfxTone(1318.5, 0.05, { type: "sine", gain: 0.045 });
    playSfxTone(1760, 0.09, { type: "sine", gain: 0.04, start: 0.05 });
  },
  passgo() {
    [987.8, 1318.5, 1568, 1975.5].forEach((f, n) =>
      playSfxTone(f, 0.07, { type: "triangle", gain: 0.06, start: n * 0.065 }),
    );
  },
  card() {
    playSfxNoise(0.1, { gain: 0.05, frequency: 2600 });
    playSfxNoise(0.07, { gain: 0.035, frequency: 1500, start: 0.09 });
  },
  jail() {
    playSfxNoise(0.18, { gain: 0.06, frequency: 520 });
    playSfxTone(110, 0.28, { type: "square", gain: 0.045 });
    playSfxTone(146.8, 0.22, { type: "square", gain: 0.03, start: 0.03 });
  },
  build() {
    playSfxNoise(0.03, { gain: 0.09, frequency: 480 });
    playSfxTone(196, 0.05, { type: "triangle", gain: 0.06 });
    playSfxNoise(0.03, { gain: 0.08, frequency: 520, start: 0.12 });
    playSfxTone(220, 0.06, { type: "triangle", gain: 0.055, start: 0.12 });
  },
  sell() {
    playSfxTone(440, 0.05, { type: "triangle", gain: 0.05 });
    playSfxTone(330, 0.08, { type: "triangle", gain: 0.05, start: 0.06 });
  },
  rent() {
    playSfxTone(523.25, 0.08, { type: "triangle", gain: 0.06 });
    playSfxTone(392, 0.14, { type: "triangle", gain: 0.06, start: 0.09 });
  },
  tax() {
    playSfxTone(329.6, 0.08, { type: "square", gain: 0.035 });
    playSfxTone(246.9, 0.16, { type: "square", gain: 0.035, start: 0.1 });
  },
  mortgage() {
    playSfxTone(392, 0.07, { type: "sine", gain: 0.06 });
    playSfxTone(293.7, 0.12, { type: "sine", gain: 0.06, start: 0.08 });
  },
  unmortgage() {
    playSfxTone(293.7, 0.07, { type: "sine", gain: 0.06 });
    playSfxTone(392, 0.12, { type: "sine", gain: 0.06, start: 0.08 });
  },
  bail() {
    [392, 523.25, 659.3].forEach((f, n) => playSfxTone(f, 0.06, { type: "triangle", gain: 0.055, start: n * 0.06 }));
  },
  "auction-open"() {
    playSfxTone(659.3, 0.08, { type: "triangle", gain: 0.05 });
    playSfxTone(880, 0.1, { type: "triangle", gain: 0.05, start: 0.09 });
  },
  bid() {
    playSfxTone(1200, 0.035, { type: "sine", gain: 0.04 });
  },
  "auction-win"() {
    playSfxNoise(0.05, { gain: 0.12, frequency: 300 });
    playSfxTone(180, 0.08, { type: "square", gain: 0.05 });
    playSfxNoise(0.05, { gain: 0.12, frequency: 300, start: 0.16 });
    playSfxTone(180, 0.1, { type: "square", gain: 0.05, start: 0.16 });
  },
  turn() {
    playSfxTone(784, 0.08, { type: "sine", gain: 0.035 });
    playSfxTone(1174.7, 0.14, { type: "sine", gain: 0.03, start: 0.08 });
  },
};


// ── Haptics ────────────────────────────────────────────────────────────────
// Short vibrations on phones for the moments that matter: your roll, buying,
// building, rent, jail, your turn. Off in Settings, and never on a desktop.
const HAPTICS_KEY = "monopoly_haptics";
const HAPTIC_PATTERNS = {
  dice: 12,
  buy: 18,
  build: 18,
  sell: 12,
  rent: [25, 40, 25],
  passgo: [10, 30, 10],
  jail: [40, 30, 40],
  card: 10,
  "auction-win": 20,
  bankrupt: [80, 40, 120],
  win: [30, 40, 30, 40, 60],
  turn: [30, 40, 30],
};

function hapticsOn() {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== "0";
  } catch (_err) {
    return true;
  }
}

function hapticsSupported() {
  try {
    return typeof navigator.vibrate === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch (_err) {
    return false;
  }
}

function setHaptics(on) {
  try {
    localStorage.setItem(HAPTICS_KEY, on ? "1" : "0");
  } catch (_err) {}
  if (on) buzz(20);
  if (typeof refreshSettingsViews === "function") refreshSettingsViews();
}

function buzz(pattern) {
  if (!pattern || !hapticsOn() || !hapticsSupported()) return;
  try {
    navigator.vibrate(pattern);
  } catch (_err) {}
}

// Called with each sound. Only what this device's player does (or what
// happens to them) vibrates, not every move an AI or a rival makes.
function hapticForSfx(name) {
  const pattern = HAPTIC_PATTERNS[name];
  if (!pattern || name === "turn") return;
  if (name === "rent" || name === "win" || name === "bankrupt") {
    buzz(pattern);
    return;
  }
  const p = G && Array.isArray(G.players) ? G.players[G.currentPlayerIdx] : null;
  if (p && !isAiSeat(p) && canLocalControlTurn()) buzz(pattern);
}

// ── Turn banner ────────────────────────────────────────────────────────────
// A short "Your turn" moment when play passes to someone on this device, so a
// shared phone can be handed over and nobody misses that it is their go.
const TURN_BANNER = { game: "", seen: new Set(), timer: 0 };

function maybeShowTurnBanner() {
  if (!G || !Array.isArray(G.players) || G.gameOver) return;
  const screen = document.getElementById("game-screen");
  if (!screen || screen.classList.contains("hidden")) return;
  if (DEBT_PROMPT.active || G.debtTurnReturn) return;
  const p = G.players[G.currentPlayerIdx];
  if (!p || p.bankrupt) return;
  const game = String(G.gameStartedAt || "");
  if (TURN_BANNER.game !== game) {
    TURN_BANNER.game = game;
    TURN_BANNER.seen = new Set();
  }
  const key = `${Number(G.turnCount) || 0}|${G.currentPlayerIdx}`;
  if (TURN_BANNER.seen.has(key)) return;
  TURN_BANNER.seen.add(key);
  if (isAiSeat(p)) return;
  if (isOnlineGame() && p.uid !== ONLINE.localUid) return;
  const humansHere = G.players.filter((x) => !x.bankrupt && !isAiSeat(x)).length;
  const text = isOnlineGame() || humansHere <= 1 ? uiText("Your turn") : uiText(`${p.name}'s turn`);
  showTurnBanner(p, text);
  buzz(HAPTIC_PATTERNS.turn);
}

function showTurnBanner(p, text) {
  const host = document.querySelector("#game-screen .board-wrapper") || document.body;
  document.querySelectorAll(".turn-banner").forEach((el) => el.remove());
  const el = document.createElement("div");
  el.className = "turn-banner";
  el.setAttribute("aria-hidden", "true");
  el.style.setProperty("--turn-color", sanitizeColor(p.color, "#f4c542"));
  el.innerHTML = `<span class="turn-banner-token">${escHtml(p.token)}</span><span class="turn-banner-text">${escHtml(text)}</span>`;
  host.appendChild(el);
  clearTimeout(TURN_BANNER.timer);
  TURN_BANNER.timer = setTimeout(() => el.remove(), prefersReducedMotion() ? 1000 : 1500);
}
