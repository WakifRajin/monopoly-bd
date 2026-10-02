/*
 * BUET board art. Redraws the printed BUET board's squares, corners and campus
 * map as vector drawing on the board texture (see drawBoardTexture in
 * main.js), so the board keeps its look at any size instead of showing a photo.
 *
 * Squares follow the game's convention (every square upright, its band along
 * the top), but keep the printed board's colours, zigzag bands, lettering and
 * pictures. Ownership frames and the mortgaged ribbon are still drawn by
 * main.js on top.
 */
import { BUILDINGS, MAP_H, MAP_W, ROADS } from "./buet-map.js";

export const BUET_FONT = '"Josefin Sans", "DM Sans", system-ui, sans-serif';
export const BUET_CARD_FONT = '"Aldrich", "DM Sans", system-ui, sans-serif';
// Fonts the canvas needs before it can draw this board.
export const BUET_FONTS = [`600 40px ${BUET_FONT}`, `700 40px ${BUET_FONT}`, `400 40px ${BUET_CARD_FONT}`];

const CREAM = "#f5f3ea";
const INK = "#2b2b2b";
// The darker zigzag strip under each group's band.
const ZIG = {
  BROWN: "#6e4429",
  LBLUE: "#232c7c",
  PINK: "#8c2f4f",
  ORANGE: "#c95f2a",
  RED: "#cf3c48",
  YELLOW: "#e39a38",
  GREEN: "#1d6650",
  DBLUE: "#2b1f5e",
};

// ── Small drawing helpers ──────────────────────────────────────────────────
function font(px, weight = 600, family = BUET_FONT) {
  return `${weight} ${Math.round(px)}px ${family}`;
}

function text(ctx, str, x, y, px, color, weight = 600, family = BUET_FONT) {
  ctx.fillStyle = color;
  ctx.font = font(px, weight, family);
  ctx.fillText(str, x, y);
}

// Wraps upper-case words into at most maxLines lines of maxWidth, shrinking
// from maxPx toward minPx until they fit. Returns { size, lines }.
function fit(ctx, str, maxWidth, maxLines, maxPx, minPx, weight = 600, family = BUET_FONT) {
  const words = String(str || "").toUpperCase().split(/\s+/).filter(Boolean);
  for (let size = Math.round(maxPx); size >= minPx; size--) {
    ctx.font = font(size, weight, family);
    if (words.some((w) => ctx.measureText(w).width > maxWidth)) continue;
    const lines = [];
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return { size, lines };
  }
  return { size: minPx, lines: [String(str || "").toUpperCase()] };
}

// A block of wrapped lines centred on (cx, cy).
function block(ctx, str, cx, cy, maxWidth, maxLines, maxPx, minPx, color, weight = 600, family = BUET_FONT) {
  const f = fit(ctx, str, maxWidth, maxLines, maxPx, minPx, weight, family);
  ctx.fillStyle = color;
  ctx.font = font(f.size, weight, family);
  const lh = f.size * 1.18;
  f.lines.forEach((l, i) => ctx.fillText(l, cx, cy + (i - (f.lines.length - 1) / 2) * lh));
  return f;
}

function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function strokeRect(ctx, x, y, w, h, color, lw) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
}

function polygon(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fill();
}

// The colour band with its zigzag strip, along the top of a square.
function band(ctx, x, y, w, PX, light, dark) {
  const solid = PX * 0.2;
  const strip = PX * 0.09;
  const amp = PX * 0.045;
  const teeth = Math.max(4, Math.round(w / (PX * 0.115)));
  rect(ctx, x, y, w, solid, light);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(x, y + solid);
  ctx.lineTo(x + w, y + solid);
  for (let i = teeth; i >= 0; i--) {
    const px = x + (w * i) / teeth;
    ctx.lineTo(px, y + solid + strip - (i % 2 ? amp : 0));
  }
  ctx.closePath();
  ctx.fill();
  return solid + strip;
}

// ── Pictures on the squares ───────────────────────────────────────────────
function computer(ctx, cx, cy, s, color) {
  // Monitor on a stand, tower to its right (BIIS).
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.045;
  const mw = s * 0.62;
  const mh = s * 0.42;
  const mx = cx - s * 0.5;
  const my = cy - s * 0.32;
  ctx.strokeRect(mx, my, mw, mh);
  ctx.strokeRect(mx + s * 0.04, my + s * 0.04, mw - s * 0.08, mh - s * 0.08);
  ctx.beginPath();
  ctx.moveTo(mx + mw / 2, my + mh);
  ctx.lineTo(mx + mw / 2, my + mh + s * 0.12);
  ctx.moveTo(mx + mw / 2 - s * 0.14, my + mh + s * 0.12);
  ctx.lineTo(mx + mw / 2 + s * 0.14, my + mh + s * 0.12);
  ctx.stroke();
  const tx = cx + s * 0.2;
  const tw = s * 0.26;
  const th = s * 0.64;
  ctx.strokeRect(tx, my, tw, th);
  ctx.beginPath();
  ctx.moveTo(tx + tw * 0.25, my + th * 0.16);
  ctx.lineTo(tx + tw * 0.75, my + th * 0.16);
  ctx.moveTo(tx + tw * 0.25, my + th * 0.26);
  ctx.lineTo(tx + tw * 0.75, my + th * 0.26);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tx + tw / 2, my + th * 0.8, s * 0.035, 0, Math.PI * 2);
  ctx.stroke();
}

function questionMark(ctx, cx, cy, px, color) {
  text(ctx, "?", cx, cy, px, color, 400);
}

function redCross(ctx, cx, cy, s) {
  const a = s * 0.16;
  rect(ctx, cx - a, cy - s / 2, a * 2, s, "#b3262b");
  rect(ctx, cx - s / 2, cy - a, s, a * 2, "#b3262b");
}

function weightPlate(ctx, cx, cy, s) {
  // Gymnasium: a KG plate with a stack of plates in front of it.
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = s * 0.03;
  const r = s * 0.3;
  const px = cx - s * 0.1;
  ctx.beginPath();
  ctx.arc(px, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, cy, r * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px, cy, r * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  text(ctx, "KG", px, cy + r * 0.5, s * 0.11, "#3a3a3a", 600);
  const bw = s * 0.36;
  const bh = s * 0.13;
  const bx = px + r * 0.15;
  for (let i = 0; i < 3; i++) {
    const by = cy - r * 0.95 + i * bh;
    ctx.fillStyle = CREAM;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeRect(bx, by, bw, bh);
  }
}

function diamond(ctx, cx, cy, s) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.moveTo(cx, cy - s / 2);
  ctx.lineTo(cx + s / 2, cy);
  ctx.lineTo(cx, cy + s / 2);
  ctx.lineTo(cx - s / 2, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.11, 0, Math.PI * 2);
  ctx.fill();
}

function hallIcon(ctx, cx, cy, s) {
  // Hall fee: a hall block with its windows and a HALL sign.
  ctx.strokeStyle = "#3a3a3a";
  ctx.lineWidth = s * 0.025;
  const w = s * 0.62;
  const h = s * 0.7;
  const x = cx - w / 2 + s * 0.08;
  const y = cy - h / 2 - s * 0.06;
  ctx.strokeRect(x - s * 0.18, y + s * 0.02, s * 0.18, h * 0.82);
  ctx.strokeRect(x, y, w, h);
  ctx.strokeRect(x + w * 0.3, y, w * 0.4, h * 0.16);
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.5, y + h * 0.16);
  ctx.stroke();
  const ws = w * 0.17;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) ctx.strokeRect(x + w * 0.12 + c * w * 0.27, y + h * 0.3 + r * h * 0.26, ws, ws);
  const sw = w * 1.2;
  const sx = cx - sw / 2 + s * 0.02;
  const sy = y + h - s * 0.04;
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(sx, sy, sw, s * 0.16, s * 0.03);
  else ctx.rect(sx, sy, sw, s * 0.16);
  ctx.fill();
  ctx.stroke();
  text(ctx, "HALL", sx + sw / 2, sy + s * 0.085, s * 0.1, "#3a3a3a", 600);
}

// Civil building: pink facade, two wings, dark window bands.
function civilIcon(ctx, cx, cy, s) {
  const w = s * 0.86;
  const h = s * 0.8;
  const x = cx - w / 2;
  const y = cy - h / 2;
  rect(ctx, x, y, w, h, "#f2c3d6");
  for (let wing = 0; wing < 2; wing++) {
    const wx = x + wing * (w / 2) + w * 0.03;
    const ww = w / 2 - w * 0.06;
    for (let i = 0; i < 12; i++) rect(ctx, wx + (ww * i) / 12, y + h * 0.12, ww / 24, h * 0.12, "#c86d93");
    rect(ctx, wx, y + h * 0.26, ww, h * 0.06, "#4a1222");
    rect(ctx, wx, y + h * 0.34, ww, h * 0.14, "#e48fb3");
    rect(ctx, wx, y + h * 0.5, ww, h * 0.06, "#4a1222");
    rect(ctx, wx, y + h * 0.58, ww, h * 0.14, "#e48fb3");
    rect(ctx, wx, y + h * 0.74, ww, h * 0.06, "#4a1222");
  }
  rect(ctx, cx - w * 0.012, y, w * 0.024, h, "#fbe6ef");
  strokeRect(ctx, x, y, w, h, "#fbe6ef", s * 0.02);
}

// Architecture building: a grid of window modules.
function archIcon(ctx, cx, cy, s) {
  const cols = 2;
  const rows = 5;
  const mw = s * 0.4;
  const mh = s * 0.15;
  const gap = s * 0.035;
  const x0 = cx - (cols * mw + (cols - 1) * gap) / 2;
  const y0 = cy - (rows * mh + (rows - 1) * gap) / 2;
  ctx.lineWidth = s * 0.012;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * (mw + gap);
      const y = y0 + r * (mh + gap);
      rect(ctx, x, y, mw, mh, "#cdd6f4");
      ctx.strokeStyle = "#5a46a0";
      for (let i = 1; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo(x + (mw * i) / 10, y + mh * 0.15);
        ctx.lineTo(x + (mw * i) / 10, y + mh * 0.85);
        ctx.stroke();
      }
      rect(ctx, x - s * 0.02, y + mh * 0.3, s * 0.02, mh * 0.4, "#cdd6f4");
      rect(ctx, x + mw, y + mh * 0.3, s * 0.02, mh * 0.4, "#cdd6f4");
    }
}

// ECE building: dark tower, side window columns, slatted middle, stilts.
function eceIcon(ctx, cx, cy, s) {
  const w = s * 0.8;
  const h = s * 0.82;
  const x = cx - w / 2;
  const y = cy - h / 2;
  strokeRect(ctx, x, y, w, h * 0.9, "#2b2b2b", s * 0.018);
  for (let i = 0; i < 9; i++) {
    const yy = y + h * 0.05 + i * h * 0.09;
    rect(ctx, x + w * 0.03, yy, w * 0.07, h * 0.05, "#2b2b2b");
    rect(ctx, x + w * 0.9, yy, w * 0.07, h * 0.05, "#2b2b2b");
  }
  for (let i = 0; i < 8; i++) rect(ctx, x + w * 0.16, y + h * (0.14 + i * 0.085), w * 0.68, h * 0.04, "#2b2b2b");
  for (let i = 0; i < 7; i++) rect(ctx, x + w * (0.18 + i * 0.095), y + h * 0.05, w * 0.06, h * 0.035, "#2b2b2b");
  ctx.strokeStyle = "#2b2b2b";
  ctx.lineWidth = s * 0.014;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h * 0.9);
  ctx.lineTo(x + w * 0.2, y + h);
  ctx.moveTo(x + w * 0.8, y + h * 0.9);
  ctx.lineTo(x + w * 0.8, y + h);
  ctx.moveTo(x + w * 0.2, y + h * 0.94);
  ctx.lineTo(x + w * 0.8, y + h * 0.94);
  ctx.stroke();
}

// Mechanical building: red-brick floors with pale windows.
function mechIcon(ctx, cx, cy, s) {
  const cols = 4;
  const rows = 5;
  const w = s * 0.84;
  const h = s * 0.78;
  const x = cx - w / 2;
  const y = cy - h / 2;
  rect(ctx, x, y, w, h, "#c4475a");
  const cw = w / cols;
  const rh = h / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      rect(ctx, x + c * cw + cw * 0.1, y + r * rh + rh * 0.12, cw * 0.36, rh * 0.42, "#e4e8f4");
      rect(ctx, x + c * cw + cw * 0.54, y + r * rh + rh * 0.12, cw * 0.36, rh * 0.42, "#e4e8f4");
      rect(ctx, x + c * cw, y + r * rh + rh * 0.7, cw, rh * 0.1, "#8f2c3c");
    }
  for (let c = 0; c <= cols; c++) rect(ctx, x + c * cw - s * 0.006, y, s * 0.012, h, "#f3d7dc");
}

// ── Corners ───────────────────────────────────────────────────────────────
function rotated(ctx, cx, cy, angle, draw) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  draw();
  ctx.restore();
}

function drawGo(ctx, x, y, s) {
  rect(ctx, x, y, s, s, "#c9b3a6");
  const light = "#f3eee8";
  // The gate, drawn on the diagonal like the printed corner.
  rotated(ctx, x + s * 0.6, y + s * 0.54, -Math.PI / 4, () => {
    ctx.scale(0.85, 0.85);
    ctx.strokeStyle = light;
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.moveTo(-s * 0.4, -s * 0.12);
    ctx.lineTo(-s * 0.4, s * 0.12);
    ctx.lineTo(s * 0.4, s * 0.12);
    ctx.lineTo(s * 0.4, -s * 0.12);
    ctx.stroke();
    rect(ctx, -s * 0.22, -s * 0.2, s * 0.44, s * 0.08, light);
    text(ctx, "BUET", 0, -s * 0.158, s * 0.055, "#5a4a40", 700);
    rect(ctx, -s * 0.06, -s * 0.08, s * 0.16, s * 0.16, "#7d1b1b");
    ctx.strokeStyle = light;
    ctx.lineWidth = s * 0.01;
    ctx.beginPath();
    ctx.arc(s * 0.02, 0, s * 0.045, 0, Math.PI * 2);
    ctx.stroke();
    rect(ctx, -s * 0.3, -s * 0.05, s * 0.14, s * 0.14, "#a9c4e8");
    ctx.strokeStyle = "#5d7fb8";
    ctx.lineWidth = s * 0.008;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.3 + (s * 0.14 * i) / 3, -s * 0.05);
      ctx.lineTo(-s * 0.3 + (s * 0.14 * i) / 3, s * 0.09);
      ctx.moveTo(-s * 0.3, -s * 0.05 + (s * 0.14 * i) / 3);
      ctx.lineTo(-s * 0.16, -s * 0.05 + (s * 0.14 * i) / 3);
      ctx.stroke();
    }
    rect(ctx, s * 0.22, -s * 0.05, s * 0.03, s * 0.12, "#7d1b1b");
  });
  rotated(ctx, x + s * 0.27, y + s * 0.27, -Math.PI / 4, () => {
    ctx.fillStyle = light;
    ctx.font = font(s * 0.055, 600);
    ["COLLECT", "200TK SCHOLARSHIP", "AS YOU PASS"].forEach((l, i) => ctx.fillText(l, 0, (i - 1) * s * 0.066));
  });
  rotated(ctx, x + s * 0.8, y + s * 0.74, -Math.PI / 4, () => text(ctx, "BUET MAIN GATE", 0, 0, s * 0.055, light, 600));
  // The arrow along the bottom, pointing the way round the board.
  const ay = y + s * 0.92;
  const red = "#9b0c0c";
  polygon(
    ctx,
    [
      [x + s * 0.06, ay],
      [x + s * 0.17, ay - s * 0.06],
      [x + s * 0.17, ay - s * 0.022],
      [x + s * 0.92, ay - s * 0.022],
      [x + s * 0.96, ay - s * 0.05],
      [x + s * 0.96, ay + s * 0.05],
      [x + s * 0.92, ay + s * 0.022],
      [x + s * 0.17, ay + s * 0.022],
      [x + s * 0.17, ay + s * 0.06],
    ],
    red,
  );
}

function drawJail(ctx, x, y, s) {
  rect(ctx, x, y, s, s, "#3e4fa3");
  // The exam room: an octagon in the upper right (where jailed tokens stand),
  // with "just chilling" along the outer corner for visitors.
  const cx = x + s * 0.56;
  const cy = y + s * 0.44;
  const R = s * 0.34;
  const oct = (r) => Array.from({ length: 8 }, (_, i) => [cx + r * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), cy + r * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)]);
  polygon(ctx, oct(R + s * 0.012), "#e8b9c4");
  polygon(ctx, oct(R), "#b0213d");
  // The light-blue stretch of the ring, lower right.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R * 1.2, Math.PI * 0.02, Math.PI * 0.27);
  ctx.closePath();
  ctx.clip();
  polygon(ctx, oct(R), "#3a8be0");
  ctx.restore();
  polygon(ctx, oct(R * 0.8), "#e8b9c4");
  polygon(ctx, oct(R * 0.8 - s * 0.012), "#3e4fa3");
  rotated(ctx, cx, cy, Math.PI / 4, () => {
    ctx.fillStyle = "#a9c4ff";
    ctx.font = font(s * 0.048, 400, BUET_CARD_FONT);
    ctx.fillText("SUPPLEMENTARY", 0, -s * 0.03);
    ctx.fillText("EXAM", 0, s * 0.04);
  });
  rotated(ctx, x + s * 0.21, y + s * 0.81, Math.PI / 4, () => {
    ctx.fillStyle = "#d6e07a";
    ctx.font = font(s * 0.068, 400, BUET_CARD_FONT);
    ctx.fillText("JUST", 0, -s * 0.05);
    ctx.fillText("CHILLING", 0, s * 0.05);
  });
}

function drawParking(ctx, x, y, s) {
  rect(ctx, x, y, s, s, "#c9b5a8");
  const navy = "#2e3170";
  // A jeep climbing a slope.
  ctx.strokeStyle = navy;
  ctx.lineWidth = s * 0.018;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.16, y + s * 0.88);
  ctx.lineTo(x + s * 0.94, y + s * 0.34);
  ctx.stroke();
  rotated(ctx, x + s * 0.5, y + s * 0.5, -0.6, () => {
    ctx.lineWidth = s * 0.016;
    const body = "#efe6da";
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, s * 0.08);
    ctx.lineTo(-s * 0.32, -s * 0.06);
    ctx.lineTo(-s * 0.16, -s * 0.08);
    ctx.lineTo(-s * 0.1, -s * 0.24);
    ctx.lineTo(s * 0.3, -s * 0.24);
    ctx.lineTo(s * 0.32, s * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    rect(ctx, -s * 0.06, -s * 0.21, s * 0.13, s * 0.1, "#c9a77a");
    rect(ctx, s * 0.11, -s * 0.21, s * 0.15, s * 0.1, "#c9a77a");
    strokeRect(ctx, -s * 0.06, -s * 0.21, s * 0.13, s * 0.1, navy, s * 0.01);
    strokeRect(ctx, s * 0.11, -s * 0.21, s * 0.15, s * 0.1, navy, s * 0.01);
    // Roof rack.
    ctx.beginPath();
    ctx.moveTo(-s * 0.08, -s * 0.28);
    ctx.lineTo(s * 0.3, -s * 0.28);
    for (let i = 0; i < 5; i++) {
      ctx.moveTo(-s * 0.06 + i * s * 0.085, -s * 0.28);
      ctx.lineTo(-s * 0.06 + i * s * 0.085, -s * 0.24);
    }
    ctx.stroke();
    // Spare wheel and wheels.
    rect(ctx, s * 0.32, -s * 0.16, s * 0.06, s * 0.16, navy);
    for (const wx of [-s * 0.19, s * 0.2]) {
      ctx.fillStyle = navy;
      ctx.beginPath();
      ctx.arc(wx, s * 0.1, s * 0.085, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#d9dbe8";
      ctx.beginPath();
      ctx.arc(wx, s * 0.1, s * 0.035, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  rotated(ctx, x + s * 0.74, y + s * 0.8, -Math.PI / 4, () => {
    ctx.fillStyle = navy;
    ctx.font = font(s * 0.075, 600);
    ctx.fillText("MID-TERM", 0, -s * 0.045);
    ctx.fillText("BREAK", 0, s * 0.045);
  });
}

function drawGoToJail(ctx, x, y, s) {
  rect(ctx, x, y, s, s, "#2e4fa0");
  const i = s * 0.07;
  const a = x + i;
  const b = y + i;
  const n = s - i * 2;
  polygon(ctx, [[a, b], [a + n, b], [a + n, b + n]], "#c22a35");
  polygon(ctx, [[a, b], [a + n, b + n], [a, b + n]], "#3550a5");
  // The blue sash across the middle.
  polygon(
    ctx,
    [
      [a, b + n * 0.12],
      [a + n * 0.12, b],
      [a + n, b + n * 0.88],
      [a + n * 0.88, b + n],
    ],
    "#3a63c4",
  );
  polygon(ctx, [[a + n * 0.62, b + n * 0.07], [a + n * 0.93, b + n * 0.07], [a + n * 0.93, b + n * 0.38]], "#f2c64d");
  const yellow = "#f2d35a";
  rotated(ctx, a + n * 0.56, b + n * 0.34, Math.PI / 4, () => text(ctx, "ATTEND", 0, 0, s * 0.085, yellow, 400, BUET_CARD_FONT));
  rotated(ctx, a + n * 0.48, b + n * 0.52, Math.PI / 4, () => text(ctx, "SUPPLEMENTARY", 0, 0, s * 0.085, yellow, 400, BUET_CARD_FONT));
  rotated(ctx, a + n * 0.3, b + n * 0.72, Math.PI / 4, () => text(ctx, "EXAM", 0, 0, s * 0.085, yellow, 400, BUET_CARD_FONT));
}

// ── Squares ───────────────────────────────────────────────────────────────
// Each space draws itself into (x, y, w, h). `price(text, y, px, color, x)`
// writes the price line, or the owner's token once the square is owned.
const RAILROAD_ART = {
  5: { bg: "#8e2457", ink: "#f2b8cf", icon: civilIcon },
  15: { bg: "#4b2f86", ink: "#ece6fb", icon: archIcon },
  25: { bg: "#e3dcd1", ink: INK, icon: eceIcon },
  35: { bg: "#9fd3b0", ink: "#f7fff9", icon: mechIcon },
};
// The question mark's colour differs on each CGPA square.
const CGPA_MARK = { 7: "#ecc8de", 22: "#bcd9de", 36: "#f1d04a" };

export function drawBuetSpace(ctx, sp, x, y, w, h, PX, price, colorOf) {
  const cx = x + w / 2;
  const wide = w > h * 1.2; // the side columns
  const corner = sp.id % 10 === 0;
  const s = Math.min(w, h);
  // Which side of a wide square faces the board's centre.
  const innerRight = sp.id > 10 && sp.id < 20;

  if (corner) {
    if (sp.type === "go") drawGo(ctx, x, y, w);
    else if (sp.type === "jail") drawJail(ctx, x, y, w);
    else if (sp.type === "parking") drawParking(ctx, x, y, w);
    else drawGoToJail(ctx, x, y, w);
    return;
  }

  if (sp.type === "property") {
    rect(ctx, x, y, w, h, CREAM);
    const top = y + band(ctx, x, y, w, PX, colorOf(sp.color), ZIG[sp.color] || "#555");
    const priceY = y + h - PX * 0.17;
    if (wide) block(ctx, sp.name, cx, (top + priceY) / 2 - PX * 0.04, w - PX * 0.2, 2, PX * 0.16, PX * 0.1, INK);
    else block(ctx, sp.name, cx, top + PX * 0.34, w - PX * 0.12, 3, PX * 0.15, PX * 0.09, INK);
    price(`${sp.price} TK`, priceY, PX * 0.14, INK);
    return;
  }

  if (sp.type === "chance") {
    rect(ctx, x, y, w, h, "#2f6e4c");
    const mark = CGPA_MARK[sp.id] || "#f1d04a";
    if (wide) {
      const lx = innerRight ? x + w * 0.78 : x + w * 0.24;
      const qx = innerRight ? x + w * 0.34 : x + w * 0.66;
      text(ctx, "CGPA", lx, y + h / 2, PX * 0.24, "#f1d54a", 700);
      questionMark(ctx, qx, y + h * 0.56, h * 0.95, mark);
    } else {
      text(ctx, "CGPA", cx, y + PX * 0.22, PX * 0.26, "#f1d54a", 700);
      questionMark(ctx, cx, y + h * 0.62, h * 0.62, mark);
    }
    return;
  }

  if (sp.type === "community") {
    rect(ctx, x, y, w, h, "#8e4448");
    if (wide) {
      const lx = innerRight ? x + w * 0.8 : x + w * 0.22;
      const ix = innerRight ? x + w * 0.36 : x + w * 0.64;
      text(ctx, "BIIS", lx, y + h / 2, PX * 0.24, "#cdc3ee", 700);
      computer(ctx, ix, y + h / 2 + PX * 0.02, PX * 0.72, "#f3c9d3");
    } else {
      text(ctx, "BIIS", cx, y + PX * 0.22, PX * 0.26, "#cdc3ee", 700);
      computer(ctx, cx, y + h * 0.6, PX * 0.8, "#f3c9d3");
    }
    return;
  }

  if (sp.type === "railroad") {
    const art = RAILROAD_ART[sp.id] || RAILROAD_ART[5];
    rect(ctx, x, y, w, h, art.bg);
    const priceY = y + h - PX * 0.14;
    if (wide) {
      const nx = innerRight ? x + w * 0.74 : x + w * 0.27;
      const ix = innerRight ? x + w * 0.3 : x + w * 0.7;
      block(ctx, sp.name, nx, y + h * 0.4, w * 0.42, 3, PX * 0.12, PX * 0.08, art.ink);
      art.icon(ctx, ix, y + h * 0.5, h * 0.78);
      price(`${sp.price} TK`, priceY, PX * 0.12, art.ink, nx);
    } else {
      block(ctx, sp.name, cx, y + PX * 0.24, w - PX * 0.12, 2, PX * 0.14, PX * 0.09, art.ink);
      art.icon(ctx, cx, y + h * 0.52, w * 0.86);
      price(`${sp.price} TK`, priceY, PX * 0.13, art.ink);
    }
    return;
  }

  // Utilities and taxes on the cream ground.
  rect(ctx, x, y, w, h, CREAM);
  const isTax = sp.type === "tax";
  const line = isTax ? `PAY ${sp.amount} TK` : `${sp.price} TK`;
  const icon = (ix, iy, size) => {
    if (sp.type === "utility") {
      if (sp.id === 12) weightPlate(ctx, ix, iy, size);
      else redCross(ctx, ix, iy, size * 0.52);
    } else if (sp.id === 4) diamond(ctx, ix, iy, size * 0.22);
    else hallIcon(ctx, ix, iy, size * 0.9);
  };
  const priceY = y + h - PX * 0.15;
  if (wide) {
    const nx = innerRight ? x + w * 0.74 : x + w * 0.27;
    const ix = innerRight ? x + w * 0.3 : x + w * 0.7;
    block(ctx, sp.name, nx, y + h * 0.4, w * 0.44, 2, PX * 0.13, PX * 0.09, INK);
    icon(ix, y + h * 0.48, h * 0.7);
    if (isTax) text(ctx, line, nx, priceY, PX * 0.12, INK, 700);
    else price(line, priceY, PX * 0.12, INK, nx);
    return;
  } else {
    block(ctx, sp.name, cx, y + PX * 0.26, w - PX * 0.12, 2, PX * 0.14, PX * 0.09, INK);
    icon(cx, y + h * 0.55, s * 0.9);
  }
  if (isTax) text(ctx, line, cx, priceY, PX * 0.13, INK, 700);
  else price(line, priceY, PX * 0.13, INK);
}

// ── Centre: the campus map, the two card places and the compass ──────────
let roadsPath = null;
let buildingsPath = null;

export function drawBuetCenter(ctx, x, y, size) {
  rect(ctx, x, y, size, size, "#f4f1e8");
  if (typeof Path2D === "function") {
    if (!roadsPath) {
      roadsPath = new Path2D(ROADS);
      buildingsPath = new Path2D(BUILDINGS);
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.translate(x, y);
    ctx.scale(size / MAP_W, size / MAP_H);
    ctx.fillStyle = "#dedad5";
    ctx.fill(roadsPath, "evenodd");
    ctx.fillStyle = "#cbc9c6";
    ctx.fill(buildingsPath, "evenodd");
    ctx.restore();
  }
  const u = size / 1000;
  const P = (px, py) => [x + px * u, y + py * u];
  // Where the decks go: CGPA lower left, BIIS upper right (upside down for the
  // player across the table), as printed.
  const place = (pts) => {
    ctx.strokeStyle = "#6b3424";
    ctx.lineWidth = Math.max(2, u * 2.4);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(...P(px, py)) : ctx.moveTo(...P(px, py))));
    ctx.closePath();
    ctx.stroke();
  };
  place([[82, 786], [209, 661], [396, 847], [271, 973]]);
  place([[655, 210], [782, 82], [972, 271], [844, 399]]);
  ctx.fillStyle = "#1d1d1d";
  ctx.font = font(u * 36, 400, BUET_CARD_FONT);
  rotated(ctx, ...P(345, 716), Math.PI / 4, () => ctx.fillText("CGPA", 0, 0));
  rotated(ctx, ...P(706, 349), Math.PI / 4 + Math.PI, () => ctx.fillText("BIIS", 0, 0));
  // Compass, bottom right.
  const [kx, ky] = P(928, 962);
  const kr = u * 30;
  ctx.fillStyle = "#f7f4ec";
  ctx.strokeStyle = "#7a5a3a";
  ctx.lineWidth = Math.max(1.5, u * 1.6);
  ctx.beginPath();
  ctx.arc(kx, ky, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  polygon(ctx, [[kx, ky - kr * 0.8], [kx + kr * 0.2, ky], [kx - kr * 0.2, ky]], "#a3202a");
  polygon(ctx, [[kx, ky + kr * 0.8], [kx + kr * 0.2, ky], [kx - kr * 0.2, ky]], "#b88a5a");
}
