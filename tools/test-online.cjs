#!/usr/bin/env node
/*
 * Online play tests: two (and later four) browsers play through the real
 * online code against the Firebase emulators. Hosting and joining, turns and
 * chat staying in sync, rejoining after a refresh, the AI holding a dropped
 * player's seat until they come back, host handover, and closed rooms.
 *
 *   npm run test:online      (needs Java, Chrome and firebase-tools)
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

const NS = "monopoly-bd-default-rtdb";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const check = (label, ok, extra = "") => {
  log.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
};

(async () => {
  const server = await serve();
  const BASE = `http://127.0.0.1:${server.address().port}`;
  await fetch(`http://127.0.0.1:9000/.json?ns=${NS}`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
  // The page reaches the emulators on 127.0.0.1; newer Chrome asks before a
  // page talks to the local network, so that check is off for the test.
  const launch = { headless: true, args: ["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  else launch.channel = "chrome";
  const b = await chromium.launch(launch);
  const denied = [];
  async function client(name) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
    await ctx.route(/\/index\.html/, async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      body = body.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, "");
      route.fulfill({ response: res, body });
    });
    await ctx.route(/core-online-theme-lobby\.js/, async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      body = body
        .replace("const auth = authMod.getAuth(app);", 'const auth = authMod.getAuth(app); authMod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });')
        .replace(
          "FIREBASE.db = dbMod.getDatabase(app, firebaseConfig.databaseURL);",
          'FIREBASE.db = dbMod.getDatabase(app, firebaseConfig.databaseURL); dbMod.connectDatabaseEmulator(FIREBASE.db, "127.0.0.1", 9000);',
        );
      route.fulfill({ response: res, body });
    });
    const p = await ctx.newPage();
    watch(p, name);
    await p.goto(`${BASE}/index.html?nosw`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => typeof bootstrapFirebase === "function");
    const ok = await p.evaluate(async () => {
      await bootstrapFirebase();
      return ONLINE.ready;
    });
    check(`${name} connects to the online service`, ok, await p.evaluate(() => ONLINE_SERVICE.error));
    await p.evaluate((n) => {
      document.getElementById("online-player-name").value = n;
    }, name);
    return { ctx, p };
  }
  function watch(p, name) {
    p.on("console", (m) => {
      const t = m.text();
      if (/permission|PERMISSION_DENIED/i.test(t)) denied.push(`${name}: ${t.slice(0, 180)}`);
    });
    p.on("pageerror", (e) => denied.push(`${name} pageerror: ${e.message}`));
  }

  // One step of whoever's turn it is on this client.
  const playStep = (p, buyParity) =>
    p.evaluate(async (buyParity) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const me = G.players.findIndex((x) => x.uid === ONLINE.localUid);
      if (G.auctionState) {
        passAuction();
        await sleep(600);
      }
      if (G.currentPlayerIdx !== me || G.gameOver) return;
      if (G.phase === "roll") {
        await rollDice();
        await sleep(2800);
      }
      document.querySelectorAll("#card-overlay.show .modal > .btn").forEach((x) => x.click());
      await sleep(1500);
      if (hasPendingBuy()) (G.players[me].pos % 2 === buyParity ? confirmBuy : declineBuy)();
      await sleep(600);
      document.querySelectorAll(".overlay.show").forEach((o) => {
        if (["rent-overlay", "jail-overlay"].includes(o.id)) o.classList.remove("show");
      });
      if (G.auctionState) {
        passAuction();
        await sleep(600);
      }
      if (G.phase !== "roll") endTurn();
    }, buyParity);

  const A = await client("Alice");
  const B = await client("Bob");

  await A.p.evaluate(() => {
    setOnlineMode("host");
    return createOnlineRoom();
  });
  const room = await A.p.evaluate(() => ONLINE.roomId);
  check("host creates a room", !!room, room || "");
  await wait(1000);
  const listed = await B.p.evaluate(async () => {
    setOnlineMode("join");
    await refreshOpenRoomsList(true);
    await new Promise((r) => setTimeout(r, 800));
    return document.getElementById("open-rooms-list").textContent;
  });
  check("room shows in the open rooms list", listed.includes(room));
  await B.p.evaluate((code) => {
    document.getElementById("join-room-code").value = code;
    return joinOnlineRoom();
  }, room);
  await wait(1500);
  check("guest joins", await B.p.evaluate(() => !!(ONLINE.connected && ONLINE.roomId)));
  await A.p.evaluate(() => toggleReadyState());
  await B.p.evaluate(() => toggleReadyState());
  await wait(1500);
  await A.p.evaluate(() => startGame());
  await wait(3500);
  const screens = await Promise.all([A.p, B.p].map((p) => p.evaluate(() => document.querySelector(".screen:not(.hidden)")?.id)));
  check("both enter the game", screens.every((s) => s === "game-screen"), screens.join(","));

  for (let t = 0; t < 6; t++) {
    await playStep(A.p, 0);
    await wait(900);
    await playStep(B.p, 1);
    await wait(900);
  }
  await wait(1500);
  const state = (p) => p.evaluate(() => [ONLINE.revision, G.players.map((x) => x.money).join("/"), (G.stats || []).map((s) => s.rentPaid).join("/")]);
  const sA = await state(A.p);
  const sB = await state(B.p);
  check("turns sync between both players", sA[0] > 3 && sA[0] === sB[0] && sA[1] === sB[1] && sA[2] === sB[2], `A ${sA} | B ${sB}`);

  await A.p.evaluate(() => {
    document.getElementById("chat-input").value = "hello from Alice";
    sendChat();
  });
  await B.p.evaluate(() => {
    document.getElementById("chat-input").value = "hi Alice";
    sendChat();
  });
  await wait(1800);
  const chat = (p) => p.evaluate(() => (G.chat || []).map((m) => m.text).join("|"));
  const cA = await chat(A.p);
  const cB = await chat(B.p);
  check("chat reaches both", [cA, cB].every((c) => c.includes("hello from Alice") && c.includes("hi Alice")), `${cA} / ${cB}`);

  const rev0 = sB[0];
  for (let t = 0; t < 2; t++) {
    await playStep(A.p, 0);
    await wait(900);
    await playStep(B.p, 1);
    await wait(900);
  }
  await wait(1500);
  check("moves still sync after chat", (await B.p.evaluate(() => ONLINE.revision)) > rev0);

  // Bob refreshes mid-game: he is still seated and gets straight back in.
  const reopen = async () => {
    const np = await B.ctx.newPage();
    watch(np, "Bob");
    await np.goto(`${BASE}/index.html?nosw`, { waitUntil: "domcontentloaded" });
    await np.waitForFunction(() => typeof bootstrapFirebase === "function");
    await np.waitForTimeout(800);
    const card = await np.evaluate(() => !document.getElementById("hp-rejoin").hidden);
    await np.evaluate(() => rejoinRememberedRoom());
    await np.waitForTimeout(3000);
    return { np, card };
  };
  await B.p.close();
  let again = await reopen();
  B.p = again.np;
  const back1 = await B.p.evaluate(() => [document.querySelector(".screen:not(.hidden)")?.id, G.players.find((x) => x.uid === ONLINE.localUid)?.kind]);
  check("after a refresh the home screen offers Rejoin", again.card);
  check("a refreshed player is back in their seat", back1[0] === "game-screen" && back1[1] === "human", JSON.stringify(back1));

  // Bob drops out long enough for the AI to take his seat, then comes back.
  await B.p.close();
  const tDrop = Date.now();
  let reserved = false;
  while (Date.now() - tDrop < 90000) {
    await playStep(A.p, 0);
    await wait(2000);
    reserved = await A.p.evaluate(() => G.players.some((x) => x.reservedUid && x.kind === "ai"));
    if (reserved) break;
  }
  check("the AI takes a dropped player's seat and keeps it reserved", reserved, `${Math.round((Date.now() - tDrop) / 1000)}s`);
  if (!reserved) console.log("DIAG", JSON.stringify(await A.p.evaluate(() => ({ cur: G.currentPlayerIdx, phase: G.phase, auction: G.auctionState && { bidder: currentAuctionBidderId(), passed: [...(G.auctionState.passed || [])] }, trade: !!G.pendingTrade, debt: DEBT_PROMPT.active, players: G.players.map((p) => [p.name, p.kind, p.uid && p.uid.slice(0, 4)]), presence: ONLINE.presence, ready: ONLINE.presenceReady, key: ONLINE.lastTakeoverKey, overlays: [...document.querySelectorAll(".overlay.show")].map((o) => o.id) }))));
  again = await reopen();
  B.p = again.np;
  const back2 = await B.p.evaluate(() => {
    const me = G.players.find((x) => x.uid === ONLINE.localUid);
    return [document.querySelector(".screen:not(.hidden)")?.id, me?.kind, me?.name, !!me?.reservedUid];
  });
  check("the dropped player takes their seat back from the AI", back2[0] === "game-screen" && back2[1] === "human" && back2[2] === "Bob" && !back2[3], JSON.stringify(back2));
  for (let t = 0; t < 2; t++) {
    await playStep(A.p, 0);
    await wait(900);
    await playStep(B.p, 1);
    await wait(900);
  }
  await wait(1500);
  const sA2 = await state(A.p);
  const sB2 = await state(B.p);
  check("play goes on in sync after the rejoin", sA2[0] === sB2[0] && sA2[1] === sB2[1], `A ${sA2} | B ${sB2}`);

  // Host drops out: the guest hands the seat to the AI and becomes host.
  await A.ctx.close();
  const t0 = Date.now();
  let took = false;
  while (Date.now() - t0 < 120000) {
    await wait(3000);
    took = await B.p.evaluate(() => ONLINE.isHost && G.players.some((x) => x.kind === "ai"));
    if (took) break;
    await playStep(B.p, 1);
  }
  check("guest takes over a disconnected host and becomes host", took, `${Math.round((Date.now() - t0) / 1000)}s`);

  await B.p.evaluate(() => leaveOnlineRoom(false, true, "liquidation"));
  await wait(2000);
  const left = await (await fetch(`http://127.0.0.1:9000/rooms/${room}.json?ns=${NS}`, { headers: { Authorization: "Bearer owner" } })).json();
  check("last player leaving removes the room", left === null, left ? JSON.stringify(Object.keys(left)) : "");

  const C = await client("Cara");
  const D = await client("Dan");
  await C.p.evaluate(() => {
    setOnlineMode("host");
    document.getElementById("room-visibility").value = "closed";
    document.getElementById("host-room-password").value = "secret12";
    return createOnlineRoom();
  });
  const room2 = await C.p.evaluate(() => ONLINE.roomId);
  check("closed room created", !!room2, room2 || "");
  const deniedBefore = denied.length;
  await D.p.evaluate((code) => {
    setOnlineMode("join");
    document.getElementById("join-room-code").value = code;
    document.getElementById("join-room-password").value = "wrong";
    return joinOnlineRoom();
  }, room2);
  await wait(1000);
  check("wrong password is refused", !(await D.p.evaluate(() => ONLINE.connected)));
  const wrongPwErrors = denied.length - deniedBefore;
  await D.p.evaluate((code) => {
    document.getElementById("join-room-code").value = code;
    document.getElementById("join-room-password").value = "secret12";
    return joinOnlineRoom();
  }, room2);
  await wait(1500);
  check("right password joins", await D.p.evaluate(() => ONLINE.connected));
  const unexpected = denied.filter((_, i) => i < deniedBefore || i >= deniedBefore + wrongPwErrors);
  check("no other permission errors or page errors", unexpected.length === 0, unexpected.slice(0, 6).join("\n    "));
  console.log(`\n${log.filter(Boolean).length}/${log.length} passed`);
  await b.close();
  server.close();
  process.exit(log.every(Boolean) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
