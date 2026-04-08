const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'screenshots');
const APP_URL = 'https://wakifrajin.github.io/monopoly-bd/';

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function main() {
  ensureOutDir();

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-gpu', '--hide-scrollbars'],
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT_DIR, 'gameplay-home.png') });

  await page.evaluate(() => {
    openOfflineSetupPage();
  });
  await page.waitForTimeout(500);

  await page.evaluate(async () => {
    await startGame();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT_DIR, 'gameplay-board.png') });

  await page.evaluate(() => {
    const p0 = G.players[0];
    const p1 = G.players[1];
    if (!p0 || !p1) return;

    const myProp = 1;
    const theirProp = 3;

    [myProp, theirProp].forEach(id => {
      const prop = G.properties[id];
      if (!prop) return;
      prop.owner = null;
      prop.houses = 0;
      prop.hotel = false;
      prop.mortgaged = false;
    });

    p0.properties = p0.properties.filter(id => id !== theirProp);
    p1.properties = p1.properties.filter(id => id !== myProp);

    if (!p0.properties.includes(myProp)) p0.properties.push(myProp);
    if (!p1.properties.includes(theirProp)) p1.properties.push(theirProp);
    G.properties[myProp].owner = p0.id;
    G.properties[theirProp].owner = p1.id;

    G.phase = 'action';
    renderAll();
    openTradeModal();

    tradeSelected.mine = [myProp];
    tradeSelected.theirs = [theirProp];

    const myMoneyInput = document.getElementById('trade-my-money');
    const theirMoneyInput = document.getElementById('trade-their-money');
    if (myMoneyInput) myMoneyInput.value = 500;
    if (theirMoneyInput) theirMoneyInput.value = 300;

    renderTradeProps();
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT_DIR, 'trade-system.png') });

  await page.evaluate(() => {
    closeOverlay('trade-overlay');
    G.pendingBuy = 6;
    G.phase = 'action';
    renderAll();
    startAuction();
    if (G.auctionState) {
      try {
        placeBid(200);
      } catch (_) {
        // Ignore if controls are temporarily gated.
      }
      renderAuction();
    }
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT_DIR, 'auction-system.png') });

  await page.evaluate(() => {
    closeOverlay('auction-overlay');
    openOnlineSetupPage('host');
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT_DIR, 'online-setup.png') });

  await page.evaluate(() => {
    openOnlineRoomPage();
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT_DIR, 'online-lobby.png') });

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
