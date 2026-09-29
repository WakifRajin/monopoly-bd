// ═══════════════════════════════════════════════
//  SAME WI-FI (LAN) MULTIPLAYER
// ═══════════════════════════════════════════════
// Rooms that live on the host's device and reach guests directly over WebRTC,
// the way PairDrop sends files. GitHub Pages has no server of its own, so two
// outside services help for the few seconds it takes to connect:
//   - a public STUN server tells each device its network's public address,
//     which is hashed into a network id: devices behind the same router get
//     the same id and see each other's rooms (like PairDrop);
//   - Firebase carries the room list (lanRooms/<network>) and the one-time
//     WebRTC offer/answer (lanSignal/<host>/<guest>).
// Once connected, the match goes device to device and Firebase is not used.
//
// The online room code is reused unchanged. It talks to the database through
// FIREBASE.api (ref/get/set/update/onValue/runTransaction/onDisconnect/push);
// during a LAN match that object is swapped for one backed by an in-memory
// store on the host. Guests reach the store over a data channel; transactions
// are compare-and-set with retry, like the real database. The host's clock is
// the "server time" for everyone.
//
// Limits: the room lives on the host's device, so if the host leaves or closes
// the tab, the match ends for everyone. Networks that isolate devices from each
// other (common on guest and public Wi-Fi) cannot connect.

const LAN = {
  active: false, // a LAN room is in use; FIREBASE.api is swapped
  role: null, // "host" | "guest"
  netId: null,
  real: null, // { api, db, serverTimeOffset } saved while swapped
  host: null, // host-side state
  guest: null, // guest-side state
  unsubRooms: null,
  rooms: [],
  status: "",
};

const LAN_STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const LAN_ROOM_TTL_MS = 60000;
const LAN_CHUNK = 48000;

// ── Values stored like the Realtime Database stores them ─────────────────
const LAN_SERVER_TS = { ".sv": "timestamp" };

// Nulls are deletions and empty containers disappear, as in RTDB; the online
// code was written against that behaviour.
function lanNorm(v, now) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "function") return null;
  if (Array.isArray(v)) {
    const out = v.map((x) => lanNorm(x, now));
    while (out.length && out[out.length - 1] === null) out.pop();
    return out.length ? out : null;
  }
  if (typeof v === "object") {
    if (v[".sv"] === "timestamp") return now;
    const out = {};
    let any = false;
    for (const k of Object.keys(v)) {
      const n = lanNorm(v[k], now);
      if (n !== null) {
        out[k] = n;
        any = true;
      }
    }
    return any ? out : null;
  }
  return null;
}
const lanClone = (v) => (v === null || v === undefined ? null : JSON.parse(JSON.stringify(v)));
function lanStable(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(lanStable).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${lanStable(v[k])}`)
    .join(",")}}`;
}
function lanHash(v) {
  const s = lanStable(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}:${s.length}`;
}
const lanParts = (path) => String(path || "").split("/").filter(Boolean);
const lanJoin = (a, b) => [...lanParts(a), ...lanParts(b)].join("/");
const lanRelated = (a, b) => {
  const pa = lanParts(a);
  const pb = lanParts(b);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) if (pa[i] !== pb[i]) return false;
  return true;
};
function lanSnap(path, value) {
  const v = value === undefined ? null : value;
  return {
    key: lanParts(path).pop() || null,
    exists: () => v !== null,
    val: () => lanClone(v),
  };
}
let lanPushCounter = 0;
function lanPushKey() {
  lanPushCounter = (lanPushCounter + 1) % 1000;
  return `-${Date.now().toString(36)}${String(lanPushCounter).padStart(3, "0")}${Math.random().toString(36).slice(2, 7)}`;
}

// ── Host: the in-memory database ──────────────────────────────────────────
class LanStore {
  constructor() {
    this.root = null;
    this.subs = new Map(); // id -> { path, owner, cb, last }
    this.nextSub = 1;
    this.disconnectOps = new Map(); // owner -> Map(path -> value|null)
  }
  get(path) {
    let node = this.root;
    for (const p of lanParts(path)) {
      if (node === null || typeof node !== "object") return null;
      node = node[p];
      if (node === undefined) return null;
    }
    return node === undefined ? null : node;
  }
  // Writes without notifying; set()/update() notify once afterwards.
  write(path, value) {
    const parts = lanParts(path);
    const v = lanNorm(value, Date.now());
    if (!parts.length) {
      this.root = v;
      return;
    }
    if (this.root === null || typeof this.root !== "object") this.root = {};
    const stack = [this.root];
    let node = this.root;
    for (let i = 0; i < parts.length - 1; i++) {
      let next = node[parts[i]];
      if (next === null || next === undefined || typeof next !== "object") {
        if (v === null) return;
        next = {};
        node[parts[i]] = next;
      }
      node = next;
      stack.push(node);
    }
    const last = parts[parts.length - 1];
    if (v === null) {
      if (Array.isArray(node)) node[last] = null;
      else delete node[last];
    } else node[last] = v;
    // Collapse containers left empty, as RTDB does.
    for (let i = stack.length - 1; i >= 1; i--) {
      const container = stack[i];
      const empty = Array.isArray(container)
        ? !container.some((x) => x !== null && x !== undefined)
        : !Object.keys(container).length;
      if (!empty) break;
      const parent = stack[i - 1];
      delete parent[parts[i - 1]];
    }
    if (this.root && typeof this.root === "object" && !Object.keys(this.root).length) this.root = null;
  }
  set(path, value) {
    this.write(path, value);
    this.notify([path]);
  }
  update(path, values) {
    const touched = [];
    for (const k of Object.keys(values || {})) {
      const p = lanJoin(path, k);
      this.write(p, values[k]);
      touched.push(p);
    }
    this.notify(touched.length ? touched : [path]);
  }
  // Compare-and-set: applies `value` only if `path` still hashes to `expect`.
  cas(path, expect, value) {
    const current = this.get(path);
    if (lanHash(current) !== expect) return { ok: false, value: lanClone(current) };
    this.write(path, value);
    this.notify([path]);
    return { ok: true, value: lanClone(this.get(path)) };
  }
  subscribe(path, owner, cb) {
    const id = this.nextSub++;
    const sub = { path, owner, cb, last: null };
    this.subs.set(id, sub);
    this.deliver(sub);
    return id;
  }
  unsubscribe(id) {
    this.subs.delete(id);
  }
  deliver(sub) {
    const value = this.get(sub.path);
    const h = lanHash(value);
    if (h === sub.last) return;
    sub.last = h;
    try {
      sub.cb(lanClone(value));
    } catch (err) {
      console.error(err);
    }
  }
  notify(paths) {
    for (const sub of [...this.subs.values()]) {
      if (paths.some((p) => lanRelated(p, sub.path))) this.deliver(sub);
    }
  }
  onDisconnectSet(owner, path, value) {
    if (!this.disconnectOps.has(owner)) this.disconnectOps.set(owner, new Map());
    this.disconnectOps.get(owner).set(lanParts(path).join("/"), value);
  }
  onDisconnectCancel(owner, path) {
    this.disconnectOps.get(owner)?.delete(lanParts(path).join("/"));
  }
  // A guest's link closed: run its onDisconnect writes, drop its listeners.
  dropOwner(owner) {
    const ops = this.disconnectOps.get(owner);
    this.disconnectOps.delete(owner);
    for (const [id, sub] of [...this.subs]) if (sub.owner === owner) this.subs.delete(id);
    if (ops) for (const [path, value] of ops) this.set(path, value);
  }
}

// ── Data channel framing (chunked JSON) ───────────────────────────────────
function lanWire(channel, onMessage) {
  const partial = new Map();
  channel.onmessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (_err) {
      return;
    }
    if (msg && msg.__chunk) {
      const entry = partial.get(msg.__chunk) || { parts: [], got: 0 };
      entry.parts[msg.i] = msg.d;
      entry.got++;
      partial.set(msg.__chunk, entry);
      if (entry.got < msg.n) return;
      partial.delete(msg.__chunk);
      try {
        msg = JSON.parse(entry.parts.join(""));
      } catch (_err) {
        return;
      }
    }
    onMessage(msg);
  };
  return (msg) => {
    if (channel.readyState !== "open") return false;
    const text = JSON.stringify(msg);
    if (text.length <= LAN_CHUNK) {
      channel.send(text);
      return true;
    }
    const id = Math.random().toString(36).slice(2);
    const n = Math.ceil(text.length / LAN_CHUNK);
    for (let i = 0; i < n; i++) {
      channel.send(JSON.stringify({ __chunk: id, i, n, d: text.slice(i * LAN_CHUNK, (i + 1) * LAN_CHUNK) }));
    }
    return true;
  };
}

// ── FIREBASE.api replacements ─────────────────────────────────────────────
// Refs are plain { path } objects; db arguments are ignored.
const lanRef = (_db, path = "") => ({ path: lanParts(path).join("/"), key: lanParts(path).pop() || null });

function lanHostApi(store) {
  const owner = "host";
  return {
    ref: lanRef,
    get: async (ref) => lanSnap(ref.path, store.get(ref.path)),
    set: async (ref, value) => store.set(ref.path, value),
    update: async (ref, values) => store.update(ref.path, values),
    remove: async (ref) => store.set(ref.path, null),
    push: (ref, value) => {
      const child = lanRef(null, lanJoin(ref.path, lanPushKey()));
      const p = Promise.resolve().then(() => store.set(child.path, value)).then(() => child);
      p.key = child.key;
      return p;
    },
    onValue: (ref, cb) => {
      const id = store.subscribe(ref.path, owner, (v) => cb(lanSnap(ref.path, v)));
      return () => store.unsubscribe(id);
    },
    runTransaction: async (ref, fn) => {
      const current = lanClone(store.get(ref.path));
      const next = fn(current);
      if (next === undefined) return { committed: false, snapshot: lanSnap(ref.path, current) };
      store.set(ref.path, next);
      return { committed: true, snapshot: lanSnap(ref.path, store.get(ref.path)) };
    },
    serverTimestamp: () => ({ ...LAN_SERVER_TS }),
    // The host's own disconnect ends the room, so its handlers never run.
    onDisconnect: () => ({ set: async () => {}, remove: async () => {}, cancel: async () => {} }),
    query: (ref) => ref,
    orderByChild: () => null,
    equalTo: () => null,
    limitToFirst: () => null,
  };
}

// Guests normalise with the sentinel itself as "now", which leaves server
// timestamps in place for the host to stamp with its own clock.
const LAN_SERVER_TS_PLACEHOLDER = LAN_SERVER_TS;

function lanGuestApi(guest) {
  const call = (msg) => guest.request(msg);
  return {
    ref: lanRef,
    get: async (ref) => lanSnap(ref.path, (await call({ op: "get", path: ref.path })).value),
    set: async (ref, value) => {
      await call({ op: "set", path: ref.path, value: lanNorm(value, LAN_SERVER_TS_PLACEHOLDER) });
    },
    update: async (ref, values) => {
      const clean = {};
      for (const k of Object.keys(values || {})) clean[k] = lanNorm(values[k], LAN_SERVER_TS_PLACEHOLDER);
      await call({ op: "update", path: ref.path, value: clean });
    },
    remove: async (ref) => {
      await call({ op: "set", path: ref.path, value: null });
    },
    push: (ref, value) => {
      const child = lanRef(null, lanJoin(ref.path, lanPushKey()));
      const p = call({ op: "set", path: child.path, value: lanNorm(value, LAN_SERVER_TS_PLACEHOLDER) }).then(() => child);
      p.key = child.key;
      return p;
    },
    onValue: (ref, cb) => guest.subscribe(ref.path, (v) => cb(lanSnap(ref.path, v))),
    runTransaction: async (ref, fn) => {
      let current = (await call({ op: "get", path: ref.path })).value;
      for (let attempt = 0; attempt < 25; attempt++) {
        const next = fn(lanClone(current));
        if (next === undefined) return { committed: false, snapshot: lanSnap(ref.path, current) };
        const res = await call({
          op: "cas",
          path: ref.path,
          expect: lanHash(current),
          value: lanNorm(next, LAN_SERVER_TS_PLACEHOLDER),
        });
        if (res.ok) return { committed: true, snapshot: lanSnap(ref.path, res.value) };
        current = res.value;
      }
      throw new Error("The room is busy. Try again.");
    },
    serverTimestamp: () => ({ ...LAN_SERVER_TS }),
    onDisconnect: (ref) => ({
      set: (value) => call({ op: "odset", path: ref.path, value: lanNorm(value, LAN_SERVER_TS_PLACEHOLDER) }),
      remove: () => call({ op: "odset", path: ref.path, value: null }),
      cancel: () => call({ op: "odcancel", path: ref.path }),
    }),
    query: (ref) => ref,
    orderByChild: () => null,
    equalTo: () => null,
    limitToFirst: () => null,
  };
}

// ── Host side ─────────────────────────────────────────────────────────────
function lanCreateHost() {
  const store = new LanStore();
  const host = { store, peers: new Map(), unsubSignal: null, heartbeat: null, code: null };
  host.attachPeer = (peerId, pc, channel) => {
    const peer = { pc, channel, subs: new Map() };
    peer.send = lanWire(channel, (msg) => lanHostHandle(host, peerId, peer, msg));
    host.peers.set(peerId, peer);
    const drop = () => {
      if (!host.peers.has(peerId)) return;
      host.peers.delete(peerId);
      store.dropOwner(peerId);
      try {
        pc.close();
      } catch (_err) {}
    };
    channel.onclose = drop;
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        // "disconnected" can recover; give it a moment.
        if (pc.connectionState === "disconnected") setTimeout(() => pc.connectionState !== "connected" && drop(), 6000);
        else drop();
      }
    };
  };
  return host;
}

function lanHostHandle(host, peerId, peer, msg) {
  const store = host.store;
  const reply = (body) => peer.send({ id: msg.id, ...body });
  try {
    switch (msg.op) {
      case "hello":
        reply({ ok: true, now: Date.now() });
        break;
      case "get":
        reply({ ok: true, value: lanClone(store.get(msg.path)) });
        break;
      case "set":
        store.set(msg.path, msg.value);
        reply({ ok: true });
        break;
      case "update":
        store.update(msg.path, msg.value);
        reply({ ok: true });
        break;
      case "cas":
        reply(store.cas(msg.path, msg.expect, msg.value));
        break;
      case "sub": {
        const id = store.subscribe(msg.path, peerId, (value) => peer.send({ sub: msg.sub, value }));
        peer.subs.set(msg.sub, id);
        break;
      }
      case "unsub": {
        const id = peer.subs.get(msg.sub);
        if (id) store.unsubscribe(id);
        peer.subs.delete(msg.sub);
        break;
      }
      case "odset":
        store.onDisconnectSet(peerId, msg.path, msg.value);
        reply({ ok: true });
        break;
      case "odcancel":
        store.onDisconnectCancel(peerId, msg.path);
        reply({ ok: true });
        break;
      default:
        reply({ ok: false, error: "Unknown request" });
    }
  } catch (err) {
    reply({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

// ── Guest side ────────────────────────────────────────────────────────────
function lanCreateGuest(pc, channel) {
  const guest = { pc, channel, pending: new Map(), subs: new Map(), nextId: 1, nextSub: 1, closed: false };
  guest.send = lanWire(channel, (msg) => {
    if (msg.sub !== undefined && msg.id === undefined) {
      const cb = guest.subs.get(msg.sub);
      if (cb) cb(msg.value);
      return;
    }
    const p = guest.pending.get(msg.id);
    if (!p) return;
    guest.pending.delete(msg.id);
    if (msg.ok === false && msg.error) p.reject(new Error(msg.error));
    else p.resolve(msg);
  });
  guest.request = (msg) =>
    new Promise((resolve, reject) => {
      if (guest.closed) return reject(new Error("Lost connection to the host."));
      const id = guest.nextId++;
      guest.pending.set(id, { resolve, reject });
      if (!guest.send({ ...msg, id })) {
        guest.pending.delete(id);
        reject(new Error("Lost connection to the host."));
      }
      setTimeout(() => {
        if (guest.pending.has(id)) {
          guest.pending.delete(id);
          reject(new Error("The host did not answer."));
        }
      }, 15000);
    });
  guest.subscribe = (path, cb) => {
    const sub = guest.nextSub++;
    guest.subs.set(sub, cb);
    guest.send({ op: "sub", path, sub });
    return () => {
      guest.subs.delete(sub);
      guest.send({ op: "unsub", sub });
    };
  };
  // The host is the room. When its link goes, every listener sees the room
  // disappear, which the online code already handles ("Room closed").
  guest.lost = () => {
    if (guest.closed) return;
    guest.closed = true;
    for (const p of guest.pending.values()) p.reject(new Error("Lost connection to the host."));
    guest.pending.clear();
    for (const cb of [...guest.subs.values()]) {
      try {
        cb(null);
      } catch (_err) {}
    }
    guest.subs.clear();
  };
  channel.onclose = guest.lost;
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") guest.lost();
    if (pc.connectionState === "disconnected") setTimeout(() => pc.connectionState !== "connected" && guest.lost(), 6000);
  };
  return guest;
}

// ── WebRTC helpers ────────────────────────────────────────────────────────
function lanWaitIce(pc, ms = 3000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    });
  });
}
function lanWaitOpen(channel, ms = 15000) {
  if (channel.readyState === "open") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    channel.addEventListener("open", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

// Guest: creates the offer (with all candidates, no trickle).
async function lanGuestOffer() {
  const pc = new RTCPeerConnection({ iceServers: LAN_STUN });
  const channel = pc.createDataChannel("room", { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await lanWaitIce(pc);
  return { pc, channel, sdp: pc.localDescription.sdp };
}
// Host: answers an offer; the peer attaches once its channel opens.
async function lanHostAnswer(host, peerId, sdp) {
  const pc = new RTCPeerConnection({ iceServers: LAN_STUN });
  pc.ondatachannel = (e) => {
    const channel = e.channel;
    const attach = () => host.attachPeer(peerId, pc, channel);
    if (channel.readyState === "open") attach();
    else channel.addEventListener("open", attach, { once: true });
  };
  await pc.setRemoteDescription({ type: "offer", sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await lanWaitIce(pc);
  setTimeout(() => {
    if (!host.peers.has(peerId) && pc.connectionState !== "connected") pc.close();
  }, 30000);
  return pc.localDescription.sdp;
}

// ── Network id (same router → same id) ────────────────────────────────────
// The public address comes from a STUN "server reflexive" candidate. IPv4 is
// shared by every device behind a home router; for IPv6 each device has its
// own address, so only the /64 network prefix is used.
async function lanDetectNetwork() {
  const pc = new RTCPeerConnection({ iceServers: LAN_STUN });
  pc.createDataChannel("probe");
  const found = new Set();
  pc.onicecandidate = (e) => {
    const c = e.candidate && e.candidate.candidate;
    if (!c || !/ typ srflx /.test(c)) return;
    const addr = c.split(" ")[4];
    if (addr) found.add(addr);
  };
  await pc.setLocalDescription(await pc.createOffer());
  await lanWaitIce(pc, 4000);
  pc.close();
  const list = [...found];
  const v4 = list.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const v6 = list.find((a) => a.includes(":"));
  const key = v4 || (v6 ? v6.split(":").slice(0, 4).join(":") : null);
  if (!key) return null;
  const bytes = new TextEncoder().encode(`monopoly-bd-lan|${key}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Swapping the database the online code talks to ────────────────────────
function lanSwapIn(api, serverTimeOffset) {
  if (!LAN.real) {
    LAN.real = { api: FIREBASE.api, db: FIREBASE.db, serverTimeOffset: ONLINE.serverTimeOffset };
  }
  FIREBASE.api = api;
  FIREBASE.db = { lan: true };
  ONLINE.serverTimeOffset = serverTimeOffset;
  LAN.active = true;
}
function lanSwapOut() {
  if (LAN.real) {
    FIREBASE.api = LAN.real.api;
    FIREBASE.db = LAN.real.db;
    ONLINE.serverTimeOffset = LAN.real.serverTimeOffset || 0;
  }
  LAN.real = null;
  LAN.active = false;
}
// The real Firebase API, whatever is swapped in.
const lanFb = () => (LAN.real ? LAN.real : { api: FIREBASE.api, db: FIREBASE.db });

// ── Screen ────────────────────────────────────────────────────────────────
function lanSetStatus(text, isError = false) {
  LAN.status = text;
  const el = document.getElementById("lan-status");
  if (el) {
    el.textContent = text;
    el.classList.toggle("is-error", !!isError);
  }
}

async function openLanPage() {
  showScreen("lan-screen");
  const nameInput = document.getElementById("lan-player-name");
  if (nameInput && !nameInput.value) {
    let saved = "";
    try {
      saved = localStorage.getItem("monopoly_online_name") || "";
    } catch (_err) {}
    nameInput.value = saved || document.getElementById("online-player-name")?.value || "";
  }
  renderLanRooms();
  await lanStartDiscovery();
}

async function lanWaitReady() {
  if (ONLINE.ready) return true;
  return bootstrapFirebase();
}

async function lanStartDiscovery() {
  if (typeof RTCPeerConnection === "undefined") {
    lanSetStatus("This browser cannot make direct connections (WebRTC is missing).", true);
    return;
  }
  if (LAN.unsubRooms && LAN.netId) return;
  lanSetStatus("Looking for games on this network…");
  if (!(await lanWaitReady())) {
    lanSetStatus("Finding games needs the online service for a moment. See the message above.", true);
    return;
  }
  try {
    LAN.netId = LAN.netId || (await lanDetectNetwork());
  } catch (err) {
    console.error(err);
  }
  if (!LAN.netId) {
    lanSetStatus("Could not identify this network. Check your internet connection and try again.", true);
    return;
  }
  const fb = lanFb();
  try {
    LAN.unsubRooms = fb.api.onValue(
      fb.api.ref(fb.db, `lanRooms/${LAN.netId}`),
      (snap) => {
        const raw = snap.val() || {};
        const now = Date.now();
        LAN.rooms = Object.entries(raw)
          .map(([hostUid, r]) => ({ hostUid, ...(r || {}) }))
          .filter((r) => r.code && now - (Number(r.updatedAt) || 0) < LAN_ROOM_TTL_MS && r.hostUid !== ONLINE.localUid);
        renderLanRooms();
        lanSetStatus(LAN.rooms.length ? "" : "No games on this network yet. Host one, or wait for a friend to.");
      },
      (err) => {
        console.error(err);
        lanSetStatus(lanRulesHint(err), true);
      },
    );
  } catch (err) {
    console.error(err);
    lanSetStatus(lanRulesHint(err), true);
  }
}

function lanRulesHint(err) {
  const denied = /permission/i.test(String(err?.code || err?.message || ""));
  return denied
    ? "The connection service refused the request. The database rules need updating (firebase deploy --only database)."
    : "Could not look for games on this network.";
}

function lanStopDiscovery() {
  if (LAN.unsubRooms) LAN.unsubRooms();
  LAN.unsubRooms = null;
}

function renderLanRooms() {
  const el = document.getElementById("lan-rooms");
  if (!el) return;
  if (!LAN.rooms.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = LAN.rooms
    .map((r) => {
      const players = Number(r.players) || 1;
      const playing = r.status === "playing";
      return `<div class="online-open-room">
        <div class="online-open-room-meta">
          <div class="online-open-room-code">${escHtml(r.hostName || "Player")}'s game</div>
          <div class="online-open-room-host">${players} of 8 players${playing ? " · in progress" : ""}${r.board ? ` · ${escHtml(r.board)}` : ""}</div>
        </div>
        <button class="mp-btn mp-btn-primary mp-btn-sm" onclick="joinLanRoom('${escAttr(r.hostUid)}')" ${playing ? "disabled" : ""}>Join</button>
      </div>`;
    })
    .join("");
}

function lanPlayerName() {
  const input = document.getElementById("lan-player-name");
  const name = sanitizeName(input?.value, "Player");
  if (input) input.value = name;
  try {
    localStorage.setItem("monopoly_online_name", name);
  } catch (_err) {}
  const onlineInput = document.getElementById("online-player-name");
  if (onlineInput) onlineInput.value = name;
  return name;
}

// ── Hosting ───────────────────────────────────────────────────────────────
async function hostLanRoom() {
  if (LAN.active || ONLINE.connected) return;
  const btn = document.getElementById("lan-host-btn");
  if (btn) btn.disabled = true;
  try {
    await lanStartDiscovery();
    if (!LAN.netId) return;
    lanPlayerName();
    const host = lanCreateHost();
    LAN.host = host;
    LAN.role = "host";
    lanSwapIn(lanHostApi(host.store), 0);
    const vis = document.getElementById("room-visibility");
    if (vis) vis.value = "open";
    await createOnlineRoom();
    if (!ONLINE.connected || !ONLINE.roomId) {
      lanTeardown();
      return;
    }
    host.code = ONLINE.roomId;
    await lanPublishRoom();
    host.heartbeat = setInterval(lanPublishRoom, 20000);
    lanListenForGuests();
  } catch (err) {
    console.error(err);
    toast(lanRulesHint(err), "danger");
    if (LAN.active && ONLINE.connected) await leaveOnlineRoom(false, true);
    lanTeardown();
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function lanPublishRoom() {
  const host = LAN.host;
  if (!host || !host.code || !LAN.netId) return;
  const fb = lanFb();
  const ref = fb.api.ref(fb.db, `lanRooms/${LAN.netId}/${ONLINE.localUid}`);
  const room = host.store.get(`rooms/${host.code}`) || {};
  const players = Array.isArray(room.players) ? room.players.filter(Boolean).length : Object.keys(room.players || {}).length;
  const board = (BOARD_THEMES[room?.settings?.themeId] || window.ACTIVE_THEME || {}).name || "";
  await fb.api.set(ref, {
    code: host.code,
    hostName: String(ONLINE.localName || "Player").slice(0, 24),
    players: players || 1,
    status: room.status === "playing" ? "playing" : "lobby",
    board: String(board).slice(0, 40),
    updatedAt: Date.now(),
  });
  if (!host.cleanupArmed && fb.api.onDisconnect) {
    host.cleanupArmed = true;
    fb.api.onDisconnect(ref).remove();
    fb.api.onDisconnect(fb.api.ref(fb.db, `lanSignal/${ONLINE.localUid}`)).remove();
  }
}

function lanListenForGuests() {
  const host = LAN.host;
  const fb = lanFb();
  const handled = new Set();
  host.unsubSignal = fb.api.onValue(fb.api.ref(fb.db, `lanSignal/${ONLINE.localUid}`), (snap) => {
    const all = snap.val() || {};
    for (const [guestUid, sig] of Object.entries(all)) {
      if (!sig || !sig.offer || sig.answer) continue;
      const key = `${guestUid}|${sig.at}`;
      if (handled.has(key)) continue;
      handled.add(key);
      lanHostAnswer(host, guestUid, sig.offer)
        .then((answer) => fb.api.set(fb.api.ref(fb.db, `lanSignal/${ONLINE.localUid}/${guestUid}/answer`), answer))
        .catch((err) => console.error(err));
    }
  });
}

// ── Joining ───────────────────────────────────────────────────────────────
async function joinLanRoom(hostUid) {
  if (LAN.active || ONLINE.connected) return;
  const room = LAN.rooms.find((r) => r.hostUid === hostUid);
  if (!room) return;
  lanPlayerName();
  const fb = lanFb();
  const sigRef = fb.api.ref(fb.db, `lanSignal/${hostUid}/${ONLINE.localUid}`);
  let unsubAnswer = null;
  lanSetStatus(`Connecting to ${room.hostName || "the host"}…`);
  try {
    const { pc, channel, sdp } = await lanGuestOffer();
    const answer = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no-answer")), 20000);
      unsubAnswer = fb.api.onValue(fb.api.ref(fb.db, `lanSignal/${hostUid}/${ONLINE.localUid}/answer`), (snap) => {
        const v = snap.val();
        if (typeof v === "string" && v) {
          clearTimeout(t);
          resolve(v);
        }
      });
    });
    await fb.api.set(sigRef, { offer: sdp, at: Date.now() });
    await pc.setRemoteDescription({ type: "answer", sdp: await answer });
    try {
      await lanWaitOpen(channel);
    } catch (_err) {
      throw new Error("no-link");
    }
    await lanConnectAsGuest(pc, channel, room.code);
  } catch (err) {
    console.error(err);
    lanTeardown();
    const msg =
      err.message === "no-answer"
        ? "The host did not respond. Make sure their game is still open."
        : err.message === "no-link"
          ? "Could not connect directly. This Wi-Fi may block devices from reaching each other (common on guest and public networks). Try Play online instead."
          : lanRulesHint(err);
    lanSetStatus(msg, true);
    toast(msg, "danger");
  } finally {
    if (unsubAnswer) unsubAnswer();
    fb.api.set(sigRef, null).catch(() => {});
  }
}

async function lanConnectAsGuest(pc, channel, code) {
  const guest = lanCreateGuest(pc, channel);
  const t0 = Date.now();
  const hello = await guest.request({ op: "hello" });
  const t1 = Date.now();
  // Host clock at the midpoint of the round trip.
  const offset = Number(hello.now) - (t0 + t1) / 2;
  LAN.guest = guest;
  LAN.role = "guest";
  lanSwapIn(lanGuestApi(guest), Number.isFinite(offset) ? offset : 0);
  const codeEl = document.getElementById("join-room-code");
  if (codeEl) codeEl.value = code;
  const passEl = document.getElementById("join-room-password");
  if (passEl) passEl.value = "";
  await joinOnlineRoom();
  if (!ONLINE.connected) {
    lanTeardown();
    throw new Error("join-failed");
  }
  lanSetStatus("");
}

// ── Leaving ───────────────────────────────────────────────────────────────
// Called by leaveOnlineRoom() once the room is left.
function lanTeardown() {
  const host = LAN.host;
  if (host) {
    clearInterval(host.heartbeat);
    if (host.unsubSignal) host.unsubSignal();
    for (const peer of host.peers.values()) {
      try {
        peer.pc.close();
      } catch (_err) {}
    }
    host.peers.clear();
    const fb = lanFb();
    if (LAN.netId && ONLINE.localUid) {
      fb.api.set(fb.api.ref(fb.db, `lanRooms/${LAN.netId}/${ONLINE.localUid}`), null).catch(() => {});
      fb.api.set(fb.api.ref(fb.db, `lanSignal/${ONLINE.localUid}`), null).catch(() => {});
    }
  }
  if (LAN.guest) {
    LAN.guest.closed = true;
    try {
      LAN.guest.pc.close();
    } catch (_err) {}
  }
  const wasLan = !!(LAN.role || LAN.active);
  LAN.host = null;
  LAN.guest = null;
  LAN.role = null;
  lanSwapOut();
  if (wasLan) LAN.leftAt = Date.now();
}

// A late room update can make the online code "leave" a second time just
// after a LAN room closed; send that one back to this page too.
function lanAfterLeave() {
  const justLeft = LAN.leftAt && Date.now() - LAN.leftAt < 5000;
  if (!LAN.role && !LAN.active && !justLeft) return false;
  lanTeardown();
  showScreen("lan-screen");
  renderLanRooms();
  return true;
}

window.addEventListener("pagehide", () => {
  if (LAN.host) lanTeardown();
});

// Test hooks: lets a harness pair two pages without the signaling service.
LAN._test = {
  lanGuestOffer,
  lanHostAnswer: (peerId, sdp) => lanHostAnswer(LAN.host, peerId, sdp),
  lanConnectAsGuest,
  lanCreateHost,
  lanHostApi,
  lanSwapIn,
  LanStore,
  lanHash,
};
