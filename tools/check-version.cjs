#!/usr/bin/env node
/*
 * Fails when the release version is not the same everywhere it must match:
 * the service worker cache name, APP_BUILD, and every ?v= stamp on local
 * scripts and stylesheets. A mismatch lets a browser mix old and new files.
 *
 *   npm run check:version      (fix with: npm run version:bump -- <version>)
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const version = (read("sw.js").match(/const SW_VERSION = '([\d.]+)';/) || [])[1];
const problems = [];
if (!version) problems.push("sw.js: SW_VERSION not found");

const build = (read("index.html").match(/window\.APP_BUILD = "([^"]*)"/) || [])[1];
if (build !== version) problems.push(`index.html: APP_BUILD is ${build}, sw.js is ${version}`);

for (const f of ["index.html", "whats-new.html", "boardeditor.html", "test-lab.html"]) {
  const html = read(f);
  const re = /<(?:script\s+src|link\s+rel="stylesheet"\s+href)="((?!https?:|\/\/)[^"]+\.(?:js|css))(?:\?v=([^"]*))?"/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[2] !== version) problems.push(`${f}: ${m[1]} is stamped ${m[2] || "(none)"}, expected ${version}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Version ${version} matches everywhere.`);
