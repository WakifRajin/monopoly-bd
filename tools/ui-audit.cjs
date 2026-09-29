#!/usr/bin/env node
/*
 * UI audit: opens every screen, dialog and drawer at phone, tablet and
 * desktop sizes and reports
 *   blocked   a visible control whose centre is covered by something else
 *             (taps would land on the wrong element)
 *   clipped   text cut off inside its box (not deliberate ellipsis/clamp)
 *   spill     content that sticks out of its button/card
 *   offcentre an icon or single glyph noticeably off the centre of its button
 *   overflow  the page itself wider than the screen
 *
 *   node tools/ui-audit.cjs [baseUrl]      (default http://localhost:8091/)
 * Writes tools/ui-audit-report.json and prints a summary.
 */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright-core");

const BASE = (process.argv[2] || "http://localhost:8091/").replace(/\/?$/, "/");
const SIZES = {
  phone: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  phoneL: { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tablet: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1280, height: 720 } },
  desktop: { viewport: { width: 1440, height: 900 } },
};

// Runs in the page.
function inspect(label) {
  const out = [];
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  };
  const shown = (el) => {
    // Closed <details> keep their contents laid out but unrendered.
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") return false;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
      if (e.classList && e.classList.contains("screen") && e.classList.contains("hidden")) return false;
      if (e.hidden) return false;
    }
    return vis(el);
  };
  const name = (el) => {
    if (!el) return "null";
    const id = el.id ? `#${el.id}` : "";
    const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const txt = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28);
    return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ""}`;
  };
  const W = innerWidth;
  const H = innerHeight;
  const root = document.querySelector(".overlay.show .modal") || document.querySelector(".drawer.open .drawer-panel") || document.querySelector(".screen:not(.hidden)") || document.body;

  // Page overflow.
  const sc = document.querySelector(".screen:not(.hidden)");
  const docW = Math.max(document.documentElement.scrollWidth, sc ? sc.scrollWidth : 0);
  if (docW > W + 1) out.push({ kind: "overflow", el: name(sc), detail: `${docW}px wide on ${W}px` });

  // Controls: hit-test the centre of each fully on-screen control.
  const controls = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [onclick], summary, [role=button]")].filter(shown);
  const extras = root === sc ? [...document.querySelectorAll("#app-nav button")].filter(shown) : [];
  for (const el of [...controls, ...extras]) {
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 1 || cy < 1 || cx > W - 1 || cy > H - 1) continue;
    const top = document.elementFromPoint(cx, cy);
    if (!top) continue;
    if (top === el || el.contains(top) || top.contains(el) || (top.tagName === "LABEL" && top.control === el)) continue;
    // A sticky header, tab bar or dock legitimately covers scrolled content.
    if (top.closest(".mp-header, #app-nav, .mp-actionbar, .game-topbar, .modal-close-bar") && !el.closest(".mp-header, #app-nav, .mp-actionbar, .game-topbar, .modal-close-bar")) continue;
    out.push({ kind: "blocked", el: name(el), detail: `covered by ${name(top)}` });
  }

  // Clipping and spill.
  const all = [...root.querySelectorAll("*")].filter((e) => e.children.length < 40 && shown(e));
  for (const el of all) {
    const cs = getComputedStyle(el);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const clipsX = /hidden|clip/.test(cs.overflowX);
    const clipsY = /hidden|clip/.test(cs.overflowY);
    const deliberate = cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none" || (cs.display === "-webkit-box");
    if (hasText && !deliberate) {
      if (clipsX && el.scrollWidth > el.clientWidth + 2) out.push({ kind: "clipped", el: name(el), detail: `text ${el.scrollWidth}px in ${el.clientWidth}px` });
      if (clipsY && el.scrollHeight > el.clientHeight + 2 && el.clientHeight < 200) out.push({ kind: "clipped", el: name(el), detail: `text ${el.scrollHeight}px tall in ${el.clientHeight}px` });
    }
    // Content sticking out of a control or card it belongs to.
    if (/^(BUTTON|A|SELECT|INPUT)$/.test(el.tagName) || el.classList.contains("mp-card") || el.classList.contains("hp-card") || el.classList.contains("bd-card")) {
      const pr = el.getBoundingClientRect();
      for (const c of el.querySelectorAll("*")) {
        if (!shown(c) || getComputedStyle(c).position === "absolute" || getComputedStyle(c).position === "fixed" || c.closest(".hp-card-globe")) continue;
        const r = c.getBoundingClientRect();
        if (r.right > pr.right + 2 || r.left < pr.left - 2 || r.bottom > pr.bottom + 2) {
          out.push({ kind: "spill", el: name(c), detail: `outside ${name(el)} by ${Math.round(Math.max(r.right - pr.right, pr.left - r.left, r.bottom - pr.bottom))}px` });
          break;
        }
      }
    }
  }

  // Icon and glyph centring inside small buttons.
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width > 64 || r.height > 64) continue;
    if (el.classList.contains("mp-switch")) continue; // the knob sits to one side by design
    const kids = [...el.children].filter(shown);
    const text = (el.innerText || "").trim();
    let box = null;
    if (kids.length === 1 && !text) box = kids[0].getBoundingClientRect();
    else if (!kids.length && text.length <= 2) {
      const range = document.createRange();
      range.selectNodeContents(el);
      box = range.getBoundingClientRect();
    }
    if (!box || !box.width) continue;
    const dx = box.left + box.width / 2 - (r.left + r.width / 2);
    const dy = box.top + box.height / 2 - (r.top + r.height / 2);
    if (Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5) out.push({ kind: "offcentre", el: name(el), detail: `off by ${dx.toFixed(1)}, ${dy.toFixed(1)}px` });
  }
  return out.map((o) => ({ ...o, where: label }));
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const report = [];
  for (const [size, opts] of Object.entries(SIZES)) {
    const ctx = await browser.newContext(opts);
    await ctx.route(/googletagmanager|google-analytics/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${BASE}?nosw`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => typeof ONLINE !== "undefined" && ONLINE.ready, null, { timeout: 30000 }).catch(() => {});
    const check = async (label, setup, wait = 450) => {
      try {
        await page.evaluate(setup);
      } catch (err) {
        report.push({ where: `${size}/${label}`, kind: "error", el: "", detail: String(err.message || err).slice(0, 160) });
        return;
      }
      await page.waitForTimeout(wait);
      const found = await page.evaluate(inspect, `${size}/${label}`);
      report.push(...found);
      // Also scrolled to the bottom, where sticky bars overlap content.
      const scrolled = await page.evaluate(() => {
        const sc = document.querySelector(".overlay.show .modal") || document.querySelector(".screen:not(.hidden)");
        if (!sc || sc.scrollHeight <= sc.clientHeight + 10) return false;
        sc.scrollTop = sc.scrollHeight;
        return true;
      });
      if (scrolled) {
        await page.waitForTimeout(250);
        report.push(...(await page.evaluate(inspect, `${size}/${label}@bottom`)));
        await page.evaluate(() => {
          const sc = document.querySelector(".overlay.show .modal") || document.querySelector(".screen:not(.hidden)");
          if (sc) sc.scrollTop = 0;
        });
      }
    };
    const closeAll = () => {
      document.querySelectorAll(".overlay.show").forEach((o) => o.classList.remove("show"));
      if (typeof closeDrawer === "function") closeDrawer();
    };
    await check("home", () => showScreen("home-screen"));
    await check("online-host", () => openOnlineSetupPage("host"));
    await check("online-join", () => { openOnlineSetupPage("host"); setOnlineMode("join"); });
    await check("same-wifi", () => { openLanPage(); }, 1500);
    await check("lobby", () => { lanStopDiscovery(); openOfflineSetupPage(); });
    await check("lobby-custom", () => { openOfflineSetupPage(); document.getElementById("custom-board-card").open = true; });
    await check("boards", () => openBoardsPage());
    await check("rules", () => showScreen("how-to-screen"));
    await check("settings", () => openSettingsPage());
    // A match with some history.
    await page.evaluate(async () => {
      openOfflineSetupPage();
      TIMER.duration = 0;
      while (lobbyPlayers.length < 4) addPlayerSlot("ai");
      lobbyPlayers.forEach((x, i) => { x.kind = i ? "ai" : "human"; x.name = ["Shakib Al Hasan", "Rafi", "Nusrat Jahan Chowdhury", "Tanvir"][i]; });
      renderLobby();
      document.querySelectorAll(".name-input").forEach((el, i) => (el.value = lobbyPlayers[i].name));
      await startGame();
      clearOfflineAiTimer(true);
      const ids = SPACES.filter((s) => s.type === "property").map((s) => s.id);
      ids.forEach((id, k) => { if (k % 3 !== 2) { G.properties[id].owner = k % 4; G.players[k % 4].properties.push(id); } });
      G.properties[ids[0]].houses = 2;
      G.properties[ids[1]].houses = 2;
      G.properties[ids[4]].hotel = true;
      for (let i = 0; i < 30; i++) addLog(`${G.players[i % 4].name} paid ${fmtCurrency(100 * i)} rent to ${G.players[(i + 1) % 4].name} for Karwan Bazar.`, i % 3 ? "danger" : "");
      G.currentPlayerIdx = 0; G.phase = "roll";
      renderAll(); updateActionButtons();
    });
    await page.waitForTimeout(2500);
    for (const view of ["2d", "3d"]) {
      await page.evaluate((v) => setBoard3d(v === "3d", false), view);
      await page.waitForTimeout(1200);
      await check(`game-${view}`, () => { document.getElementById("toast")?.classList.remove("show"); });
    }
    await page.evaluate(() => setBoard3d(false, false));
    await page.waitForTimeout(900);
    const dialogs = [
      ["property", () => showSpaceInfo(1)],
      ["station", () => showSpaceInfo(5)],
      ["corner", () => showSpaceInfo(0)],
      ["portfolio", () => showPlayerPortfolio(0)],
      ["history", () => showPlayerPortfolio(2, "log")],
      ["build", () => openBuildModal()],
      ["mortgage", () => openMortgageModal()],
      ["trade", () => openTradeModal()],
      ["rent", () => showRentModal(G.players[0], G.players[1], "Karwan Bazar", 1500)],
      ["jail", () => showJailPrompt(G.players[0])],
      ["debt", () => showDebtPrompt(G.players[0], 5000, G.players[1])],
      ["leave", () => { if (typeof requestExitMatch === "function") requestExitMatch(); }],
    ];
    for (const [label, fn] of dialogs) {
      await check(`dialog-${label}`, `(${fn.toString()})()`.replace(/^\(\(\) => /, "(() => "));
      await page.evaluate(closeAll);
    }
    for (const d of ["settings", "log", "chat", "players"]) {
      await check(`drawer-${d}`, `openDrawer("${d}")`, 700);
      await page.evaluate(closeAll);
      await page.waitForTimeout(400);
    }
    // Standalone pages.
    for (const [label, url] of [["patch-notes", "whats-new.html"], ["board-editor", "boardeditor.html"], ["test-lab", "test-lab.html"]]) {
      await page.goto(`${BASE}${url}?nosw`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      report.push(...(await page.evaluate(inspect, `${size}/${label}`)));
    }
    for (const e of errors) report.push({ where: size, kind: "error", el: "", detail: e.slice(0, 160) });
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, "ui-audit-report.json"), JSON.stringify(report, null, 1));
  // Summary: group identical findings across sizes.
  const groups = new Map();
  for (const r of report) {
    const key = `${r.kind} | ${r.where.split("/")[1] || r.where} | ${r.el} | ${r.detail.replace(/\d+(\.\d+)?/g, "#")}`;
    if (!groups.has(key)) groups.set(key, { ...r, sizes: new Set() });
    groups.get(key).sizes.add(r.where.split("/")[0]);
  }
  const rows = [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind));
  for (const g of rows) console.log(`${g.kind.padEnd(9)} ${String((g.where.split("/")[1] || "")).padEnd(22)} ${g.el.slice(0, 60).padEnd(60)} ${g.detail.slice(0, 70)}  [${[...g.sizes].join(",")}]`);
  console.log(`\n${report.length} findings, ${rows.length} distinct`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
