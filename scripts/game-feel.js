// ═══════════════════════════════════════════════
//  GAME FEEL
//  Money animations, title deeds, card reveals, match stats and the
//  synthesised sound effects. Everything here only reads G (apart from the
//  stats counters), so it behaves the same offline, online and on LAN.
// ═══════════════════════════════════════════════

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_err) {
    return false;
  }
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
  const row = (label, value, strong = false) =>
    `<div class="deed-row${strong ? " is-strong" : ""}"><span>${label}</span><span>${value}</span></div>`;
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
      return { text: "Nearest station · double rent if it's owned", tone: "move" };
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

function presentCardReveal(type, card, p) {
  const box = document.getElementById("deck-card");
  if (!box) return;
  const isChance = type === "chance";
  box.dataset.deck = isChance ? "chance" : "community";
  const backTitle = document.getElementById("card-back-title");
  const backIcon = document.getElementById("card-back-icon");
  if (backTitle) backTitle.textContent = isChance ? "Chance" : "Community Chest";
  if (backIcon) backIcon.textContent = isChance ? "?" : "📦";
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
    <div class="winner-leader-title">Match summary${length ? ` · ${length}` : ""}${turns ? ` · ${turns} turns` : ""}</div>
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
