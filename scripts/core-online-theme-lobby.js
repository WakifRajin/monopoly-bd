const firebaseConfig = {
  apiKey: "AIzaSyBHqtL0dCXAzP4W0GPQtAYdb39xmprz4sk",
  authDomain: "monopoly-bd.firebaseapp.com",
  projectId: "monopoly-bd",
  databaseURL:
    "https://monopoly-bd-default-rtdb.asia-southeast1.firebasedatabase.app",
  storageBucket: "monopoly-bd.firebasestorage.app",
  messagingSenderId: "415179857628",
  appId: "1:415179857628:web:c7cd7db68740d358135e19",
  measurementId: "G-QPMD9QD5H7",
};

const FIREBASE = {
  db: null,
  fs: null,
  api: null,
  auth: null,
};

const ONLINE = {
  ready: false,
  connected: false,
  roomId: null,
  isHost: false,
  mode: "host",
  localUid: null,
  localName: "",
  hostUid: null,
  visibility: "open",
  unsubRoom: null,
  roomsListLoading: false,
  lastRoomsFetchAt: 0,
  isApplyingRemote: false,
  status: "offline",
  revision: 0,
  lastDepartureNoticeId: "",
  lastSnapshotAt: 0,
  aiRunner: null,
  aiRunnerRequestAt: 0,
  pendingCardResolutions: 0,
  roomCleanupRunning: false,
  lastRoomCleanupAt: 0,
  heartbeatInFlight: false,
  lastHeartbeatAt: 0,
  snapshotApplyInFlight: false,
  queuedSnapshot: null,
};

const ONLINE_MUTATION_FUNCS = [
  "rollDice",
  "actionBuy",
  "buildHouse",
  "sellHouse",
  "mortgageProp",
  "unmortgageProp",
  "confirmTrade",
  "respondTrade",
  "cancelTradeProposal",
  "payBailout",
  "endTurn",
  "confirmBankruptcy",
  "confirmBuy",
  "startAuction",
  "placeBid",
  "passAuction",
  "sendChat",
];

const ROOM_SCHEMA_VERSION = 2;
const GAME_LOG_LIMIT = 250;
const GAME_LOG_ARCHIVE_LIMIT = 5000;
const OPEN_ROOM_STALE_MS = 1000 * 60 * 10;
const PLAYING_ROOM_STALE_MS = 1000 * 60 * 60 * 24;
const EMPTY_ROOM_STALE_MS = 1000 * 60 * 5;
const ROOM_CLEANUP_INTERVAL_MS = 1000 * 60 * 2;
const ROOM_CLEANUP_BATCH_LIMIT = 16;
const ROOM_HEARTBEAT_INTERVAL_MS = 1000 * 20;
const AUCTION_OPENING_MIN_PERCENT = 60;
const AUCTION_OPENING_MAX_PERCENT = 80;
const DEFAULT_RAILROAD_PRICE = 2000;
const DEFAULT_RAILROAD_RENT = [250, 500, 1000, 2000];
const DEFAULT_RAILROAD_MORTGAGE = 1000;
const DEFAULT_UTILITY_PRICE = 1500;
const DEFAULT_UTILITY_MORTGAGE = 750;
const DEFAULT_UTILITY_RENT_ONE_MULTIPLIER = 40;
const DEFAULT_UTILITY_RENT_BOTH_MULTIPLIER = 100;
const SFX_PREF_ENABLED_KEY = "monopoly_sfx_enabled";
const SFX_PREF_VOLUME_KEY = "monopoly_sfx_volume";
const SFX_PREF_BGM_ENABLED_KEY = "monopoly_bgm_enabled";
const SFX_DEFAULT_VOLUME = 0.55;
const CUSTOM_BOARD_THEME_ID = "custom";
const CUSTOM_BOARD_SEED_PREFIX = "MBD1";
const CUSTOM_BOARD_STORAGE_KEY = "monopoly_custom_board_seed";
const CUSTOM_BOARD_EDITOR_STORAGE_KEY = "monopoly_board_editor_seed";
const BUG_REPORT_URL =
  "https://github.com/WakifRajin/monopoly-bd/issues/new?title=Bug%20Report&body=Describe%20the%20issue%20here&labels=bug";
let LOBBY_CONTEXT = "offline";
let ACTIVE_CUSTOM_BOARD_SEED = "";

function ensureLocalUid() {
  const key = "monopoly_online_uid";
  let uid = localStorage.getItem(key);
  if (!uid) {
    uid = `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, uid);
  }
  ONLINE.localUid = uid;
}

function roomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function isValidRoomId(v) {
  return /^[A-Z0-9]{6}$/.test(String(v || ""));
}

function sanitizeRoomId(v) {
  return String(v || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
}

async function hashRoomPassword(roomId, plainPassword) {
  const payload = `${roomId}|${plainPassword}|monopoly-bd-v1`;
  if (!window.crypto?.subtle || !window.TextEncoder) {
    throw new Error(
      "Secure password hashing is unavailable in this browser context.",
    );
  }
  const bytes = new TextEncoder().encode(payload);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function generateUniqueRoomId(maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    const id = roomCode();
    if (isValidRoomId(id)) return id;
  }
  return null;
}

function tokenForPlayer(players, uid) {
  const fallback = TOKENS[players.length % TOKENS.length] || TOKENS[0];
  const existing = players.find((p) => p.uid === uid);
  if (existing) return sanitizeToken(existing.token, fallback);
  const used = new Set(
    players
      .map((p) => sanitizeToken(p.token, ""))
      .filter((t) => TOKENS.includes(t)),
  );
  return (
    TOKENS.find((t) => !used.has(t)) || TOKENS[players.length % TOKENS.length]
  );
}

function setOnlineMode(mode) {
  ONLINE.mode = mode === "join" ? "join" : "host";
  updateOnlineLobbyUI();
}

async function updateLocalPlayerProfile(next = {}) {
  if (!isOnlineGame() || !FIREBASE.api) return;
  const roomRef = getRoomRef();
  await FIREBASE.api.runTransaction(roomRef, (current) => {
    const data = current || null;
    if (!data) return;
    if ((data.status || "lobby") !== "lobby") return;
    const playersIn = indexedObjectToArray(data.players).filter(
      (p) => p && typeof p === "object",
    );
    const usedByOthers = new Set(
      playersIn
        .filter((p) => p.uid !== ONLINE.localUid)
        .map((p, i) => sanitizeToken(p.token, TOKENS[i % TOKENS.length])),
    );
    const players = playersIn.map((p, i) => {
      if (p.uid !== ONLINE.localUid) return p;
      const currentToken = sanitizeToken(p.token, TOKENS[i % TOKENS.length]);
      const proposedToken = sanitizeToken(
        next.token || currentToken,
        currentToken,
      );
      const safeToken = usedByOthers.has(proposedToken)
        ? TOKENS.find((t) => !usedByOthers.has(t)) || currentToken
        : proposedToken;
      return {
        uid: p.uid,
        name: sanitizeName(next.name ?? p.name, `Player ${i + 1}`),
        token: safeToken,
        ready: typeof next.ready === "boolean" ? next.ready : !!p.ready,
      };
    });
    return {
      ...data,
      players,
      playerUids: players.map((p) => p.uid).filter(Boolean),
      updatedAt: Date.now(),
    };
  });
}

async function toggleReadyState() {
  if (!isOnlineGame()) {
    toast("Join a room first.", "danger");
    return;
  }
  const me = lobbyPlayers.find((p) => p.uid === ONLINE.localUid);
  if (!me) return;
  await updateLocalPlayerProfile({ ready: !me.ready });
}

function cycleMyToken(step = 1) {
  if (!isOnlineGame()) return;
  const me = lobbyPlayers.find((p) => p.uid === ONLINE.localUid);
  if (!me) return;
  const idx = Math.max(0, TOKENS.indexOf(me.token));
  const token = TOKENS[(idx + step + TOKENS.length) % TOKENS.length];
  updateLocalPlayerProfile({ token, ready: false }).catch((err) => {
    console.error(err);
    toast("Could not update token right now.", "danger");
  });
}

function roomLastActivityAt(roomData) {
  const stamp = Number(roomData?.updatedAt || roomData?.createdAt || 0);
  return Number.isFinite(stamp) ? stamp : 0;
}

function isRoomAbandoned(roomData, now = Date.now()) {
  if (!roomData || typeof roomData !== "object") return false;
  const lastSeen = roomLastActivityAt(roomData);
  const age =
    lastSeen > 0 ? Math.max(0, now - lastSeen) : Number.POSITIVE_INFINITY;
  const status = String(roomData.status || "lobby");
  const players = indexedObjectToArray(roomData.players).filter(
    (p) => p && p.uid,
  );

  if (players.length === 0) return age > EMPTY_ROOM_STALE_MS;
  if (status === "playing") return age > PLAYING_ROOM_STALE_MS;
  return age > OPEN_ROOM_STALE_MS;
}

async function pulseRoomHeartbeat(force = false) {
  if (!isOnlineGame() || !FIREBASE.api) return;
  if (ONLINE.status !== "lobby" || !ONLINE.isHost) return;
  if (ONLINE.heartbeatInFlight) return;

  const now = Date.now();
  if (!force && now - ONLINE.lastHeartbeatAt < ROOM_HEARTBEAT_INTERVAL_MS)
    return;

  ONLINE.heartbeatInFlight = true;
  ONLINE.lastHeartbeatAt = now;

  try {
    await FIREBASE.api.runTransaction(getRoomRef(), (current) => {
      if (!current || typeof current !== "object") return current;
      if ((current.status || "lobby") !== "lobby") return current;
      const players = indexedObjectToArray(current.players).filter(
        (p) => p && p.uid,
      );
      if (!players.some((p) => p.uid === ONLINE.localUid)) return current;
      return {
        ...current,
        updatedAt: now,
      };
    });
  } catch (err) {
    console.warn("Room heartbeat failed.", err);
  } finally {
    ONLINE.heartbeatInFlight = false;
  }
}

async function cleanupAbandonedRooms(candidateRoomIds = null, force = false) {
  if (!FIREBASE.api || ONLINE.roomCleanupRunning) return 0;
  const now = Date.now();
  if (!force && now - ONLINE.lastRoomCleanupAt < ROOM_CLEANUP_INTERVAL_MS)
    return 0;

  ONLINE.roomCleanupRunning = true;
  ONLINE.lastRoomCleanupAt = now;

  try {
    let candidates = Array.isArray(candidateRoomIds)
      ? candidateRoomIds.slice()
      : null;
    if (!candidates) {
      const snap = await FIREBASE.api.get(
        FIREBASE.api.ref(FIREBASE.db, "rooms"),
      );
      const rawRooms = snap.exists() ? snap.val() || {} : {};
      const scanNow = Date.now();
      candidates = Object.entries(rawRooms)
        .filter(
          ([roomId, data]) =>
            roomId !== ONLINE.roomId &&
            isValidRoomId(roomId) &&
            isRoomAbandoned(data, scanNow),
        )
        .map(([roomId]) => roomId);
    }

    const uniqueIds = Array.from(
      new Set(
        candidates.filter(
          (roomId) => roomId !== ONLINE.roomId && isValidRoomId(roomId),
        ),
      ),
    ).slice(0, ROOM_CLEANUP_BATCH_LIMIT);

    let removed = 0;
    for (const roomId of uniqueIds) {
      const roomRef = FIREBASE.api.ref(FIREBASE.db, `rooms/${roomId}`);
      const tx = await FIREBASE.api.runTransaction(roomRef, (current) => {
        if (!current) return;
        if (!isRoomAbandoned(current, Date.now())) return current;
        return null;
      });
      if (tx?.committed && tx?.snapshot && !tx.snapshot.exists()) {
        removed += 1;
      }
    }
    return removed;
  } catch (err) {
    console.error("Abandoned room cleanup failed.", err);
    return 0;
  } finally {
    ONLINE.roomCleanupRunning = false;
  }
}

async function refreshOpenRoomsList(force = false) {
  if (!FIREBASE.api || isOnlineGame() || ONLINE.mode !== "join") return;
  if (ONLINE.roomsListLoading) return;
  if (!force && Date.now() - ONLINE.lastRoomsFetchAt < 4000) return;
  const listEl = document.getElementById("open-rooms-list");
  if (!listEl) return;
  ONLINE.roomsListLoading = true;
  ONLINE.lastRoomsFetchAt = Date.now();
  listEl.innerHTML =
    '<div class="online-room-empty">Loading open rooms...</div>';

  try {
    const snap = await FIREBASE.api.get(FIREBASE.api.ref(FIREBASE.db, "rooms"));
    const rawRooms = snap.exists() ? snap.val() || {} : {};
    const now = Date.now();
    const rooms = [];
    const staleCandidates = [];
    Object.entries(rawRooms).forEach(([roomId, d]) => {
      if (!d || typeof d !== "object") return;
      if (
        isRoomAbandoned(d, now) &&
        roomId !== ONLINE.roomId &&
        isValidRoomId(roomId)
      ) {
        staleCandidates.push(roomId);
      }

      if (Number(d.schemaVersion || 0) !== ROOM_SCHEMA_VERSION) return;
      const updatedAt = roomLastActivityAt(d);
      if (isRoomAbandoned(d, now)) return;
      const players = indexedObjectToArray(d.players).filter(
        (p) => p && typeof p === "object",
      );
      if ((d.status || "lobby") !== "lobby") return;
      if ((d.visibility || "open") !== "open") return;
      if (players.length < 8 && isValidRoomId(roomId)) {
        rooms.push({
          id: roomId,
          players,
          hostUid: d.hostUid,
          updatedAt,
        });
      }
    });

    if (staleCandidates.length) {
      cleanupAbandonedRooms(staleCandidates, force).catch((err) => {
        console.error("Failed to clean stale rooms from listing scan.", err);
      });
    }

    rooms.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const visibleRooms = rooms.slice(0, 25);

    if (!visibleRooms.length) {
      listEl.innerHTML =
        '<div class="online-room-empty">No open rooms available.</div>';
      return;
    }

    listEl.innerHTML = visibleRooms
      .map((r) => {
        const host = r.players.find((p) => p.uid === r.hostUid)?.name || "Host";
        return `<div class="online-open-room">
        <div class="online-open-room-meta">
          <div class="online-open-room-code">${escHtml(r.id)} • ${r.players.length}/8</div>
          <div class="online-open-room-host">Host: ${escHtml(host)}</div>
        </div>
        <button class="btn btn-sm online-open-room-btn" onclick="joinOpenRoom('${r.id}')">Join</button>
      </div>`;
      })
      .join("");
  } catch (err) {
    console.error(err);
    const msg = firebaseErrorMessage(err, "Failed to load room list.");
    listEl.innerHTML = `<div class="online-room-error">${escHtml(msg)}</div>`;
    updateOnlineStatus(msg, true);
  } finally {
    ONLINE.roomsListLoading = false;
  }
}

function joinOpenRoom(roomId) {
  if (!isValidRoomId(roomId)) {
    toast("Room code is invalid.", "danger");
    return;
  }
  const code = document.getElementById("join-room-code");
  if (code) code.value = roomId;
  joinOnlineRoom();
}

function sanitizeName(v, fallback = "Player") {
  const clean = String(v || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>`"'\\]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  return clean.slice(0, 24) || fallback;
}

function sanitizeToken(v, fallback = TOKENS[0]) {
  const token = String(v || "");
  if (TOKENS.includes(token)) return token;
  if (TOKENS.includes(fallback)) return fallback;
  return TOKENS[0];
}

function sanitizeColor(v, fallback = "#ffffff") {
  const color = String(v || "").trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(color)) return color;
  return fallback;
}

function indexedObjectToArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const keys = Object.keys(value).filter((k) => /^\d+$/.test(k));
  if (!keys.length) return [];
  const arr = [];
  keys
    .sort((a, b) => Number(a) - Number(b))
    .forEach((k) => {
      arr[Number(k)] = value[k];
    });
  return arr;
}

async function bootstrapFirebase() {
  try {
    const [appMod, dbMod, fsMod, authMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.11.0/firebase-database.js"),
      import(
        "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js"
      ),
      import("https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js"),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    if (!auth.currentUser) {
      await authMod.signInAnonymously(auth);
    }
    if (auth.currentUser?.uid) {
      ONLINE.localUid = auth.currentUser.uid;
      if (Array.isArray(lobbyPlayers) && lobbyPlayers[0]) {
        lobbyPlayers[0].uid = ONLINE.localUid;
      }
    }
    FIREBASE.db = dbMod.getDatabase(app, firebaseConfig.databaseURL);
    FIREBASE.fs = fsMod.getFirestore(app);
    FIREBASE.auth = auth;
    FIREBASE.api = {
      ref: dbMod.ref,
      query: dbMod.query,
      orderByChild: dbMod.orderByChild,
      equalTo: dbMod.equalTo,
      limitToFirst: dbMod.limitToFirst,
      get: dbMod.get,
      set: dbMod.set,
      update: dbMod.update,
      onValue: dbMod.onValue,
      runTransaction: dbMod.runTransaction,
      serverTimestamp: dbMod.serverTimestamp,
    };
    ONLINE.ready = true;
    updateOnlineStatus("Online service ready. You can create or join a room.");
  } catch (err) {
    console.error(err);
    const msg = firebaseErrorMessage(
      err,
      "Online service failed to initialize. Check room service URL and enable anonymous sign-in.",
    );
    updateOnlineStatus(msg, true);
  }
}

function updateOnlineStatus(text, isError = false) {
  const el = document.getElementById("online-room-status");
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? "#ff9ca1" : "rgba(255,255,255,.65)";
}

function firebaseErrorMessage(err, fallback = "Online request failed.") {
  const code = String(err?.code || "").toLowerCase();
  const message = String(err?.message || "");
  if (
    code.includes("permission-denied") ||
    message.includes("Permission denied") ||
    message.includes("PERMISSION_DENIED")
  ) {
    return "Permission denied by RTDB rules. Allow authenticated users to read/write rooms.";
  }
  if (
    code.includes("unauthenticated") ||
    code.includes("auth") ||
    message.toLowerCase().includes("anonymous")
  ) {
    return "Authentication failed. Enable anonymous sign-in in authentication settings.";
  }
  if (code.includes("network") || message.toLowerCase().includes("network")) {
    return "Network error while contacting RTDB. Check your internet connection.";
  }
  return fallback;
}

function isOnlineGame() {
  return ONLINE.connected && ONLINE.roomId;
}

function sanitizeAuctionEnabled(value, fallback = true) {
  if (typeof value === "boolean") return value;
  if (value === "on") return true;
  if (value === "off") return false;
  return !!fallback;
}

function isAuctionSystemEnabled(state = G) {
  if (
    state &&
    typeof state === "object" &&
    typeof state.auctionEnabled === "boolean"
  ) {
    return state.auctionEnabled;
  }
  const uiValue = document.getElementById("auction-enabled")?.value;
  return sanitizeAuctionEnabled(uiValue, true);
}

function pickAuctionOpeningPercent() {
  return rand(AUCTION_OPENING_MIN_PERCENT, AUCTION_OPENING_MAX_PERCENT);
}

function getAuctionOpeningBid(price, openingPercent = null) {
  const base = Number(price) || 0;
  if (base <= 0) return 0;
  const rawPct = Number(openingPercent);
  const pct = Number.isFinite(rawPct)
    ? Math.max(
        AUCTION_OPENING_MIN_PERCENT,
        Math.min(AUCTION_OPENING_MAX_PERCENT, Math.round(rawPct)),
      )
    : pickAuctionOpeningPercent();
  return Math.max(0, Math.floor((base * pct) / 100));
}

function resolveLocalPlayerIndex() {
  if (!G.players || !G.players.length) return -1;

  const byUid = G.players.findIndex((p) => p.uid && p.uid === ONLINE.localUid);
  if (byUid >= 0) return byUid;

  const lobbyMe = Array.isArray(lobbyPlayers)
    ? lobbyPlayers.find((p) => p.uid === ONLINE.localUid)
    : null;
  if (lobbyMe?.token) {
    const byToken = G.players.findIndex((p) => p.token === lobbyMe.token);
    if (byToken >= 0) return byToken;
  }

  const targetName = sanitizeName(lobbyMe?.name || ONLINE.localName || "", "");
  if (targetName) {
    const byName = G.players.findIndex(
      (p) => sanitizeName(p.name, "") === targetName,
    );
    if (byName >= 0) return byName;
  }

  return -1;
}

function canLocalControlTurn() {
  if (!isOnlineGame() || !G.players || !G.players.length) return true;
  const myIdx = resolveLocalPlayerIndex();
  if (myIdx >= 0 && myIdx === G.currentPlayerIdx) return true;
  const current = G.players[G.currentPlayerIdx];
  return isAiPlayer(current) && canRunAiController();
}

function currentAuctionBidderId() {
  const a = G.auctionState;
  if (!a || !Array.isArray(a.activePlayers) || !a.activePlayers.length)
    return null;
  const rawIdx = Number(a.bidderIdx);
  const idx = Number.isFinite(rawIdx)
    ? ((Math.trunc(rawIdx) % a.activePlayers.length) + a.activePlayers.length) %
      a.activePlayers.length
    : 0;
  const bidderId = Number(a.activePlayers[idx]);
  return Number.isInteger(bidderId) ? bidderId : null;
}

function canLocalControlAuctionAction() {
  if (!G.auctionState) return canLocalControlTurn();
  if (!isOnlineGame()) return true;
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return canLocalControlTurn();
  const bidder = G.players[bidderId];
  if (!bidder) return canLocalControlTurn();
  if (isAiPlayer(bidder)) return canRunAiController();
  if (bidder.uid && bidder.uid === ONLINE.localUid) return true;
  const myIdx = resolveLocalPlayerIndex();
  return myIdx >= 0 ? myIdx === bidderId : canLocalControlTurn();
}

function requireTurnControl() {
  if (G?.gameOver) {
    toast(
      "Game is over. Use Winner actions to view board or play again.",
      "gold",
    );
    return false;
  }
  if (isOnlineGame() && ONLINE.isApplyingRemote) {
    toast("Syncing latest board state. Try again in a moment.", "gold");
    return false;
  }
  if (!canLocalControlTurn()) {
    toast(`Wait for ${curPlayer().name}'s turn.`, "danger");
    return false;
  }
  return true;
}

function requireAuctionControl() {
  if (!canLocalControlAuctionAction()) {
    const bidderId = currentAuctionBidderId();
    const bidderName = Number.isInteger(bidderId)
      ? G.players[bidderId]?.name || "the current bidder"
      : "the current bidder";
    toast(`Waiting for ${bidderName} to bid or pass.`, "danger");
    return false;
  }
  return true;
}

function getOnlinePlayerName() {
  const input = document.getElementById("online-player-name");
  const fallback = lobbyPlayers?.[0]?.name || "Player";
  return sanitizeName(input?.value, fallback);
}

function customBoardHostCanEdit() {
  return !isOnlineGame() || ONLINE.isHost;
}

function normalizeCustomBoardSeedText(seed) {
  return String(seed || "")
    .replace(/\s+/g, "")
    .trim();
}

function getStoredCustomBoardSeed() {
  const seed = normalizeCustomBoardSeedText(
    localStorage.getItem(CUSTOM_BOARD_STORAGE_KEY) ||
      localStorage.getItem(CUSTOM_BOARD_EDITOR_STORAGE_KEY) ||
      "",
  );
  return seed;
}

function setStoredCustomBoardSeed(seed) {
  const raw = normalizeCustomBoardSeedText(seed);
  if (!raw) return;
  localStorage.setItem(CUSTOM_BOARD_STORAGE_KEY, raw);
  localStorage.setItem(CUSTOM_BOARD_EDITOR_STORAGE_KEY, raw);
}

function clearStoredCustomBoardSeed() {
  localStorage.removeItem(CUSTOM_BOARD_STORAGE_KEY);
  localStorage.removeItem(CUSTOM_BOARD_EDITOR_STORAGE_KEY);
}

function setCustomBoardStatus(text, isError = false) {
  const el = document.getElementById("custom-board-status");
  if (!el) return;
  el.textContent = String(text || "");
  el.style.color = isError ? "#ff9ca1" : "rgba(255,255,255,.68)";
}

function refreshCustomBoardPanel() {
  const seedInput = document.getElementById("custom-board-seed");
  const loadBtn = document.getElementById("load-custom-board-btn");
  const useSavedBtn = document.getElementById("use-saved-custom-board-btn");
  const downloadBtn = document.getElementById("download-custom-board-btn");
  const clearBtn = document.getElementById("clear-custom-board-btn");
  const hostEditable = customBoardHostCanEdit();

  if (seedInput && !seedInput.value && ACTIVE_CUSTOM_BOARD_SEED) {
    seedInput.value = ACTIVE_CUSTOM_BOARD_SEED;
  }

  if (seedInput) seedInput.disabled = !hostEditable;
  if (loadBtn) loadBtn.disabled = !hostEditable;
  if (useSavedBtn) useSavedBtn.disabled = !hostEditable;
  if (clearBtn) clearBtn.disabled = !hostEditable;
  if (downloadBtn) downloadBtn.disabled = !ACTIVE_CUSTOM_BOARD_SEED;

  const theme = BOARD_THEMES[CUSTOM_BOARD_THEME_ID];
  if (theme) {
    setCustomBoardStatus(
      `Loaded: ${theme.name}. Select "Custom" in board themes to play it.`,
    );
  } else {
    setCustomBoardStatus(
      "No custom board loaded. Paste a seed or use saved seed.",
    );
  }
}

function loadSavedCustomBoardSeed() {
  if (!customBoardHostCanEdit()) {
    toast("Only the host can change board settings in online mode.", "danger");
    return;
  }
  const seed = getStoredCustomBoardSeed();
  if (!seed) {
    setCustomBoardStatus("No saved custom board seed found.", true);
    toast("No saved custom board seed found.", "danger");
    return;
  }
  const ok = applyCustomBoardSeed(seed, { persist: true, quiet: false });
  if (!ok) return;
  applyThemeById(CUSTOM_BOARD_THEME_ID);
  refreshStartingMoneyUi(CUSTOM_BOARD_THEME_ID, true);
  renderBoardThemeSelector();
  refreshCustomBoardPanel();
  syncLobbySettingsToRoom().catch((err) => console.error(err));
  toast("Saved custom board loaded.", "gold");
}

function loadCustomBoardSeedFromInput() {
  if (!customBoardHostCanEdit()) {
    toast("Only the host can change board settings in online mode.", "danger");
    return;
  }
  const seedInput = document.getElementById("custom-board-seed");
  const seed = normalizeCustomBoardSeedText(seedInput?.value || "");
  if (seedInput && seedInput.value !== seed) {
    seedInput.value = seed;
  }
  if (!seed) {
    setCustomBoardStatus("Paste a seed first.", true);
    toast("Paste a custom board seed first.", "danger");
    return;
  }
  const ok = applyCustomBoardSeed(seed, { persist: true, quiet: false });
  if (!ok) return;
  applyThemeById(CUSTOM_BOARD_THEME_ID);
  refreshStartingMoneyUi(CUSTOM_BOARD_THEME_ID, true);
  renderBoardThemeSelector();
  refreshCustomBoardPanel();
  syncLobbySettingsToRoom().catch((err) => console.error(err));
  toast("Custom board loaded.", "gold");
}

function clearCustomBoardThemeSelection() {
  if (!customBoardHostCanEdit()) {
    toast("Only the host can change board settings in online mode.", "danger");
    return;
  }
  removeActiveCustomBoardTheme(true);
  if (selectedThemeId === CUSTOM_BOARD_THEME_ID) {
    applyThemeById("dhaka");
    refreshStartingMoneyUi("dhaka", true);
  }
  const seedInput = document.getElementById("custom-board-seed");
  if (seedInput) seedInput.value = "";
  renderBoardThemeSelector();
  refreshCustomBoardPanel();
  syncLobbySettingsToRoom().catch((err) => console.error(err));
}

function downloadActiveCustomBoardSeed() {
  const seed = String(ACTIVE_CUSTOM_BOARD_SEED || "").trim();
  if (!seed) {
    toast("No active custom board seed to download.", "danger");
    return;
  }
  const themeName = String(
    BOARD_THEMES[CUSTOM_BOARD_THEME_ID]?.name || "custom-board",
  ).trim();
  const safeName =
    themeName
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "custom-board";
  const blob = new Blob([seed], { type: "text/plain;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `${safeName}.mbdseed.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
  setCustomBoardStatus(`Downloaded seed for ${themeName}.`);
}

ensureLocalUid();
bootstrapFirebase();

// ═══════════════════════════════════════════════
//  BOARD THEMES (modular location sets)
// ═══════════════════════════════════════════════
const BOARD_THEMES = {
  dhaka: {
    id: "dhaka",
    name: "Dhaka City",
    flag: "🏙️",
    desc: "Streets of the capital",
    currency: "৳",
    locale: "en-BD",
    goSalary: 2000,
    startMoneyDefault: 15000,
    stations: [
      "Kamalapur Station",
      "Airport Station",
      "Sadarghat Terminal",
      "Sayedabad Bus Stand",
    ],
    utilities: [
      { name: "Desco Power", icon: "⚡" },
      { name: "WASA Water", icon: "💧" },
    ],
    spaces: [
      {
        name: "Mirpur Rd",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Kazipara",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "New Market",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Bangshal Rd",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Motijheel Cir",
        color: "LBLUE",
        price: 1200,
        rent: [80, 400, 1000, 3000, 4500, 6000],
        house: 500,
        mortgage: 600,
        group: 1,
      },
      {
        name: "Dhanmondi Rd",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Elephant Rd",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Panthapath",
        color: "PINK",
        price: 1600,
        rent: [120, 600, 1800, 5000, 7000, 9000],
        house: 1000,
        mortgage: 800,
        group: 2,
      },
      {
        name: "Bashundhara",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Uttara Sector",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Baridhara",
        color: "ORANGE",
        price: 2000,
        rent: [160, 800, 2200, 6000, 8000, 10000],
        house: 1000,
        mortgage: 1000,
        group: 3,
      },
      {
        name: "Tejgaon I/A",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Tejgaon Rd",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Farmgate",
        color: "RED",
        price: 2400,
        rent: [200, 1000, 3000, 7500, 9250, 11000],
        house: 1500,
        mortgage: 1200,
        group: 4,
      },
      {
        name: "Gulshan-1",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Gulshan-2",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Banani",
        color: "YELLOW",
        price: 2800,
        rent: [240, 1200, 3600, 8500, 10250, 12000],
        house: 1500,
        mortgage: 1400,
        group: 5,
      },
      {
        name: "Niketan",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Mohakhali",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Palashi",
        color: "GREEN",
        price: 3200,
        rent: [280, 1500, 4500, 10000, 12000, 14000],
        house: 2000,
        mortgage: 1600,
        group: 6,
      },
      {
        name: "Motijheel CA",
        color: "DBLUE",
        price: 3500,
        rent: [350, 1750, 5000, 11000, 13000, 15000],
        house: 2000,
        mortgage: 1750,
        group: 7,
      },
      {
        name: "Karwan Bazar",
        color: "DBLUE",
        price: 4000,
        rent: [500, 2000, 6000, 14000, 17000, 20000],
        house: 2000,
        mortgage: 2000,
        group: 7,
      },
    ],
    taxNames: ["Income Tax", "Luxury Tax"],
    taxAmounts: [2000, 1000],
  },
  bangladesh: {
    id: "bangladesh",
    name: "Bangladesh",
    flag: "🇧🇩",
    desc: "Cities across the nation",
    currency: "৳",
    locale: "en-BD",
    goSalary: 2000,
    startMoneyDefault: 14000,
    stations: ["Kamalapur Stn", "Chittagong Stn", "Sylhet Stn", "Rajshahi Stn"],
    utilities: [
      { name: "BPDB Power", icon: "⚡" },
      { name: "BWDB Water", icon: "💧" },
    ],
    spaces: [
      {
        name: "Narsingdi",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Comilla",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Narayanganj",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Gazipur",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Mymensingh",
        color: "LBLUE",
        price: 1200,
        rent: [80, 400, 1000, 3000, 4500, 6000],
        house: 500,
        mortgage: 600,
        group: 1,
      },
      {
        name: "Barisal",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Faridpur",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Jessore",
        color: "PINK",
        price: 1600,
        rent: [120, 600, 1800, 5000, 7000, 9000],
        house: 1000,
        mortgage: 800,
        group: 2,
      },
      {
        name: "Khulna",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Rajshahi",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Bogra",
        color: "ORANGE",
        price: 2000,
        rent: [160, 800, 2200, 6000, 8000, 10000],
        house: 1000,
        mortgage: 1000,
        group: 3,
      },
      {
        name: "Rangpur",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Dinajpur",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Cox's Bazar",
        color: "RED",
        price: 2400,
        rent: [200, 1000, 3000, 7500, 9250, 11000],
        house: 1500,
        mortgage: 1200,
        group: 4,
      },
      {
        name: "Bandarbans",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Rangamati",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Khagrachhari",
        color: "YELLOW",
        price: 2800,
        rent: [240, 1200, 3600, 8500, 10250, 12000],
        house: 1500,
        mortgage: 1400,
        group: 5,
      },
      {
        name: "Sylhet",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Srimangal",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Sunamganj",
        color: "GREEN",
        price: 3200,
        rent: [280, 1500, 4500, 10000, 12000, 14000],
        house: 2000,
        mortgage: 1600,
        group: 6,
      },
      {
        name: "Chittagong",
        color: "DBLUE",
        price: 3500,
        rent: [350, 1750, 5000, 11000, 13000, 15000],
        house: 2000,
        mortgage: 1750,
        group: 7,
      },
      {
        name: "Dhaka",
        color: "DBLUE",
        price: 4000,
        rent: [500, 2000, 6000, 14000, 17000, 20000],
        house: 2000,
        mortgage: 2000,
        group: 7,
      },
    ],
    taxNames: ["Income Tax", "Luxury Tax"],
    taxAmounts: [2000, 1000],
  },
  world: {
    id: "world",
    name: "World Tour",
    flag: "🌍",
    desc: "Cities of the globe",
    currency: "$",
    locale: "en-US",
    goSalary: 2000,
    startMoneyDefault: 15000,
    stations: [
      "Heathrow Airport",
      "JFK Airport",
      "Dubai Airport",
      "Tokyo Airport",
    ],
    utilities: [
      { name: "Global Power", icon: "⚡" },
      { name: "City Water", icon: "💧" },
    ],
    spaces: [
      {
        name: "Cairo",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 4500],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Lagos",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 4500],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Istanbul",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Bangkok",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Mexico City",
        color: "LBLUE",
        price: 1200,
        rent: [80, 400, 1000, 3000, 4500, 6000],
        house: 500,
        mortgage: 600,
        group: 1,
      },
      {
        name: "Buenos Aires",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Mumbai",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Toronto",
        color: "PINK",
        price: 1600,
        rent: [120, 600, 1800, 5000, 7000, 9000],
        house: 1000,
        mortgage: 800,
        group: 2,
      },
      {
        name: "Sydney",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Amsterdam",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Rome",
        color: "ORANGE",
        price: 2000,
        rent: [160, 800, 2200, 6000, 8000, 10000],
        house: 1000,
        mortgage: 1000,
        group: 3,
      },
      {
        name: "Berlin",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Madrid",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Paris",
        color: "RED",
        price: 2400,
        rent: [200, 1000, 3000, 7500, 9250, 11000],
        house: 1500,
        mortgage: 1200,
        group: 4,
      },
      {
        name: "Singapore",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Seoul",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Shanghai",
        color: "YELLOW",
        price: 2800,
        rent: [240, 1200, 3600, 8500, 10250, 12000],
        house: 1500,
        mortgage: 1400,
        group: 5,
      },
      {
        name: "Tokyo",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Hong Kong",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Los Angeles",
        color: "GREEN",
        price: 3200,
        rent: [280, 1500, 4500, 10000, 12000, 14000],
        house: 2000,
        mortgage: 1600,
        group: 6,
      },
      {
        name: "London",
        color: "DBLUE",
        price: 3500,
        rent: [350, 1750, 5000, 11000, 13000, 15000],
        house: 2000,
        mortgage: 1750,
        group: 7,
      },
      {
        name: "New York",
        color: "DBLUE",
        price: 4000,
        rent: [500, 2000, 6000, 14000, 17000, 20000],
        house: 2000,
        mortgage: 2000,
        group: 7,
      },
    ],
    taxNames: ["VAT Tax", "Luxury Tax"],
    taxAmounts: [2000, 1000],
  },
  classic: {
    id: "classic",
    name: "Classic",
    flag: "🎩",
    desc: "Original-scale board and values",
    currency: "$",
    locale: "en-US",
    goSalary: 200,
    startMoneyDefault: 1500,
    jailBail: 50,
    cardProfile: "classic",
    railroadPrice: 200,
    railroadRent: [25, 50, 100, 200],
    railroadMortgage: 100,
    utilityPrice: 150,
    utilityMortgage: 75,
    utilityRentOneMultiplier: 4,
    utilityRentBothMultiplier: 10,
    stations: [
      "Reading Railroad",
      "Pennsylvania Railroad",
      "B&O Railroad",
      "Short Line",
    ],
    utilities: [
      { name: "Electric Company", icon: "⚡" },
      { name: "Water Works", icon: "💧" },
    ],
    spaces: [
      {
        name: "Mediterranean Avenue",
        color: "BROWN",
        price: 60,
        rent: [2, 10, 30, 90, 160, 250],
        house: 50,
        mortgage: 30,
        group: 0,
      },
      {
        name: "Baltic Avenue",
        color: "BROWN",
        price: 60,
        rent: [4, 20, 60, 180, 320, 450],
        house: 50,
        mortgage: 30,
        group: 0,
      },
      {
        name: "Oriental Avenue",
        color: "LBLUE",
        price: 100,
        rent: [6, 30, 90, 270, 400, 550],
        house: 50,
        mortgage: 50,
        group: 1,
      },
      {
        name: "Vermont Avenue",
        color: "LBLUE",
        price: 100,
        rent: [6, 30, 90, 270, 400, 550],
        house: 50,
        mortgage: 50,
        group: 1,
      },
      {
        name: "Connecticut Avenue",
        color: "LBLUE",
        price: 120,
        rent: [8, 40, 100, 300, 450, 600],
        house: 50,
        mortgage: 60,
        group: 1,
      },
      {
        name: "St. Charles Place",
        color: "PINK",
        price: 140,
        rent: [10, 50, 150, 450, 625, 750],
        house: 100,
        mortgage: 70,
        group: 2,
      },
      {
        name: "States Avenue",
        color: "PINK",
        price: 140,
        rent: [10, 50, 150, 450, 625, 750],
        house: 100,
        mortgage: 70,
        group: 2,
      },
      {
        name: "Virginia Avenue",
        color: "PINK",
        price: 160,
        rent: [12, 60, 180, 500, 700, 900],
        house: 100,
        mortgage: 80,
        group: 2,
      },
      {
        name: "St. James Place",
        color: "ORANGE",
        price: 180,
        rent: [14, 70, 200, 550, 750, 950],
        house: 100,
        mortgage: 90,
        group: 3,
      },
      {
        name: "Tennessee Avenue",
        color: "ORANGE",
        price: 180,
        rent: [14, 70, 200, 550, 750, 950],
        house: 100,
        mortgage: 90,
        group: 3,
      },
      {
        name: "New York Avenue",
        color: "ORANGE",
        price: 200,
        rent: [16, 80, 220, 600, 800, 1000],
        house: 100,
        mortgage: 100,
        group: 3,
      },
      {
        name: "Kentucky Avenue",
        color: "RED",
        price: 220,
        rent: [18, 90, 250, 700, 875, 1050],
        house: 150,
        mortgage: 110,
        group: 4,
      },
      {
        name: "Indiana Avenue",
        color: "RED",
        price: 220,
        rent: [18, 90, 250, 700, 875, 1050],
        house: 150,
        mortgage: 110,
        group: 4,
      },
      {
        name: "Illinois Avenue",
        color: "RED",
        price: 240,
        rent: [20, 100, 300, 750, 925, 1100],
        house: 150,
        mortgage: 120,
        group: 4,
      },
      {
        name: "Atlantic Avenue",
        color: "YELLOW",
        price: 260,
        rent: [22, 110, 330, 800, 975, 1150],
        house: 150,
        mortgage: 130,
        group: 5,
      },
      {
        name: "Ventnor Avenue",
        color: "YELLOW",
        price: 260,
        rent: [22, 110, 330, 800, 975, 1150],
        house: 150,
        mortgage: 130,
        group: 5,
      },
      {
        name: "Marvin Gardens",
        color: "YELLOW",
        price: 280,
        rent: [24, 120, 360, 850, 1025, 1200],
        house: 150,
        mortgage: 140,
        group: 5,
      },
      {
        name: "Pacific Avenue",
        color: "GREEN",
        price: 300,
        rent: [26, 130, 390, 900, 1100, 1275],
        house: 200,
        mortgage: 150,
        group: 6,
      },
      {
        name: "North Carolina Avenue",
        color: "GREEN",
        price: 300,
        rent: [26, 130, 390, 900, 1100, 1275],
        house: 200,
        mortgage: 150,
        group: 6,
      },
      {
        name: "Pennsylvania Avenue",
        color: "GREEN",
        price: 320,
        rent: [28, 150, 450, 1000, 1200, 1400],
        house: 200,
        mortgage: 160,
        group: 6,
      },
      {
        name: "Park Place",
        color: "DBLUE",
        price: 350,
        rent: [35, 175, 500, 1100, 1300, 1500],
        house: 200,
        mortgage: 175,
        group: 7,
      },
      {
        name: "Boardwalk",
        color: "DBLUE",
        price: 400,
        rent: [50, 200, 600, 1400, 1700, 2000],
        house: 200,
        mortgage: 200,
        group: 7,
      },
    ],
    taxNames: ["Income Tax", "Luxury Tax"],
    taxAmounts: [200, 100],
  },
  ancient: {
    id: "ancient",
    name: "Ancient Wonders",
    flag: "🏛️",
    desc: "Empires of antiquity",
    currency: "⚜",
    locale: "en-US",
    goSalary: 2000,
    startMoneyDefault: 13000,
    stations: ["Silk Road", "Spice Route", "Maritime Trail", "Grand Bazaar"],
    utilities: [
      { name: "Aqueduct", icon: "🌊" },
      { name: "Lighthouse", icon: "🔦" },
    ],
    spaces: [
      {
        name: "Memphis",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Carthage",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      },
      {
        name: "Babylon",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Persepolis",
        color: "LBLUE",
        price: 1000,
        rent: [60, 300, 900, 2700, 4000, 5500],
        house: 500,
        mortgage: 500,
        group: 1,
      },
      {
        name: "Nineveh",
        color: "LBLUE",
        price: 1200,
        rent: [80, 400, 1000, 3000, 4500, 6000],
        house: 500,
        mortgage: 600,
        group: 1,
      },
      {
        name: "Sparta",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Corinth",
        color: "PINK",
        price: 1400,
        rent: [100, 500, 1500, 4500, 6250, 7500],
        house: 1000,
        mortgage: 700,
        group: 2,
      },
      {
        name: "Olympia",
        color: "PINK",
        price: 1600,
        rent: [120, 600, 1800, 5000, 7000, 9000],
        house: 1000,
        mortgage: 800,
        group: 2,
      },
      {
        name: "Alexandria",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Antioch",
        color: "ORANGE",
        price: 1800,
        rent: [140, 700, 2000, 5500, 7500, 9500],
        house: 1000,
        mortgage: 900,
        group: 3,
      },
      {
        name: "Ephesus",
        color: "ORANGE",
        price: 2000,
        rent: [160, 800, 2200, 6000, 8000, 10000],
        house: 1000,
        mortgage: 1000,
        group: 3,
      },
      {
        name: "Carthage II",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Thebes",
        color: "RED",
        price: 2200,
        rent: [180, 900, 2500, 7000, 8750, 10500],
        house: 1500,
        mortgage: 1100,
        group: 4,
      },
      {
        name: "Troy",
        color: "RED",
        price: 2400,
        rent: [200, 1000, 3000, 7500, 9250, 11000],
        house: 1500,
        mortgage: 1200,
        group: 4,
      },
      {
        name: "Petra",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Palmyra",
        color: "YELLOW",
        price: 2600,
        rent: [220, 1100, 3300, 8000, 9750, 11500],
        house: 1500,
        mortgage: 1300,
        group: 5,
      },
      {
        name: "Damascus",
        color: "YELLOW",
        price: 2800,
        rent: [240, 1200, 3600, 8500, 10250, 12000],
        house: 1500,
        mortgage: 1400,
        group: 5,
      },
      {
        name: "Constantinople",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Athens",
        color: "GREEN",
        price: 3000,
        rent: [260, 1300, 3900, 9000, 11000, 12750],
        house: 2000,
        mortgage: 1500,
        group: 6,
      },
      {
        name: "Jerusalem",
        color: "GREEN",
        price: 3200,
        rent: [280, 1500, 4500, 10000, 12000, 14000],
        house: 2000,
        mortgage: 1600,
        group: 6,
      },
      {
        name: "Rome",
        color: "DBLUE",
        price: 3500,
        rent: [350, 1750, 5000, 11000, 13000, 15000],
        house: 2000,
        mortgage: 1750,
        group: 7,
      },
      {
        name: "Chang'an",
        color: "DBLUE",
        price: 4000,
        rent: [500, 2000, 6000, 14000, 17000, 20000],
        house: 2000,
        mortgage: 2000,
        group: 7,
      },
    ],
    taxNames: ["Tribute Tax", "Imperial Tax"],
    taxAmounts: [2000, 1000],
  },
};

let selectedThemeId = "dhaka";

function getThemeById(themeId = selectedThemeId) {
  return BOARD_THEMES[themeId] || BOARD_THEMES.dhaka;
}

function getThemeGoSalary(themeId = selectedThemeId) {
  const goSalary = Number(getThemeById(themeId).goSalary);
  return Number.isFinite(goSalary) && goSalary > 0
    ? Math.floor(goSalary)
    : 2000;
}

function getThemeStartMoneyDefault(themeId = selectedThemeId) {
  const startMoney = Number(getThemeById(themeId).startMoneyDefault);
  return Number.isFinite(startMoney) && startMoney > 0
    ? Math.floor(startMoney)
    : 15000;
}

function getThemeJailBail(themeId = selectedThemeId) {
  const bailRaw = Number(getThemeById(themeId).jailBail);
  return Number.isFinite(bailRaw) && bailRaw > 0 ? Math.floor(bailRaw) : 500;
}

function getThemeRailroadConfig(themeId = selectedThemeId) {
  const theme = getThemeById(themeId);
  const priceRaw = Number(theme.railroadPrice);
  const price =
    Number.isFinite(priceRaw) && priceRaw > 0
      ? Math.floor(priceRaw)
      : DEFAULT_RAILROAD_PRICE;
  const rentRaw = Array.isArray(theme.railroadRent)
    ? theme.railroadRent
    : DEFAULT_RAILROAD_RENT;
  const rent = rentRaw
    .map((v) => Math.max(0, Math.floor(Number(v) || 0)))
    .slice(0, 4);
  while (rent.length < 4) rent.push(DEFAULT_RAILROAD_RENT[rent.length]);
  const mortgageRaw = Number(theme.railroadMortgage);
  const mortgage =
    Number.isFinite(mortgageRaw) && mortgageRaw >= 0
      ? Math.floor(mortgageRaw)
      : Math.floor(price / 2);
  return { price, rent, mortgage };
}

function getThemeUtilityConfig(themeId = selectedThemeId) {
  const theme = getThemeById(themeId);
  const priceRaw = Number(theme.utilityPrice);
  const price =
    Number.isFinite(priceRaw) && priceRaw > 0
      ? Math.floor(priceRaw)
      : DEFAULT_UTILITY_PRICE;
  const mortgageRaw = Number(theme.utilityMortgage);
  const mortgage =
    Number.isFinite(mortgageRaw) && mortgageRaw >= 0
      ? Math.floor(mortgageRaw)
      : Math.floor(price / 2);
  return { price, mortgage };
}

function getThemeUtilityRentMultipliers(themeId = selectedThemeId) {
  const theme = getThemeById(themeId);
  const oneRaw = Number(theme.utilityRentOneMultiplier);
  const bothRaw = Number(theme.utilityRentBothMultiplier);
  const one =
    Number.isFinite(oneRaw) && oneRaw > 0
      ? Math.floor(oneRaw)
      : DEFAULT_UTILITY_RENT_ONE_MULTIPLIER;
  const both =
    Number.isFinite(bothRaw) && bothRaw >= one
      ? Math.floor(bothRaw)
      : DEFAULT_UTILITY_RENT_BOTH_MULTIPLIER;
  return { one, both };
}

function refreshStartingMoneyUi(themeId = selectedThemeId, forceValue = false) {
  const theme = getThemeById(themeId);
  const label = document.getElementById("starting-money-label");
  if (label) label.textContent = `Starting Money (${theme.currency})`;

  const input = document.getElementById("starting-money");
  if (!input) return;
  if (forceValue || !input.value || Number(input.value) <= 0) {
    input.value = String(getThemeStartMoneyDefault(themeId));
  }
}

function buildSpacesFromTheme(themeId) {
  const t = BOARD_THEMES[themeId];
  const propSpaces = t.spaces;
  const rrCfg = getThemeRailroadConfig(themeId);
  const utilCfg = getThemeUtilityConfig(themeId);
  let pi = 0; // property index
  let si = 0; // station index
  let ui = 0; // utility index

  // We interleave properties, stations, utilities into the 40 fixed slots
  // Fixed layout: 0=GO, 2=community, 4=tax, 7=chance, 10=jail, 17=community, 20=parking, 22=chance, 30=gotojail, 33=community, 36=chance, 38=tax
  // Stations at: 5, 15, 25, 35
  // Utilities at: 12, 28
  const fixed = {
    0: {
      id: 0,
      name: "GO",
      type: "go",
      icon: "🏁",
      desc: `Collect ${t.currency}${t.goSalary} salary each time you pass`,
    },
    2: { id: 2, name: "Community Chest", type: "community", icon: "📦" },
    4: {
      id: 4,
      name: t.taxNames[0],
      type: "tax",
      icon: "💸",
      amount: t.taxAmounts[0],
      desc: `Pay ${t.currency}${t.taxAmounts[0]} ${t.taxNames[0]}`,
    },
    5: {
      id: 5,
      name: t.stations[0],
      type: "railroad",
      price: rrCfg.price,
      rent: [...rrCfg.rent],
      mortgage: rrCfg.mortgage,
    },
    7: { id: 7, name: "Chance", type: "chance", icon: "❓" },
    10: {
      id: 10,
      name: "Jail / Visit",
      type: "jail",
      icon: "⛓️",
      desc: "Just visiting or in jail",
    },
    12: {
      id: 12,
      name: t.utilities[0].name,
      type: "utility",
      icon: t.utilities[0].icon,
      price: utilCfg.price,
      mortgage: utilCfg.mortgage,
    },
    15: {
      id: 15,
      name: t.stations[1],
      type: "railroad",
      price: rrCfg.price,
      rent: [...rrCfg.rent],
      mortgage: rrCfg.mortgage,
    },
    17: {
      id: 17,
      name: "Community Chest",
      type: "community",
      icon: "📦",
    },
    20: {
      id: 20,
      name: "Free Parking",
      type: "parking",
      icon: "🅿️",
      desc: "Free parking — just visiting.",
    },
    22: { id: 22, name: "Chance", type: "chance", icon: "❓" },
    25: {
      id: 25,
      name: t.stations[2],
      type: "railroad",
      price: rrCfg.price,
      rent: [...rrCfg.rent],
      mortgage: rrCfg.mortgage,
    },
    28: {
      id: 28,
      name: t.utilities[1].name,
      type: "utility",
      icon: t.utilities[1].icon,
      price: utilCfg.price,
      mortgage: utilCfg.mortgage,
    },
    30: { id: 30, name: "Go to Jail", type: "gotojail", icon: "🚔" },
    33: {
      id: 33,
      name: "Community Chest",
      type: "community",
      icon: "📦",
    },
    35: {
      id: 35,
      name: t.stations[3],
      type: "railroad",
      price: rrCfg.price,
      rent: [...rrCfg.rent],
      mortgage: rrCfg.mortgage,
    },
    36: { id: 36, name: "Chance", type: "chance", icon: "❓" },
    38: {
      id: 38,
      name: t.taxNames[1],
      type: "tax",
      icon: "👑",
      amount: t.taxAmounts[1],
      desc: `Pay ${t.currency}${t.taxAmounts[1]} ${t.taxNames[1]}`,
    },
  };

  // Slots for properties (all 40 positions not in fixed)
  const propSlots = [];
  for (let i = 0; i < 40; i++) if (!fixed[i]) propSlots.push(i);

  // Sort property slots in board order
  const result = [];
  let pIdx = 0;
  for (let i = 0; i < 40; i++) {
    if (fixed[i]) {
      result.push(fixed[i]);
    } else {
      const s = propSpaces[pIdx] || {
        name: "—",
        type: "property",
        color: "BROWN",
        price: 600,
        rent: [40, 200, 600, 1800, 3200, 5000],
        house: 500,
        mortgage: 300,
        group: 0,
      };
      result.push({ ...s, id: i, type: "property" });
      pIdx++;
    }
  }
  return result;
}

function applyThemeById(themeId) {
  if (
    themeId === CUSTOM_BOARD_THEME_ID &&
    !BOARD_THEMES[CUSTOM_BOARD_THEME_ID]
  ) {
    const savedSeed = ACTIVE_CUSTOM_BOARD_SEED || getStoredCustomBoardSeed();
    if (savedSeed)
      applyCustomBoardSeed(savedSeed, { persist: false, quiet: true });
  }
  const nextId = BOARD_THEMES[themeId] ? themeId : "dhaka";
  selectedThemeId = nextId;
  window.ACTIVE_THEME = BOARD_THEMES[nextId];
  document.body.dataset.theme = nextId;
  refreshStartingMoneyUi(nextId, false);
  const themedSpaces = buildSpacesFromTheme(nextId);
  for (let i = 0; i < 40; i++) SPACES[i] = themedSpaces[i];
  return nextId;
}

function renderBoardThemeSelector() {
  const el = document.getElementById("board-theme-grid");
  if (!el) return;
  el.innerHTML = "";
  const hostCanEditTheme = !isOnlineGame() || ONLINE.isHost;
  Object.values(BOARD_THEMES).forEach((t) => {
    const btn = document.createElement("div");
    const active = t.id === selectedThemeId;
    btn.style.cssText = `padding:.75rem;border-radius:9px;cursor:${hostCanEditTheme ? "pointer" : "not-allowed"};border:2px solid ${active ? "var(--gold-light)" : "rgba(255,255,255,.15)"};background:${active ? "rgba(201,151,28,.2)" : "rgba(255,255,255,.06)"};transition:all .2s;${hostCanEditTheme ? "" : "opacity:.65"}`;
    btn.innerHTML = `<div style="font-size:1.5rem;margin-bottom:.3rem">${t.flag}</div>
      <div style="font-weight:700;color:#fff;font-size:.9rem">${t.name}</div>
      <div style="font-size:.75rem;color:rgba(255,255,255,.5);margin-top:.15rem">${t.desc}</div>`;
    btn.onclick = async () => {
      if (!hostCanEditTheme) return;
      applyThemeById(t.id);
      refreshStartingMoneyUi(t.id, true);
      renderBoardThemeSelector();
      await syncLobbySettingsToRoom();
    };
    el.appendChild(btn);
  });
}

const COLOR = {
  BROWN: "#8B4513",
  LBLUE: "#87CEEB",
  PINK: "#FF69B4",
  ORANGE: "#FF8C00",
  RED: "#DC143C",
  YELLOW: "#FFD700",
  GREEN: "#228B22",
  DBLUE: "#00008B",
  RAILROAD: "#333",
  UTILITY: "#666",
  TAX: "#444",
  SPECIAL: "#1a5c2a",
};

const SPACES = [
  {
    id: 0,
    name: "GO",
    type: "go",
    icon: "🏁",
    desc: "Collect ৳2000 salary each time you pass",
  },
  {
    id: 1,
    name: "Mirpur Rd",
    type: "property",
    color: "BROWN",
    price: 600,
    rent: [40, 200, 600, 1800, 3200, 5000],
    house: 500,
    mortgage: 300,
    group: 0,
  },
  { id: 2, name: "Community Chest", type: "community", icon: "📦" },
  {
    id: 3,
    name: "Kazipara",
    type: "property",
    color: "BROWN",
    price: 600,
    rent: [40, 200, 600, 1800, 3200, 5000],
    house: 500,
    mortgage: 300,
    group: 0,
  },
  {
    id: 4,
    name: "Income Tax",
    type: "tax",
    icon: "💸",
    amount: 2000,
    desc: "Pay ৳2,000 income tax",
  },
  {
    id: 5,
    name: "Dhaka Station",
    type: "railroad",
    price: 2000,
    rent: [250, 500, 1000, 2000],
    mortgage: 1000,
  },
  {
    id: 6,
    name: "New Market",
    type: "property",
    color: "LBLUE",
    price: 1000,
    rent: [60, 300, 900, 2700, 4000, 5500],
    house: 500,
    mortgage: 500,
    group: 1,
  },
  { id: 7, name: "Chance", type: "chance", icon: "❓" },
  {
    id: 8,
    name: "Bangshal Rd",
    type: "property",
    color: "LBLUE",
    price: 1000,
    rent: [60, 300, 900, 2700, 4000, 5500],
    house: 500,
    mortgage: 500,
    group: 1,
  },
  {
    id: 9,
    name: "Motijheel Cir",
    type: "property",
    color: "LBLUE",
    price: 1200,
    rent: [80, 400, 1000, 3000, 4500, 6000],
    house: 500,
    mortgage: 600,
    group: 1,
  },
  {
    id: 10,
    name: "Jail / Visit",
    type: "jail",
    icon: "⛓️",
    desc: "Just visiting or in jail",
  },
  {
    id: 11,
    name: "Dhanmondi Rd",
    type: "property",
    color: "PINK",
    price: 1400,
    rent: [100, 500, 1500, 4500, 6250, 7500],
    house: 1000,
    mortgage: 700,
    group: 2,
  },
  {
    id: 12,
    name: "Desco",
    type: "utility",
    icon: "⚡",
    price: 1500,
    mortgage: 750,
  },
  {
    id: 13,
    name: "Elephant Rd",
    type: "property",
    color: "PINK",
    price: 1400,
    rent: [100, 500, 1500, 4500, 6250, 7500],
    house: 1000,
    mortgage: 700,
    group: 2,
  },
  {
    id: 14,
    name: "Panthapath",
    type: "property",
    color: "PINK",
    price: 1600,
    rent: [120, 600, 1800, 5000, 7000, 9000],
    house: 1000,
    mortgage: 800,
    group: 2,
  },
  {
    id: 15,
    name: "Ctg Station",
    type: "railroad",
    price: 2000,
    rent: [250, 500, 1000, 2000],
    mortgage: 1000,
  },
  {
    id: 16,
    name: "Bashundhara",
    type: "property",
    color: "ORANGE",
    price: 1800,
    rent: [140, 700, 2000, 5500, 7500, 9500],
    house: 1000,
    mortgage: 900,
    group: 3,
  },
  { id: 17, name: "Community Chest", type: "community", icon: "📦" },
  {
    id: 18,
    name: "Uttara Sector",
    type: "property",
    color: "ORANGE",
    price: 1800,
    rent: [140, 700, 2000, 5500, 7500, 9500],
    house: 1000,
    mortgage: 900,
    group: 3,
  },
  {
    id: 19,
    name: "Baridhara",
    type: "property",
    color: "ORANGE",
    price: 2000,
    rent: [160, 800, 2200, 6000, 8000, 10000],
    house: 1000,
    mortgage: 1000,
    group: 3,
  },
  {
    id: 20,
    name: "Free Parking",
    type: "parking",
    icon: "🅿️",
    desc: "Free parking — just visiting.",
  },
  {
    id: 21,
    name: "Tejgaon I/A",
    type: "property",
    color: "RED",
    price: 2200,
    rent: [180, 900, 2500, 7000, 8750, 10500],
    house: 1500,
    mortgage: 1100,
    group: 4,
  },
  { id: 22, name: "Chance", type: "chance", icon: "❓" },
  {
    id: 23,
    name: "Tejgaon Rd",
    type: "property",
    color: "RED",
    price: 2200,
    rent: [180, 900, 2500, 7000, 8750, 10500],
    house: 1500,
    mortgage: 1100,
    group: 4,
  },
  {
    id: 24,
    name: "Farmgate",
    type: "property",
    color: "RED",
    price: 2400,
    rent: [200, 1000, 3000, 7500, 9250, 11000],
    house: 1500,
    mortgage: 1200,
    group: 4,
  },
  {
    id: 25,
    name: "Sylhet Station",
    type: "railroad",
    price: 2000,
    rent: [250, 500, 1000, 2000],
    mortgage: 1000,
  },
  {
    id: 26,
    name: "Gulshan-1",
    type: "property",
    color: "YELLOW",
    price: 2600,
    rent: [220, 1100, 3300, 8000, 9750, 11500],
    house: 1500,
    mortgage: 1300,
    group: 5,
  },
  {
    id: 27,
    name: "Gulshan-2",
    type: "property",
    color: "YELLOW",
    price: 2600,
    rent: [220, 1100, 3300, 8000, 9750, 11500],
    house: 1500,
    mortgage: 1300,
    group: 5,
  },
  {
    id: 28,
    name: "WASA",
    type: "utility",
    icon: "💧",
    price: 1500,
    mortgage: 750,
  },
  {
    id: 29,
    name: "Banani",
    type: "property",
    color: "YELLOW",
    price: 2800,
    rent: [240, 1200, 3600, 8500, 10250, 12000],
    house: 1500,
    mortgage: 1400,
    group: 5,
  },
  { id: 30, name: "Go to Jail", type: "gotojail", icon: "🚔" },
  {
    id: 31,
    name: "Niketan",
    type: "property",
    color: "GREEN",
    price: 3000,
    rent: [260, 1300, 3900, 9000, 11000, 12750],
    house: 2000,
    mortgage: 1500,
    group: 6,
  },
  {
    id: 32,
    name: "Mohakhali",
    type: "property",
    color: "GREEN",
    price: 3000,
    rent: [260, 1300, 3900, 9000, 11000, 12750],
    house: 2000,
    mortgage: 1500,
    group: 6,
  },
  { id: 33, name: "Community Chest", type: "community", icon: "📦" },
  {
    id: 34,
    name: "Palashi",
    type: "property",
    color: "GREEN",
    price: 3200,
    rent: [280, 1500, 4500, 10000, 12000, 14000],
    house: 2000,
    mortgage: 1600,
    group: 6,
  },
  {
    id: 35,
    name: "Rajshahi Stn",
    type: "railroad",
    price: 2000,
    rent: [250, 500, 1000, 2000],
    mortgage: 1000,
  },
  { id: 36, name: "Chance", type: "chance", icon: "❓" },
  {
    id: 37,
    name: "Motijheel CA",
    type: "property",
    color: "DBLUE",
    price: 3500,
    rent: [350, 1750, 5000, 11000, 13000, 15000],
    house: 2000,
    mortgage: 1750,
    group: 7,
  },
  {
    id: 38,
    name: "Luxury Tax",
    type: "tax",
    icon: "👑",
    amount: 1000,
    desc: "Pay ৳1,000 luxury tax",
  },
  {
    id: 39,
    name: "Karwan Bazar",
    type: "property",
    color: "DBLUE",
    price: 4000,
    rent: [500, 2000, 6000, 14000, 17000, 20000],
    house: 2000,
    mortgage: 2000,
    group: 7,
  },
];

const CHANCE_CARDS_INFLATED = [
  { text: "Advance to GO. Collect ৳2000.", action: "goto", value: 0 },
  {
    text: "Bank pays you dividend of ৳500.",
    action: "money",
    value: 500,
  },
  { text: "Go to Jail. Do not collect ৳2000.", action: "jail", value: 0 },
  {
    text: "Make general repairs: ৳500 per house, ৳2000 per hotel.",
    action: "repairs",
    value: { house: 500, hotel: 2000 },
  },
  { text: "Pay school fees of ৳1500.", action: "money", value: -1500 },
  { text: "Speeding fine — pay ৳500.", action: "money", value: -500 },
  {
    text: "Advance to nearest Railway Station.",
    action: "nearest",
    value: "railroad",
  },
  {
    text: "Your building won a prize! Collect ৳1500.",
    action: "money",
    value: 1500,
  },
  { text: "Get out of Jail free.", action: "jailcard", value: 0 },
  {
    text: "Bank error in your favour — collect ৳2000.",
    action: "money",
    value: 2000,
  },
  { text: "Doctor fees — pay ৳1000.", action: "money", value: -1000 },
  {
    text: "You are assessed street repairs: ৳400 per house, ৳1500 per hotel.",
    action: "repairs",
    value: { house: 400, hotel: 1500 },
  },
];

const COMMUNITY_CARDS_INFLATED = [
  {
    text: "Bank error in your favour. Collect ৳2000.",
    action: "money",
    value: 2000,
  },
  { text: "Doctor fees. Pay ৳500.", action: "money", value: -500 },
  { text: "Go to Jail. Do not collect ৳2000.", action: "jail", value: 0 },
  {
    text: "From sale of stock — collect ৳500.",
    action: "money",
    value: 500,
  },
  {
    text: "Collect ৳1000 consultancy fee.",
    action: "money",
    value: 1000,
  },
  { text: "Pay hospital fees of ৳1000.", action: "money", value: -1000 },
  { text: "Get out of Jail free.", action: "jailcard", value: 0 },
  { text: "Advance to GO. Collect ৳2000.", action: "goto", value: 0 },
  {
    text: "Life insurance matures — collect ৳1000.",
    action: "money",
    value: 1000,
  },
  { text: "Pay school fees of ৳1500.", action: "money", value: -1500 },
  {
    text: "Income tax refund — collect ৳500.",
    action: "money",
    value: 500,
  },
  {
    text: "It is your birthday! Collect ৳1000 from each player.",
    action: "birthday",
    value: 1000,
  },
];

const CHANCE_CARDS_CLASSIC = [
  { text: "Advance to GO. Collect $200.", action: "goto", value: 0 },
  { text: "Advance to Illinois Avenue.", action: "goto", value: 24 },
  { text: "Advance to St. Charles Place.", action: "goto", value: 11 },
  { text: "Take a trip to Reading Railroad.", action: "goto", value: 5 },
  { text: "Take a walk on Boardwalk.", action: "goto", value: 39 },
  {
    text: "Advance to nearest Railroad.",
    action: "nearest",
    value: "railroad",
  },
  {
    text: "Bank pays you a dividend of $50.",
    action: "money",
    value: 50,
  },
  {
    text: "Building loan matures. Collect $150.",
    action: "money",
    value: 150,
  },
  { text: "Pay poor tax of $15.", action: "money", value: -15 },
  { text: "Go to Jail. Do not collect $200.", action: "jail", value: 0 },
  { text: "Get Out of Jail Free.", action: "jailcard", value: 0 },
  {
    text: "General repairs: pay $25 per house and $100 per hotel.",
    action: "repairs",
    value: { house: 25, hotel: 100 },
  },
];

const COMMUNITY_CARDS_CLASSIC = [
  { text: "Advance to GO. Collect $200.", action: "goto", value: 0 },
  {
    text: "Bank error in your favor. Collect $200.",
    action: "money",
    value: 200,
  },
  { text: "Doctor fee. Pay $50.", action: "money", value: -50 },
  { text: "From sale of stock you get $50.", action: "money", value: 50 },
  { text: "Receive consultancy fee of $25.", action: "money", value: 25 },
  { text: "Get Out of Jail Free.", action: "jailcard", value: 0 },
  { text: "Go to Jail. Do not collect $200.", action: "jail", value: 0 },
  {
    text: "Life insurance matures. Collect $100.",
    action: "money",
    value: 100,
  },
  { text: "Pay hospital fees of $100.", action: "money", value: -100 },
  { text: "Pay school fees of $50.", action: "money", value: -50 },
  { text: "Income tax refund. Collect $20.", action: "money", value: 20 },
  {
    text: "It is your birthday. Collect $10 from each player.",
    action: "birthday",
    value: 10,
  },
];

function cloneCardDeck(deck) {
  return deck.map((card) => ({
    ...card,
    value:
      card.value && typeof card.value === "object" && !Array.isArray(card.value)
        ? { ...card.value }
        : card.value,
  }));
}

function customClampInt(value, fallback = 0, min = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.round(n));
}

function customSeedChecksumFNV1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
    hash >>>= 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function customSeedFromBase64Url(text) {
  const normalized = String(text || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function normalizeCustomCardAction(action) {
  const normalized = String(action || "")
    .trim()
    .toLowerCase();
  return [
    "goto",
    "money",
    "jail",
    "jailcard",
    "nearest",
    "repairs",
    "birthday",
  ].includes(normalized)
    ? normalized
    : "money";
}

function normalizeCustomCardValue(action, value) {
  if (action === "nearest") {
    const target = String(value || "").trim();
    return target || "railroad";
  }
  if (action === "repairs") {
    const raw =
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
      house: customClampInt(raw.house, 0, 0),
      hotel: customClampInt(raw.hotel, 0, 0),
    };
  }
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function decodeCustomCardDeck(rawDeck, fallbackDeck) {
  const source = Array.isArray(rawDeck) ? rawDeck : [];
  const basis = source.length ? source : fallbackDeck;
  return basis.map((entry, idx) => {
    const fallback = fallbackDeck[idx] || {
      text: "Card",
      action: "money",
      value: 0,
    };
    let row = entry;
    if (Array.isArray(entry)) {
      row = { text: entry[0], action: entry[1], value: entry[2] };
    }
    if (!row || typeof row !== "object") row = fallback;
    const action = normalizeCustomCardAction(row.action);
    return {
      text: String(row.text || fallback.text || "Card").slice(0, 220),
      action,
      value: normalizeCustomCardValue(
        action,
        row.value !== undefined ? row.value : fallback.value,
      ),
    };
  });
}

function expandCustomBoardSeedPayload(payload) {
  if (
    !payload ||
    Number(payload.v) !== 1 ||
    !Array.isArray(payload.m) ||
    !Array.isArray(payload.s)
  ) {
    throw new Error("Seed payload format is invalid.");
  }

  const meta = {
    boardName: String(payload.m[0] || "Custom Board").slice(0, 48),
    currencySymbol: String(payload.m[1] || "$").slice(0, 4) || "$",
    economyScale: Number(payload.m[2]) || 1,
    goSalary: customClampInt(payload.m[3], 200, 0),
    startMoney: customClampInt(payload.m[4], 1500, 0),
    jailBail: customClampInt(payload.m[5], 50, 0),
    utilityOne: customClampInt(payload.m[6], 4, 0),
    utilityBoth: customClampInt(payload.m[7], 10, 0),
  };

  const spaces = payload.s.map((row) => {
    if (!Array.isArray(row) || row.length < 5) {
      throw new Error("Seed contains an invalid space row.");
    }

    const id = customClampInt(row[0], 0, 0);
    const typeCode = String(row[1] || "p").toLowerCase();
    const name = String(row[2] || "Space").slice(0, 48);

    if (typeCode === "p") {
      const color = String(row[3] || "BROWN").toUpperCase();
      const group = customClampInt(row[4], 0, 0);
      const price = customClampInt(row[5], 0, 0);
      const house = customClampInt(row[6], 0, 0);
      const mortgage = customClampInt(row[7], 0, 0);
      const rent = row.slice(8, 14).map((v) => customClampInt(v, 0, 0));
      while (rent.length < 6) rent.push(0);
      return {
        id,
        type: "property",
        name,
        color,
        group,
        price,
        house,
        mortgage,
        rent,
      };
    }

    if (typeCode === "r") {
      const price = customClampInt(row[3], 0, 0);
      const mortgage = customClampInt(row[4], 0, 0);
      const rent = row.slice(5, 9).map((v) => customClampInt(v, 0, 0));
      while (rent.length < 4) rent.push(0);
      return {
        id,
        type: "railroad",
        name,
        color: "",
        group: null,
        price,
        house: 0,
        mortgage,
        rent,
      };
    }

    if (typeCode === "u") {
      const price = customClampInt(row[3], 0, 0);
      const mortgage = customClampInt(row[4], 0, 0);
      return {
        id,
        type: "utility",
        name,
        color: "",
        group: null,
        price,
        house: 0,
        mortgage,
        rent: [],
      };
    }

    throw new Error("Seed contains an unknown space type.");
  });

  const cardsPayload = payload.c;
  let chanceRaw = null;
  let communityRaw = null;
  if (Array.isArray(cardsPayload)) {
    chanceRaw = cardsPayload[0];
    communityRaw = cardsPayload[1];
  } else if (cardsPayload && typeof cardsPayload === "object") {
    chanceRaw = cardsPayload.ch || cardsPayload.chance;
    communityRaw = cardsPayload.cc || cardsPayload.community;
  }

  const cards = {
    chance: decodeCustomCardDeck(chanceRaw, CHANCE_CARDS_CLASSIC),
    community: decodeCustomCardDeck(communityRaw, COMMUNITY_CARDS_CLASSIC),
  };

  return { meta, spaces, cards };
}

function parseCustomBoardSeed(seed) {
  const raw = String(seed || "").trim();
  if (!raw) throw new Error("Seed is empty.");
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== CUSTOM_BOARD_SEED_PREFIX) {
    throw new Error("Invalid seed format.");
  }
  const checksum = String(parts[1] || "").toLowerCase();
  const json = customSeedFromBase64Url(parts[2]);
  const actualChecksum = customSeedChecksumFNV1a(json).toLowerCase();
  if (checksum !== actualChecksum) {
    throw new Error("Seed checksum mismatch.");
  }
  const payload = JSON.parse(json);
  return expandCustomBoardSeedPayload(payload);
}

function makeThemeFromCustomBoard(board, seed) {
  const byId = new Map(
    (board.spaces || []).map((space) => [Number(space.id), space]),
  );
  const goSalary = customClampInt(board?.meta?.goSalary, 200, 0);
  const startMoneyDefault = customClampInt(board?.meta?.startMoney, 1500, 0);
  const jailBail = customClampInt(board?.meta?.jailBail, 50, 0);
  const utilityOne = customClampInt(board?.meta?.utilityOne, 4, 0);
  const utilityBoth = Math.max(
    utilityOne,
    customClampInt(board?.meta?.utilityBoth, 10, 0),
  );

  const stationIds = [5, 15, 25, 35];
  const utilityIds = [12, 28];
  const stations = stationIds.map((id, idx) =>
    String(byId.get(id)?.name || `Railroad ${idx + 1}`),
  );
  const utilities = utilityIds.map((id, idx) => ({
    name: String(
      byId.get(id)?.name || (idx === 0 ? "Electric Company" : "Water Works"),
    ),
    icon: idx === 0 ? "⚡" : "💧",
  }));

  const firstRailroad =
    stationIds
      .map((id) => byId.get(id))
      .find((space) => space && space.type === "railroad") || null;
  const firstUtility =
    utilityIds
      .map((id) => byId.get(id))
      .find((space) => space && space.type === "utility") || null;
  const railroadPrice = customClampInt(firstRailroad?.price, 200, 0);
  const railroadMortgage = customClampInt(
    firstRailroad?.mortgage,
    Math.floor(railroadPrice / 2),
    0,
  );
  const railroadRent = Array.isArray(firstRailroad?.rent)
    ? firstRailroad.rent.slice(0, 4).map((v) => customClampInt(v, 0, 0))
    : [25, 50, 100, 200];
  while (railroadRent.length < 4)
    railroadRent.push(railroadRent[railroadRent.length - 1] || 0);

  const utilityPrice = customClampInt(firstUtility?.price, 150, 0);
  const utilityMortgage = customClampInt(
    firstUtility?.mortgage,
    Math.floor(utilityPrice / 2),
    0,
  );

  const properties = (board.spaces || [])
    .filter((space) => space && space.type === "property")
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((space) => ({
      name: String(space.name || "Property").slice(0, 48),
      color: String(space.color || "BROWN").toUpperCase(),
      price: customClampInt(space.price, 0, 0),
      rent: Array.isArray(space.rent)
        ? space.rent.slice(0, 6).map((v) => customClampInt(v, 0, 0))
        : [0, 0, 0, 0, 0, 0],
      house: customClampInt(space.house, 0, 0),
      mortgage: customClampInt(space.mortgage, 0, 0),
      group: customClampInt(space.group, 0, 0),
    }));

  if (!properties.length) {
    throw new Error("Seed has no property spaces.");
  }

  return {
    id: CUSTOM_BOARD_THEME_ID,
    name: String(board?.meta?.boardName || "Custom Board").slice(0, 48),
    flag: "🧩",
    desc: "Imported custom board",
    currency: String(board?.meta?.currencySymbol || "$").slice(0, 4) || "$",
    locale: "en-US",
    goSalary,
    startMoneyDefault,
    jailBail,
    railroadPrice,
    railroadRent,
    railroadMortgage,
    utilityPrice,
    utilityMortgage,
    utilityRentOneMultiplier: utilityOne,
    utilityRentBothMultiplier: utilityBoth,
    stations,
    utilities,
    spaces: properties,
    taxNames: ["Income Tax", "Luxury Tax"],
    taxAmounts: [Math.max(0, goSalary), Math.max(0, Math.floor(goSalary / 2))],
    cardProfile: "custom",
    chanceCards: cloneCardDeck(board.cards?.chance || CHANCE_CARDS_CLASSIC),
    communityCards: cloneCardDeck(
      board.cards?.community || COMMUNITY_CARDS_CLASSIC,
    ),
    customSeed: String(seed || "").trim(),
  };
}

function applyCustomBoardSeed(seed, { persist = true, quiet = false } = {}) {
  const rawSeed = String(seed || "").trim();
  if (!rawSeed) {
    if (!quiet) setCustomBoardStatus("Seed is empty.", true);
    return false;
  }
  try {
    const parsed = parseCustomBoardSeed(rawSeed);
    const customTheme = makeThemeFromCustomBoard(parsed, rawSeed);
    BOARD_THEMES[CUSTOM_BOARD_THEME_ID] = customTheme;
    ACTIVE_CUSTOM_BOARD_SEED = rawSeed;
    if (persist) setStoredCustomBoardSeed(rawSeed);

    const seedInput = document.getElementById("custom-board-seed");
    if (seedInput) seedInput.value = rawSeed;
    if (!quiet)
      setCustomBoardStatus(`Custom board loaded: ${customTheme.name}`);
    return true;
  } catch (err) {
    if (!quiet) {
      const msg = err?.message || "Invalid custom board seed.";
      setCustomBoardStatus(msg, true);
      toast(msg, "danger");
    }
    return false;
  }
}

function removeActiveCustomBoardTheme(clearStorage = false) {
  delete BOARD_THEMES[CUSTOM_BOARD_THEME_ID];
  ACTIVE_CUSTOM_BOARD_SEED = "";
  if (clearStorage) clearStoredCustomBoardSeed();
}

function initializeCustomBoardFromStorage() {
  const seed = getStoredCustomBoardSeed();
  if (!seed) return false;
  const ok = applyCustomBoardSeed(seed, { persist: false, quiet: true });
  if (!ok) clearStoredCustomBoardSeed();
  return ok;
}

function getThemeCardDecks(themeId = selectedThemeId) {
  const theme = getThemeById(themeId);
  if (Array.isArray(theme.chanceCards) && Array.isArray(theme.communityCards)) {
    return {
      chance: cloneCardDeck(theme.chanceCards),
      community: cloneCardDeck(theme.communityCards),
    };
  }
  const isClassicDeck = theme.cardProfile === "classic";
  const chance = isClassicDeck ? CHANCE_CARDS_CLASSIC : CHANCE_CARDS_INFLATED;
  const community = isClassicDeck
    ? COMMUNITY_CARDS_CLASSIC
    : COMMUNITY_CARDS_INFLATED;
  return {
    chance: cloneCardDeck(chance),
    community: cloneCardDeck(community),
  };
}

const TOKENS = ["🎩", "🚗", "🐶", "👢", "🛳️", "♟️", "🏎️", "🦁"];
const TOKEN_COLORS = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#e91e63",
];

// ═══════════════════════════════════════════════
//  GAME STATE
// ═══════════════════════════════════════════════
let G = {}; // global game state
let jailPromptShownKey = "";
let tradeReviewShownKey = "";
const CHAT_PREVIEW = {
  lastShownKey: "",
};
const AI_CTRL = {
  timerId: null,
  lastKey: "",
  lastTradeAttemptKey: "",
  tradeByPlayer: {},
};
const AI_RUNNER_LEASE_MS = 3200;
const AI_RUNNER_RENEW_MS = 1200;
const AI_TRADE_SAME_OFFER_LIMIT = 2;
const AI_TRADE_DECLINE_STREAK_COOLDOWN = 2;
const AI_TRADE_PROPOSAL_COOLDOWN_MOVES = 2;
const DEBT_PROMPT = {
  active: false,
  payerId: null,
  amount: 0,
  recipientId: null,
  toParking: false,
};
const MOVE_FX = {
  active: false,
  playerId: null,
};
const REMOTE_FX = {
  running: false,
  epoch: 0,
};
let LOG_ARCHIVE_GAME_STARTED_AT = 0;
const LOG_ARCHIVE = [];
const LOG_ARCHIVE_KEYS = new Set();

function initGameState(players, startMoney, options = {}) {
  const gameStartedAt = Date.now();
  const themeDecks = getThemeCardDecks(selectedThemeId);
  const shuffledChance = shuffle(themeDecks.chance);
  const shuffledComm = shuffle(themeDecks.community);
  const auctionEnabled = sanitizeAuctionEnabled(options.auctionEnabled, true);
  if (AI_CTRL.timerId) {
    clearTimeout(AI_CTRL.timerId);
    AI_CTRL.timerId = null;
  }
  AI_CTRL.lastKey = "";
  AI_CTRL.lastTradeAttemptKey = "";
  AI_CTRL.tradeByPlayer = {};
  clearLogArchive(gameStartedAt);
  jailPromptShownKey = "";
  tradeReviewShownKey = "";
  CHAT_PREVIEW.lastShownKey = "";
  DEBT_PROMPT.active = false;
  DEBT_PROMPT.payerId = null;
  DEBT_PROMPT.amount = 0;
  DEBT_PROMPT.recipientId = null;
  DEBT_PROMPT.toParking = false;
  MOVE_FX.active = false;
  MOVE_FX.playerId = null;
  ONLINE.pendingCardResolutions = 0;
  G = {
    players: players.map((p, i) => ({
      id: i,
      uid: p.uid || null,
      name: p.name,
      kind: p.kind === "ai" ? "ai" : "human",
      token: p.token,
      color: TOKEN_COLORS[i % TOKEN_COLORS.length],
      money: startMoney,
      pos: 0,
      properties: [],
      railroads: [],
      utilities: [],
      jailFreeCards: 0,
      inJail: false,
      jailTurns: 0,
      bankrupt: false,
      bankruptOrder: null,
      doublesCount: 0,
    })),
    properties: SPACES.map((s) =>
      s.type === "property" || s.type === "railroad" || s.type === "utility"
        ? {
            id: s.id,
            owner: null,
            houses: 0,
            hotel: false,
            mortgaged: false,
          }
        : null,
    ),
    currentPlayerIdx: 0,
    phase: "roll", // roll | action | end
    dice: [1, 1],
    lastDoubles: false,
    chanceIdx: 0,
    communityIdx: 0,
    chanceDeck: shuffledChance,
    communityDeck: shuffledComm,
    gameStartedAt,
    parkingPot: 0,
    log: [],
    chat: [],
    pendingBuy: null,
    debtPrompt: null,
    auctionState: null,
    bankAuctionQueue: [],
    bankruptcySeq: 0,
    pendingTrade: null,
    boardThemeId: selectedThemeId,
    customBoardSeed:
      selectedThemeId === CUSTOM_BOARD_THEME_ID
        ? String(ACTIVE_CUSTOM_BOARD_SEED || "").trim() || null
        : null,
    auctionEnabled,
    gameOver: false,
  };
}

// ═══════════════════════════════════════════════
//  LOBBY SETUP
// ═══════════════════════════════════════════════
let lobbyPlayers = [
  {
    uid: ONLINE.localUid,
    name: "Player 1",
    token: TOKENS[0],
    kind: "human",
  },
  { uid: null, name: "Player 2", token: TOKENS[1], kind: "human" },
];

function normalizePlayerKind(kind) {
  return kind === "ai" ? "ai" : "human";
}

const AI_PLACEHOLDER_NAMES = [
  "Mirza Abbas",
  "Dipjol",
  "Hero Alom",
  "Obaydul Kader",
  "Shakib Khan",
  "Sefuda",
  "Shakib Al Hasan",
  "Nasiruddin Patwary",
  "Dr. Mahfuzur Rahman",
  "Solaiman Shukhon",
  "Salman Muqtadir",
  "Ananta Jalil",
];

function isAiPlaceholderName(name) {
  const clean = String(name || "").trim();
  return AI_PLACEHOLDER_NAMES.includes(clean);
}

function pickRandomAiPlaceholderName(excludeIndex = -1) {
  const used = new Set(
    lobbyPlayers
      .map((p, idx) => ({ p, idx }))
      .filter(
        ({ p, idx }) =>
          idx !== excludeIndex &&
          normalizePlayerKind(p?.kind) === "ai" &&
          isAiPlaceholderName(p?.name),
      )
      .map(({ p }) => String(p.name || "").trim()),
  );
  const available = AI_PLACEHOLDER_NAMES.filter((name) => !used.has(name));
  const pool = available.length ? available : AI_PLACEHOLDER_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function defaultLobbyPlayerName(index, kind = "human") {
  if (normalizePlayerKind(kind) !== "ai") return `Player ${index + 1}`;
  const current = lobbyPlayers[index];
  if (current && isAiPlaceholderName(current.name))
    return String(current.name).trim();
  return pickRandomAiPlaceholderName(index);
}

function getRoomRef() {
  return FIREBASE.api.ref(FIREBASE.db, `rooms/${ONLINE.roomId}`);
}

function defaultLobbySettings() {
  const rawStart = Number.parseInt(
    document.getElementById("starting-money")?.value,
    10,
  );
  const auctionEnabled = sanitizeAuctionEnabled(
    document.getElementById("auction-enabled")?.value,
    true,
  );
  const customBoardSeed =
    selectedThemeId === CUSTOM_BOARD_THEME_ID
      ? String(ACTIVE_CUSTOM_BOARD_SEED || "").trim()
      : "";
  return {
    startMoney:
      Number.isFinite(rawStart) && rawStart > 0
        ? rawStart
        : getThemeStartMoneyDefault(selectedThemeId),
    timerDuration:
      parseInt(document.getElementById("lobby-timer")?.value, 10) || 0,
    themeId: selectedThemeId,
    customBoardSeed: customBoardSeed || null,
    auctionEnabled,
  };
}

async function syncLobbySettingsToRoom() {
  if (!isOnlineGame() || !ONLINE.isHost || !FIREBASE.api) return;
  try {
    await FIREBASE.api.update(getRoomRef(), {
      settings: defaultLobbySettings(),
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error(err);
  }
}

function safeGameStateForRoom() {
  const raw = JSON.parse(
    JSON.stringify(G || {}, (_key, value) => {
      if (value instanceof Set) return Array.from(value);
      return value;
    }),
  );
  return raw;
}

function captureBoardVisualState(state) {
  const rawPlayers = indexedObjectToArray(state?.players);
  const rawProps = indexedObjectToArray(state?.properties);
  return {
    players: rawPlayers.map((p, i) => {
      const posN = Number(p?.pos);
      const pos = Number.isInteger(posN) ? ((posN % 40) + 40) % 40 : 0;
      return {
        id: i,
        pos,
        inJail: !!p?.inJail,
        bankrupt: !!p?.bankrupt,
      };
    }),
    owners: rawProps.map((prop) => {
      if (!prop || prop.owner === null || prop.owner === undefined) return null;
      const ownerN = Number(prop.owner);
      return Number.isInteger(ownerN) && ownerN >= 0 ? ownerN : null;
    }),
  };
}

function hydrateRemoteGameState(raw) {
  if (!raw) return;
  const next = JSON.parse(JSON.stringify(raw));
  const remoteGameStartedAt = Number(next.gameStartedAt) || 0;
  if (
    remoteGameStartedAt &&
    remoteGameStartedAt !== LOG_ARCHIVE_GAME_STARTED_AT
  ) {
    clearLogArchive(remoteGameStartedAt);
  }

  const requestedThemeId = String(next.boardThemeId || selectedThemeId);
  if (
    requestedThemeId === CUSTOM_BOARD_THEME_ID &&
    typeof next.customBoardSeed === "string" &&
    next.customBoardSeed.trim()
  ) {
    const loaded = applyCustomBoardSeed(next.customBoardSeed, {
      persist: false,
      quiet: true,
    });
    if (!loaded) removeActiveCustomBoardTheme(false);
  }

  const remoteThemeId = BOARD_THEMES[requestedThemeId]
    ? requestedThemeId
    : selectedThemeId;
  applyThemeById(remoteThemeId);
  next.boardThemeId = selectedThemeId;
  next.customBoardSeed =
    selectedThemeId === CUSTOM_BOARD_THEME_ID
      ? String(ACTIVE_CUSTOM_BOARD_SEED || "").trim() || null
      : null;

  const players = indexedObjectToArray(next.players).filter(
    (p) => p && typeof p === "object",
  );
  if (!players.length) {
    throw new Error("Remote game state is missing player data.");
  }

  next.players = players.map((p, i) => ({
    ...p,
    id: i,
    name: sanitizeName(p.name, `Player ${i + 1}`),
    kind: normalizePlayerKind(p.kind),
    token: sanitizeToken(p.token, TOKENS[i % TOKENS.length]),
    color: sanitizeColor(p.color, TOKEN_COLORS[i % TOKEN_COLORS.length]),
    money: Number.isFinite(Number(p.money)) ? Number(p.money) : 0,
    pos: Number.isInteger(Number(p.pos)) ? ((Number(p.pos) % 40) + 40) % 40 : 0,
    jailFreeCards: Math.max(0, Number(p.jailFreeCards) || 0),
    inJail: !!p.inJail,
    jailTurns: Math.max(0, Number(p.jailTurns) || 0),
    bankrupt: !!p.bankrupt,
    bankruptOrder:
      Number.isInteger(Number(p.bankruptOrder)) && Number(p.bankruptOrder) > 0
        ? Number(p.bankruptOrder)
        : null,
    doublesCount: Math.max(0, Number(p.doublesCount) || 0),
    properties: indexedObjectToArray(p.properties).filter(Number.isInteger),
    railroads: indexedObjectToArray(p.railroads).filter(Number.isInteger),
    utilities: indexedObjectToArray(p.utilities).filter(Number.isInteger),
  }));

  const ownable = new Set(
    SPACES.map((s, i) =>
      s.type === "property" || s.type === "railroad" || s.type === "utility"
        ? i
        : null,
    ).filter((i) => i !== null),
  );
  const props = indexedObjectToArray(next.properties);
  if (props.length < SPACES.length) props.length = SPACES.length;
  for (let i = 0; i < SPACES.length; i++) {
    if (!ownable.has(i)) {
      props[i] = null;
      continue;
    }
    const src = props[i] && typeof props[i] === "object" ? props[i] : {};
    const ownerN =
      src.owner === null || src.owner === undefined ? NaN : Number(src.owner);
    const owner =
      Number.isInteger(ownerN) && ownerN >= 0 && ownerN < next.players.length
        ? ownerN
        : null;
    const hotel = !!src.hotel;
    const houses = hotel
      ? 0
      : Math.max(0, Math.min(4, Number(src.houses) || 0));
    props[i] = {
      id: i,
      owner,
      houses,
      hotel,
      mortgaged: !!src.mortgaged,
    };
  }
  next.properties = props;

  const curIdx = Number(next.currentPlayerIdx);
  next.currentPlayerIdx =
    Number.isInteger(curIdx) && curIdx >= 0 && curIdx < next.players.length
      ? curIdx
      : 0;
  next.phase = ["roll", "action", "end"].includes(next.phase)
    ? next.phase
    : "roll";
  const dice = indexedObjectToArray(next.dice).map((n) => Number(n));
  next.dice =
    dice.length >= 2 &&
    dice.every((n) => Number.isInteger(n) && n >= 1 && n <= 6)
      ? [dice[0], dice[1]]
      : [1, 1];
  const seqRaw = Math.max(0, Number(next.bankruptcySeq) || 0);
  const maxPlayerOrder = next.players.reduce((max, player) => {
    const order = Number(player?.bankruptOrder);
    return Number.isInteger(order) && order > 0 ? Math.max(max, order) : max;
  }, 0);
  next.bankruptcySeq = Math.max(seqRaw, maxPlayerOrder);

  next.log = indexedObjectToArray(next.log)
    .map(normalizeLogEntry)
    .filter(Boolean);
  if (next.log.length > GAME_LOG_LIMIT)
    next.log = next.log.slice(-GAME_LOG_LIMIT);
  next.chat = indexedObjectToArray(next.chat).filter(Boolean);
  next.chanceDeck = indexedObjectToArray(next.chanceDeck);
  next.communityDeck = indexedObjectToArray(next.communityDeck);
  next.bankAuctionQueue = indexedObjectToArray(next.bankAuctionQueue).filter(
    Number.isInteger,
  );
  next.auctionEnabled = sanitizeAuctionEnabled(next.auctionEnabled, true);
  const debtPromptRaw =
    next.debtPrompt && typeof next.debtPrompt === "object"
      ? next.debtPrompt
      : null;
  if (debtPromptRaw && debtPromptRaw.active !== false) {
    const payerId = Number(debtPromptRaw.payerId);
    const payerValid =
      Number.isInteger(payerId) &&
      payerId >= 0 &&
      payerId < next.players.length;
    const recipientIdRaw = Number(debtPromptRaw.recipientId);
    const recipientId =
      Number.isInteger(recipientIdRaw) &&
      recipientIdRaw >= 0 &&
      recipientIdRaw < next.players.length
        ? recipientIdRaw
        : null;
    next.debtPrompt =
      payerValid && !next.players[payerId]?.bankrupt
        ? {
            active: true,
            payerId,
            amount: Math.max(0, Number(debtPromptRaw.amount) || 0),
            recipientId,
            toParking: !!debtPromptRaw.toParking,
          }
        : null;
  } else {
    next.debtPrompt = null;
  }

  const pendingTradeRaw =
    next.pendingTrade && typeof next.pendingTrade === "object"
      ? next.pendingTrade
      : null;
  if (pendingTradeRaw) {
    const fromId = Number(pendingTradeRaw.fromId);
    const toId = Number(pendingTradeRaw.toId);
    const fromMoney = Math.max(0, Number(pendingTradeRaw.fromMoney) || 0);
    const toMoney = Math.max(0, Number(pendingTradeRaw.toMoney) || 0);
    const fromProps = indexedObjectToArray(pendingTradeRaw.fromProps).filter(
      Number.isInteger,
    );
    const toProps = indexedObjectToArray(pendingTradeRaw.toProps).filter(
      Number.isInteger,
    );
    const validPlayers =
      Number.isInteger(fromId) &&
      Number.isInteger(toId) &&
      fromId >= 0 &&
      fromId < next.players.length &&
      toId >= 0 &&
      toId < next.players.length &&
      fromId !== toId;

    next.pendingTrade = validPlayers
      ? {
          id: String(pendingTradeRaw.id || `tr_${Date.now().toString(36)}`),
          fromId,
          toId,
          fromProps,
          toProps,
          fromMoney,
          toMoney,
          createdAt: Number(pendingTradeRaw.createdAt) || Date.now(),
        }
      : null;
  } else {
    next.pendingTrade = null;
  }

  G = next;
  restoreDebtPromptFromGameState(G);
  if (G.auctionState) {
    const activePlayersRaw = indexedObjectToArray(G.auctionState.activePlayers)
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v >= 0 && v < G.players.length);
    const fallbackActive = G.players
      .filter((p) => !p.bankrupt)
      .map((p) => p.id);
    const activePlayers = activePlayersRaw.length
      ? activePlayersRaw
      : fallbackActive;

    if (!activePlayers.length) {
      G.auctionState = null;
    } else {
      G.auctionState.activePlayers = activePlayers;

      const passedRaw = indexedObjectToArray(G.auctionState.passed)
        .map((v) => Number(v))
        .filter((v) => Number.isInteger(v) && activePlayers.includes(v));
      G.auctionState.passed = new Set(passedRaw);

      const rawBidderIdx = Number(G.auctionState.bidderIdx);
      G.auctionState.bidderIdx = Number.isFinite(rawBidderIdx)
        ? ((Math.trunc(rawBidderIdx) % activePlayers.length) +
            activePlayers.length) %
          activePlayers.length
        : 0;

      const rawHighBidder = Number(G.auctionState.highBidder);
      G.auctionState.highBidder =
        Number.isInteger(rawHighBidder) &&
        rawHighBidder >= 0 &&
        rawHighBidder < G.players.length
          ? rawHighBidder
          : null;

      const rawBid = Number(G.auctionState.currentBid);
      G.auctionState.currentBid =
        Number.isFinite(rawBid) && rawBid >= 0 ? Math.floor(rawBid) : 0;

      const rawPropId = Number(G.auctionState.propId);
      const propValid =
        Number.isInteger(rawPropId) &&
        !!SPACES[rawPropId] &&
        !!G.properties[rawPropId];
      if (!propValid) {
        G.auctionState = null;
      } else {
        G.auctionState.propId = rawPropId;
        G.auctionState.propName = String(
          G.auctionState.propName || SPACES[rawPropId].name || "Property",
        );
        G.auctionState.source =
          G.auctionState.source === "bank" ? "bank" : "market";
      }
    }
  }
}

async function syncRoomState(reason = "") {
  if (!isOnlineGame() || ONLINE.isApplyingRemote || !FIREBASE.api) return;

  if (ONLINE.syncInFlight) {
    ONLINE.syncQueuedReason = reason || ONLINE.syncQueuedReason || "sync";
    return;
  }

  ONLINE.syncInFlight = true;

  try {
    let currentReason = reason || "sync";
    while (true) {
      const baseRevision = Number(ONLINE.revision) || 0;
      const nextRevision = baseRevision + 1;
      syncDebtPromptToGameState();
      const nextGameState = safeGameStateForRoom();
      const nextSettings = ONLINE.isHost ? defaultLobbySettings() : null;

      const txResult = await FIREBASE.api.runTransaction(
        getRoomRef(),
        (current) => {
          if (!current || typeof current !== "object") return current;

          const serverRevision = Number(current.revision) || 0;
          if (serverRevision !== baseRevision) {
            return;
          }

          const out = {
            ...current,
            status: "playing",
            gameState: nextGameState,
            revision: nextRevision,
            updatedAt: Date.now(),
            lastReason: currentReason,
          };
          if (nextSettings) out.settings = nextSettings;
          return out;
        },
      );

      if (txResult?.committed) {
        ONLINE.revision = nextRevision;
        if (ONLINE.syncQueuedReason) {
          currentReason = ONLINE.syncQueuedReason;
          ONLINE.syncQueuedReason = null;
          continue;
        }
        break;
      } else {
        const snapData = txResult?.snapshot?.val ? txResult.snapshot.val() : null;
        if (snapData) {
          ONLINE.revision = Number(snapData.revision) || 0;
        }
        continue;
      }
    }
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "Failed to sync room state."), "danger");
  } finally {
    ONLINE.syncInFlight = false;
  }
}

async function applyRoomSnapshot(data) {
  if (!data) return;
  const prevLastChatKey = chatMessageKey(getLastChatMessage());
  const prevVisualState = captureBoardVisualState(G);
  const departureNotice =
    data.lastDepartureNotice && typeof data.lastDepartureNotice === "object"
      ? data.lastDepartureNotice
      : null;
  let departureMessage = "";
  let departureEndsMatch = false;
  if (
    departureNotice?.id &&
    departureNotice.id !== ONLINE.lastDepartureNoticeId
  ) {
    ONLINE.lastDepartureNoticeId = String(departureNotice.id);
    const noticeTime = Number(departureNotice.time) || 0;
    const isRecent = !noticeTime || Date.now() - noticeTime < 15000;
    if (isRecent) {
      const who = sanitizeName(departureNotice.name, "A player");
      departureMessage = String(
        departureNotice.message || `${who} left the room.`,
      );
      departureEndsMatch = departureNotice.type === "leave-end";
    }
  }
  const roomVersion = Number(data.schemaVersion || 0);
  if (roomVersion !== ROOM_SCHEMA_VERSION) {
    throw new Error(
      "Room is using an older game schema. Recreate the room from this version.",
    );
  }
  ONLINE.status = data.status || "lobby";
  ONLINE.revision = data.revision || 0;
  ONLINE.hostUid = data.hostUid || null;
  ONLINE.visibility = data.visibility || "open";
  ONLINE.lastSnapshotAt = Number(data.updatedAt) || Date.now();
  const aiRunnerRaw =
    data.aiRunner && typeof data.aiRunner === "object" ? data.aiRunner : null;
  ONLINE.aiRunner = aiRunnerRaw
    ? {
        uid: String(aiRunnerRaw.uid || ""),
        turnKey: String(aiRunnerRaw.turnKey || ""),
        until: Number(aiRunnerRaw.until) || 0,
      }
    : null;

  const roomPlayers = indexedObjectToArray(data.players).map((p, i) => ({
    uid: p.uid || null,
    name: sanitizeName(p.name, `Player ${i + 1}`),
    token: sanitizeToken(p.token, TOKENS[i % TOKENS.length]),
    ready: !!p.ready,
  }));

  if (!ONLINE.hostUid) {
    ONLINE.hostUid = roomPlayers.find((p) => p.uid)?.uid || null;
  }
  ONLINE.isHost = ONLINE.hostUid === ONLINE.localUid;

  const localPresent = roomPlayers.some((p) => p.uid === ONLINE.localUid);
  if (isOnlineGame() && !localPresent) {
    updateOnlineStatus("You are no longer in this room.", true);
    leaveOnlineRoom(false, false);
    toast("You were removed from the room.", "danger");
    return;
  }

  if (roomPlayers.length) {
    lobbyPlayers = roomPlayers;
  }

  const settings = data.settings || {};
  if (
    settings.themeId === CUSTOM_BOARD_THEME_ID &&
    typeof settings.customBoardSeed === "string" &&
    settings.customBoardSeed.trim()
  ) {
    const loaded = applyCustomBoardSeed(settings.customBoardSeed, {
      persist: false,
      quiet: true,
    });
    if (!loaded) removeActiveCustomBoardTheme(false);
  }
  if (settings.themeId && BOARD_THEMES[settings.themeId]) {
    applyThemeById(settings.themeId);
  }
  if (typeof settings.startMoney === "number") {
    const sm = document.getElementById("starting-money");
    if (sm) sm.value = settings.startMoney;
  }
  if (typeof settings.timerDuration === "number") {
    const lt = document.getElementById("lobby-timer");
    if (lt) lt.value = settings.timerDuration;
    TIMER.duration = settings.timerDuration;
  }
  if (typeof settings.auctionEnabled === "boolean") {
    const auctionSelect = document.getElementById("auction-enabled");
    if (auctionSelect)
      auctionSelect.value = settings.auctionEnabled ? "on" : "off";
  }
  refreshCustomBoardPanel();

  if (ONLINE.status === "playing" && data.gameState) {
    ONLINE.isApplyingRemote = true;
    try {
      hydrateRemoteGameState(data.gameState);
      buildBoard();
      renderAll();
      showScreen("game-screen");
      const animationRevision = Number(ONLINE.revision) || 0;
      const animationEpoch = ++REMOTE_FX.epoch;
      await playRemoteSnapshotAnimations(prevVisualState, {
        expectedRevision: animationRevision,
        expectedEpoch: animationEpoch,
      });
      updateActionButtons();
      if (departureMessage) {
        toast(departureMessage, departureEndsMatch ? "danger" : "gold");
        if (departureEndsMatch) {
          const winner = (G.players || []).find((p) => !p.bankrupt);
          if (winner) showWinner(winner);
        }
      }
      if (!departureEndsMatch) {
        maybeShowWinnerFromState();
      }
      const nextLast = getLastChatMessage();
      if (prevLastChatKey && chatMessageKey(nextLast) !== prevLastChatKey) {
        showChatPreview(nextLast);
      }
    } finally {
      ONLINE.isApplyingRemote = false;
      // If the current player is an AI (e.g. after AI takeover), eagerly try to claim
      // the runner lease before the polling interval fires, so the turn isn't stuck.
      const currentAfterHydrate =
        G && Array.isArray(G.players) ? G.players[G.currentPlayerIdx] : null;
      if (
        currentAfterHydrate &&
        isAiPlayer(currentAfterHydrate) &&
        !currentAfterHydrate.bankrupt
      ) {
        ensureAiRunnerLease().then(() => maybeScheduleOfflineAiTurn());
      } else {
        maybeScheduleOfflineAiTurn();
      }
    }
  } else if (ONLINE.status === "lobby") {
    openOnlineRoomPage();
    if (departureMessage) {
      toast(departureMessage, "danger");
    }
  }

  updateOnlineLobbyUI();
}

async function processQueuedRoomSnapshots() {
  if (ONLINE.snapshotApplyInFlight) return;
  ONLINE.snapshotApplyInFlight = true;
  try {
    while (ONLINE.queuedSnapshot) {
      const nextSnapshot = ONLINE.queuedSnapshot;
      ONLINE.queuedSnapshot = null;
      try {
        await applyRoomSnapshot(nextSnapshot);
      } catch (err) {
        console.error(err);
        const detail = err?.message || err?.name || "Unknown error";
        const msg = `Failed to apply room updates: ${detail}`;
        updateOnlineStatus(msg, true);
        toast(msg, "danger");
      }
    }
  } finally {
    ONLINE.snapshotApplyInFlight = false;
  }
}

function attachRoomListener(roomId) {
  if (ONLINE.unsubRoom) ONLINE.unsubRoom();
  ONLINE.roomId = roomId;
  ONLINE.connected = true;
  ONLINE.lastDepartureNoticeId = "";
  ONLINE.lastSnapshotAt = Date.now();
  ONLINE.heartbeatInFlight = false;
  ONLINE.lastHeartbeatAt = 0;
  ONLINE.aiRunner = null;
  ONLINE.aiRunnerRequestAt = 0;
  ONLINE.pendingCardResolutions = 0;
  ONLINE.snapshotApplyInFlight = false;
  ONLINE.queuedSnapshot = null;
  const ref = FIREBASE.api.ref(FIREBASE.db, `rooms/${roomId}`);
  ONLINE.unsubRoom = FIREBASE.api.onValue(
    ref,
    (snap) => {
      if (!snap.exists()) {
        updateOnlineStatus("Room closed. You are now offline.", true);
        leaveOnlineRoom(false, false);
        return;
      }
      ONLINE.queuedSnapshot = snap.val();
      processQueuedRoomSnapshots();
    },
    (err) => {
      console.error(err);
      const msg = firebaseErrorMessage(
        err,
        "Failed to subscribe to room updates.",
      );
      updateOnlineStatus(msg, true);
    },
  );
  pulseRoomHeartbeat(true);
}

function updateOnlineLobbyUI() {
  const createBtn = document.getElementById("create-room-btn");
  const joinBtn = document.getElementById("join-room-btn");
  const leaveBtn = document.getElementById("leave-room-btn");
  const readyBtn = document.getElementById("ready-btn");
  const hostOpt = document.getElementById("host-options");
  const joinOpt = document.getElementById("join-options");
  const hostModeBtn = document.getElementById("mode-host-btn");
  const joinModeBtn = document.getElementById("mode-join-btn");

  if (hostModeBtn)
    hostModeBtn.style.background =
      ONLINE.mode === "host"
        ? "linear-gradient(135deg,#1e3a5f,#2563eb)"
        : "rgba(255,255,255,.12)";
  if (joinModeBtn)
    joinModeBtn.style.background =
      ONLINE.mode === "join"
        ? "linear-gradient(135deg,#1e3a5f,#2563eb)"
        : "rgba(255,255,255,.12)";
  if (hostModeBtn) hostModeBtn.disabled = ONLINE.connected;
  if (joinModeBtn) joinModeBtn.disabled = ONLINE.connected;
  if (hostOpt) hostOpt.style.display = ONLINE.mode === "host" ? "" : "none";
  if (joinOpt) joinOpt.style.display = ONLINE.mode === "join" ? "" : "none";

  if (createBtn) createBtn.disabled = !ONLINE.ready || ONLINE.connected;
  if (joinBtn) joinBtn.disabled = !ONLINE.ready || ONLINE.connected;
  if (leaveBtn) leaveBtn.disabled = !ONLINE.connected;
  if (readyBtn) {
    const me = lobbyPlayers.find((p) => p.uid === ONLINE.localUid);
    readyBtn.disabled = !ONLINE.connected || !me || ONLINE.status !== "lobby";
    readyBtn.textContent = me?.ready ? "❌ Unready" : "✅ Ready";
    readyBtn.style.background = me?.ready
      ? "linear-gradient(135deg,#7f1d1d,#c0392b)"
      : "linear-gradient(135deg,#92610e,var(--gold))";
  }

  if (ONLINE.connected) {
    const myName =
      lobbyPlayers.find((p) => p.uid === ONLINE.localUid)?.name ||
      getOnlinePlayerName();
    const playersIn = lobbyPlayers.filter((p) => p.uid).length;
    const readyIn = lobbyPlayers.filter((p) => p.uid && p.ready).length;
    const vis = ONLINE.visibility === "closed" ? "Closed" : "Open";
    updateOnlineStatus(
      `Room ${ONLINE.roomId} • ${vis} • ${readyIn}/${playersIn} ready • ${myName}${ONLINE.isHost ? " (Host)" : ""}.`,
    );
  } else if (ONLINE.ready) {
    updateOnlineStatus("Offline mode. Choose Host or Join.");
    if (ONLINE.mode === "join") refreshOpenRoomsList();
  }
}

async function createOnlineRoom() {
  if (!ONLINE.ready || !FIREBASE.api) {
    toast("Online service is not ready yet.", "danger");
    return;
  }
  if (ONLINE.connected) return;

  const myName = getOnlinePlayerName();
  ONLINE.localName = myName;
  const settings = defaultLobbySettings();
  const visibility =
    document.getElementById("room-visibility")?.value === "closed"
      ? "closed"
      : "open";
  const password = String(
    document.getElementById("host-room-password")?.value || "",
  ).trim();
  if (visibility === "closed" && password.length < 4) {
    toast("Closed room password must be at least 4 characters.", "danger");
    return;
  }

  let createdRoomId = null;
  let me = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidateRoomId = await generateUniqueRoomId();
    if (!candidateRoomId) break;

    let passwordHash = "";
    if (visibility === "closed") {
      try {
        passwordHash = await hashRoomPassword(candidateRoomId, password);
      } catch (err) {
        toast(
          err.message || "Unable to secure room password in this browser.",
          "danger",
        );
        return;
      }
    }

    const candidateRef = FIREBASE.api.ref(
      FIREBASE.db,
      `rooms/${candidateRoomId}`,
    );
    const candidateMe = {
      uid: ONLINE.localUid,
      name: myName,
      token: TOKENS[0],
      kind: "human",
      ready: false,
    };

    try {
      const result = await FIREBASE.api.runTransaction(
        candidateRef,
        (current) => {
          if (current) return;
          return {
            schemaVersion: ROOM_SCHEMA_VERSION,
            status: "lobby",
            hostUid: ONLINE.localUid,
            visibility,
            passwordHash,
            hasPassword: visibility === "closed",
            players: [candidateMe],
            playerUids: [ONLINE.localUid],
            settings,
            gameState: null,
            revision: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        },
      );
      if (!result.committed) continue;
      createdRoomId = candidateRoomId;
      me = candidateMe;
      break;
    } catch (err) {
      console.error(err);
      toast(
        firebaseErrorMessage(err, "Unable to create room right now."),
        "danger",
      );
      return;
    }
  }

  if (!createdRoomId || !me) {
    toast("Could not generate a unique room code. Please retry.", "danger");
    return;
  }

  lobbyPlayers = [me];
  attachRoomListener(createdRoomId);
  const codeEl = document.getElementById("join-room-code");
  if (codeEl) codeEl.value = createdRoomId;
  const hostPassEl = document.getElementById("host-room-password");
  if (hostPassEl) hostPassEl.value = "";
  openOnlineRoomPage();
  toast(`Room created: ${createdRoomId}`, "gold");
}

async function joinOnlineRoom() {
  if (!ONLINE.ready || !FIREBASE.api) {
    toast("Online service is not ready yet.", "danger");
    return;
  }
  if (ONLINE.connected) return;

  const codeEl = document.getElementById("join-room-code");
  const passEl = document.getElementById("join-room-password");
  const roomId = sanitizeRoomId(codeEl?.value || "");
  if (!isValidRoomId(roomId)) {
    toast("Enter a valid room code.", "danger");
    return;
  }
  if (codeEl) codeEl.value = roomId;

  const myName = getOnlinePlayerName();
  ONLINE.localName = myName;
  const roomRef = FIREBASE.api.ref(FIREBASE.db, `rooms/${roomId}`);
  const preSnap = await FIREBASE.api.get(roomRef);
  const baseRoom = preSnap.exists() ? preSnap.val() : null;
  if (!baseRoom) {
    toast("Room not found", "danger");
    return;
  }
  const entered = String(passEl?.value || "").trim();
  let enteredHash = "";
  if (entered) {
    try {
      enteredHash = await hashRoomPassword(roomId, entered);
    } catch (err) {
      toast(
        err.message || "Unable to verify room password in this browser.",
        "danger",
      );
      return;
    }
  }

  try {
    let txError = "";
    const result = await FIREBASE.api.runTransaction(roomRef, (data) => {
      const roomData = data && typeof data === "object" ? data : baseRoom;
      if (!roomData) {
        throw new Error("Room not found");
      }
      if (Number(roomData.schemaVersion || 0) !== ROOM_SCHEMA_VERSION) {
        txError =
          "Room is from an older version. Ask host to recreate the room.";
        return;
      }
      if ((roomData.status || "lobby") !== "lobby") {
        txError = "Game already started";
        return;
      }
      const isClosed = (roomData.visibility || "open") === "closed";
      const requiredHash = String(roomData.passwordHash || "");
      const requiredLegacyPassword = String(roomData.password || "");
      let needsPasswordMigration = false;
      if (isClosed) {
        if (!entered) {
          txError = "Password required for closed room";
          return;
        }
        const matchesHash = requiredHash ? enteredHash === requiredHash : false;
        const matchesLegacy = requiredLegacyPassword
          ? entered === requiredLegacyPassword
          : false;
        if (!matchesHash && !matchesLegacy) {
          txError = "Invalid room password";
          return;
        }
        needsPasswordMigration =
          !requiredHash && !!requiredLegacyPassword && matchesLegacy;
      }
      let players = indexedObjectToArray(roomData.players).filter(
        (p) => p && typeof p === "object",
      );
      const existingIdx = players.findIndex((p) => p.uid === ONLINE.localUid);
      if (existingIdx === -1) {
        if (players.length >= 8) {
          txError = "Room is full";
          return;
        }
        const token = tokenForPlayer(players, ONLINE.localUid);
        players = [
          ...players,
          {
            uid: ONLINE.localUid,
            name: myName,
            token,
            kind: "human",
            ready: false,
          },
        ];
      } else {
        const currentToken = sanitizeToken(
          players[existingIdx].token,
          TOKENS[existingIdx % TOKENS.length],
        );
        const otherTokens = new Set(
          players
            .filter((_, idx) => idx !== existingIdx)
            .map((p, i) => sanitizeToken(p.token, TOKENS[i % TOKENS.length])),
        );
        const token = otherTokens.has(currentToken)
          ? TOKENS.find((t) => !otherTokens.has(t)) || currentToken
          : currentToken;
        players[existingIdx] = {
          uid: ONLINE.localUid,
          name: myName,
          token,
          kind: "human",
          ready: false,
        };
      }
      return {
        ...roomData,
        players,
        playerUids: players.map((p) => p.uid).filter(Boolean),
        ...(needsPasswordMigration
          ? { passwordHash: enteredHash, password: "", hasPassword: true }
          : {}),
        updatedAt: Date.now(),
      };
    });
    if (!result.committed) throw new Error(txError || "Unable to join room.");
  } catch (err) {
    toast(
      firebaseErrorMessage(err, err.message || "Unable to join room."),
      "danger",
    );
    return;
  }

  attachRoomListener(roomId);
  if (passEl) passEl.value = "";
  openOnlineRoomPage();
  toast(`Joined room ${roomId}`, "gold");
}

function applyOnlineDepartureRuleToRoomData(
  roomData,
  leavingUid,
  leaveMode = "liquidation",
) {
  if (!roomData || typeof roomData !== "object") return roomData;

  const now = Date.now();
  const departureMode = leaveMode === "ai" ? "ai" : "liquidation";
  const allRoomPlayers = indexedObjectToArray(roomData.players).filter(
    (p) => p && typeof p === "object" && !!p.uid,
  );
  const leavingRoomPlayer =
    allRoomPlayers.find((p) => p.uid === leavingUid) || null;
  const remainingRoomPlayers = allRoomPlayers.filter(
    (p) => p.uid !== leavingUid,
  );

  if (!remainingRoomPlayers.length) return null;

  const leavingName = sanitizeName(leavingRoomPlayer?.name, "A player");
  const previousHostUid = String(roomData.hostUid || "");
  const keptHost =
    remainingRoomPlayers.find((p) => String(p.uid || "") === previousHostUid)
      ?.uid || null;
  const nextRevision = (Number(roomData.revision) || 0) + 1;
  const out = {
    ...roomData,
    players: remainingRoomPlayers,
    playerUids: remainingRoomPlayers.map((p) => p.uid).filter(Boolean),
    hostUid: keptHost || remainingRoomPlayers[0]?.uid || null,
    revision: nextRevision,
    updatedAt: now,
  };
  if (out.aiRunner && typeof out.aiRunner === "object") {
    if (String(out.aiRunner.uid || "") === String(leavingUid || "")) {
      out.aiRunner = null;
    }
  }

  if ((roomData.status || "lobby") !== "playing" || !roomData.gameState) {
    out.lastDepartureNotice = {
      id: `dep_${now}_${leavingUid}`,
      type: "leave-lobby",
      name: leavingName,
      message: `${leavingName} left the room.`,
      time: now,
    };
    return out;
  }

  const gs = JSON.parse(JSON.stringify(roomData.gameState || {}));
  const auctionsEnabled = sanitizeAuctionEnabled(
    gs.auctionEnabled,
    roomData?.settings?.auctionEnabled !== false,
  );
  gs.auctionEnabled = auctionsEnabled;
  const gamePlayers = indexedObjectToArray(gs.players).filter(
    (p) => p && typeof p === "object",
  );
  if (!gamePlayers.length) {
    out.gameState = gs;
    out.lastDepartureNotice = {
      id: `dep_${now}_${leavingUid}`,
      type: "leave-play",
      name: leavingName,
      message: `${leavingName} left the room.`,
      time: now,
    };
    return out;
  }

  gs.players = gamePlayers.map((p, i) => ({ ...p, id: i }));

  let quitterIdx = gs.players.findIndex((p) => p.uid === leavingUid);
  if (quitterIdx < 0 && leavingRoomPlayer?.token) {
    quitterIdx = gs.players.findIndex(
      (p) => String(p.token || "") === String(leavingRoomPlayer.token || ""),
    );
  }
  if (quitterIdx < 0 && leavingRoomPlayer?.name) {
    const targetName = sanitizeName(leavingRoomPlayer.name, "A player");
    quitterIdx = gs.players.findIndex(
      (p) => sanitizeName(p.name, "A player") === targetName,
    );
  }

  if (quitterIdx < 0) {
    const activeUids = remainingRoomPlayers.map((p) => p.uid).filter(Boolean);
    const unmatched = gs.players.filter(
      (p) => !p.bankrupt && normalizePlayerKind(p.kind) !== "ai" && !activeUids.includes(p.uid),
    );
    if (unmatched.length === 1) {
      quitterIdx = unmatched[0].id;
    }
  }

  if (quitterIdx < 0) {
    out.gameState = gs;
    out.lastDepartureNotice = {
      id: `dep_${now}_${leavingUid}`,
      type: "leave-play",
      name: leavingName,
      message: `${leavingName} left the room.`,
      time: now,
    };
    return out;
  }

  const quitter = gs.players[quitterIdx];
  const quitterName = sanitizeName(quitter.name, leavingName);

  if (departureMode === "ai") {
    quitter.uid = null;
    quitter.kind = "ai";
    quitter.name = `${quitterName} (AI)`;

    if (
      gs.pendingTrade &&
      (Number(gs.pendingTrade.fromId) === quitterIdx ||
        Number(gs.pendingTrade.toId) === quitterIdx)
    ) {
      gs.pendingTrade = null;
    }
    gs.pendingBuy = null;

    const aiMsg = `${quitterName} left the match. AI takeover is active.`;
    if (!Array.isArray(gs.log)) gs.log = [];
    gs.log.push({ text: aiMsg, type: "important", time: now });
    if (gs.log.length > GAME_LOG_LIMIT) gs.log = gs.log.slice(-GAME_LOG_LIMIT);

    out.lastDepartureNotice = {
      id: `dep_${now}_${leavingUid}`,
      type: "leave-ai",
      name: quitterName,
      message: aiMsg,
      time: now,
    };
    out.gameState = gs;
    out.status = "playing";
    return out;
  }

  const props = indexedObjectToArray(gs.properties);
  if (props.length < SPACES.length) props.length = SPACES.length;
  const queuedIds = [];
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (!prop || typeof prop !== "object") continue;
    if (prop.owner === null || prop.owner === undefined) continue;
    const ownerN = Number(prop.owner);
    if (!Number.isInteger(ownerN) || ownerN !== quitterIdx) continue;
    prop.owner = null;
    prop.houses = 0;
    prop.hotel = false;
    prop.mortgaged = false;
    queuedIds.push(i);
  }
  gs.properties = props;

  quitter.money = 0;
  quitter.inJail = false;
  quitter.jailTurns = 0;
  quitter.doublesCount = 0;
  quitter.bankrupt = true;
  markPlayerBankruptStanding(quitter, gs);
  quitter.uid = null;
  quitter.properties = [];
  quitter.railroads = [];
  quitter.utilities = [];
  quitter.name = `${quitterName} (Left)`;

  gs.players.forEach((pl, idx) => {
    const ownedProps = [];
    const ownedRail = [];
    const ownedUtil = [];
    for (let pid = 0; pid < props.length; pid++) {
      const prop = props[pid];
      if (!prop || prop.owner === null || prop.owner === undefined) continue;
      const propOwnerN = Number(prop.owner);
      if (!Number.isInteger(propOwnerN) || propOwnerN !== idx) continue;
      const sp = SPACES[pid];
      if (!sp) continue;
      if (sp.type === "property") ownedProps.push(pid);
      else if (sp.type === "railroad") ownedRail.push(pid);
      else if (sp.type === "utility") ownedUtil.push(pid);
    }
    pl.properties = ownedProps;
    pl.railroads = ownedRail;
    pl.utilities = ownedUtil;
  });

  if (
    gs.pendingTrade &&
    (Number(gs.pendingTrade.fromId) === quitterIdx ||
      Number(gs.pendingTrade.toId) === quitterIdx)
  ) {
    gs.pendingTrade = null;
  }
  gs.pendingBuy = null;

  if (auctionsEnabled) {
    let queue = indexedObjectToArray(gs.bankAuctionQueue)
      .map(Number)
      .filter(Number.isInteger);
    queuedIds.forEach((id) => {
      if (!queue.includes(id)) queue.push(id);
    });
    gs.bankAuctionQueue = queue;

    if (gs.auctionState && typeof gs.auctionState === "object") {
      const auctionPropId = Number(gs.auctionState.propId);
      if (
        Number.isInteger(auctionPropId) &&
        props[auctionPropId] &&
        props[auctionPropId].owner === null
      ) {
        if (!gs.bankAuctionQueue.includes(auctionPropId))
          gs.bankAuctionQueue.unshift(auctionPropId);
      }
      gs.auctionState = null;
    }
  } else {
    gs.bankAuctionQueue = [];
    gs.auctionState = null;
  }

  const activeIds = gs.players.filter((p) => !p.bankrupt).map((p) => p.id);
  if (activeIds.length) {
    const curN = Number(gs.currentPlayerIdx);
    if (!Number.isInteger(curN) || !activeIds.includes(curN)) {
      gs.currentPlayerIdx = activeIds[0];
      gs.phase = "roll";
    }
  }

  if (activeIds.length <= 1) {
    gs.gameOver = true;
    gs.pendingBuy = null;
    gs.pendingTrade = null;
    gs.auctionState = null;
    gs.bankAuctionQueue = [];

    const winner = gs.players.find((p) => !p.bankrupt);
    const endMsg = winner
      ? `${quitterName} left the match. ${winner.name} wins by default.`
      : `${quitterName} left the match. Match ended.`;

    out.lastDepartureNotice = {
      id: `dep_${now}_${leavingUid}`,
      type: "leave-end",
      name: quitterName,
      winnerName: winner?.name || "",
      message: endMsg,
      time: now,
    };
  } else {
    if (auctionsEnabled) {
      while (gs.bankAuctionQueue.length && !gs.auctionState) {
        const nextId = Number(gs.bankAuctionQueue[0]);
        if (
          !Number.isInteger(nextId) ||
          !props[nextId] ||
          props[nextId].owner !== null
        ) {
          gs.bankAuctionQueue.shift();
          continue;
        }
        const bidderStartIdx = activeIds.includes(Number(gs.currentPlayerIdx))
          ? activeIds.indexOf(Number(gs.currentPlayerIdx))
          : 0;
        gs.auctionState = {
          propId: nextId,
          propName: SPACES[nextId]?.name || "Property",
          currentBid: getAuctionOpeningBid(SPACES[nextId]?.price),
          highBidder: null,
          passed: [],
          bidderIdx: bidderStartIdx,
          activePlayers: activeIds,
          source: "bank",
        };
        gs.bankAuctionQueue.shift();
      }
    }

    const liquidatedCount = queuedIds.length;
    const liquidatedMsg =
      liquidatedCount > 0
        ? auctionsEnabled
          ? `${quitterName} left the match. Bank liquidated assets and queued ${liquidatedCount} ${liquidatedCount === 1 ? "property" : "properties"} for auction.`
          : `${quitterName} left the match. Bank liquidated ${liquidatedCount} ${liquidatedCount === 1 ? "property" : "properties"} to unsold bank inventory (auction disabled).`
        : `${quitterName} left the match. Bank liquidated assets.`;

    out.lastDepartureNotice = {
      id: `dep_${now}_${leavingUid}`,
      type: "leave-liquidation",
      name: quitterName,
      auctionsQueued: auctionsEnabled ? liquidatedCount : 0,
      message: liquidatedMsg,
      time: now,
    };

    if (!Array.isArray(gs.log)) gs.log = [];
    gs.log.push({ text: liquidatedMsg, type: "important", time: now });
    if (gs.log.length > GAME_LOG_LIMIT) gs.log = gs.log.slice(-GAME_LOG_LIMIT);
    gs.gameOver = false;
  }

  out.gameState = gs;
  out.status = "playing";
  return out;
}

function openLeaveGameModal() {
  if (!isOnlineGame()) {
    toast("Online game only.", "danger");
    return;
  }
  if (ONLINE.status !== "playing") {
    leaveOnlineRoom(true, true).catch((err) => {
      console.error(err);
      toast("Could not leave room cleanly.", "danger");
    });
    return;
  }
  openOverlay("leave-game-overlay");
}

async function confirmLeaveOnlineGame(mode) {
  const leaveMode = mode === "ai" ? "ai" : "liquidation";
  closeOverlay("leave-game-overlay");
  try {
    await leaveOnlineRoom(true, true, leaveMode);
  } catch (err) {
    console.error(err);
    toast("Could not leave the match.", "danger");
  }
}

async function leaveOnlineRoom(
  showToast = true,
  mutateRoom = true,
  leaveMode = "liquidation",
) {
  if (!ONLINE.connected || !FIREBASE.api) {
    LOBBY_CONTEXT = "online";
    clearLogArchive(0);
    ONLINE.connected = false;
    ONLINE.roomId = null;
    ONLINE.isHost = false;
    ONLINE.hostUid = null;
    ONLINE.visibility = "open";
    ONLINE.status = "offline";
    ONLINE.lastDepartureNoticeId = "";
    ONLINE.lastSnapshotAt = 0;
    ONLINE.heartbeatInFlight = false;
    ONLINE.lastHeartbeatAt = 0;
    ONLINE.aiRunner = null;
    ONLINE.aiRunnerRequestAt = 0;
    ONLINE.pendingCardResolutions = 0;
    ONLINE.snapshotApplyInFlight = false;
    ONLINE.queuedSnapshot = null;
    updateOnlineLobbyUI();
    showScreen("online-screen");
    return;
  }

  const wasPlaying = ONLINE.status === "playing";

  const roomId = ONLINE.roomId;
  const roomRef = FIREBASE.api.ref(FIREBASE.db, `rooms/${roomId}`);
  if (mutateRoom) {
    try {
      await FIREBASE.api.runTransaction(roomRef, (data) =>
        applyOnlineDepartureRuleToRoomData(data, ONLINE.localUid, leaveMode),
      );
    } catch (err) {
      console.error(err);
    }
  }

  if (ONLINE.unsubRoom) ONLINE.unsubRoom();
  ONLINE.unsubRoom = null;
  clearLogArchive(0);
  ONLINE.connected = false;
  ONLINE.roomId = null;
  ONLINE.isHost = false;
  ONLINE.hostUid = null;
  ONLINE.visibility = "open";
  ONLINE.status = "offline";
  ONLINE.revision = 0;
  ONLINE.lastDepartureNoticeId = "";
  ONLINE.lastSnapshotAt = 0;
  ONLINE.heartbeatInFlight = false;
  ONLINE.lastHeartbeatAt = 0;
  ONLINE.aiRunner = null;
  ONLINE.aiRunnerRequestAt = 0;
  ONLINE.pendingCardResolutions = 0;
  ONLINE.snapshotApplyInFlight = false;
  ONLINE.queuedSnapshot = null;
  LOBBY_CONTEXT = "online";
  updateOnlineLobbyUI();
  renderLobby();
  showScreen("online-screen");
  if (showToast)
    toast(wasPlaying ? "You left the match." : "Left online room.", "gold");
}

function renderLobby() {
  const el = document.getElementById("player-slots");
  el.innerHTML = "";
  const online = isOnlineGame();
  const showOnlinePanel = online || LOBBY_CONTEXT === "online";
  const onlinePanel = document.getElementById("online-room-panel");
  if (onlinePanel) onlinePanel.style.display = showOnlinePanel ? "" : "none";
  const taglineEl = document.getElementById("lobby-context-tagline");
  if (taglineEl)
    taglineEl.textContent = showOnlinePanel
      ? "✦ Online Room Lobby ✦"
      : "✦ Local Multiplayer ✦";

  lobbyPlayers.forEach((p, i) => {
    const kind = normalizePlayerKind(p.kind);
    p.kind = kind;
    const div = document.createElement("div");
    div.className = "player-slot active";
    const isMe = p.uid && p.uid === ONLINE.localUid;
    const editable = !online || isMe;
    const readOnlyAttr = editable ? "" : "readonly";
    const removeBtn =
      !online && editable && i >= 2
        ? `<button class="remove-btn" onclick="removePlayer(${i})">✕</button>`
        : "";
    const pColor = TOKEN_COLORS[i % TOKEN_COLORS.length];
    const safeName = escAttr(p.name);
    const readyBadge =
      online && p.uid
        ? `<span style="margin-left:.3rem;font-size:.72rem;padding:.1rem .35rem;border-radius:10px;background:${p.ready ? "rgba(45,160,90,.3)" : "rgba(127,29,29,.3)"};color:${p.ready ? "#86efac" : "#fca5a5"}">${p.ready ? "READY" : "NOT READY"}</span>`
        : "";
    const typeSelect = !online
      ? `<select class="type-select" title="Player type" onchange="onLobbyTypeChange(${i}, this.value)">
           <option value="human" ${kind === "human" ? "selected" : ""}>🙂 Human</option>
           <option value="ai" ${kind === "ai" ? "selected" : ""}>🤖 AI</option>
         </select>`
      : "";
    const tokenControls =
      online && isMe
        ? `<div style="display:flex;gap:.25rem"><button class="btn btn-sm" style="padding:.2rem .35rem;background:rgba(255,255,255,.12);color:#fff" onclick="cycleMyToken(-1)">◀</button><button class="btn btn-sm" style="padding:.2rem .35rem;background:rgba(255,255,255,.12);color:#fff" onclick="cycleMyToken(1)">▶</button></div>`
        : "";
    div.innerHTML = `
      <div class="token-preview" style="color:${pColor}">${p.token}</div>
      <input class="name-input" value="${safeName}" placeholder="${escAttr(defaultLobbyPlayerName(i, kind))}" onchange="onLobbyNameChange(${i}, this.value)" ${readOnlyAttr} style="color:${pColor};${editable ? "" : "opacity:.8;cursor:not-allowed"}">
      ${readyBadge}
      ${typeSelect}
      ${tokenControls}
      ${removeBtn}
    `;
    el.appendChild(div);
  });

  const addBtn = document.getElementById("add-player-btn");
  const addAiBtn = document.getElementById("add-ai-btn");
  const hideAddButtons = online || lobbyPlayers.length >= 8;
  if (addBtn) addBtn.style.display = hideAddButtons ? "none" : "";
  if (addAiBtn) addAiBtn.style.display = hideAddButtons ? "none" : "";

  const onlineNameInput = document.getElementById("online-player-name");
  if (onlineNameInput && !onlineNameInput.value) {
    onlineNameInput.value = lobbyPlayers[0]?.name || "Player 1";
  }

  const hostEditable = !online || ONLINE.isHost;
  ["starting-money", "max-houses", "lobby-timer", "auction-enabled"].forEach(
    (id) => {
      const input = document.getElementById(id);
      if (input) input.disabled = !hostEditable;
    },
  );

  const startBtn = document.getElementById("start-btn");
  const connectedPlayers = lobbyPlayers.filter((p) => p.uid).length;
  const allReady =
    connectedPlayers >= 2 &&
    lobbyPlayers.filter((p) => p.uid).every((p) => p.ready);
  if (startBtn) {
    if (online) {
      startBtn.textContent = ONLINE.isHost
        ? allReady
          ? "🚀 Launch Game"
          : "⏳ Waiting for Ready"
        : "⏳ Waiting for Host";
      startBtn.disabled = !ONLINE.isHost || !allReady;
    } else {
      startBtn.textContent = "🎮 Start Game";
      startBtn.disabled = lobbyPlayers.length < 2;
    }
  }

  const roomPlayersEl = document.getElementById("online-room-players");
  if (roomPlayersEl) {
    if (!online) {
      roomPlayersEl.innerHTML = "";
    } else {
      roomPlayersEl.innerHTML = lobbyPlayers
        .filter((p) => p.uid)
        .map((p, i) => {
          const mine = p.uid === ONLINE.localUid;
          const host = p.uid === ONLINE.hostUid;
          return `<div class="online-connected-player">
          <div class="online-connected-name">${escHtml(p.token || "🎲")} ${escHtml(p.name)}${host ? " (Host)" : ""}${mine ? " (You)" : ""}</div>
          <div class="online-connected-ready ${p.ready ? "is-ready" : "is-not-ready"}">${p.ready ? "READY" : "NOT READY"}</div>
        </div>`;
        })
        .join("");
    }
  }

  refreshStartingMoneyUi(selectedThemeId, false);
  updateOnlineLobbyUI();
  renderBoardThemeSelector();
  refreshCustomBoardPanel();
}

function onLobbyNameChange(i, value) {
  const fallback = defaultLobbyPlayerName(
    i,
    normalizePlayerKind(lobbyPlayers[i]?.kind),
  );
  const clean = sanitizeName(value, fallback);
  lobbyPlayers[i].name = clean;
  if (isOnlineGame() && lobbyPlayers[i].uid === ONLINE.localUid) {
    updateLocalPlayerProfile({ name: clean, ready: false }).catch((err) => {
      console.error(err);
      toast("Could not update name right now.", "danger");
    });
  }
}

function onLobbyTypeChange(i, kind) {
  if (isOnlineGame()) return;
  const player = lobbyPlayers[i];
  if (!player) return;

  const prevKind = normalizePlayerKind(player.kind);
  const nextKind = normalizePlayerKind(kind);
  player.kind = nextKind;

  const prevDefault = defaultLobbyPlayerName(i, prevKind);
  const nextDefault =
    nextKind === "ai"
      ? pickRandomAiPlaceholderName(i)
      : defaultLobbyPlayerName(i, nextKind);
  const humanDefault = defaultLobbyPlayerName(i, "human");
  const currentName = sanitizeName(player.name, prevDefault);
  if (
    !currentName ||
    currentName === prevDefault ||
    currentName === humanDefault ||
    isAiPlaceholderName(currentName)
  ) {
    player.name = nextDefault;
  }

  renderLobby();
}

function addPlayerSlot(kind = "human") {
  if (isOnlineGame()) {
    toast("In online mode, players join with room code.", "danger");
    return;
  }
  if (lobbyPlayers.length >= 8) return;
  const i = lobbyPlayers.length;
  const nextKind = normalizePlayerKind(kind);
  const defaultName =
    nextKind === "ai"
      ? pickRandomAiPlaceholderName(-1)
      : defaultLobbyPlayerName(i, nextKind);
  lobbyPlayers.push({
    uid: null,
    name: defaultName,
    token: TOKENS[i],
    kind: nextKind,
  });
  renderLobby();
}

function removePlayer(i) {
  if (isOnlineGame()) return;
  lobbyPlayers.splice(i, 1);
  renderLobby();
}

async function startGame() {
  clearOfflineAiTimer(true);
  const names = lobbyPlayers.map((p, i) => ({
    uid: p.uid || null,
    name: sanitizeName(
      document.querySelectorAll(".name-input")[i]?.value || p.name,
      defaultLobbyPlayerName(i, normalizePlayerKind(p.kind)),
    ),
    kind: isOnlineGame() ? "human" : normalizePlayerKind(p.kind),
    token: sanitizeToken(p.token, TOKENS[i % TOKENS.length]),
    ready: !!p.ready,
  }));

  if (isOnlineGame()) {
    if (!ONLINE.isHost) {
      toast("Only host can start the online game.", "danger");
      return;
    }
    const snap = await FIREBASE.api.get(getRoomRef());
    if (!snap.exists()) {
      toast("Room no longer exists.", "danger");
      return;
    }
    const serverRoom = snap.val() || {};
    if ((serverRoom.hostUid || null) !== ONLINE.localUid) {
      toast("Host changed. Only current host can start.", "danger");
      return;
    }
    const serverPlayers = (serverRoom.players || []).filter((p) => p.uid);
    const allReady =
      serverPlayers.length >= 2 && serverPlayers.every((p) => !!p.ready);
    if (!allReady) {
      toast("All players must be ready before launch.", "danger");
      return;
    }
    if (serverPlayers.length < 2) {
      toast("At least 2 players are required.", "danger");
      return;
    }
    names.length = 0;
    serverPlayers.forEach((p, i) => {
      names.push({
        uid: p.uid || null,
        name: sanitizeName(p.name, `Player ${i + 1}`),
        kind: "human",
        token: sanitizeToken(p.token, TOKENS[i % TOKENS.length]),
        ready: !!p.ready,
      });
    });
  }

  if (
    selectedThemeId === CUSTOM_BOARD_THEME_ID &&
    !BOARD_THEMES[CUSTOM_BOARD_THEME_ID]
  ) {
    const seedInput = document.getElementById("custom-board-seed");
    const candidateSeed = String(
      seedInput?.value ||
        ACTIVE_CUSTOM_BOARD_SEED ||
        getStoredCustomBoardSeed() ||
        "",
    ).trim();
    if (!candidateSeed) {
      toast("Load a custom board seed before starting.", "danger");
      return;
    }
    const loaded = applyCustomBoardSeed(candidateSeed, {
      persist: true,
      quiet: false,
    });
    if (!loaded) return;
  }

  const parsedStartMoney = Number.parseInt(
    document.getElementById("starting-money").value,
    10,
  );
  const startMoney =
    Number.isFinite(parsedStartMoney) && parsedStartMoney > 0
      ? parsedStartMoney
      : getThemeStartMoneyDefault(selectedThemeId);
  TIMER.duration = parseInt(document.getElementById("lobby-timer").value) || 0;
  const auctionEnabled = sanitizeAuctionEnabled(
    document.getElementById("auction-enabled")?.value,
    true,
  );

  // Apply selected theme
  applyThemeById(selectedThemeId);
  const t = getThemeById(selectedThemeId);

  initGameState(names, startMoney, { auctionEnabled });
  buildBoard();
  renderAll();
  showScreen("game-screen");
  addLog(
    `Game started with ${G.players.length} players! ${t.currency}${fmt(startMoney)} starting money. Board: ${t.flag} ${t.name}`,
    "important",
  );
  if (auctionEnabled) {
    addLog(
      `🔨 Auctions enabled. Opening bid starts around ${AUCTION_OPENING_MIN_PERCENT}%–${AUCTION_OPENING_MAX_PERCENT}% of base property price.`,
      "important",
    );
  } else {
    addLog(
      "🔕 Auctions disabled. Unpurchased properties remain unsold.",
      "important",
    );
  }
  if (TIMER.duration > 0)
    addLog(`⏱ Auto-advance timer: ${TIMER.duration}s`, "important");
  updateActionButtons();

  if (isOnlineGame()) {
    await syncRoomState("host-start");
  }
}

