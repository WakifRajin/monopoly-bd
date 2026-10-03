#!/usr/bin/env node
/*
 * Game tests: loads the real game in headless Chrome and checks the rules,
 * house rules, trading, the turn timer, pausing, saving, the AI, the Bangla
 * interface and the app shell. Dice are forced where a test needs a roll.
 *
 *   npm test                     (Chrome must be installed)
 *   CHROME_PATH=/path/to/chrome npm test
 *
 * Serves the repository on a free local port, so no dev server is needed.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".mp3": "audio/mpeg",
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, buf) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `  (${detail})` : ""}`);
  // On GitHub Actions a failure also shows on the run's summary page.
  if (!ok && process.env.GITHUB_ACTIONS) console.log(`::error title=${name}::${String(detail).replace(/\s+/g, " ").slice(0, 900)}`);
}

(async () => {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  // CI machines have no GPU, and drawing the WebGL table in software slowed
  // every move enough to time tests out. There the game runs on its plain
  // HTML board (what browsers without WebGL get); the 3D table is covered by
  // the screenshot and touch checks. TEST_WEBGL=1 forces WebGL on.
  const noGl = process.env.CI && !process.env.TEST_WEBGL;
  const launch = { headless: true, args: noGl ? ["--disable-webgl", "--disable-3d-apis"] : ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  else launch.channel = "chrome";
  const browser = await chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // The analytics question is answered, so its banner stays out of the way.
  await ctx.addInitScript(() => { try { localStorage.setItem("monopoly_analytics_consent", "denied"); } catch (_e) {} });
  await ctx.route(/googletagmanager|google-analytics|gstatic\.com\/firebasejs/, (r) => r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const open = async () => {
    await page.goto(`${base}/index.html?nosw`, { waitUntil: "load" });
    await page.waitForFunction(() => typeof startGame === "function" && document.getElementById("home-screen"));
  };
  // A fresh game on this device: `ai` seats after the first two humans.
  const newGame = (opts = {}) =>
    page.evaluate(async (opts) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      Object.keys(localStorage).filter((k) => k.startsWith("monopoly_save")).forEach((k) => localStorage.removeItem(k));
      openOfflineSetupPage();
      await wait(100);
      for (let i = 0; i < (opts.ai || 0); i++) document.getElementById("add-ai-btn").click();
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
      set("lobby-timer", String(opts.timer ?? 0));
      set("auction-enabled", opts.auctions === false ? "off" : "on");
      set("rule-free-parking", opts.freeParking ? "on" : "off");
      set("rule-jail-rent", opts.noRentInJail ? "off" : "on");
      set("rule-go-bonus", opts.doubleGo ? "on" : "off");
      set("rule-time-limit", String(opts.timeLimit || 0));
      set("ai-difficulty", opts.aiLevel || "normal");
      if (opts.theme) applyThemeById(opts.theme);
      await startGame(true);
      await wait(300);
      TIMER.duration = opts.timer ?? 0;
      AI_SPEED.factor = 0.25;
      MOVE_SPEED.factor = 0.25;
      if (!opts.keepAi) G.players.forEach((p) => (p.kind = "human"));
      clearOfflineAiTimer(true);
      window.__q = [];
      if (!window.__origRand) {
        window.__origRand = rand;
        window.rand = (a, b) => (window.__q.length ? window.__q.shift() : window.__origRand(a, b));
      }
      document.querySelectorAll(".coach-tip").forEach((t) => t.remove());
      return G.players.length;
    }, opts);
  // Roll forced dice for the current player and wait for everything to settle.
  const roll = (d1, d2) =>
    page.evaluate(async ([d1, d2]) => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      window.__q = [d1, d2];
      await rollDice();
      for (let i = 0; i < 80 && (MOVE_FX.active || ONLINE.pendingCardResolutions > 0); i++) await wait(50);
      await wait(120);
    }, [d1, d2]);
  const closeAll = () => page.evaluate(() => document.querySelectorAll(".overlay.show").forEach((o) => o.classList.remove("show")));
  const readCard = () =>
    page.evaluate(async () => {
      const b = document.querySelector("#card-overlay.show .modal > .btn");
      if (b && b.onclick) await b.onclick();
      for (let i = 0; i < 80 && (MOVE_FX.active || ONLINE.pendingCardResolutions > 0); i++) await new Promise((r) => setTimeout(r, 50));
    });
  // Put a card of `action` on top of a deck.
  const stackDeck = (type, action, value) =>
    page.evaluate(([type, action, value]) => {
      const deck = type === "chance" ? G.chanceDeck : G.communityDeck;
      const key = type === "chance" ? "chanceIdx" : "communityIdx";
      if (!(G[key] < deck.length)) G[key] = 0;
      const fits = (c) => c.action === action && (value === null || c.value === value);
      const i = deck.findIndex((c, j) => j >= G[key] && fits(c));
      const card = deck.splice(i >= 0 ? i : deck.findIndex(fits), 1)[0];
      deck.splice(G[key], 0, card);
    }, [type, action, value === undefined ? null : value]);

  await open();
  console.log("\nRules");
  await newGame();
  await page.evaluate(() => { G.players[0].pos = 37; });
  await roll(1, 1); // 39: an unowned street
  check("doubles land on a property to buy", await page.evaluate(() => hasPendingBuy()));
  await page.evaluate(() => confirmBuy());
  check("buying after doubles keeps the extra roll", await page.evaluate(() => G.phase === "roll"));
  // "Don't buy" only exists with auctions off.
  await page.evaluate(() => { G.auctionEnabled = false; G.players[0].pos = 4; });
  await roll(1, 1);
  await page.evaluate(() => declineBuy());
  check("skipping after doubles keeps the extra roll", await page.evaluate(() => G.phase === "roll" && !hasPendingBuy()));
  await page.evaluate(() => { G.auctionEnabled = true; });
  await closeAll();
  await roll(2, 2);
  await closeAll();
  check("three doubles send you to jail", await page.evaluate(() => G.players[0].inJail));
  await page.evaluate(() => endTurn());

  await newGame({ auctions: false });
  await page.evaluate(() => { const p = G.players[0]; p.inJail = true; p.pos = 10; });
  await roll(1, 1); // out of jail on doubles, to 12: an unowned utility
  await page.evaluate(() => declineBuy());
  await closeAll();
  check("leaving jail on doubles gives no extra roll", await page.evaluate(() => !G.players[0].inJail && G.players[0].pos === 12 && G.phase === "end"));

  await newGame();
  await page.evaluate(() => { G.players[0].pos = 20; });
  await stackDeck("chance", "jail");
  await roll(1, 1); // 22 is Chance
  await readCard();
  await closeAll();
  check("a jail card after doubles ends the turn", await page.evaluate(() => G.players[0].inJail && G.phase === "end"));

  await newGame();
  await page.evaluate(() => { G.properties[5].owner = 1; G.players[1].railroads.push(5); G.players[0].pos = 33; });
  await stackDeck("chance", "nearest", "railroad");
  const before = await page.evaluate(() => [G.players[0].money, G.players[1].money]);
  await roll(1, 2); // 36 is Chance
  await readCard();
  await closeAll();
  const after = await page.evaluate(() => [G.players[0].money, G.players[1].money, calcRent(SPACES[5], G.properties[5]), getThemeGoSalary(G.boardThemeId)]);
  check("nearest-station card charges double rent", after[1] - before[1] === after[2] * 2, JSON.stringify({ before, after }));

  // BUET board: its own names and decks, and BIIS's "pay thrice" card.
  await newGame({ theme: "buet" });
  const buet = await page.evaluate(() => ({ go: SPACES[0].name, biis: SPACES[33].name, cgpa: SPACES[7].name, rail: SPACES[35].name, deck: G.communityDeck.length + G.chanceDeck.length }));
  check("the BUET board names its squares as printed", buet.go === "BUET Main Gate" && buet.biis === "BIIS" && buet.cgpa === "CGPA" && buet.rail === "Mechanical Building" && buet.deck === 32, JSON.stringify(buet));
  await page.evaluate(() => { G.properties[35].owner = 1; G.players[1].railroads.push(35); G.players[0].pos = 29; });
  await stackDeck("community", "nearest", "railroad");
  const buetBefore = await page.evaluate(() => G.players[1].money);
  await roll(1, 3); // 33 is BIIS
  await readCard();
  await closeAll();
  const buetAfter = await page.evaluate(() => [G.players[1].money, calcRent(SPACES[35], G.properties[35])]);
  check("BIIS nearest-building card charges three times the rent", buetAfter[0] - buetBefore === buetAfter[1] * 3, JSON.stringify({ buetBefore, buetAfter }));
  await page.evaluate(() => applyThemeById("dhaka"));

  const deck = await page.evaluate(() => {
    G.jailCardHolder = { chance: 1 };
    G.chanceIdx = 0;
    let held = 0;
    for (let i = 0; i < G.chanceDeck.length * 2; i++) if (drawFromDeck("chance").action === "jailcard") held++;
    G.jailCardHolder = {};
    // From the top of a deck: two full passes, one reshuffle between them.
    G.chanceIdx = 0;
    let free = 0;
    for (let i = 0; i < G.chanceDeck.length * 2; i++) if (drawFromDeck("chance").action === "jailcard") free++;
    return { held, free };
  });
  check("a held Get Out of Jail Free card is out of the deck", deck.held === 0);
  check("decks keep dealing after running out (reshuffle)", deck.free === 2);

  await newGame();
  const bail = await page.evaluate(async () => {
    const p = G.players[0];
    p.inJail = true;
    p.jailTurns = 2;
    const bail = getThemeJailBail(G.boardThemeId);
    p.money = bail - 10;
    G.properties[39].owner = 0;
    p.properties.push(39);
    return bail;
  });
  await roll(1, 2);
  const debt = await page.evaluate(() => [DEBT_PROMPT.active, DEBT_PROMPT.recipientId]);
  check("an unaffordable forced bail opens the debt prompt, owed to the bank", debt[0] === true && debt[1] === null, JSON.stringify(debt));
  const settle = await page.evaluate(() => { const m = G.players[0].money; mortgageProp(39); return { freed: !G.players[0].inJail, paid: m + mortgageValueForSpace(SPACES[39]) - G.players[0].money, log: G.log.slice(-2).map((l) => l.text) }; });
  check("settling the forced bail frees the player", settle.freed);
  check("the bail goes to the bank, not to a player", settle.paid === bail && settle.log.some((t) => /to the bank/.test(t)), JSON.stringify(settle));
  await closeAll();

  const misc = await page.evaluate(() => {
    const [p0, p1] = G.players;
    p1.money = 50;
    G.properties[39].mortgaged = true;
    const interest = validatePendingTrade({ fromId: 0, toId: 1, fromProps: [39], toProps: [], fromMoney: 0, toMoney: 0 });
    G.properties[39].mortgaged = false;
    return { interest, steps60: auctionBidSteps(60).join(","), steps2000: auctionBidSteps(2000).join(",") };
  });
  check("a trade the receiver can't pay interest on is refused", /interest/.test(misc.interest), misc.interest);
  check("auction steps fit the price", misc.steps60 === "2,5,10,20" && misc.steps2000 === "100,200,500,1000", JSON.stringify(misc));

  const hotel = await page.evaluate(() => {
    const p = G.players[0];
    G.properties.forEach((pr) => pr && ((pr.houses = 0), (pr.hotel = false)));
    const grp = SPACES[39].group;
    const ids = SPACES.filter((s) => s.type === "property" && s.group === grp).map((s) => s.id);
    ids.forEach((id) => { G.properties[id].owner = 0; if (!p.properties.includes(id)) p.properties.push(id); G.properties[id].hotel = true; });
    let used = 0;
    for (const s of SPACES) if (s.type === "property" && !ids.includes(s.id) && used < 32) { G.properties[s.id].owner = 1; G.properties[s.id].houses = 4; used += 4; }
    G.currentPlayerIdx = 0;
    G.phase = "end";
    const m = p.money;
    sellHouse(39);
    const r = { sold: !G.properties[39].hotel, refund: p.money - m, expect: Math.floor(SPACES[39].house / 2) * 5 };
    G.properties.forEach((pr) => pr && ((pr.houses = 0), (pr.hotel = false)));
    return r;
  });
  check("a hotel sells during a house shortage", hotel.sold && hotel.refund === hotel.expect, JSON.stringify(hotel));
  await closeAll();

  console.log("\nHouse rules");
  await newGame({ freeParking: true });
  const pot = await page.evaluate(async () => {
    const p = G.players[0];
    p.pos = 1; // 1 + 3 = 4, Income Tax
    return { tax: SPACES[4].amount };
  });
  await roll(1, 2);
  const potAfterTax = await page.evaluate(() => G.parkingPot);
  check("with the jackpot, tax goes into the Free Parking pot", potAfterTax === pot.tax, `${potAfterTax}`);
  await closeAll();
  await page.evaluate(() => { G.phase = "roll"; G.players[0].pos = 17; });
  const m0 = await page.evaluate(() => G.players[0].money);
  await roll(1, 2); // 20, Free Parking
  const collected = await page.evaluate(() => [G.players[0].money, G.parkingPot]);
  check("landing on Free Parking collects the pot", collected[0] - m0 === pot.tax && collected[1] === 0, JSON.stringify({ m0, collected }));

  await newGame({ noRentInJail: true });
  const jailRent = await page.evaluate(() => { G.properties[3].owner = 1; G.players[1].properties.push(3); G.players[1].inJail = true; G.players[0].pos = 1; return G.players[0].money; });
  await roll(1, 1);
  check("an owner in jail collects no rent", await page.evaluate((m) => G.players[0].money === m, jailRent));
  await closeAll();

  await newGame({ doubleGo: true });
  const go = await page.evaluate(() => { G.players[0].pos = 37; return [G.players[0].money, getThemeGoSalary(G.boardThemeId)]; });
  await roll(1, 2); // exactly GO
  check("landing exactly on GO pays double", await page.evaluate(([m, s]) => G.players[0].money - m === 2 * s, go));

  await newGame({ timeLimit: 30 });
  const midRound = await page.evaluate(() => { G.gameStartedAt = Date.now() - 31 * 60000; G.players[1].money += 5000; G.phase = "end"; endTurn(); return !G.gameOver && G.currentPlayerIdx === 1; });
  check("time up mid-round: the round is finished first", midRound);
  await page.evaluate(() => { G.phase = "end"; endTurn(); });
  const timeEnd = await page.evaluate(() => [G.gameOver, G.endReason, G.winnerId, document.getElementById("winner-screen").classList.contains("hidden")]);
  check("when time runs out, the richest player wins", timeEnd[0] && timeEnd[1] === "time" && timeEnd[2] === 1 && !timeEnd[3], JSON.stringify(timeEnd));

  console.log("\nRule fixes");
  await newGame();
  await page.evaluate(() => { G.players[0].pos = 4; });
  await roll(1, 1); // 6: an unowned street
  const skipHidden = await page.evaluate(() => getComputedStyle(document.getElementById("buy-skip-btn")).display === "none");
  await closeAll();
  const endBlocked = await page.evaluate(() => { endTurn(); return G.currentPlayerIdx === 0 && hasPendingBuy() && document.getElementById("buy-overlay").classList.contains("show"); });
  check("with auctions on there is no Don't buy, and End turn waits for the auction", skipHidden && endBlocked);
  const toAuction = await page.evaluate(() => { declineBuy(); return !!G.auctionState && G.auctionState.propId === 6 && !hasPendingBuy(); });
  check("not buying sends the property to auction", toAuction);
  const typed = await page.evaluate(() => {
    const a = G.auctionState;
    const open = a.currentBid;
    placeBidTo(open); // the first bid may match the opening bid
    const first = a.highBidder !== null && a.currentBid === open;
    placeBidTo(open); // ...but the next must raise it
    const refused = a.currentBid === open;
    placeBidTo(open + 77);
    return first && refused && a.currentBid === open + 77;
  });
  check("a typed bid is accepted, and must beat the current bid", typed);
  await page.evaluate(() => { while (G.auctionState) passAuction(); });
  await closeAll();

  await newGame({ ai: 1 });
  await page.evaluate(() => { G.players[1].money = 0; G.players[0].pos = 0; });
  await stackDeck("community", "birthday");
  await roll(1, 1); // 2: Community Chest, rolled as doubles
  await readCard();
  await closeAll();
  await page.evaluate(() => runOfflineAiStep());
  const debtTurn = await page.evaluate(() => G.currentPlayerIdx);
  const back = await page.evaluate(() => { G.players[1].money = 5000; tryResolveDebtPrompt(); return [G.currentPlayerIdx, G.phase, !!G.debtTurnReturn]; });
  check("a birthday debt hands the turn back (with the doubles roll)", debtTurn === 1 && back[0] === 0 && back[1] === "roll" && !back[2], JSON.stringify({ debtTurn, back }));
  await closeAll();

  await newGame();
  await page.evaluate(() => { G.players[0].pos = 4; });
  await stackDeck("chance", "back");
  await roll(1, 2); // 7: Chance
  await readCard();
  await closeAll();
  check("Go back 3 spaces moves back without GO", await page.evaluate(() => G.players[0].pos === 4));

  await newGame();
  const util = await page.evaluate(() => { G.properties[12].owner = 1; G.players[1].utilities.push(12); G.players[0].pos = 4; return G.players[1].money; });
  await stackDeck("chance", "nearest", "utility");
  await roll(1, 2); // 7: Chance, then the nearest utility (12)
  await readCard();
  await closeAll();
  const utilAfter = await page.evaluate(() => [G.players[0].pos, G.players[1].money, 3 * 10 * utilityCardScale()]);
  check("Nearest utility card charges ten times the dice", utilAfter[0] === 12 && utilAfter[1] - util === utilAfter[2], JSON.stringify({ util, utilAfter }));

  await newGame({ ai: 1 });
  const each = await page.evaluate(() => { G.players[0].pos = 4; return G.players.map((p) => p.money); });
  await stackDeck("chance", "payeach");
  await roll(1, 2);
  await readCard();
  await closeAll();
  const eachAfter = await page.evaluate(() => [G.players.map((p) => p.money), G.chanceDeck.find((c) => c.action === "payeach").value]);
  const others = each.length - 1;
  check("Pay each player pays every other player", each.slice(1).every((m, i) => eachAfter[0][i + 1] - m === eachAfter[1]) && each[0] - eachAfter[0][0] === others * eachAfter[1], JSON.stringify({ each, eachAfter }));
  check("both decks hold 16 cards", await page.evaluate(() => G.chanceDeck.length === 16 && G.communityDeck.length === 16));

  await newGame();
  const jailCard = await page.evaluate(() => { const p = G.players[0]; p.inJail = true; p.pos = 10; p.jailTurns = 2; p.jailFreeCards = 1; G.jailCardHolder = { chance: 0 }; return p.money; });
  await roll(1, 2);
  await closeAll();
  check("third jail turn uses a held card instead of cash", await page.evaluate((m) => { const p = G.players[0]; return !p.inJail && p.jailFreeCards === 0 && p.money >= m - 0 && p.pos === 13; }, jailCard));

  await newGame();
  await page.evaluate(() => { const p = G.players[0]; p.inJail = true; p.pos = 10; p.jailTurns = 2; p.money = 10; });
  await roll(1, 2); // misses doubles, must pay bail it cannot afford
  await closeAll();
  const owes = await page.evaluate(() => DEBT_PROMPT.active && G.players[0].inJail && !!G.jailReleaseMove);
  await page.evaluate(async () => { G.players[0].money = 5000; tryResolveDebtPrompt(); for (let i = 0; i < 80 && MOVE_FX.active; i++) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 300)); });
  await closeAll();
  check("after paying a forced bail the player moves by their roll", owes && (await page.evaluate(() => !G.players[0].inJail && G.players[0].pos === 13)));

  await newGame();
  const hotelSale = await page.evaluate(() => {
    // Every house is on the board, and Player 1 owns a hotel set.
    const p = G.players[0];
    [1, 3].forEach((id) => { G.properties[id].owner = 0; p.properties.push(id); G.properties[id].hotel = true; });
    let left = 32;
    SPACES.forEach((sp) => { if (left > 0 && sp.type === "property" && G.properties[sp.id].owner === null) { G.properties[sp.id].houses = Math.min(4, left); left -= G.properties[sp.id].houses; } });
    G.phase = "action";
    openBuildModal();
    const btn = [...document.querySelectorAll("#build-list .build-btn.is-sell")][0];
    const enabled = btn && !btn.disabled;
    const before = p.money;
    sellHouse(1);
    return { enabled, hotelGone: !G.properties[1].hotel, houses: G.properties[1].houses, gain: p.money - before };
  });
  check("a hotel can be sold during a house shortage", hotelSale.enabled && hotelSale.hotelGone && hotelSale.houses === 0, JSON.stringify(hotelSale));
  await closeAll();

  await newGame();
  const fresh = await page.evaluate(() => {
    const [p0, p1] = G.players;
    G.properties[1].owner = 1; p1.properties.push(1); G.properties[1].mortgaged = true;
    G.pendingTrade = { fromId: 0, toId: 1, fromProps: [], toProps: [1], fromMoney: 100, toMoney: 0, fromCards: 0, toCards: 0, createdAt: Date.now() };
    respondTrade(true);
    const value = mortgageValueForSpace(SPACES[1]);
    const cost = unmortgageCostFor(p0, 1);
    const m = p0.money;
    G.phase = "action";
    unmortgageProp(1);
    return { cost, value, paid: m - p0.money, mortgaged: G.properties[1].mortgaged };
  });
  check("a mortgage received in a trade can be lifted without paying interest twice", fresh.cost === fresh.value && fresh.paid === fresh.value && !fresh.mortgaged, JSON.stringify(fresh));
  await closeAll();

  await newGame({ ai: 1, keepAi: true });
  const aiBid = await page.evaluate(() => {
    // An AI with no cash and a mortgageable lone street, at an auction for a
    // card that means nothing to it: it must pass without mortgaging.
    const ai = G.players[2];
    ai.money = 0;
    G.properties[39].owner = 2; ai.properties.push(39);
    G.players.forEach((p, i) => { if (i !== 2) p.kind = "human"; });
    beginAuction(6, { source: "market", bidderStartIdx: 2 });
    runOfflineAiStep();
    return { mortgaged: G.properties[39].mortgaged, passed: G.auctionState ? G.auctionState.passed.has(2) : true };
  });
  check("the AI does not mortgage for an auction it will not win", !aiBid.mortgaged && aiBid.passed, JSON.stringify(aiBid));
  await page.evaluate(() => { while (G.auctionState) passAuction(); });
  await closeAll();


  console.log("\nAuctions");
  await newGame({ ai: 1 });
  const order = await page.evaluate(() => {
    // Three people: the leader is never asked to outbid themselves.
    G.players.length = 3;
    G.players.forEach((p) => (p.kind = "human"));
    beginAuction(6, { source: "market", bidderStartIdx: 0 });
    const a = G.auctionState;
    placeBid(0); // player 1 takes the opening bid
    const second = currentAuctionBidderId();
    passAuction(); // player 2
    const third = currentAuctionBidderId();
    passAuction(); // player 3: player 1 wins without being asked again
    return { second, third, open: !!G.auctionState, owner: G.properties[6].owner };
  });
  check("the leader is never asked to bid against themselves", order.second === 1 && order.third === 2 && !order.open && order.owner === 0, JSON.stringify(order));
  await closeAll();

  await newGame({ ai: 1 });
  const broke = await page.evaluate(() => {
    G.players.length = 3;
    G.players.forEach((p) => (p.kind = "human"));
    G.players[1].money = 10; // cannot cover the opening bid
    beginAuction(6, { source: "market", bidderStartIdx: 1 });
    const first = currentAuctionBidderId();
    const passed = G.auctionState.passed.has(1);
    while (G.auctionState) passAuction();
    return { first, passed };
  });
  check("a player who can't afford the bid drops out instead of being asked", broke.first === 2 && broke.passed, JSON.stringify(broke));
  await closeAll();

  await newGame({ ai: 1, keepAi: true });
  const opening = await page.evaluate(() => {
    // An AI that completes its own set takes the opening price, not more.
    const ai = G.players.find((p) => p.kind === "ai");
    G.players.forEach((p) => { if (p !== ai) p.kind = "human"; });
    G.properties[8].owner = ai.id; ai.properties.push(8);
    G.properties[9].owner = ai.id; ai.properties.push(9);
    beginAuction(6, { source: "market", bidderStartIdx: ai.id });
    const open = G.auctionState.currentBid;
    runOfflineAiStep();
    const r = { open, bid: G.auctionState?.currentBid, leader: G.auctionState?.highBidder, ai: ai.id };
    while (G.auctionState) { if (isAiPlayer(G.players[currentAuctionBidderId()])) { G.auctionState.passed.add(currentAuctionBidderId()); settleAuctionBidder(G.auctionState, G.auctionState.bidderIdx); } else passAuction(); }
    return r;
  });
  check("the AI opens at the opening price instead of jumping above it", opening.bid === opening.open && opening.leader === opening.ai, JSON.stringify(opening));
  await closeAll();

  await newGame({ ai: 2, keepAi: true });
  const stress = await page.evaluate(() => {
    // Every seat an AI, every street and station auctioned in turn.
    G.players.forEach((p) => (p.kind = "ai"));
    const ids = SPACES.filter((sp) => ["property", "railroad", "utility"].includes(sp.type)).map((sp) => sp.id);
    const out = { auctions: 0, stuck: 0, negative: 0, selfRaise: 0, sold: 0, overpaid: 0 };
    for (const id of ids) {
      if (G.properties[id].owner !== null) continue;
      if (!beginAuction(id, { source: "market", bidderStartIdx: out.auctions % G.players.length })) continue;
      out.auctions++;
      let steps = 0;
      while (G.auctionState && steps < 400) {
        const leader = G.auctionState.highBidder;
        const bidder = currentAuctionBidderId();
        if (bidder === leader) out.selfRaise++;
        runOfflineAiStep();
        steps++;
      }
      if (G.auctionState) {
        out.stuck++;
        const a = G.auctionState;
        out.stuckAt = { prop: SPACES[id].name, bid: a.currentBid, leader: a.highBidder, bidder: currentAuctionBidderId(), passed: [...a.passed], money: G.players.map((p) => p.money), log: G.log.slice(-6).map((e) => e.text), debt: DEBT_PROMPT.active, trade: !!G.pendingTrade, fx: MOVE_FX.active, phase: G.phase, cur: G.currentPlayerIdx };
        G.auctionState = null;
      }
      if (G.properties[id].owner !== null) {
        out.sold++;
        if (G.properties[id].owner !== null && SPACES[id].price && false) out.overpaid++;
      }
      if (G.players.some((p) => p.money < 0)) out.negative++;
    }
    return out;
  });
  check("AI auctions always finish, never go negative and never self-raise", stress.auctions > 20 && !stress.stuck && !stress.negative && !stress.selfRaise && stress.sold > 0, JSON.stringify(stress));
  await closeAll();
  console.log("\nTrading");
  await newGame();
  const trade = await page.evaluate(() => {
    const [p0, p1] = G.players;
    G.properties[1].owner = 0; p0.properties.push(1);
    p0.jailFreeCards = 1; G.jailCardHolder = { chance: 0 };
    G.currentPlayerIdx = 1; G.phase = "roll"; // Player 2's turn
    const open = canProposeTradeNow();
    openTradeModal(0);
    document.getElementById("trade-partner").value = "1";
    renderTradeProps();
    tradeSelected.mine = [1];
    document.getElementById("trade-my-cards").value = "1";
    document.getElementById("trade-their-money").value = "100";
    confirmTrade();
    const pending = !!G.pendingTrade && G.pendingTrade.fromId === 0 && G.pendingTrade.fromCards === 1;
    respondTrade(true);
    return { open, pending, owner: G.properties[1].owner, cards: [p0.jailFreeCards, p1.jailFreeCards], holder: G.jailCardHolder.chance };
  });
  check("you can trade on someone else's turn", trade.open && trade.pending, JSON.stringify(trade));
  check("jail cards change hands in a trade", trade.owner === 1 && trade.cards[0] === 0 && trade.cards[1] === 1 && trade.holder === 1, JSON.stringify(trade));
  await closeAll();

  console.log("\nTurn timer");
  await newGame({ timer: 1 });
  await page.evaluate(() => { TIMER.duration = 1; G.players[0].pos = 37; window.__q = [1, 1]; updateActionButtons(); });
  await page.waitForTimeout(3500);
  check("the timer rolls for an idle player", await page.evaluate(() => (G.rollCount || 0) >= 1));
  await page.waitForTimeout(4000);
  check("the timer moves an idle buy decision on", await page.evaluate(() => !hasPendingBuy() && (G.auctionState || G.log.some((l) => /ran out of time to decide/.test(l.text)))));
  await page.evaluate(() => { TIMER.duration = 0; stopTimer(); G.auctionState = null; closeOverlay("auction-overlay"); });

  console.log("\nPause and save");
  await newGame({ ai: 1, keepAi: true });
  const paused = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    G.players[0].kind = "ai";
    pauseGame();
    const log = G.log.length;
    maybeScheduleOfflineAiTurn();
    await wait(1500);
    const still = G.log.length === log;
    resumeGame();
    G.players.forEach((p) => (p.kind = "human"));
    clearOfflineAiTimer(true);
    return { still, pausedMs: G.pausedMs > 1000 };
  });
  check("pausing stops the AI", paused.still);
  check("paused time is recorded for the clock", paused.pausedMs);
  await closeAll();
  const saved = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 40 && (MOVE_FX.active || ONLINE.pendingCardResolutions > 0); i++) await wait(50);
    G.players[0].money = 12345;
    G.properties[6].owner = 1;
    G.players[1].properties.push(6);
    saveGameNow();
    return !!readSavedGame();
  });
  check("the game saves to this device", saved);
  await open();
  check("the home screen offers to continue", await page.evaluate(() => !document.getElementById("hp-continue").hidden));
  const resumed = await page.evaluate(async () => {
    resumeSavedGame();
    await new Promise((r) => setTimeout(r, 400));
    return {
      screen: document.querySelector(".screen:not(.hidden)")?.id,
      money: G.players[0].money,
      owner: G.properties[6].owner,
      pendingBuy: G.pendingBuy,
      dialogs: [...document.querySelectorAll(".overlay.show")].map((o) => o.id),
    };
  });
  check("continuing restores the game", resumed.screen === "game-screen" && resumed.money === 12345 && resumed.owner === 1, JSON.stringify(resumed));
  check("continuing opens no stray dialog (no purchase of GO)", resumed.pendingBuy === null && resumed.dialogs.length === 0, JSON.stringify(resumed));
  await page.evaluate(() => { G.gameOver = true; showWinner(G.players[0]); });
  check("a finished game is no longer offered", await page.evaluate(() => !readSavedGames().some((sv) => sv.id === String(G.gameStartedAt))));

  await newGame();
  await page.evaluate(() => { G.players[0].money = 1111; saveGameNow(); });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 30)));
  await newGame();
  const slots = await page.evaluate(() => { saveGameNow(); return readSavedGames().map((sv) => indexedObjectToArray(sv.game.players)[0].money); });
  check("a new game keeps the earlier saved game", slots.length === 2 && slots.includes(1111), JSON.stringify(slots));
  const legacy = await page.evaluate(() => {
    Object.keys(localStorage).filter((k) => k.startsWith("monopoly_save")).forEach((k) => localStorage.removeItem(k));
    const game = safeGameStateForRoom();
    game.gameStartedAt = 777;
    localStorage.setItem("monopoly_saved_game_v1", JSON.stringify({ v: 1, savedAt: Date.now(), game }));
    const list = readSavedGames();
    return list.length === 1 && list[0].id === "777" && !localStorage.getItem("monopoly_saved_game_v1");
  });
  check("a save from an older build carries over", legacy);
  const damaged = await page.evaluate(async () => {
    const id = readSavedGames()[0].id;
    const sv = JSON.parse(localStorage.getItem("monopoly_save_v2_" + id));
    sv.game.players = [{ name: "x" }];
    sv.game.properties = "broken";
    sv.game.boardThemeId = "dhaka";
    localStorage.setItem("monopoly_save_v2_" + id, JSON.stringify(sv));
    const orig = window.hydrateRemoteGameState;
    window.hydrateRemoteGameState = () => { throw new Error("bad save"); };
    try { resumeSavedGame(id); } finally { window.hydrateRemoteGameState = orig; }
    await new Promise((r) => setTimeout(r, 100));
    return { gone: !readSavedGame(id), screen: document.querySelector(".screen:not(.hidden)")?.id };
  });
  check("a damaged save is removed instead of trapping the player", damaged.gone && damaged.screen === "home-screen", JSON.stringify(damaged));

  console.log("\nAI");
  await newGame({ ai: 2, keepAi: true });
  const raise = await page.evaluate(() => {
    const p = G.players[2];
    const grp = SPACES[1].group;
    const set = SPACES.filter((s) => s.type === "property" && s.group === grp).map((s) => s.id);
    set.forEach((id) => { G.properties[id].owner = p.id; p.properties.push(id); G.properties[id].houses = 2; });
    G.properties[5].owner = p.id; p.railroads.push(5);
    p.money = 0;
    const need = Math.floor(mortgageValueForSpace(SPACES[5]) / 2);
    aiRaiseCash(p, need);
    return { houses: set.map((id) => G.properties[id].houses), rrMortgaged: G.properties[5].mortgaged, money: p.money, need };
  });
  check("the AI mortgages before selling houses", raise.rrMortgaged && raise.houses.every((h) => h === 2) && raise.money >= raise.need, JSON.stringify(raise));
  const easy = await page.evaluate(() => { G.rules.aiLevel = "easy"; const p = G.players[2]; G.pendingTrade = null; AI_CTRL.lastTradeAttemptKey = ""; p.money = 99999; const proposed = aiTryProposeTrade(p); G.pendingTrade = null; G.rules.aiLevel = "normal"; return proposed; });
  check("easy AI does not propose swaps", easy === false);
  const cash0 = await page.evaluate(() => G.players.reduce((s, p) => s + p.money, 0));
  const aiRun = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    G.properties.forEach((pr) => pr && ((pr.owner = null), (pr.houses = 0), (pr.hotel = false), (pr.mortgaged = false)));
    G.players.forEach((p) => { p.properties = []; p.railroads = []; p.utilities = []; p.money = 1500 * aiEconomyScale() * 10; p.kind = "ai"; p.inJail = false; });
    G.phase = "roll";
    G.currentPlayerIdx = 0;
    maybeScheduleOfflineAiTurn();
    await wait(30000);
    return { turns: G.turnCount, over: G.gameOver, problems: auditGameState("test").length };
  });
  check("three AIs play 30 seconds of turns without errors", aiRun.turns >= 5 && aiRun.problems === 0, JSON.stringify(aiRun));

  console.log("\nInterface");
  const bn = await page.evaluate(async () => {
    setUiLanguage("bn");
    await new Promise((r) => setTimeout(r, 200));
    const r = {
      lang: document.documentElement.lang,
      roll: uiText("Roll dice"),
      line: uiText("Player 1 rolled 7 (3 + 4)."),
      buy: uiText("Rahim bought Gulshan-1 for ৳2,600."),
      code: uiText("Joined room AB12CD"),
    };
    setUiLanguage("en");
    await new Promise((r) => setTimeout(r, 200));
    r.back = document.getElementById("roll-btn")?.textContent.trim();
    return r;
  });
  check("the Bangla interface translates buttons", bn.lang === "bn" && bn.roll === "ছক্কা চালুন", JSON.stringify(bn));
  check("log lines translate with Bangla digits", bn.line === "খেলোয়াড় ১ চাললেন ৭ (৩ + ৪)।", bn.line);
  check("place names and room codes are left as they are", /Gulshan-1/.test(bn.buy) && /AB12CD/.test(bn.code), JSON.stringify(bn));
  check("switching back restores English", bn.back === "Roll dice" || bn.back === "Roll for doubles", bn.back);
  const toggles = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const texts = () => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim();
        if (t && !n.parentElement.closest("script,style,#chat-log,[data-no-i18n]")) out.push(t);
      }
      return out;
    };
    const bengali = /[ঀ-৲৴-৿]/;
    const counts = [];
    for (let i = 0; i < 4; i++) {
      setUiLanguage("bn");
      await wait(150);
      counts.push(texts().filter((t) => bengali.test(t)).length);
      setUiLanguage("en");
      await wait(150);
    }
    return { counts, home: document.querySelector(".hp-card-hero .hp-card-title")?.textContent.trim(), card: (setUiLanguage("bn"), uiText("Advance to GO. Collect ৳2,000.")), back: (setUiLanguage("en"), uiText("Roll dice")) };
  });
  check("switching language many times translates everything each time", toggles.counts.every((c) => c > 100 && Math.abs(c - toggles.counts[0]) <= toggles.counts[0] * 0.03) && toggles.home === "Play online", JSON.stringify(toggles));
  check("card texts are translated", toggles.card === "GO-তে যান। ৳২,০০০ নিন।", toggles.card);
  const shell = await page.evaluate(async () => {
    openOverlay("pause-overlay");
    await new Promise((r) => setTimeout(r, 100));
    const modal = document.querySelector("#pause-overlay .modal");
    const r = { role: modal.getAttribute("role"), modal: modal.getAttribute("aria-modal"), focus: modal.contains(document.activeElement) };
    closeOverlay("pause-overlay");
    r.viewport = document.querySelector('meta[name="viewport"]').content;
    r.og = !!document.querySelector('meta[property="og:image"]');
    return r;
  });
  check("dialogs are labelled as modal dialogs and take focus", shell.role === "dialog" && shell.modal === "true" && shell.focus, JSON.stringify(shell));
  check("pinch-zoom is allowed", !/user-scalable\s*=\s*no/.test(shell.viewport));
  check("link previews have an image", shell.og);


  console.log("\nPolish");
  const polish = await page.evaluate(() => {
    setUiLanguage("bn");
    const r = {
      roll: uiText("Roll the dice"),
      watching: uiText("Watching Rafi's turn"),
      turn: uiText("Rafi's turn"),
      bid: uiText("Bid ৳650 or more"),
      edition: translateText("🇧🇩 DHAKA CITY EDITION"),
    };
    setUiLanguage("en");
    r.noGtag = typeof window.gtag === "undefined" && !document.querySelector('script[src*="googletagmanager"]');
    return r;
  });
  check("new interface text has Bangla", polish.roll === "ছক্কা চালুন" && /৳৬৫০/.test(polish.bid), JSON.stringify(polish));
  check("specific Bangla patterns win over the catch-alls", polish.watching === "Rafi-এর পালা দেখছেন" && polish.turn === "Rafi-এর পালা", JSON.stringify(polish));
  check("a flag edition title is translated whole", !/EDITION|CITY/.test(polish.edition.replace(/DHAKA CITY/, "")) && /সংস্করণ/.test(polish.edition), polish.edition);
  check("analytics does not load until the player allows it", polish.noGtag);
  await newGame({ ai: 1 });
  const banner = await page.evaluate(async () => {
    G.phase = "end";
    const why = { fx: MOVE_FX.active, pend: ONLINE.pendingCardResolutions, debt: DEBT_PROMPT.active, pb: hasPendingBuy(), ctl: canLocalControlTurn(), over: G.gameOver, auction: !!G.auctionState, paused: typeof isGamePaused === "function" && isGamePaused() };
    endTurn();
    window.__why = why;
    for (let i = 0; i < 20 && !/Player 2/.test(document.querySelector(".turn-banner-text")?.textContent || ""); i++) await new Promise((r) => setTimeout(r, 50));
    return { shown: !!document.querySelector(".turn-banner"), text: document.querySelector(".turn-banner-text")?.textContent, cur: G.currentPlayerIdx, why: window.__why };
  });
  check("the turn passes with a banner for the next player", banner.shown && /Player 2/.test(banner.text || ""), JSON.stringify(banner));
  const low = await page.evaluate(() => {
    const [p0, p1] = G.players;
    [37, 39].forEach((id) => { G.properties[id].owner = 1; p1.properties.push(id); G.properties[id].hotel = true; });
    p0.money = 100;
    renderAll();
    return document.querySelector("#player-cards .pcard .ptag.low") !== null;
  });
  check("a player short of the biggest rent is flagged", low);
  const win = await page.evaluate(() => {
    G.stats[1].rentEarned = 5000;
    const n = G.players.length;
    G.worthHistory = [0, 1, 2, 3].map((t) => G.players.map((_, i) => 15000 + (i === 1 ? t * 3000 : -t * 1000)));
    showWinner(G.players[1]);
    const r = {
      chart: document.querySelectorAll("#winner-stats .winner-chart polyline").length === n,
      award: document.querySelector(".winner-award strong")?.textContent,
      focused: document.activeElement?.id || "",
      recorded: Object.keys(readRecords()).length > 0,
    };
    return r;
  });
  check("the winner screen shows the net-worth chart and awards", win.chart && win.award === "Top landlord" && win.recorded, JSON.stringify(win));
  await page.evaluate(() => showScreen("home-screen"));
  await newGame();
  const keys = await page.evaluate(async () => {
    const sq = document.getElementById("sp6");
    return { role: sq.getAttribute("role"), tab: sq.tabIndex, label: sq.getAttribute("aria-label") };
  });
  check("board squares can be reached and read by keyboard", keys.role === "button" && keys.tab === 0 && /for sale/.test(keys.label || ""), JSON.stringify(keys));

  // Every file the service worker caches must exist, or it never installs.
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const listed = [...sw.matchAll(/(?:withVersion\()?'\.\/([^'?]*)'\)?/g)].map((m) => m[1]).filter(Boolean);
  const missing = listed.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  check("every file the service worker caches exists", missing.length === 0, missing.join(", "));

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
