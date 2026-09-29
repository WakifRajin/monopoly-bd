#!/usr/bin/env node
/*
 * Regenerates the README screenshots in docs/screenshots/.
 *
 *   npm install
 *   npm run screenshots
 *
 * Serves the working tree on a local port, lets an all-AI match play out at
 * high speed with a fixed random seed, then hands one seat to a human at the
 * start of their turn and captures real game states on a desktop and a phone
 * viewport.
 *
 * The AI players rarely accept each other's trades, so an all-AI match never
 * completes a colour group and never builds. The script therefore plays one
 * short turn as the human: a trade that completes a group, then a few houses.
 * Both go through the game's own trade and build actions, so the board, cash
 * and log are exactly what a player doing the same would see.
 *
 * Uses the installed Chrome (playwright-core does not download browsers).
 * Set CHROME_CHANNEL=msedge to use Edge instead.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "screenshots");
const SEED = 20260927;
// Rounds of play before capturing. Enough for players to own most of the board
// and start building; not so many that someone has already gone bankrupt.
const TARGET_TURNS = 48;
const PLAYERS = ["Ayesha", "Rafi", "Nusrat", "Tanvir"];

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const PHONE = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

function serve(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.join(root, urlPath);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, "index.html");
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// Runs before any page script: a seeded Math.random so the match is the same
// on every run, and a switch to fast-forward timers while the AI plays.
function initScript(seed) {
  let s = seed >>> 0;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const realTimeout = window.setTimeout.bind(window);
  window.__realTimeout = realTimeout;
  window.__timeScale = 1;

  // The colour group player 0 can complete with a single trade: they own at
  // least one of it, and whatever they lack (one or two properties) belongs
  // to a single opponent.
  window.__tradePlan = () => {
    const me = G.players[0];
    const groups = {};
    SPACES.filter((s) => s.type === "property").forEach((s) => {
      (groups[s.group] = groups[s.group] || []).push(s.id);
    });
    let plan = null;
    for (const ids of Object.values(groups)) {
      const mine = ids.filter((id) => G.properties[id].owner === me.id);
      const missing = ids.filter((id) => G.properties[id].owner !== me.id);
      if (mine.length < 1 || missing.length < 1 || missing.length > 2) continue;
      const ownerId = G.properties[missing[0]].owner;
      if (missing.some((id) => G.properties[id].owner !== ownerId)) continue;
      const clean = ids.every(
        (id) => !G.properties[id].houses && !G.properties[id].hotel && !G.properties[id].mortgaged,
      );
      if (ownerId == null || !clean || G.players[ownerId].bankrupt) continue;
      const value = ids.reduce((sum, id) => sum + (SPACES[id].price || 0), 0);
      // Pay 30% of the list price on top of a swapped property, and only pick
      // a group where one house on each square is still affordable after it.
      const ask = missing.reduce((sum, id) => sum + (SPACES[id].price || 0), 0);
      const fromMoney = Math.round((ask * 0.3) / 50) * 50;
      const oneRound = (SPACES[ids[0]].house || 0) * ids.length;
      if (me.money - fromMoney - 1000 < oneRound) continue;
      if (!plan || value > plan.value) plan = { ids, needIds: missing, ownerId, value, fromMoney };
    }
    return plan;
  };

  window.setTimeout = (fn, ms, ...args) =>
    realTimeout(fn, Math.max(0, (Number(ms) || 0) * window.__timeScale), ...args);
}

async function newPage(browser, viewport, seed = SEED) {
  const { width, height, ...rest } = viewport;
  const context = await browser.newContext({
    viewport: { width, height },
    ...rest,
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  // Screenshot runs should not count as visits or touch the live database.
  await context.route(
    /googletagmanager\.com|google-analytics\.com|firebasedatabase\.app|identitytoolkit|securetoken/,
    (route) => route.abort(),
  );
  await context.addInitScript(initScript, seed);
  const page = await context.newPage();
  page.on("pageerror", (err) => console.warn("  page error:", err.message));
  return page;
}

async function openHome(page, base) {
  await page.goto(`${base}/?nosw`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

async function startMatch(page, { allAi }) {
  await page.evaluate(
    async ({ names, allAi }) => {
      openOfflineSetupPage();
      await new Promise((r) => window.__realTimeout(r, 150));
      // Set directly: setTimerDuration() also shows a toast and, on phones,
      // reopens the settings drawer.
      TIMER.duration = 0;
      const timerInput = document.getElementById("lobby-timer");
      if (timerInput) timerInput.value = "0";
      while (lobbyPlayers.length < names.length) addPlayerSlot("ai");
      lobbyPlayers.forEach((p, i) => {
        p.kind = i > 0 ? "ai" : "human";
        p.name = names[i];
      });
      renderLobby();
      document.querySelectorAll(".name-input").forEach((input, i) => {
        input.value = names[i];
      });
      await startGame();
      // Ayesha is a human seat (so the match is recorded as one); the AI
      // plays it only while the script fast-forwards.
      if (allAi) {
        G.players[0].kind = "ai";
        // The scheduler caches whose turn it last saw; reset it after the flip.
        clearOfflineAiTimer(true);
      }
    },
    { names: PLAYERS, allAi },
  );
  await page.waitForTimeout(400);
}

// Plays an all-AI match at high speed, then stops at the start of player 0's
// turn and gives that seat back to a human so the controls are live.
async function playUntilHumanTurn(page) {
  const turns = await page.evaluate(async (target) => {
    const original = maybeScheduleOfflineAiTurn;
    const originalEndTurn = endTurn;
    let stopped = false;
    // The log only keeps its last 250 lines, so count turns as they end.
    let ended = 0;
    endTurn = function (...args) {
      ended++;
      return originalEndTurn.apply(this, args);
    };
    const turnCount = () => ended;
    maybeScheduleOfflineAiTurn = function (...args) {
      // Past the target, keep going until a trade can complete a group, with
      // a limit so a match that never offers one still gets captured.
      const ready =
        turnCount() >= target &&
        (window.__tradePlan() ||
        Object.values(G.properties).some((x) => x && (x.houses || x.hotel)) ||
        turnCount() >= target + 80) &&
        G.currentPlayerIdx === 0 &&
        G.phase === "roll" &&
        !G.players[0].inJail &&
        !G.auctionState &&
        !G.pendingTrade &&
        !G.debtPrompt;
      if (!stopped && ready) {
        stopped = true;
        G.players[0].kind = "human";
        return;
      }
      if (stopped) return;
      return original.apply(this, args);
    };
    window.__timeScale = 0.02;
    maybeScheduleOfflineAiTurn();
    const started = performance.now();
    while (!stopped && !G.gameOver && performance.now() - started < 180000) {
      await new Promise((r) => window.__realTimeout(r, 50));
    }
    window.__timeScale = 1;
    maybeScheduleOfflineAiTurn = original;
    endTurn = originalEndTurn;
    clearOfflineAiTimer(true);
    document.querySelectorAll(".overlay.show").forEach((o) => o.classList.remove("show"));
    renderAll();
    updateActionButtons();
    if (stopped) return turnCount();
    return {
      turns: turnCount(),
      gameOver: !!G.gameOver,
      phase: G.phase,
      current: G.players[G.currentPlayerIdx]?.name,
      auction: !!G.auctionState,
      trade: !!G.pendingTrade,
      debt: !!(G.debtPrompt && G.debtPrompt.active),
      overlays: [...document.querySelectorAll(".overlay.show")].map((o) => o.id),
      lastLog: G.log.slice(-3).map((l) => l.text),
    };
  }, TARGET_TURNS);
  if (typeof turns !== "number") {
    throw new Error(`Match ended or stalled: ${JSON.stringify(turns)}`);
  }
  // Let toasts and the last move animation finish.
  await page.waitForTimeout(3500);
  return turns;
}

// Ayesha's turn: trade for the one property that completes her best colour
// group, then build evenly across it while keeping a cash cushion.
async function playHumanTurn(page) {
  const summary = await page.evaluate(() => {
    const me = G.players[0];
    const plan = window.__tradePlan();
    if (!plan) {
      const houses = Object.values(G.properties).filter((x) => x && (x.houses || x.hotel)).length;
      return houses ? `no trade needed, built ${houses} (by the AI)` : "no group one trade away";
    }

    const partner = G.players[plan.ownerId];
    const give = me.properties.find(
      (id) =>
        !plan.ids.includes(id) &&
        SPACES[id].type === "property" &&
        !G.properties[id].houses &&
        !G.properties[id].mortgaged &&
        SPACES.filter((s) => s.group === SPACES[id].group).some(
          (s) => G.properties[s.id].owner === partner.id,
        ),
    );
    const { fromMoney } = plan;
    addLog(`${me.name} proposed a trade to ${partner.name}.`, "important");
    applyAcceptedTrade({
      fromId: me.id,
      toId: partner.id,
      fromProps: give != null ? [give] : [],
      toProps: [...plan.needIds],
      fromMoney,
      toMoney: 0,
    });

    let built = 0;
    const cushion = 1000;
    for (let round = 0; round < 3; round++) {
      for (const id of plan.ids) {
        const cost = SPACES[id].house || 0;
        if (me.money - cost < cushion) continue;
        const before = G.properties[id].houses;
        buildHouse(id);
        if (G.properties[id].houses > before) built++;
      }
    }
    renderAll();
    updateActionButtons();
    return `traded for ${plan.needIds.map((id) => SPACES[id].name).join(" and ")}, built ${built} house${built === 1 ? "" : "s"}`;
  });
  await page.waitForTimeout(1500);
  await closeAll(page);
  return summary;
}

async function snapshotState(page) {
  return page.evaluate(() => JSON.parse(JSON.stringify(G)));
}

async function loadState(page, state) {
  await page.evaluate((state) => {
    clearOfflineAiTimer(true);
    Object.keys(G).forEach((k) => delete G[k]);
    Object.assign(G, state);
    buildBoard();
    renderAll();
    updateActionButtons();
  }, state);
  await page.waitForTimeout(800);
}

// Picks the most built-up property, falling back to any owned one.
async function showcaseProperty(page) {
  return page.evaluate(() => {
    const owned = SPACES.filter(
      (s) => s.type === "property" && G.properties[s.id]?.owner != null,
    );
    owned.sort(
      (a, b) =>
        (G.properties[b.id].hotel ? 5 : G.properties[b.id].houses || 0) -
        (G.properties[a.id].hotel ? 5 : G.properties[a.id].houses || 0),
    );
    return owned[0]?.id ?? 1;
  });
}

// Windows can briefly lock a PNG that an image viewer or indexer has open.
async function screenshotWithRetry(page, file) {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.screenshot({ path: file });
      return;
    } catch (err) {
      if (attempt >= 5 || !/UNKNOWN|EBUSY|EPERM/.test(String(err.code || err))) throw err;
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
}

async function shot(page, name) {
  await page.waitForTimeout(450);
  // A toast from an earlier step would otherwise sit on top of the next shot.
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  await page.waitForTimeout(250);
  await screenshotWithRetry(page, path.join(OUT_DIR, `${name}.png`));
  console.log(`  ${name}.png`);
}

async function closeAll(page) {
  await page.evaluate(() => {
    document.querySelectorAll(".overlay.show").forEach((o) => o.classList.remove("show"));
    if (typeof closeDrawer === "function") closeDrawer();
  });
  await page.waitForTimeout(300);
}

async function openTrade(page) {
  await page.evaluate(() => {
    const me = G.players[0];
    const partner = G.players
      .filter((p) => p.id !== me.id && !p.bankrupt)
      .sort((a, b) => b.properties.length - a.properties.length)[0];
    openTradeModal();
    const sel = document.getElementById("trade-partner");
    sel.value = String(partner.id);
    const free = (id) =>
      !G.properties[id]?.houses && !G.properties[id]?.hotel && !G.properties[id]?.mortgaged;
    const mine = me.properties.filter(free).slice(0, 1);
    const theirs = partner.properties.filter(free).slice(0, 1);
    tradeSelected = { mine, theirs };
    // A plausible sweetener she can actually afford.
    document.getElementById("trade-my-money").value = Math.min(
      1000,
      Math.floor(me.money / 2 / 100) * 100,
    );
    renderTradeProps();
  });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await serve(ROOT);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    channel: process.env.CHROME_CHANNEL || "chrome",
    headless: true,
    // SwiftShader gives headless Chrome WebGL for the 3D board shot.
    args: ["--hide-scrollbars", "--autoplay-policy=user-gesture-required", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });

  try {
    console.log("Desktop");
    // Matches differ run to run (AI timing still varies), and some never
    // offer a group to complete. Try a few seeds until one ends with houses.
    let desk = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      desk = await newPage(browser, DESKTOP, SEED + attempt);
      try {
        await openHome(desk, base);
        await startMatch(desk, { allAi: true });
        const turns = await playUntilHumanTurn(desk);
        const summary = await playHumanTurn(desk);
        console.log(`  seed ${SEED + attempt}: ${turns} turns, ${summary}`);
        if (/built [1-9]/.test(summary)) break;
      } catch (err) {
        console.log(`  seed ${SEED + attempt}: ${err.message}`);
      }
      await desk.context().close();
      desk = null;
    }
    if (!desk) throw new Error("No seed produced a usable match.");
    const state = await snapshotState(desk);
    await shot(desk, "desktop-game");

    await desk.evaluate(() => setBoard3d(true, false));
    await desk.waitForFunction(() => document.body.classList.contains("board-3d"), null, { timeout: 30000 });
    await desk.waitForTimeout(2500);
    await shot(desk, "desktop-game-3d");
    await desk.evaluate(() => setBoard3d(false, false));
    await desk.waitForTimeout(900);

    const propId = await showcaseProperty(desk);
    await desk.evaluate((id) => showSpaceInfo(id), propId);
    await shot(desk, "desktop-property");
    await closeAll(desk);

    await openTrade(desk);
    await shot(desk, "desktop-trade");
    await closeAll(desk);

    await desk.evaluate(() => showPlayerPortfolio(0, "log"));
    await shot(desk, "desktop-history");
    await closeAll(desk);

    // Home last, so "Recent activity" lists the match that was just played.
    await desk.evaluate(() => showScreen("home-screen"));
    await shot(desk, "desktop-home");

    const editor = await newPage(browser, DESKTOP);
    await editor.goto(`${base}/boardeditor.html?nosw`, { waitUntil: "networkidle" });
    await editor.evaluate(() => document.fonts.ready);
    await shot(editor, "desktop-board-editor");
    await editor.context().close();

    console.log("Phone");
    const phone = await newPage(browser, PHONE);
    await openHome(phone, base);
    await startMatch(phone, { allAi: false });
    await loadState(phone, state);
    await shot(phone, "phone-game");

    await phone.evaluate(() => openDrawer("log"));
    await phone.waitForTimeout(600);
    await shot(phone, "phone-log");
    await closeAll(phone);

    await phone.evaluate(() => showPlayerPortfolio(0));
    await shot(phone, "phone-portfolio");
    await closeAll(phone);

    await phone.evaluate((id) => showSpaceInfo(id), propId);
    await shot(phone, "phone-property");
    await closeAll(phone);

    await phone.evaluate(() => showScreen("home-screen"));
    await shot(phone, "phone-home");

    await desk.context().close();
    await phone.context().close();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
