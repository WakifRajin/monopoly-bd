/*
 * Board scene (WebGL, three.js). Draws both board views:
 *   2D  the table seen from straight above
 *   3D  the same table tilted, with a camera you can turn and zoom
 * Switching views animates the camera, so the two are one continuous scene.
 *
 * Source file. The game loads the bundled build, scripts/board3d.min.js;
 * rebuild it after editing this file:   npm run build:3d
 *
 * The scene is a view of the game state and never changes it. Each frame it
 * compares the state (G, SPACES, the active theme) with what it last drew and
 * updates only what changed, so local play, AI turns and online snapshots all
 * show up without hooks into the rules code. Clicking a square calls the same
 * showSpaceInfo() as the HTML board, which stays in the page (hidden) as the
 * fallback for browsers without WebGL.
 *
 * Layout matches the HTML board's grid (styles/main.css): 11 x 11 cells,
 * corners 1.65 units, edge squares 1 unit, GO at the bottom right. Every square
 * is drawn upright with its colour bar along the top, like the HTML board, so
 * text reads the right way up from the default viewpoint in both views.
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// ── Board geometry (world units; 1 unit = one edge square) ─────────────────
const CORNER = 1.65;
const SIDE = CORNER * 2 + 9; // 12.3
const HALF = SIDE / 2;
const SLAB = 0.38; // board thickness
const TOP = SLAB / 2; // y of the playing surface
const TEX = 2048; // board texture size (px)
const PX = TEX / SIDE; // texture px per unit
const BAR = 0.2; // colour bar: fraction of a square's height

// Grid cell (1..11) of each space, same as the HTML board's CSS grid.
function cellOf(id) {
  if (id === 0) return { col: 11, row: 11 };
  if (id < 10) return { col: 11 - id, row: 11 };
  if (id === 10) return { col: 1, row: 11 };
  if (id < 20) return { col: 1, row: 11 - (id - 10) };
  if (id === 20) return { col: 1, row: 1 };
  if (id < 30) return { col: 1 + (id - 20), row: 1 };
  if (id === 30) return { col: 11, row: 1 };
  return { col: 11, row: 1 + (id - 30) };
}
const trackStart = (i) => (i <= 1 ? 0 : CORNER + (i - 2));
const trackSize = (i) => (i === 1 || i === 11 ? CORNER : 1);
// World-space rectangle of a space (x to the right, z toward the viewer).
function rectOf(id) {
  const { col, row } = cellOf(id);
  const x0 = -HALF + trackStart(col);
  const z0 = -HALF + trackStart(row);
  const w = trackSize(col);
  const d = trackSize(row);
  return { x0, z0, w, d, cx: x0 + w / 2, cz: z0 + d / 2 };
}
const isCorner = (id) => id % 10 === 0;

// ── Helpers ────────────────────────────────────────────────────────────────
const G_ = () => (typeof G !== "undefined" ? G : null);
const spaces = () => (typeof SPACES !== "undefined" ? SPACES : []);
const theme = () =>
  window.ACTIVE_THEME ||
  (typeof BOARD_THEMES !== "undefined" ? BOARD_THEMES.dhaka : null) ||
  {};
const colorOf = (key) =>
  (typeof COLOR !== "undefined" && COLOR[key]) || "#666666";
const money = (n) =>
  typeof fmtCurrency === "function" ? fmtCurrency(n) : String(n);
const moveFactor = () =>
  (typeof MOVE_SPEED !== "undefined" && MOVE_SPEED.factor) || 1;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}
function canvasTexture(c, anisotropy = 4) {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

const BODY = '"DM Sans", system-ui, sans-serif';
const DISPLAY = '"Playfair Display", Georgia, serif';

// Wraps text to at most maxLines lines of maxWidth, shrinking the font from
// maxPx toward minPx until it fits. Returns { size, lines }.
function fitText(ctx, text, weight, maxWidth, maxLines, maxPx, minPx) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  for (let size = maxPx; size >= minPx; size--) {
    ctx.font = `${weight} ${size}px ${BODY}`;
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
  ctx.font = `${weight} ${minPx}px ${BODY}`;
  return { size: minPx, lines: [String(text || "")] };
}

// ── Board texture ──────────────────────────────────────────────────────────
function palette() {
  const classic = (theme().id || "") === "classic";
  return classic
    ? { felt: ["#efe4c5", "#dccb9f"], square: "#f8f2df", corner: "#f3ead2", ink: "#181818", title: "#3a2a12" }
    : { felt: ["#d4ecd8", "#b8d8bf"], square: "#f4f8f2", corner: "#eaf4ec", ink: "#111111", title: "#123c22" };
}

function drawBoardTexture(canvas) {
  const ctx = canvas.getContext("2d");
  const t = theme();
  const g = G_();
  const pal = palette();
  ctx.save();
  ctx.clearRect(0, 0, TEX, TEX);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Felt.
  const felt = ctx.createRadialGradient(TEX / 2, TEX / 2, TEX * 0.08, TEX / 2, TEX / 2, TEX * 0.72);
  felt.addColorStop(0, pal.felt[0]);
  felt.addColorStop(1, pal.felt[1]);
  ctx.fillStyle = felt;
  ctx.fillRect(0, 0, TEX, TEX);

  // Centre: title and edition, in the upper half (the lower half holds the
  // dice and, in the 2D view, the Roll / End turn buttons).
  ctx.fillStyle = pal.title;
  ctx.font = `900 ${Math.round(PX * 1.05)}px ${DISPLAY}`;
  ctx.fillText("MONOPOLY", TEX / 2, TEX / 2 - PX * 2.35);
  ctx.fillStyle = "#1f5a33";
  ctx.font = `700 ${Math.round(PX * 0.3)}px ${BODY}`;
  // Letter-spacing is done by inserting hair spaces, which only works for
  // Latin text: in Bengali it splits vowel signs from their consonants.
  const edition = `${String(t.name || "").toUpperCase()} EDITION`;
  const latin = /^[ -~]*$/.test(edition);
  ctx.fillText(latin ? edition.split("").join(String.fromCharCode(8202, 8202)) : edition, TEX / 2, TEX / 2 - PX * 1.55);

  for (const sp of spaces()) {
    if (!sp) continue;
    const r = rectOf(sp.id);
    const x = (r.x0 + HALF) * PX;
    const y = (r.z0 + HALF) * PX;
    const w = r.w * PX;
    const h = r.d * PX;
    const cx = x + w / 2;
    const prop = g && g.properties ? g.properties[sp.id] : null;
    const pad = Math.min(w, h) * 0.08;
    const inner = w - pad * 2;

    ctx.fillStyle = isCorner(sp.id) ? pal.corner : pal.square;
    ctx.fillRect(x, y, w, h);

    const small = (txt, yy, px, color = "#444", weight = 600) => {
      ctx.fillStyle = color;
      ctx.font = `${weight} ${Math.round(px)}px ${BODY}`;
      ctx.fillText(txt, cx, yy);
    };
    const emoji = (txt, yy, px) => {
      ctx.font = `${Math.round(px)}px ${BODY}`;
      ctx.fillText(txt, cx, yy);
    };
    // Name block below the bar: up to 3 lines, fitted to the square.
    const nameBlock = (name, top, bottom, maxLines = 3) => {
      ctx.fillStyle = pal.ink;
      const fit = fitText(ctx, name, 700, inner, maxLines, Math.round(PX * 0.22), Math.round(PX * 0.12));
      const lh = fit.size * 1.1;
      const mid = (top + bottom) / 2;
      fit.lines.forEach((l, i) => ctx.fillText(l, cx, mid + (i - (fit.lines.length - 1) / 2) * lh));
    };

    if (sp.type === "property") {
      const barH = h * BAR;
      ctx.fillStyle = colorOf(sp.color);
      ctx.fillRect(x, y, w, barH);
      ctx.fillStyle = "rgba(0,0,0,.28)";
      ctx.fillRect(x, y + barH - 2, w, 2);
      const priceY = y + h - PX * 0.28;
      nameBlock(sp.name, y + barH + pad, priceY - PX * 0.14);
      small(money(sp.price), priceY, PX * 0.17, "#222", 700);
      small(`Rent ${money((sp.rent && sp.rent[0]) || 0)}`, y + h - PX * 0.1, PX * 0.12, "#666", 500);
    } else if (isCorner(sp.id)) {
      const my = y + h / 2;
      if (sp.type === "go") {
        emoji("🏁", my - PX * 0.42, PX * 0.42);
        small("GO", my + PX * 0.1, PX * 0.5, "#c0392b", 900);
        small(`Collect ${t.currency || ""}${Number(t.goSalary) || 0}`, my + PX * 0.55, PX * 0.15, "#1a5c1a");
      } else if (sp.type === "jail") {
        // The cell is the upper-right part (toward the board's centre);
        // "just visiting" runs along the outer edges.
        const cell = w * 0.6;
        const jx = x + w - cell;
        ctx.fillStyle = "#f59e0b";
        ctx.fillRect(jx, y, cell, cell);
        ctx.strokeStyle = "#1f2937";
        ctx.lineWidth = PX * 0.035;
        for (let i = 1; i < 5; i++) {
          const bx = jx + (cell * i) / 5;
          ctx.beginPath();
          ctx.moveTo(bx, y);
          ctx.lineTo(bx, y + cell);
          ctx.stroke();
        }
        ctx.fillStyle = "#1f2937";
        ctx.font = `900 ${Math.round(PX * 0.2)}px ${BODY}`;
        ctx.fillText("JAIL", jx + cell / 2, y + cell / 2);
        ctx.font = `700 ${Math.round(PX * 0.13)}px ${BODY}`;
        ctx.fillText("JUST VISITING", x + w / 2, y + h - PX * 0.14);
      } else if (sp.type === "parking") {
        small("FREE", my - PX * 0.45, PX * 0.24, "#b91c1c", 900);
        emoji("🅿️", my, PX * 0.44);
        small("PARKING", my + PX * 0.45, PX * 0.2, "#b91c1c", 900);
      } else if (sp.type === "gotojail") {
        small("GO TO", my - PX * 0.45, PX * 0.22, "#b91c1c", 900);
        emoji("🚔", my, PX * 0.44);
        small("JAIL", my + PX * 0.45, PX * 0.26, "#b91c1c", 900);
      }
    } else if (sp.type === "chance") {
      ctx.fillStyle = "#ea580c";
      ctx.font = `900 ${Math.round(Math.min(w, h) * 0.5)}px ${DISPLAY}`;
      ctx.fillText("?", cx, y + h * 0.42);
      small("CHANCE", y + h - PX * 0.18, PX * 0.14, "#ea580c", 800);
    } else if (sp.type === "community") {
      emoji("📦", y + h * 0.38, Math.min(w, h) * 0.36);
      small("COMMUNITY", y + h - PX * 0.3, PX * 0.12, "#1d4ed8", 800);
      small("CHEST", y + h - PX * 0.15, PX * 0.12, "#1d4ed8", 800);
    } else {
      // Stations, utilities, taxes: name, icon, price.
      const icon = sp.type === "railroad" ? "🚂" : sp.icon || "";
      const priceY = y + h - PX * 0.16;
      const wide = w > h; // side columns
      if (wide) {
        emoji(icon, y + h * 0.3, h * 0.3);
        nameBlock(sp.name, y + h * 0.45, priceY - PX * 0.12, 1);
      } else {
        nameBlock(sp.name, y + pad, y + h * 0.36, 2);
        emoji(icon, y + h * 0.56, Math.min(w, h) * 0.3);
      }
      const priceText = sp.type === "tax" ? `Pay ${money(sp.amount)}` : money(sp.price);
      small(priceText, priceY, PX * 0.15, "#222", 700);
    }

    // Ownership: a frame in the owner's colour. Mortgaged: dimmed.
    if (prop && prop.owner !== null && prop.owner !== undefined && g.players[prop.owner]) {
      const owner = g.players[prop.owner];
      ctx.strokeStyle = owner.color || "#fff";
      ctx.lineWidth = PX * 0.07;
      ctx.strokeRect(x + PX * 0.035, y + PX * 0.035, w - PX * 0.07, h - PX * 0.07);
      if (prop.mortgaged) {
        ctx.fillStyle = "rgba(40,40,40,.55)";
        ctx.fillRect(x, y, w, h);
        small("MORTGAGED", y + h / 2, PX * 0.12, "#fff", 800);
      }
    }

    ctx.strokeStyle = "#1b1b1b";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#1b1b1b";
  ctx.strokeRect(CORNER * PX, CORNER * PX, 9 * PX, 9 * PX);
  ctx.restore();
}

// ── Dice ───────────────────────────────────────────────────────────────────
// Face order of BoxGeometry materials: +x, -x, +y, -y, +z, -z. Opposite faces
// sum to 7, like a real die.
const FACE_VALUES = [3, 4, 1, 6, 2, 5];
const FACE_NORMALS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];
const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.28, 0.28], [0.72, 0.72]],
  3: [[0.26, 0.26], [0.5, 0.5], [0.74, 0.74]],
  4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
  5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.28, 0.24], [0.72, 0.24], [0.28, 0.5], [0.72, 0.5], [0.28, 0.76], [0.72, 0.76]],
};
function dieFaceTexture(value) {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fbfaf6";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = value === 1 ? "#c0392b" : "#1b1b1b";
  for (const [px, py] of PIPS[value]) {
    ctx.beginPath();
    ctx.arc(px * 256, py * 256, value === 1 ? 30 : 22, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvasTexture(c);
}
// Orientation that puts `value` on top, turned by `yaw` around the vertical.
function orientationFor(value, yaw) {
  const idx = FACE_VALUES.indexOf(value);
  const q = new Quaternion().setFromUnitVectors(FACE_NORMALS[idx], new Vector3(0, 1, 0));
  return new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw).multiply(q);
}
const DICE_REST = [new Vector3(-0.5, TOP + 0.31, -0.35), new Vector3(0.5, TOP + 0.31, -0.35)];
const DICE_MS = 620; // keep in step with diceRollDurationMs() in gameplay-actions.js

// ── Token chip and labels ──────────────────────────────────────────────────
function chipTopTexture(token, color) {
  const c = makeCanvas(256, 256);
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,.95)";
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([22, 18]);
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(255,255,255,.55)";
  ctx.beginPath();
  ctx.arc(128, 128, 122, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `120px ${BODY}`;
  ctx.fillText(token || "●", 128, 136);
  return canvasTexture(c);
}
// Where a token stands on square `pos`, given its place among the tokens
// there. Tokens stand below the colour bar; a jailed token stands in the cell.
const STACK = [
  [-0.24, -0.16],
  [0.24, -0.16],
  [-0.24, 0.2],
  [0.24, 0.2],
  [0, 0.02],
  [0, -0.34],
  [-0.24, 0.42],
  [0.24, 0.42],
];
function standPoint(pos, slot, jailed) {
  const r = rectOf(pos);
  if (pos === 10 && jailed) {
    const cell = r.w * 0.6;
    return {
      x: r.x0 + r.w - cell / 2 + (slot % 2 ? 0.16 : -0.16),
      z: r.z0 + cell / 2 + (Math.floor(slot / 2) % 2 ? 0.16 : -0.16),
    };
  }
  const [ox, oz] = STACK[slot % STACK.length];
  if (pos === 10) {
    // Just visiting: along the outer (bottom and left) strip.
    return { x: r.x0 + 0.3 + (slot % 4) * 0.32, z: r.z0 + r.d - 0.3 - (slot >= 4 ? 0.34 : 0) };
  }
  const scale = isCorner(pos) ? 1.4 : 1;
  const barShift = isCorner(pos) ? 0 : (r.d * BAR) / 2;
  const sx = Math.min(1, r.w / 1) * scale;
  const sz = Math.min(1, r.d / 1) * scale;
  return { x: r.cx + ox * sx, z: r.cz + barShift + oz * sz * 0.9 };
}

// A Monopoly-style building: a block with a gabled roof along its width.
function building(width, height, depth, roofHeight, bodyMat, roofMat) {
  const g = new Group();
  const body = new Mesh(new BoxGeometry(width, height, depth), bodyMat);
  body.position.y = TOP + height / 2;
  // Triangular prism, apex up, ridge running along the width. The eaves
  // overhang the walls slightly.
  const eave = depth * 0.56;
  const tri = new Shape();
  tri.moveTo(-eave, 0);
  tri.lineTo(eave, 0);
  tri.lineTo(0, roofHeight);
  tri.closePath();
  const roofGeo = new ExtrudeGeometry(tri, { depth: width * 1.04, bevelEnabled: false });
  roofGeo.translate(0, 0, (-width * 1.04) / 2);
  roofGeo.rotateY(Math.PI / 2);
  const roof = new Mesh(roofGeo, roofMat);
  roof.position.y = TOP + height;
  for (const m of [body, roof]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

// ── The scene ──────────────────────────────────────────────────────────────
class BoardScene {
  constructor(host, hud) {
    this.host = host;
    this.hud = hud;
    this.enabled = false;
    this.mode = "2d";
    this.modeT = 0; // 0 = 2D, 1 = 3D (animated between)
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.domElement.className = "board3d-canvas";
    host.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(14, 1, 0.1, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = MathUtils.degToRad(68);
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.enabled = false;
    this.controls.addEventListener("change", () => {
      this.userMoved = true;
      this.invalidate();
    });

    this.buildLights(mobile ? 1024 : 2048);
    this.buildTable();
    this.buildDice();

    this.tokens = new Map();
    this.buildings = new Group();
    this.scene.add(this.buildings);
    this.sig = { texture: "", buildings: "", roll: "" };
    this.frame = 0;
    this.dirty = 2;
    this.anims = new Set();
    this.diceUntil = 0;

    this.raycaster = new Raycaster();
    this.pointer = new Vector2();
    this.hoverId = null;
    this.bindPointer();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    if (hud) this.resizeObserver.observe(hud);
    this.loop = this.loop.bind(this);
  }

  invalidate() {
    this.dirty = Math.max(this.dirty, 2);
  }

  // ── Scene building ──
  buildLights(shadowSize) {
    this.scene.add(new HemisphereLight(0xfff3dd, 0x1d3325, 0.95));
    this.scene.add(new AmbientLight(0xffffff, 0.2));
    const sun = new DirectionalLight(0xfff1d6, 2.0);
    sun.position.set(-5, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = sun.shadow.camera;
    s.left = -8;
    s.right = 8;
    s.top = 8;
    s.bottom = -8;
    s.near = 1;
    s.far = 40;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 3;
    this.scene.add(sun);
    const rim = new DirectionalLight(0xf0c040, 0.45);
    rim.position.set(8, 5, -9);
    this.scene.add(rim);
  }

  buildTable() {
    this.boardCanvas = makeCanvas(TEX, TEX);
    this.boardTexture = canvasTexture(this.boardCanvas, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    const side = new MeshStandardMaterial({ color: 0x3a2a12, roughness: 0.55, metalness: 0.15 });
    const top = new MeshStandardMaterial({ map: this.boardTexture, roughness: 0.82, metalness: 0 });
    const slab = new Mesh(new BoxGeometry(SIDE, SLAB, SIDE), [side, side, top, side, side, side]);
    slab.receiveShadow = true;
    slab.castShadow = true;
    this.scene.add(slab);
    this.boardTop = slab;

    const rim = new Mesh(
      new BoxGeometry(SIDE + 0.5, SLAB * 0.8, SIDE + 0.5),
      new MeshStandardMaterial({ color: 0xd9aa3a, roughness: 0.3, metalness: 0.85 }),
    );
    rim.position.y = -SLAB * 0.15;
    rim.receiveShadow = true;
    this.scene.add(rim);

    const table = new Mesh(new CircleGeometry(60, 64), new MeshStandardMaterial({ color: 0x0b2415, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = -SLAB / 2 - 0.02;
    table.receiveShadow = true;
    this.scene.add(table);

    // Card decks, bottom corners of the centre.
    const deck = (x, z, color, label, yaw) => {
      const g = new Group();
      const mat = new MeshStandardMaterial({ color, roughness: 0.6 });
      const c = makeCanvas(256, 160);
      const ctx = c.getContext("2d");
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 256, 160);
      ctx.strokeStyle = "rgba(255,255,255,.8)";
      ctx.lineWidth = 8;
      ctx.strokeRect(12, 12, 232, 136);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const lines = label.split(" ");
      const size = lines.length > 1 ? 30 : 40;
      ctx.font = `900 ${size}px ${BODY}`;
      lines.forEach((l, i) => ctx.fillText(l, 128, 82 + (i - (lines.length - 1) / 2) * size * 1.1));
      const topMat = new MeshStandardMaterial({ map: canvasTexture(c), roughness: 0.6 });
      const edge = new MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 });
      for (let i = 0; i < 6; i++) {
        const card = new Mesh(
          new BoxGeometry(1.6, 0.025, 1.0),
          i === 5 ? [edge, edge, topMat, mat, edge, edge] : [edge, edge, mat, mat, edge, edge],
        );
        card.position.y = TOP + 0.015 + i * 0.027;
        card.rotation.y = (Math.random() - 0.5) * 0.05;
        card.castShadow = true;
        card.receiveShadow = true;
        g.add(card);
      }
      g.position.set(x, 0, z);
      g.rotation.y = yaw;
      this.scene.add(g);
    };
    deck(-2.75, 2.95, "#ea580c", "CHANCE", 0.18);
    deck(2.75, 2.95, "#2563eb", "COMMUNITY CHEST", -0.18);

    this.hover = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xf0c040, transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.hover.rotation.x = -Math.PI / 2;
    this.hover.position.y = TOP + 0.004;
    this.hover.visible = false;
    this.scene.add(this.hover);

    // A brief glow on the square a token lands on.
    this.flash = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.flash.rotation.x = -Math.PI / 2;
    this.flash.position.y = TOP + 0.005;
    this.scene.add(this.flash);
  }

  buildDice() {
    const geo = new RoundedBoxGeometry(0.62, 0.62, 0.62, 4, 0.1);
    const faces = FACE_VALUES.map((v) => new MeshStandardMaterial({ map: dieFaceTexture(v), roughness: 0.35, metalness: 0.02 }));
    this.dice = [0, 1].map((i) => {
      const m = new Mesh(geo, faces);
      m.castShadow = true;
      m.receiveShadow = true;
      m.position.copy(DICE_REST[i]);
      m.quaternion.copy(orientationFor(1, 0));
      this.scene.add(m);
      return m;
    });
  }

  flashSquare(id) {
    const r = rectOf(id);
    this.flash.scale.set(r.w, r.d, 1);
    this.flash.position.x = r.cx;
    this.flash.position.z = r.cz;
    this.animate(0.45, (k) => {
      this.flash.material.opacity = 0.55 * (1 - k);
    });
  }

  // ── Syncing with the game state ──
  sync(full) {
    const g = G_();
    if (!g || !Array.isArray(g.players)) return;
    this.syncDice(g);
    if (!full) return;
    const sps = spaces();
    const texSig =
      (theme().id || "") +
      "|" +
      sps.map((s) => (s ? s.name + (s.price || "") : "")).join(",") +
      "|" +
      Object.keys(g.properties || {})
        .map((k) => {
          const p = g.properties[k];
          return p ? `${k}:${p.owner ?? "-"}:${p.mortgaged ? 1 : 0}` : "";
        })
        .join(",") +
      "|" +
      g.players.map((p) => p.color).join(",");
    if (texSig !== this.sig.texture) {
      this.sig.texture = texSig;
      drawBoardTexture(this.boardCanvas);
      this.boardTexture.needsUpdate = true;
      this.invalidate();
    }
    const bSig = Object.keys(g.properties || {})
      .map((k) => {
        const p = g.properties[k];
        return p && (p.houses || p.hotel) ? `${k}:${p.houses || 0}:${p.hotel ? 1 : 0}` : "";
      })
      .join(",");
    if (bSig !== this.sig.buildings) {
      this.sig.buildings = bSig;
      this.syncBuildings(g);
    }
    this.syncTokens(g);
  }

  syncBuildings(g) {
    const oldCount = this.buildings.children.length;
    this.buildings.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.buildings.clear();
    const houseMat = new MeshStandardMaterial({ color: 0x2fae5a, roughness: 0.5 });
    const roofMat = new MeshStandardMaterial({ color: 0x1f7a3d, roughness: 0.55 });
    const hotelMat = new MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.45 });
    const hotelRoof = new MeshStandardMaterial({ color: 0x9a1f1f, roughness: 0.5 });
    for (const sp of spaces()) {
      if (!sp || sp.type !== "property") continue;
      const p = g.properties && g.properties[sp.id];
      if (!p || (!p.houses && !p.hotel)) continue;
      const r = rectOf(sp.id);
      const barZ = r.z0 + (r.d * BAR) / 2;
      if (p.hotel) {
        const hotel = building(Math.min(0.55, r.w * 0.6), 0.2, 0.2, 0.12, hotelMat, hotelRoof);
        hotel.position.set(r.cx, 0, barZ);
        this.buildings.add(hotel);
      } else {
        const n = Math.min(4, p.houses);
        const gap = Math.min(0.22, (r.w * 0.9) / 4);
        for (let i = 0; i < n; i++) {
          const house = building(0.16, 0.13, 0.16, 0.09, houseMat, roofMat);
          house.position.set(r.cx + (i - (n - 1) / 2) * gap, 0, barZ);
          this.buildings.add(house);
        }
      }
    }
    if (this.buildings.children.length > oldCount && oldCount + this.buildings.children.length > 0) {
      const all = this.buildings.children;
      all.forEach((b) => {
        b.position.y = 0.8;
      });
      this.animate(0.35, (t) => all.forEach((b) => (b.position.y = 0.8 * (1 - easeOut(t)))));
    }
    this.invalidate();
  }

  tokenMesh(p) {
    const g = new Group();
    const side = new MeshStandardMaterial({ color: new Color(p.color || "#888"), roughness: 0.4, metalness: 0.1 });
    const topMat = new MeshStandardMaterial({ map: chipTopTexture(p.token, p.color || "#888"), roughness: 0.45 });
    const chip = new Mesh(new CylinderGeometry(0.28, 0.28, 0.13, 40), [side, topMat, side]);
    chip.position.y = 0.065;
    chip.castShadow = true;
    chip.receiveShadow = true;
    g.add(chip);
    const edge = new Mesh(new TorusGeometry(0.28, 0.017, 8, 48), new MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.065;
    g.add(edge);
    const glow = new Mesh(
      new RingGeometry(0.32, 0.41, 48),
      new MeshBasicMaterial({ color: 0xf0c040, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.006;
    glow.visible = false;
    g.add(glow);
    g.userData = { glow };
    this.scene.add(g);
    return g;
  }

  // Slot of player i among the tokens standing on `pos`.
  slotOf(g, i, pos) {
    const p = g.players[i];
    const jailed = !!p.inJail;
    const here = g.players
      .map((x, idx) => ({ x, idx }))
      .filter(({ x }) => x && !x.bankrupt && (x.inJail ? 10 : Number(x.pos) || 0) === pos && !!x.inJail === jailed);
    return Math.max(0, here.findIndex((e) => e.idx === i));
  }

  syncTokens(g) {
    const now = performance.now();
    const alive = new Set();
    g.players.forEach((p, i) => {
      if (!p || p.bankrupt) return;
      alive.add(i);
      let t = this.tokens.get(i);
      if (t && (t.token !== p.token || t.color !== p.color)) {
        this.scene.remove(t.group);
        this.tokens.delete(i);
        t = null;
      }
      const pos = p.inJail ? 10 : Number(p.pos) || 0;
      const jailed = !!p.inJail;
      if (!t) {
        const group = this.tokenMesh(p);
        const sp = standPoint(pos, this.slotOf(g, i, pos), jailed);
        group.position.set(sp.x, TOP, sp.z);
        t = { group, pos, jailed, lastQueued: pos, token: p.token, color: p.color, queue: [], hopping: false };
        this.tokens.set(i, t);
      }
      // New destination: walk forward square by square for ordinary moves;
      // jump straight there for jail, "go back" cards and the like.
      if (pos !== t.lastQueued && (pos !== t.pos || jailed !== t.jailed)) {
        const from = t.lastQueued ?? t.pos;
        const forward = (pos - from + 40) % 40;
        if (!jailed && forward > 0 && forward <= 12) {
          for (let k = 1; k <= forward; k++) t.queue.push({ pos: (from + k) % 40, jailed: false });
        } else {
          t.queue.push({ pos, jailed, jump: true });
        }
        t.lastQueued = pos;
        // Never fall far behind the game (fast AI turns, a background tab):
        // past a dozen squares, jump straight to the destination.
        if (t.queue.length > 12) {
          const last = t.queue[t.queue.length - 1];
          t.queue = [{ pos: last.pos, jailed: last.jailed, jump: true }];
        }
      }
      // Wait for the dice to land before moving.
      if (!t.hopping && t.queue.length && now >= this.diceUntil) this.hopNext(g, i, t);
      if (!t.hopping && !t.queue.length) {
        // Settle into the right slot when others arrive or leave.
        const sp = standPoint(t.pos, this.slotOf(g, i, t.pos), t.jailed);
        const dx = sp.x - t.group.position.x;
        const dz = sp.z - t.group.position.z;
        if (Math.hypot(dx, dz) > 0.01) {
          t.hopping = true;
          const fx = t.group.position.x;
          const fz = t.group.position.z;
          this.animate(0.2, (k) => {
            const e = easeInOut(k);
            t.group.position.x = fx + dx * e;
            t.group.position.z = fz + dz * e;
            if (k >= 1) t.hopping = false;
          });
        }
      }
      const current = i === g.currentPlayerIdx;
      if (t.group.userData.glow.visible !== current) {
        t.group.userData.glow.visible = current;
        this.invalidate();
      }
    });
    for (const [i, t] of this.tokens) {
      if (!alive.has(i)) {
        this.scene.remove(t.group);
        this.tokens.delete(i);
        this.invalidate();
      }
    }
  }

  hopNext(g, i, t) {
    const step = t.queue.shift();
    const pos = step.pos;
    t.hopping = true;
    t.pos = pos;
    t.jailed = step.jailed;
    // Mid-walk squares use the centre slot; the last one the real slot.
    const last = !t.queue.length;
    const slot = last ? this.slotOf(g, i, pos) : 4;
    const target = standPoint(pos, slot, step.jailed);
    const from = t.group.position.clone();
    const dx = target.x - from.x;
    const dz = target.z - from.z;
    const dist = Math.hypot(dx, dz);
    // Catch up when several squares are waiting.
    const hurry = t.queue.length > 3 ? 0.55 : 1;
    const dur = step.jump ? 0.55 : Math.max(0.08, Math.min(0.22, 0.17 * moveFactor()) * hurry);
    const height = step.jump ? 1.1 : 0.32;
    this.animate(dur, (k) => {
      const e = easeInOut(k);
      t.group.position.x = from.x + dx * e;
      t.group.position.z = from.z + dz * e;
      t.group.position.y = TOP + Math.sin(Math.PI * k) * height * Math.min(1, 0.4 + dist);
      if (k >= 1) {
        t.group.position.y = TOP;
        t.hopping = false;
        if (last) this.flashSquare(pos);
      }
    });
  }

  syncDice(g) {
    // A roll is a new "rolled" log line; this catches local, AI and remote
    // rolls alike (remote clients only receive the state).
    const log = Array.isArray(g.log) ? g.log : [];
    let latest = null;
    for (let i = log.length - 1; i >= 0 && i >= log.length - 12; i--) {
      if (/ rolled \d+ \(/.test(String(log[i] && log[i].text))) {
        latest = log[i];
        break;
      }
    }
    const key = latest ? `${latest.id || ""}|${latest.time || ""}` : "none";
    const values = [Number(g.dice && g.dice[0]) || 1, Number(g.dice && g.dice[1]) || 1];
    if (!this.sig.roll) {
      this.sig.roll = key;
      this.dice.forEach((d, i) => d.quaternion.copy(orientationFor(values[i], i ? -0.2 : 0.25)));
      this.invalidate();
      return;
    }
    if (key !== this.sig.roll) {
      this.sig.roll = key;
      if (latest) this.rollDice(values);
    }
  }

  // A quick throw: in from the current player's side, two bounces, lands
  // on the rolled faces. Tokens wait until it is done.
  rollDice(values) {
    const g = G_();
    const cur = g && g.players[g.currentPlayerIdx];
    const pos = cur ? (cur.inJail ? 10 : Number(cur.pos) || 0) : 0;
    const from = rectOf(pos);
    this.diceUntil = performance.now() + DICE_MS;
    this.dice.forEach((die, i) => {
      const rest = DICE_REST[i].clone();
      rest.x += (Math.random() - 0.5) * 0.35;
      rest.z += (Math.random() - 0.5) * 0.3;
      const start = new Vector3(from.cx * 0.45 + (i ? 0.3 : -0.3), TOP + 1.6, from.cz * 0.45);
      const endQ = orientationFor(values[i], (Math.random() - 0.5) * 1.1);
      const axis = new Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize();
      const turns = Math.PI * 2 * (1.6 + Math.random() * 0.8);
      this.animate(DICE_MS / 1000 - i * 0.04, (k) => {
        const e = easeOut(k);
        die.position.x = start.x + (rest.x - start.x) * e;
        die.position.z = start.z + (rest.z - start.z) * e;
        const b = k < 0.5 ? 1 - Math.pow(k / 0.5, 2) : k < 0.82 ? 0.22 * Math.sin(((k - 0.5) / 0.32) * Math.PI) : 0.05 * Math.sin(((k - 0.82) / 0.18) * Math.PI);
        die.position.y = rest.y + Math.max(0, b) * (start.y - rest.y);
        die.quaternion.copy(endQ).premultiply(new Quaternion().setFromAxisAngle(axis, turns * (1 - e)));
        if (k >= 1) {
          die.position.copy(rest);
          die.quaternion.copy(endQ);
        }
      });
    });
  }

  // ── Animation ──
  animate(duration, step) {
    const a = { start: performance.now(), duration: Math.max(1, duration * 1000), step };
    this.anims.add(a);
    this.invalidate();
    return a;
  }
  tickAnims(now) {
    for (const a of this.anims) {
      const k = Math.min(1, (now - a.start) / a.duration);
      a.step(k);
      if (k >= 1) this.anims.delete(a);
    }
    if (this.anims.size) this.invalidate();
  }

  // ── Picking ──
  bindPointer() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    el.addEventListener("pointerup", (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (moved > 6 || !quick) return;
      const id = this.pick(e);
      if (id !== null && typeof showSpaceInfo === "function") showSpaceInfo(id);
    });
    el.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const id = this.pick(e);
      if (id !== this.hoverId) {
        this.hoverId = id;
        el.style.cursor = id !== null ? "pointer" : this.mode === "3d" ? "grab" : "default";
        if (id !== null) {
          const r = rectOf(id);
          this.hover.scale.set(r.w, r.d, 1);
          this.hover.position.x = r.cx;
          this.hover.position.z = r.cz;
          this.hover.visible = true;
        } else this.hover.visible = false;
        this.invalidate();
      }
    });
    el.addEventListener("pointerleave", () => {
      this.hoverId = null;
      this.hover.visible = false;
      this.invalidate();
    });
  }
  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.boardTop, false)[0];
    if (!hit || hit.point.y < TOP - 0.01) return null;
    const { x, z } = hit.point;
    for (const sp of spaces()) {
      if (!sp) continue;
      const r = rectOf(sp.id);
      if (x >= r.x0 && x <= r.x0 + r.w && z >= r.z0 && z <= r.z0 + r.d) return sp.id;
    }
    return null;
  }

  // ── Camera ──
  // A pose is { fov, dock, target, pos }. 2D looks straight down through a
  // narrow lens (close to a flat plan view); 3D is tilted with a normal lens
  // and leaves room for the controls dock under the board.
  poseFor(mode) {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    const dockH = this.hud ? this.hud.offsetHeight : 0;
    const dock = mode === "3d" && dockH ? dockH + 16 : 0;
    const aspectAvail = w / Math.max(1, h - dock);
    const fov = mode === "3d" ? 38 : 14;
    const polar = mode === "3d" ? MathUtils.degToRad(aspectAvail < 0.9 ? 28 : 40) : 0.0005;
    const target = new Vector3(0, 0, mode === "3d" ? 0.2 : 0);
    const dir = new Vector3(0, Math.cos(polar), Math.sin(polar));
    const e = HALF + 0.3;
    const corners = [
      [-e, TOP, -e], [e, TOP, -e], [-e, TOP, e], [e, TOP, e],
      [-e, -SLAB, e], [e, -SLAB, e],
    ].map(([x, y, z]) => new Vector3(x, y, z));
    const cam = this.camera.clone();
    cam.fov = fov;
    cam.aspect = w / h;
    if (dock) cam.setViewOffset(w, h + dock, 0, dock, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const margin = mode === "3d" ? 0.96 : 0.975;
    const fits = (d) => {
      cam.position.copy(dir).multiplyScalar(d).add(target);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(cam);
        return Math.abs(p.x) <= margin && Math.abs(p.y) <= margin;
      });
    };
    let lo = 2, hi = 400;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return { fov, dock, target, pos: dir.clone().multiplyScalar(hi).add(target), dist: hi };
  }

  applyCamera(fov, dock, pos, target) {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.camera.fov = fov;
    this.camera.aspect = w / h;
    if (dock > 0.5) this.camera.setViewOffset(w, h + dock, 0, dock, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(pos);
    this.camera.lookAt(target);
    this.controls.target.copy(target);
    this.currentDock = dock;
    this.invalidate();
  }

  // Animates the camera (and the controls dock) to the pose for `mode`.
  setMode(mode, animate = true) {
    this.mode = mode;
    const to = this.poseFor(mode);
    const toT = mode === "3d" ? 1 : 0;
    this.controls.enabled = false;
    this.userMoved = false;
    if (this.modeAnim) this.anims.delete(this.modeAnim);
    const finish = () => {
      this.modeT = toT;
      this.applyCamera(to.fov, to.dock, to.pos, to.target);
      if (mode === "3d") {
        this.controls.minDistance = to.dist * 0.45;
        this.controls.maxDistance = to.dist * 1.6;
        this.controls.enabled = true;
        this.controls.update();
      }
      this.userMoved = false;
      this.placeHud();
    };
    if (!animate) {
      finish();
      return;
    }
    const from = {
      fov: this.camera.fov,
      dock: this.currentDock || 0,
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      t: this.modeT,
    };
    // Move in spherical terms around the target so the camera swings over
    // the board instead of cutting through it.
    const fromOff = from.pos.clone().sub(from.target);
    const toOff = to.pos.clone().sub(to.target);
    const fromR = fromOff.length();
    const toR = toOff.length();
    const fromPolar = Math.acos(MathUtils.clamp(fromOff.y / fromR, -1, 1));
    const toPolar = Math.acos(MathUtils.clamp(toOff.y / toR, -1, 1));
    const fromAz = Math.atan2(fromOff.x, fromOff.z);
    let toAz = 0;
    let dAz = toAz - fromAz;
    while (dAz > Math.PI) dAz -= Math.PI * 2;
    while (dAz < -Math.PI) dAz += Math.PI * 2;
    // Keep the apparent size steady while the lens changes: interpolate the
    // distance as tan(fov/2) * r, which is what fixes the framing.
    const fromK = Math.tan(MathUtils.degToRad(from.fov) / 2) * fromR;
    const toK = Math.tan(MathUtils.degToRad(to.fov) / 2) * toR;
    this.modeAnim = this.animate(0.75, (k) => {
      const e = easeInOut(k);
      const fov = lerp(from.fov, to.fov, e);
      const kk = lerp(fromK, toK, e);
      const r = kk / Math.tan(MathUtils.degToRad(fov) / 2);
      const polar = lerp(fromPolar, toPolar, e);
      const az = fromAz + dAz * e;
      const target = from.target.clone().lerp(to.target, e);
      const pos = new Vector3(Math.sin(polar) * Math.sin(az), Math.cos(polar), Math.sin(polar) * Math.cos(az)).multiplyScalar(r).add(target);
      this.modeT = lerp(from.t, toT, e);
      this.applyCamera(fov, lerp(from.dock, to.dock, e), pos, target);
      this.placeHud();
      if (k >= 1) finish();
    });
  }

  resetView() {
    this.setMode(this.mode, true);
  }

  // The controls dock: centred on the board below the dice in 2D, docked
  // under the board in 3D, sliding between the two with the camera.
  placeHud() {
    if (!this.hud) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    const p = new Vector3(0, TOP, 1.25).project(this.camera);
    const x2 = ((p.x + 1) / 2) * w;
    const y2 = ((1 - p.y) / 2) * h;
    const hudH = this.hud.offsetHeight || 0;
    const x3 = w / 2;
    const y3 = h - hudH / 2 - 12;
    const m = this.modeT;
    // Size the dock to the board in 2D so it never covers the squares.
    const boardPx = Math.min(w, h);
    const scale2 = MathUtils.clamp(boardPx / 640, 0.7, 1);
    this.hud.style.left = `${lerp(x2, x3, m)}px`;
    this.hud.style.top = `${lerp(y2, y3, m)}px`;
    this.hud.style.setProperty("--hud-scale", String(lerp(scale2, 1, m)));
    this.hud.classList.toggle("is-docked", m > 0.5);
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    if (this.modeAnim && this.anims.has(this.modeAnim)) return;
    if (this.mode === "2d" || !this.userMoved) this.setMode(this.mode, false);
    else {
      const to = this.poseFor(this.mode);
      this.applyCamera(this.camera.fov, to.dock, this.camera.position.clone(), this.controls.target.clone());
      this.placeHud();
    }
    this.invalidate();
  }

  // ── Lifecycle ──
  start(mode) {
    this.mode = mode;
    this.modeT = mode === "3d" ? 1 : 0;
    if (!this.enabled) {
      this.enabled = true;
      requestAnimationFrame(this.loop);
    }
    this.sig.texture = "";
    this.sig.buildings = "";
    this.sync(true);
    this.resize();
    this.setMode(mode, false);
  }
  stop() {
    this.enabled = false;
  }
  loop(now) {
    if (!this.enabled) return;
    requestAnimationFrame(this.loop);
    if (document.hidden || !this.host.clientWidth) return;
    this.frame++;
    this.sync(this.frame % 3 === 0);
    this.tickAnims(now);
    if (this.controls.enabled && this.controls.update()) {
      this.invalidate();
      this.placeHud();
    }
    if (this.dirty > 0) {
      this.renderer.render(this.scene, this.camera);
      this.dirty--;
    }
  }
}

// ── Public API (used by scripts/ui-systems.js) ─────────────────────────────
let instance = null;
function supportsWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch (_err) {
    return false;
  }
}

window.Board3D = {
  supported: supportsWebGL(),
  async enable(mode = "2d") {
    const host = document.getElementById("board3d");
    const hud = document.getElementById("board3d-hud");
    if (!host || !this.supported) return false;
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (!instance) instance = new BoardScene(host, hud);
    instance.start(mode);
    return true;
  },
  disable() {
    if (instance) instance.stop();
  },
  setMode(mode, animate = true) {
    if (instance) instance.setMode(mode, animate);
  },
  resetView() {
    if (instance) instance.resetView();
  },
  get instance() {
    return instance;
  },
};
