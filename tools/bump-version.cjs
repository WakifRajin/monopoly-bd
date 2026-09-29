#!/usr/bin/env node
/*
 * Sets the release version everywhere it has to match:
 *   sw.js            SW_VERSION (service worker cache name)
 *   index.html       ?v= on every local script and stylesheet, and APP_BUILD
 *   whats-new.html, boardeditor.html, test-lab.html   ?v= on local stylesheets
 *
 * GitHub Pages lets browsers reuse files for 10 minutes, so without versioned
 * URLs a browser can combine a new page with old scripts right after a deploy
 * and fail to start. Run this before every deploy:
 *
 *   npm run version:bump            (bumps the patch number: 1.5.1 -> 1.5.2)
 *   npm run version:bump -- 1.6.0   (sets an exact version)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(ROOT, f), s);

const sw = read("sw.js");
const current = (sw.match(/const SW_VERSION = '([\d.]+)';/) || [])[1];
if (!current) throw new Error("SW_VERSION not found in sw.js");
let next = process.argv[2];
if (!next) {
  const parts = current.split(".").map(Number);
  parts[parts.length - 1] += 1;
  next = parts.join(".");
}
if (!/^\d+\.\d+\.\d+$/.test(next)) throw new Error(`Not a version: ${next}`);

write("sw.js", sw.replace(/const SW_VERSION = '[\d.]+';/, `const SW_VERSION = '${next}';`));

// Local (relative) script and stylesheet URLs get ?v=<version>.
const stamp = (html) =>
  html
    .replace(/(<script\s+src=")((?!https?:|\/\/)[^"?]+\.js)(?:\?v=[^"]*)?(")/g, `$1$2?v=${next}$3`)
    .replace(/(<link\s+rel="stylesheet"\s+href=")((?!https?:|\/\/)[^"?]+\.css)(?:\?v=[^"]*)?(")/g, `$1$2?v=${next}$3`)
    .replace(/window\.APP_BUILD = "[^"]*"/, `window.APP_BUILD = "${next}"`);

for (const f of ["index.html", "whats-new.html", "boardeditor.html", "test-lab.html"]) {
  write(f, stamp(read(f)));
}
console.log(`Version ${current} -> ${next}`);
