#!/usr/bin/env node
/*
 * Renders tools/og-image.html to images/og-image.jpg (1200x630), the image
 * shown when the game's link is shared. Needs Google Chrome installed.
 *
 *   node tools/make-og-image.cjs
 */
const path = require("node:path");
const { chromium } = require("playwright-core");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto("file://" + path.resolve(__dirname, "og-image.html").replace(/\\/g, "/"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.resolve(__dirname, "..", "images", "og-image.jpg"), type: "jpeg", quality: 86 });
  await browser.close();
  console.log("images/og-image.jpg written");
})();
