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
  try {
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
          lastReason: reason || "sync",
        };
        if (nextSettings) out.settings = nextSettings;
        return out;
      },
    );

    if (txResult?.committed) {
      ONLINE.revision = nextRevision;
    }
  } catch (err) {
    console.error(err);
    toast(firebaseErrorMessage(err, "Failed to sync room state."), "danger");
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

// ═══════════════════════════════════════════════
//  BOARD BUILDER
// ═══════════════════════════════════════════════
function buildBoard() {
  const board = document.getElementById("game-board");
  board.innerHTML = "";

  const die1Value = Number.isInteger(Number(G?.dice?.[0]))
    ? Math.max(1, Math.min(6, Number(G.dice[0])))
    : 1;
  const die2Value = Number.isInteger(Number(G?.dice?.[1]))
    ? Math.max(1, Math.min(6, Number(G.dice[1])))
    : 1;

  SPACES.forEach((s) => {
    const el = document.createElement("div");
    el.className = "space";
    el.id = `sp${s.id}`;
    el.onclick = () => showSpaceInfo(s.id);

    let inner = "";
    if (s.type === "property") {
      const c = COLOR[s.color];
      inner = `<div class="color-bar" style="background:${c};height:18%"></div>
               <div class="sp-name">${s.name}</div>
               <div class="sp-price">${fmtCurrency(s.price)}</div>`;
    } else if (s.type === "railroad") {
      inner = `<div class="sp-icon">🚂</div><div class="sp-name">${s.name}</div><div class="sp-price">${fmtCurrency(s.price)}</div>`;
    } else if (s.type === "utility") {
      inner = `<div class="sp-icon">${s.icon}</div><div class="sp-name">${s.name}</div><div class="sp-price">${fmtCurrency(s.price)}</div>`;
    } else if (s.type === "go") {
      inner = `<div class="sp-name"><div style="font-size:1.6em">🏁</div><div style="color:#c0392b;font-weight:900;font-size:1.1em;font-family:'Times New Roman',Georgia,serif">GO</div><div style="font-size:.65em;color:#1a5c1a">Collect ${(window.ACTIVE_THEME || BOARD_THEMES.dhaka).currency}${(window.ACTIVE_THEME || BOARD_THEMES.dhaka).goSalary}</div></div>`;
    } else if (s.type === "jail") {
      inner = `<div class="sp-name"><div style="font-size:1.2em">⛓️</div><div style="font-family:'Times New Roman',Georgia,serif;font-weight:700">JAIL</div><div style="font-size:.75em">Just Visiting</div></div>`;
    } else if (s.type === "parking") {
      inner = `<div class="sp-name"><div style="font-size:1.5em">🅿️</div><div style="font-family:'Times New Roman',Georgia,serif;font-weight:700">FREE</div><div style="font-size:.75em">Parking</div></div>`;
    } else if (s.type === "gotojail") {
      inner = `<div class="sp-name"><div style="font-size:1.3em">🚔</div><div style="color:#c0392b;font-size:.9em;font-family:'Times New Roman',Georgia,serif">GO TO</div><div style="color:#c0392b;font-weight:900;font-family:'Times New Roman',Georgia,serif">JAIL</div></div>`;
    } else if (s.type === "chance") {
      inner = `<div class="sp-name"><div style="font-size:1.5em">❓</div><div style="color:#e67e22;font-weight:700;font-family:'Times New Roman',Georgia,serif">CHANCE</div></div>`;
    } else if (s.type === "community") {
      inner = `<div class="sp-name"><div style="font-size:1.3em">📦</div><div style="font-size:.75em;color:#2563eb;font-weight:700;font-family:'Times New Roman',Georgia,serif">COMMUNITY</div><div style="font-size:.7em;color:#2563eb;font-family:'Times New Roman',Georgia,serif">CHEST</div></div>`;
    } else if (s.type === "tax") {
      inner = `<div class="sp-name"><div style="font-size:1.3em">${s.icon}</div><div style="font-size:.8em;font-family:'Times New Roman',Georgia,serif;font-weight:700">${s.name}</div><div class="sp-price">${fmtCurrency(s.amount)}</div></div>`;
    }
    el.innerHTML = inner;
    board.appendChild(el);
  });

  // Center area
  const center = document.createElement("div");
  center.className = "center-area";
  const t = window.ACTIVE_THEME || BOARD_THEMES.dhaka;
  center.innerHTML = `
    <div class="center-title">MONOPOLY</div>
    <div class="center-sub">${t.flag} ${t.name.toUpperCase()} EDITION</div>
    <div class="dice-row">
      <div class="die" id="die1" data-v="${die1Value}">${'<span class="dot"></span>'.repeat(7)}</div>
      <div class="die" id="die2" data-v="${die2Value}">${'<span class="dot"></span>'.repeat(7)}</div>
    </div>
    <button id="roll-btn" onclick="rollDice()">🎲 Roll Dice</button>
    <div id="center-msg" style="font-size:clamp(.6rem,1.2vmin,.8rem);color:#1a5c1a;margin-top:.3rem;font-weight:700;font-family:'Times New Roman',Georgia,serif"></div>
  `;
  board.appendChild(center);
}

function renderDiceFromState() {
  const d1 = Number.isInteger(Number(G?.dice?.[0]))
    ? Math.max(1, Math.min(6, Number(G.dice[0])))
    : 1;
  const d2 = Number.isInteger(Number(G?.dice?.[1]))
    ? Math.max(1, Math.min(6, Number(G.dice[1])))
    : 1;
  const die1 = document.getElementById("die1");
  const die2 = document.getElementById("die2");
  if (die1) die1.dataset.v = String(d1);
  if (die2) die2.dataset.v = String(d2);
}

// ═══════════════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════════════
function renderAll() {
  renderPlayerCards();
  renderMarkers();
  renderBoardOwnership();
  renderDiceFromState();
  renderGameLog();
  renderChatLog();
  syncAuctionOverlay();
  updateTopBar();
  updateActionButtons();
  maybeScheduleOfflineAiTurn();
}

function syncAuctionOverlay() {
  const overlay = document.getElementById("auction-overlay");
  if (!overlay) return;

  if (G?.gameOver) {
    closeOverlay("auction-overlay");
    return;
  }

  if (G.auctionState) {
    renderAuction();
    openOverlay("auction-overlay");
  } else {
    closeOverlay("auction-overlay");
  }
}

function renderGameLog() {
  const el = document.getElementById("game-log");
  if (!el || !Array.isArray(G.log)) return;
  appendLogsToArchive(G.log);
  el.innerHTML = G.log
    .map((l) => {
      const ts = l.time ? new Date(l.time) : new Date();
      const hh = ts.getHours().toString().padStart(2, "0");
      const mm = ts.getMinutes().toString().padStart(2, "0");
      const cls = l.type ? ` log-${l.type}` : "";
      return `<div class="log-entry${cls}"><span class="log-time">${hh}:${mm}</span>${escHtml(l.text || "")}</div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
}

function renderChatLog() {
  const el = document.getElementById("chat-log");
  if (!el || !G.chat) return;
  el.innerHTML = G.chat
    .map((m) => {
      const whoColor = sanitizeColor(m.color, "#ffffff");
      const token = escHtml(String(m.token || "💬"));
      const who = escHtml(m.name || "Player");
      const text = escHtml(m.text || "");
      return `<div class="chat-msg"><span class="chat-who" style="color:${whoColor}">${token} ${who}:</span><span class="chat-text">${text}</span></div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
}

function renderPlayerCards() {
  const el = document.getElementById("player-cards");
  const mobileEl = document.getElementById("mobile-player-strip");
  if (el) el.innerHTML = "";
  if (mobileEl) mobileEl.innerHTML = "";

  G.players.forEach((p, i) => {
    const active = i === G.currentPlayerIdx;
    const bankruptCls = p.bankrupt ? " bankrupt" : "";
    const propDots =
      p.properties
        .map((pid) => {
          const sp = SPACES[pid];
          return `<div class="pprop-dot" style="background:${COLOR[sp.color]}" title="${sp.name}"></div>`;
        })
        .join("") +
      p.railroads
        .map(
          () =>
            `<div class="pprop-dot" style="background:#333" title="Railroad"></div>`,
        )
        .join("");
    const location = p.inJail ? "In Jail" : SPACES[p.pos]?.name || "On board";

    if (el) {
      const div = document.createElement("div");
      div.className = "pcard" + (active ? " active-turn" : "") + bankruptCls;
      div.innerHTML = `
        <div class="prow1">
          <div class="ptoken" style="color:${p.color}">${p.token}</div>
          <div class="pname">${p.name}${isAiPlayer(p) ? " 🤖" : ""}${p.bankrupt ? " 💀" : ""}</div>
          <div class="pmoney">${fmtCurrency(p.money)}</div>
        </div>
        <div class="ppos">${p.inJail ? "⛓️ In Jail" : `📍 ${SPACES[p.pos].name}`}</div>
        ${propDots ? `<div class="pprops">${propDots}</div>` : ""}
      `;
      div.title = `Tap to view ${p.name}'s portfolio and money log`;
      div.onclick = () => showPlayerPortfolio(i);
      el.appendChild(div);
    }

    if (mobileEl) {
      const chip = document.createElement("div");
      chip.className =
        "mobile-player-chip" + (active ? " active-turn" : "") + bankruptCls;
      chip.innerHTML = `
        <div class="mobile-player-main">
          <span class="mobile-player-token" style="color:${p.color}">${p.token}</span>
          <span class="mobile-player-name">${escHtml(p.name)}${isAiPlayer(p) ? " 🤖" : ""}${p.bankrupt ? " 💀" : ""}</span>
        </div>
        <div class="mobile-player-meta">${fmtCurrency(p.money)} • ${escHtml(location)}</div>
      `;
      chip.title = `Tap to view ${p.name}'s portfolio and money log`;
      chip.onclick = () => showPlayerPortfolio(i);
      mobileEl.appendChild(chip);
    }
  });
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pulseBoardSpace(spaceId, className, duration = 320) {
  const spEl = document.getElementById(`sp${spaceId}`);
  if (!spEl || !className) return;
  spEl.classList.remove(className);
  void spEl.offsetWidth;
  spEl.classList.add(className);
  setTimeout(() => {
    spEl.classList.remove(className);
  }, duration);
}

function animatePropertyPurchase(spaceId) {
  pulseBoardSpace(spaceId, "buy-celebrate", 930);
}

async function playRemoteSnapshotAnimations(prevVisualState, options = {}) {
  if (!isOnlineGame() || !prevVisualState || REMOTE_FX.running) return;
  if (!Array.isArray(G.players) || !G.players.length) return;

  const expectedRevision =
    Number(options.expectedRevision) || Number(ONLINE.revision) || 0;
  const expectedEpoch =
    Number(options.expectedEpoch) || Number(REMOTE_FX.epoch) || 0;
  const shouldAbort = () => {
    if (!isOnlineGame()) return true;
    if (Number(REMOTE_FX.epoch) !== expectedEpoch) return true;
    if (ONLINE.queuedSnapshot) return true;
    return (Number(ONLINE.revision) || 0) !== expectedRevision;
  };

  if (shouldAbort()) return;

  REMOTE_FX.running = true;
  try {
    if (shouldAbort()) return;
    const beforePlayers = Array.isArray(prevVisualState.players)
      ? prevVisualState.players
      : [];
    const localIdx = resolveLocalPlayerIndex();
    let mover = null;

    for (let i = 0; i < G.players.length; i++) {
      if (i === localIdx) continue;
      const before = beforePlayers[i];
      const now = G.players[i];
      if (!before || !now || now.bankrupt) continue;

      const from = before.inJail ? 10 : before.pos;
      const to = now.inJail ? 10 : now.pos;
      const changed = from !== to || !!before.inJail !== !!now.inJail;
      if (!changed) continue;

      const stepsForward = (to - from + 40) % 40;
      mover = {
        id: i,
        from,
        to,
        stepsForward,
        stepAnim: !now.inJail && stepsForward > 0 && stepsForward <= 12,
      };
      break;
    }

    if (shouldAbort()) return;

    if (mover) {
      const liveStart = getLivePlayer(mover.id);
      if (liveStart) {
        const finalPos = liveStart.pos;
        const finalInJail = liveStart.inJail;
        liveStart.inJail = false;
        liveStart.pos = mover.from;
        renderMarkers();

        if (mover.stepAnim) {
          await waitMs(70);
          if (shouldAbort()) return;
          await animatePlayerStepMovement(mover.id, mover.stepsForward, {
            canContinue: () => !shouldAbort(),
          });
        } else {
          pulseBoardSpace(mover.to, "step-arrive", 360);
          await waitMs(220);
        }

        if (shouldAbort()) return;
        const liveEnd = getLivePlayer(mover.id);
        if (liveEnd) {
          liveEnd.pos = finalPos;
          liveEnd.inJail = finalInJail;
          renderMarkers();
        }
      }
    }

    if (shouldAbort()) return;

    const prevOwners = Array.isArray(prevVisualState.owners)
      ? prevVisualState.owners
      : [];
    const bought = [];
    for (let id = 0; id < G.properties.length; id++) {
      const prop = G.properties[id];
      if (!prop || typeof prop !== "object") continue;

      const oldOwner =
        prevOwners[id] === null || prevOwners[id] === undefined
          ? null
          : Number.isInteger(Number(prevOwners[id]))
            ? Number(prevOwners[id])
            : null;
      const newOwner =
        prop.owner === null || prop.owner === undefined
          ? null
          : Number.isInteger(Number(prop.owner))
            ? Number(prop.owner)
            : null;

      if (oldOwner === null && newOwner !== null && newOwner !== localIdx) {
        bought.push(id);
      }
    }

    for (let i = 0; i < bought.length; i++) {
      if (shouldAbort()) return;
      animatePropertyPurchase(bought[i]);
      if (i < bought.length - 1) await waitMs(120);
    }
  } finally {
    REMOTE_FX.running = false;
  }
}

function renderMarkers(hopPlayerId = null) {
  // Remove old markers
  document.querySelectorAll(".pmarker").forEach((m) => m.remove());
  // Group players by position
  const byPos = {};
  G.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const pos = p.inJail ? 10 : p.pos;
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push({ p, i });
  });
  G.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const pos = p.inJail ? 10 : p.pos;
    const spEl = document.getElementById(`sp${pos}`);
    if (!spEl) return;
    const group = byPos[pos];
    const idx = group.findIndex((x) => x.i === i);
    const marker = document.createElement("div");
    marker.className = "pmarker";
    if (i === G.currentPlayerIdx) marker.classList.add("current-turn");
    if (Number.isInteger(hopPlayerId) && i === hopPlayerId)
      marker.classList.add("step-hop");
    marker.id = `pmarker-${i}`;
    marker.textContent = p.token;
    marker.style.background = p.color;
    // Offset multiple players
    const offsets = [
      { top: "6%", left: "6%" },
      { top: "6%", left: "52%" },
      { top: "52%", left: "6%" },
      { top: "52%", left: "52%" },
      { top: "28%", left: "28%" },
      { top: "68%", left: "68%" },
      { top: "68%", left: "10%" },
      { top: "10%", left: "68%" },
    ];
    const off = offsets[idx % offsets.length];
    marker.style.top = off.top;
    marker.style.left = off.left;
    spEl.appendChild(marker);
  });
}

async function animatePlayerStepMovement(player, steps, options = {}) {
  const startPlayer = getLivePlayer(player);
  if (!startPlayer || !Number.isInteger(steps) || steps <= 0) return false;
  const playerId = startPlayer.id;
  const canContinue =
    typeof options.canContinue === "function"
      ? options.canContinue
      : () => true;

  if (!canContinue()) return false;

  MOVE_FX.active = true;
  MOVE_FX.playerId = playerId;
  updateActionButtons();

  try {
    for (let i = 0; i < steps; i++) {
      if (!canContinue()) return false;
      const livePlayer = getLivePlayer(playerId);
      if (!livePlayer || livePlayer.bankrupt) return false;
      livePlayer.pos = ((Number(livePlayer.pos) || 0) + 1) % 40;
      renderMarkers(playerId);
      pulseBoardSpace(
        livePlayer.pos,
        i === steps - 1 ? "step-arrive" : "step-trail",
        i === steps - 1 ? 340 : 240,
      );
      await waitMs(180);
      if (!canContinue()) return false;
    }
  } finally {
    MOVE_FX.active = false;
    MOVE_FX.playerId = null;
    updateActionButtons();
  }

  return true;
}

function renderBoardOwnership() {
  // Clear old dots
  document.querySelectorAll(".own-dot,.bldg-badge").forEach((e) => e.remove());
  G.properties.forEach((prop, id) => {
    if (!prop || prop.owner === null) return;
    const spEl = document.getElementById(`sp${id}`);
    if (!spEl) return;
    const owner = G.players[prop.owner];
    if (!owner) return;
    const dot = document.createElement("div");
    dot.className = "own-dot";
    if (prop.mortgaged) dot.classList.add("mortgaged");
    dot.textContent = String((owner.id ?? prop.owner) + 1);
    dot.title = `${owner.name}${prop.mortgaged ? " (mortgaged)" : ""}`;
    dot.style.setProperty("--own-color", owner.color || "#334155");
    spEl.appendChild(dot);
    if (prop.houses > 0 || prop.hotel) {
      const badge = document.createElement("div");
      badge.className = "bldg-badge";
      badge.textContent = prop.hotel ? "🏨" : "🏠".repeat(prop.houses);
      spEl.appendChild(badge);
    }
  });
}

function updateTopBar() {
  const p = curPlayer();
  document.getElementById("tb-token").textContent = p.token;
  document.getElementById("tb-name").textContent =
    `${p.name}${isAiPlayer(p) ? " 🤖" : ""}`;
  document.getElementById("tb-money").textContent = fmtCurrency(p.money);
  const jailTag = document.getElementById("tb-jail-tag");
  jailTag.style.display = p.inJail ? "" : "none";
  const leaveBtn = document.getElementById("leave-game-btn");
  if (leaveBtn)
    leaveBtn.style.display =
      isOnlineGame() && ONLINE.status === "playing" ? "" : "none";
}

function isAiPlayer(player) {
  return !!player && normalizePlayerKind(player.kind) === "ai";
}

function getAiTurnKey() {
  return offlineAiStateKey();
}

function uniqueConnectedRoomUids() {
  const uids = indexedObjectToArray(lobbyPlayers)
    .map((p) => String(p?.uid || ""))
    .filter(Boolean);
  return [...new Set(uids)].sort();
}

function activeOnlineRunnerUid(now = Date.now()) {
  if (!isOnlineGame()) return String(ONLINE.localUid || "");

  const lease =
    ONLINE.aiRunner && typeof ONLINE.aiRunner === "object"
      ? ONLINE.aiRunner
      : null;
  const leaseUid = String(lease?.uid || "");
  const leaseTurnKey = String(lease?.turnKey || "");
  const leaseUntil = Number(lease?.until) || 0;
  if (leaseUid && leaseTurnKey === getAiTurnKey() && leaseUntil > now)
    return leaseUid;

  // Prefer the host only if they're still connected (present in lobbyPlayers)
  const connectedUids = uniqueConnectedRoomUids();
  const host = String(ONLINE.hostUid || "");
  if (host && connectedUids.includes(host)) return host;

  // Fall back to any connected player, then local uid
  return connectedUids[0] || String(ONLINE.localUid || "");
}

function hasValidAiRunnerLease(now = Date.now()) {
  if (!isOnlineGame()) return true;
  const lease =
    ONLINE.aiRunner && typeof ONLINE.aiRunner === "object"
      ? ONLINE.aiRunner
      : null;
  if (!lease) return false;
  if (String(lease.turnKey || "") !== getAiTurnKey()) return false;
  return (Number(lease.until) || 0) > now;
}

async function ensureAiRunnerLease(force = false) {
  if (!isOnlineGame() || !FIREBASE.api || !ONLINE.connected || !ONLINE.localUid)
    return false;

  const now = Date.now();
  // Use a longer debounce (half of lease duration) to prevent rapid steal attempts
  const debounceMs = force ? 150 : Math.floor(AI_RUNNER_LEASE_MS / 2);
  if (
    !force &&
    ONLINE.aiRunnerRequestAt &&
    now - ONLINE.aiRunnerRequestAt < debounceMs
  )
    return false;
  ONLINE.aiRunnerRequestAt = now;

  const turnKey = getAiTurnKey();
  let mine = false;

  try {
    const txResult = await FIREBASE.api.runTransaction(
      getRoomRef(),
      (current) => {
        if (!current || typeof current !== "object") return current;
        if ((current.status || "lobby") !== "playing") return current;

        const raw =
          current.aiRunner && typeof current.aiRunner === "object"
            ? current.aiRunner
            : null;
        const rawUid = String(raw?.uid || "");
        const rawTurnKey = String(raw?.turnKey || "");
        const rawUntil = Number(raw?.until) || 0;
        // Use a small clock-skew buffer (200ms) when checking staleness
        const stale = rawUntil <= now + 200;
        const turnChanged = rawTurnKey !== turnKey;
        // Only take lease if: no owner, turn changed, lease is stale, we already own it, or forced
        // Never steal a valid lease that belongs to a different uid
        const canTake =
          !rawUid ||
          turnChanged ||
          stale ||
          rawUid === ONLINE.localUid ||
          force;

        if (canTake) {
          current.aiRunner = {
            uid: ONLINE.localUid,
            turnKey,
            until: now + AI_RUNNER_LEASE_MS,
          };
          mine = true;
        } else {
          mine = false;
        }

        return current;
      },
    );

    // Try to read the committed state from the transaction result
    let nextData = null;
    try {
      nextData = txResult?.snapshot?.val ? txResult.snapshot.val() : null;
    } catch (_) {}
    const nextRaw =
      nextData?.aiRunner && typeof nextData.aiRunner === "object"
        ? nextData.aiRunner
        : null;
    if (nextRaw) {
      ONLINE.aiRunner = {
        uid: String(nextRaw.uid || ""),
        turnKey: String(nextRaw.turnKey || ""),
        until: Number(nextRaw.until) || 0,
      };
    }
    // If we didn't get a snapshot back but know we won the transaction, set locally
    if (!ONLINE.aiRunner && mine) {
      ONLINE.aiRunner = {
        uid: ONLINE.localUid,
        turnKey,
        until: now + AI_RUNNER_LEASE_MS,
      };
    }
  } catch (err) {
    console.error(err);
    // Fallback: if transaction failed but we intended to take it, set optimistically
    if (mine) {
      ONLINE.aiRunner = {
        uid: ONLINE.localUid,
        turnKey,
        until: now + AI_RUNNER_LEASE_MS,
      };
    }
  }

  const lease = ONLINE.aiRunner;
  return (
    !!lease &&
    String(lease.uid || "") === String(ONLINE.localUid || "") &&
    String(lease.turnKey || "") === turnKey &&
    (Number(lease.until) || 0) > Date.now()
  );
}

function canRunAiController(now = Date.now()) {
  if (!isOnlineGame()) return true;
  if (!ONLINE.localUid) return false;
  if (!hasValidAiRunnerLease(now)) return false;
  return String(ONLINE.aiRunner?.uid || "") === String(ONLINE.localUid || "");
}

function shouldAutoActForAi(player) {
  return !!player && isAiPlayer(player) && canRunAiController();
}

function isOfflineAiAuctionTurn() {
  if (!G || !G.auctionState || !Array.isArray(G.players)) return false;
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return false;
  const bidder = G.players[bidderId];
  return isAiPlayer(bidder) && !bidder.bankrupt;
}

function clearOfflineAiTimer(resetKey = false) {
  if (AI_CTRL.timerId) {
    clearTimeout(AI_CTRL.timerId);
    AI_CTRL.timerId = null;
  }
  if (resetKey) AI_CTRL.lastKey = "";
}

function offlineAiStateKey() {
  if (!G || !Array.isArray(G.players) || !G.players.length) return "";
  const current = curPlayer();
  const bidderId = currentAuctionBidderId();
  const auctionPart = G.auctionState
    ? `${G.auctionState.propId}:${bidderId}:${Number(G.auctionState.currentBid) || 0}`
    : "no-auction";
  const tradePart = G.pendingTrade
    ? `${G.pendingTrade.id || "trade"}:${G.pendingTrade.fromId}:${G.pendingTrade.toId}`
    : "no-trade";
  const debtRaw =
    G.debtPrompt &&
    typeof G.debtPrompt === "object" &&
    G.debtPrompt.active !== false
      ? G.debtPrompt
      : null;
  const debtPart = debtRaw
    ? [
        Number.isInteger(Number(debtRaw.payerId))
          ? Number(debtRaw.payerId)
          : "na",
        Math.max(0, Number(debtRaw.amount) || 0),
        Number.isInteger(Number(debtRaw.recipientId))
          ? Number(debtRaw.recipientId)
          : "bank",
        debtRaw.toParking ? 1 : 0,
      ].join(":")
    : "no-debt";
  return [
    G.currentPlayerIdx,
    current?.kind || "human",
    G.phase,
    G.pendingBuy === null ? "no-buy" : G.pendingBuy,
    auctionPart,
    tradePart,
    debtPart,
    current?.inJail ? 1 : 0,
    current?.bankrupt ? 1 : 0,
  ].join("|");
}

function estimateAssetValue(spaceId) {
  const sp = SPACES[spaceId];
  if (!sp) return 0;
  const price = Number(sp.price) || 0;
  if (price > 0) return price;
  return Math.max(0, Math.floor(mortgageValueForSpace(sp) * 2));
}

function aiEconomyScale(themeId = G?.boardThemeId || selectedThemeId) {
  const goSalary = getThemeGoSalary(themeId);
  if (!Number.isFinite(goSalary) || goSalary <= 0) return 1;
  return Math.max(0.1, goSalary / 2000);
}

function aiCashReserve(player) {
  const scale = aiEconomyScale();
  if (!player) return Math.floor(1500 * scale);
  const owned =
    (player.properties?.length || 0) +
    (player.railroads?.length || 0) +
    (player.utilities?.length || 0);
  const floorReserve = Math.max(120, Math.floor(1500 * scale));
  const dynamicReserve = Math.floor((900 + owned * 180) * scale);
  return Math.max(floorReserve, dynamicReserve);
}

function aiPropertyGroupIds(spaceId) {
  const sp = SPACES[spaceId];
  if (!sp || sp.type !== "property") return [];
  return SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
}

function aiOwnerForSpace(spaceId, ownerOverrides = null) {
  if (ownerOverrides instanceof Map && ownerOverrides.has(spaceId)) {
    return ownerOverrides.get(spaceId);
  }
  const prop = G?.properties?.[spaceId];
  return prop ? prop.owner : null;
}

function aiCountGroupOwnedByPlayer(playerId, groupIds, ownerOverrides = null) {
  if (!Number.isInteger(playerId) || !Array.isArray(groupIds)) return 0;
  return groupIds.filter(
    (id) => aiOwnerForSpace(id, ownerOverrides) === playerId,
  ).length;
}

function aiPlayerOwnsFullGroup(playerId, groupIds, ownerOverrides = null) {
  if (
    !Number.isInteger(playerId) ||
    !Array.isArray(groupIds) ||
    !groupIds.length
  )
    return false;
  return groupIds.every(
    (id) => aiOwnerForSpace(id, ownerOverrides) === playerId,
  );
}

function aiCountOpponentMonopolyThreats(
  spaceId,
  excludedPlayerId = null,
  candidatePlayerIds = null,
  ownerOverrides = null,
) {
  const groupIds = aiPropertyGroupIds(spaceId);
  if (!groupIds.length) return 0;
  const ownerNow = aiOwnerForSpace(spaceId, ownerOverrides);
  const eligibleIds = Array.isArray(candidatePlayerIds)
    ? candidatePlayerIds
    : Array.isArray(G?.players)
      ? G.players.filter((p) => p && !p.bankrupt).map((p) => p.id)
      : [];

  let threats = 0;
  eligibleIds.forEach((pidRaw) => {
    const pid = Number(pidRaw);
    if (!Number.isInteger(pid)) return;
    if (Number.isInteger(excludedPlayerId) && pid === excludedPlayerId) return;
    if (ownerNow === pid) return;
    const owned = aiCountGroupOwnedByPlayer(pid, groupIds, ownerOverrides);
    if (owned === groupIds.length - 1) threats++;
  });

  return threats;
}

function aiEvaluateTradeGroupSwing(trade, aiPlayerId) {
  const base = {
    aiMonopoliesGained: 0,
    aiMonopoliesLost: 0,
    oppMonopoliesGained: 0,
    oppMonopoliesLost: 0,
    aiProgressDelta: 0,
    oppProgressDelta: 0,
  };
  if (!trade || !Number.isInteger(aiPlayerId)) return { ...base };

  const fromId = Number(trade.fromId);
  const toId = Number(trade.toId);
  const opponentId = aiPlayerId === fromId ? toId : fromId;
  if (!Number.isInteger(opponentId)) return { ...base };

  const ownerOverrides = new Map();
  (trade.fromProps || []).forEach((idRaw) => {
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return;
    ownerOverrides.set(id, toId);
  });
  (trade.toProps || []).forEach((idRaw) => {
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return;
    ownerOverrides.set(id, fromId);
  });

  const affectedGroups = new Set();
  [...(trade.fromProps || []), ...(trade.toProps || [])].forEach((idRaw) => {
    const id = Number(idRaw);
    if (!Number.isInteger(id)) return;
    const sp = SPACES[id];
    if (sp && sp.type === "property") affectedGroups.add(sp.group);
  });

  const result = { ...base };
  affectedGroups.forEach((group) => {
    const groupIds = SPACES.filter(
      (s) => s.type === "property" && s.group === group,
    ).map((s) => s.id);
    if (!groupIds.length) return;

    const aiBefore = aiPlayerOwnsFullGroup(aiPlayerId, groupIds);
    const aiAfter = aiPlayerOwnsFullGroup(aiPlayerId, groupIds, ownerOverrides);
    if (aiAfter && !aiBefore) result.aiMonopoliesGained++;
    if (!aiAfter && aiBefore) result.aiMonopoliesLost++;

    const oppBefore = aiPlayerOwnsFullGroup(opponentId, groupIds);
    const oppAfter = aiPlayerOwnsFullGroup(opponentId, groupIds, ownerOverrides);
    if (oppAfter && !oppBefore) result.oppMonopoliesGained++;
    if (!oppAfter && oppBefore) result.oppMonopoliesLost++;

    const aiOwnedBefore = aiCountGroupOwnedByPlayer(aiPlayerId, groupIds);
    const aiOwnedAfter = aiCountGroupOwnedByPlayer(
      aiPlayerId,
      groupIds,
      ownerOverrides,
    );
    const oppOwnedBefore = aiCountGroupOwnedByPlayer(opponentId, groupIds);
    const oppOwnedAfter = aiCountGroupOwnedByPlayer(
      opponentId,
      groupIds,
      ownerOverrides,
    );
    result.aiProgressDelta += (aiOwnedAfter - aiOwnedBefore) / groupIds.length;
    result.oppProgressDelta +=
      (oppOwnedAfter - oppOwnedBefore) / groupIds.length;
  });

  return result;
}

function aiTradeMemoryForPlayer(playerId) {
  if (!Number.isInteger(playerId)) return null;
  if (!AI_CTRL.tradeByPlayer || typeof AI_CTRL.tradeByPlayer !== "object") {
    AI_CTRL.tradeByPlayer = {};
  }
  const key = String(playerId);
  if (
    !AI_CTRL.tradeByPlayer[key] ||
    typeof AI_CTRL.tradeByPlayer[key] !== "object"
  ) {
    AI_CTRL.tradeByPlayer[key] = {
      lastOfferKey: "",
      sameOfferCount: 0,
      declineStreak: 0,
      cooldownMoves: 0,
      lastCooldownTickTurnKey: "",
      lastCooldownBlockTurnKey: "",
    };
  }
  return AI_CTRL.tradeByPlayer[key];
}

function aiTradeOfferSignature({
  fromId,
  toId,
  fromProps = [],
  toProps = [],
  fromMoney = 0,
  toMoney = 0,
} = {}) {
  const normProps = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .map((id) => Number(id))
      .filter(Number.isInteger)
      .sort((a, b) => a - b)
      .join(".");
  return [
    Number(fromId),
    Number(toId),
    normProps(fromProps),
    normProps(toProps),
    Math.max(0, Number(fromMoney) || 0),
    Math.max(0, Number(toMoney) || 0),
  ].join("|");
}

function aiCanProposeTradeOffer(memory, offerKey) {
  if (!memory || !offerKey) return true;
  return !(
    memory.lastOfferKey === offerKey &&
    memory.sameOfferCount >= AI_TRADE_SAME_OFFER_LIMIT
  );
}

function aiRecordTradeProposal(memory, offerKey) {
  if (!memory || !offerKey) return;
  if (memory.lastOfferKey === offerKey) {
    memory.sameOfferCount = (Number(memory.sameOfferCount) || 0) + 1;
  } else {
    memory.lastOfferKey = offerKey;
    memory.sameOfferCount = 1;
  }
  memory.lastCooldownBlockTurnKey = "";
}

function aiShouldSkipTradeProposalsThisTurn(memory, turnKey) {
  if (!memory) return false;
  if (memory.lastCooldownBlockTurnKey === turnKey) return true;
  if ((Number(memory.cooldownMoves) || 0) > 0) {
    if (memory.lastCooldownTickTurnKey !== turnKey) {
      memory.cooldownMoves = Math.max(
        0,
        (Number(memory.cooldownMoves) || 0) - 1,
      );
      memory.lastCooldownTickTurnKey = turnKey;
    }
    memory.lastCooldownBlockTurnKey = turnKey;
    return true;
  }
  return false;
}

function aiRecordTradeResolution(trade, accepted) {
  if (!trade) return;
  const proposerId = Number(trade.fromId);
  if (!Number.isInteger(proposerId)) return;
  const proposer = G.players?.[proposerId];
  if (!isAiPlayer(proposer)) return;

  const memory = aiTradeMemoryForPlayer(proposerId);
  if (!memory) return;

  if (accepted) {
    memory.declineStreak = 0;
    memory.cooldownMoves = 0;
    memory.lastCooldownTickTurnKey = "";
    memory.lastCooldownBlockTurnKey = "";
    return;
  }

  memory.declineStreak = (Number(memory.declineStreak) || 0) + 1;
  if (memory.declineStreak >= AI_TRADE_DECLINE_STREAK_COOLDOWN) {
    memory.cooldownMoves = Math.max(
      Number(memory.cooldownMoves) || 0,
      AI_TRADE_PROPOSAL_COOLDOWN_MOVES,
    );
    memory.declineStreak = 0;
    memory.lastCooldownTickTurnKey = "";
    memory.lastCooldownBlockTurnKey = "";
  }
}

function aiPropertyPriority(player, spaceId) {
  const sp = SPACES[spaceId];
  if (!sp || !player) return 0;
  const price = Number(sp.price) || estimateAssetValue(spaceId);
  let score = price;

  if (sp.type === "property") {
    const groupIds = aiPropertyGroupIds(spaceId);
    const groupSize = groupIds.length || 1;
    const ownedNow = aiCountGroupOwnedByPlayer(player.id, groupIds);
    const wouldGainControl = aiOwnerForSpace(spaceId) !== player.id;
    const ownedAfter = Math.min(
      groupSize,
      ownedNow + (wouldGainControl ? 1 : 0),
    );

    if (ownedAfter >= groupSize) {
      score += Math.floor(price * 1.35);
    } else if (ownedAfter === groupSize - 1) {
      score += Math.floor(price * 0.62);
    } else if (ownedAfter > 1) {
      score += Math.floor(price * 0.22 * (ownedAfter - 1));
    }

    score += Math.floor((ownedAfter / groupSize) * price * 0.34);

    const threatCount = aiCountOpponentMonopolyThreats(spaceId, player.id);
    if (threatCount > 0) {
      score += Math.floor(
        price * (0.45 + 0.12 * Math.min(2, threatCount - 1)),
      );
    }
  } else if (sp.type === "railroad") {
    score += (player.railroads?.length || 0) * 700;
  } else if (sp.type === "utility") {
    score += (player.utilities?.length || 0) * 450;
  }

  return score;
}

function aiTryMortgageToTarget(player, targetCash) {
  if (!player || player.bankrupt || player.money >= targetCash) return false;

  const assets = [
    ...player.properties,
    ...player.railroads,
    ...player.utilities,
  ]
    .filter((id) => canMortgageAsset(player, id))
    .sort(
      (a, b) =>
        mortgageValueForSpace(SPACES[a]) - mortgageValueForSpace(SPACES[b]),
    );

  if (!assets.length) return false;
  const id = assets[0];
  const sp = SPACES[id];
  const prop = G.properties[id];
  if (!sp || !prop || prop.owner !== player.id || prop.mortgaged) return false;
  const mortgageValue = mortgageValueForSpace(sp);
  prop.mortgaged = true;
  player.money += mortgageValue;
  playSfx("mortgage");
  addLog(
    `${player.name} mortgaged ${sp.name} for ${fmtCurrency(mortgageValue)}.`,
    "important",
  );
  renderAll();
  updateTopBar();
  return true;
}

function aiTryUnmortgage(player) {
  if (!player || player.bankrupt) return false;

  const reserve = aiCashReserve(player);
  const flexibleReserve = Math.floor(reserve * 0.6);
  const mortgaged = [
    ...player.properties,
    ...player.railroads,
    ...player.utilities,
  ]
    .filter((id) => {
      const prop = G.properties[id];
      return prop && prop.owner === player.id && prop.mortgaged;
    })
    .sort((a, b) => {
      const aCost = Math.floor(mortgageValueForSpace(SPACES[a]) * 1.1);
      const bCost = Math.floor(mortgageValueForSpace(SPACES[b]) * 1.1);
      return aCost - bCost;
    });

  for (let i = 0; i < mortgaged.length; i++) {
    const id = mortgaged[i];
    const sp = SPACES[id];
    const prop = G.properties[id];
    const cost = Math.floor(mortgageValueForSpace(sp) * 1.1);
    if (!prop || player.money - cost < flexibleReserve) continue;
    prop.mortgaged = false;
    player.money -= cost;
    playSfx("unmortgage");
    addLog(
      `${player.name} unmortgaged ${sp.name} for ${fmtCurrency(cost)}.`,
      "important",
    );
    renderAll();
    updateTopBar();
    return true;
  }

  return false;
}

function aiTryBuildOne(player) {
  if (
    !player ||
    player.bankrupt ||
    G.pendingBuy !== null ||
    G.auctionState ||
    G.pendingTrade
  )
    return false;

  const groups = buildableGroups(player);
  if (!groups.length) return false;
  const reserve = aiCashReserve(player);

  let best = null;
  groups.forEach((ids) => {
    if (ids.some((id) => G.properties[id]?.mortgaged)) return;
    ids.forEach((id) => {
      const sp = SPACES[id];
      const prop = G.properties[id];
      if (!sp || !prop || prop.owner !== player.id || prop.hotel) return;
      const cost = Number(sp.house) || 0;
      if (cost <= 0) return;
      if (player.money - cost < reserve) return;

      const currentRent =
        prop.houses > 0 ? sp.rent[prop.houses] || 0 : sp.rent[0] || 0;
      const nextRent =
        prop.houses >= 4
          ? sp.rent[5] || currentRent
          : sp.rent[prop.houses + 1] || currentRent;
      const score = nextRent - currentRent + (4 - prop.houses) * 25;
      if (!best || score > best.score) {
        best = { id, score };
      }
    });
  });

  if (!best) return false;
  buildHouse(best.id);
  return true;
}

function aiTryProposeTrade(player) {
  if (
    !player ||
    player.bankrupt ||
    isOnlineGame() ||
    G.pendingTrade ||
    G.auctionState ||
    G.pendingBuy !== null
  )
    return false;

  const turnKey = `${player.id}|${player.pos}|${G.phase}|${G.dice?.join("-") || "0-0"}`;
  if (AI_CTRL.lastTradeAttemptKey === turnKey) return false;
  AI_CTRL.lastTradeAttemptKey = turnKey;
  const tradeMemory = aiTradeMemoryForPlayer(player.id);
  if (aiShouldSkipTradeProposalsThisTurn(tradeMemory, turnKey)) return false;

  const reserve = aiCashReserve(player);
  let bestOffer = null;

  for (let id = 0; id < SPACES.length; id++) {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop || prop.owner === null || prop.owner === player.id)
      continue;
    if (prop.mortgaged || propertyHasBuildings(id)) continue;
    const owner = G.players[prop.owner];
    if (!owner || owner.bankrupt) continue;

    let ask = 0;
    let score = 0;

    if (sp.type === "property") {
      const groupIds = aiPropertyGroupIds(id);
      if (groupIds.some((gid) => propertyHasBuildings(gid))) continue;

      const ownedByMe = aiCountGroupOwnedByPlayer(player.id, groupIds);
      if (ownedByMe <= 0) continue;
      const groupSize = groupIds.length || 1;
      const ownedAfter = Math.min(groupSize, ownedByMe + 1);
      const completesGroup = ownedAfter >= groupSize;
      const progressRatio = ownedAfter / groupSize;

      ask = Math.max(
        420,
        Math.floor(
          (Number(sp.price) || 1200) *
            (completesGroup ? 1.08 : 0.9 + progressRatio * 0.22),
        ),
      );
      score =
        Math.floor(900 * progressRatio) +
        (completesGroup ? 1450 : Math.floor(260 * ownedByMe));
    } else if (sp.type === "railroad") {
      if ((player.railroads?.length || 0) === 0) continue;
      ask = Math.max(700, Math.floor((Number(sp.price) || 2000) * 0.95));
      score = 1100 + (player.railroads?.length || 0) * 240 - ask;
    } else if (sp.type === "utility") {
      if ((player.utilities?.length || 0) === 0) continue;
      ask = Math.max(550, Math.floor((Number(sp.price) || 1500) * 0.9));
      score = 900 + (player.utilities?.length || 0) * 180 - ask;
    } else {
      continue;
    }

    const budget = Math.max(0, player.money - Math.floor(reserve * 0.55));
    ask = Math.min(ask, owner.money, budget);
    if (ask <= 0) continue;
    const offerKey = aiTradeOfferSignature({
      fromId: player.id,
      toId: owner.id,
      fromProps: [],
      toProps: [id],
      fromMoney: ask,
      toMoney: 0,
    });
    if (!aiCanProposeTradeOffer(tradeMemory, offerKey)) continue;

    const finalScore = score + Math.max(0, (Number(sp.price) || 0) - ask);
    if (!bestOffer || finalScore > bestOffer.score) {
      bestOffer = {
        ownerId: owner.id,
        propId: id,
        ask,
        score: finalScore,
        offerKey,
      };
    }
  }

  if (bestOffer) {
    const target = G.players[bestOffer.ownerId];
    aiRecordTradeProposal(tradeMemory, bestOffer.offerKey);
    G.pendingTrade = {
      id: `tr_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      fromId: player.id,
      toId: target.id,
      fromProps: [],
      toProps: [bestOffer.propId],
      fromMoney: bestOffer.ask,
      toMoney: 0,
      createdAt: Date.now(),
    };
    tradeReviewShownKey = "";
    addLog(`${player.name} proposed a trade to ${target.name}.`, "important");
    renderAll();
    updateActionButtons();
    return true;
  }

  // If low on cash, try selling a low-impact asset for quick liquidity.
  if (player.money < Math.floor(reserve * 0.6)) {
    const myAssets = [
      ...player.properties,
      ...player.railroads,
      ...player.utilities,
    ]
      .filter((id) => {
        const prop = G.properties[id];
        return (
          prop &&
          prop.owner === player.id &&
          !prop.mortgaged &&
          !tradeAssetBuildingBlockReason(id)
        );
      })
      .sort((a, b) => estimateAssetValue(a) - estimateAssetValue(b));

    const buyers = G.players
      .filter((op) => op.id !== player.id && !op.bankrupt)
      .sort((a, b) => b.money - a.money);

    if (myAssets.length && buyers.length) {
      const severeStress = player.money < Math.floor(reserve * 0.25);
      let bestLiquidation = null;

      myAssets.forEach((propId) => {
        buyers.forEach((buyer) => {
          if (!buyer || buyer.money <= 0) return;
          const ask = Math.min(
            buyer.money,
            Math.max(350, Math.floor(estimateAssetValue(propId) * 0.78)),
          );
          if (ask <= 0) return;

          const swing = aiEvaluateTradeGroupSwing(
            {
              fromId: player.id,
              toId: buyer.id,
              fromProps: [propId],
              toProps: [],
            },
            player.id,
          );
          const createsOpponentMonopoly = swing.oppMonopoliesGained > 0;
          const breaksMyMonopoly = swing.aiMonopoliesLost > 0;
          if (!severeStress && (createsOpponentMonopoly || breaksMyMonopoly))
            return;

          const offerKey = aiTradeOfferSignature({
            fromId: player.id,
            toId: buyer.id,
            fromProps: [propId],
            toProps: [],
            fromMoney: 0,
            toMoney: ask,
          });
          if (!aiCanProposeTradeOffer(tradeMemory, offerKey)) return;

          const liquidationScore =
            ask -
            Math.floor(estimateAssetValue(propId) * 0.7) -
            swing.oppMonopoliesGained * Math.floor(900 * aiEconomyScale()) -
            swing.aiMonopoliesLost * Math.floor(1200 * aiEconomyScale()) +
            (severeStress ? ask : 0);

          if (!bestLiquidation || liquidationScore > bestLiquidation.score) {
            bestLiquidation = {
              propId,
              buyerId: buyer.id,
              ask,
              score: liquidationScore,
              offerKey,
            };
          }
        });
      });

      if (bestLiquidation) {
        const buyer = G.players[bestLiquidation.buyerId];
        aiRecordTradeProposal(tradeMemory, bestLiquidation.offerKey);
        G.pendingTrade = {
          id: `tr_ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          fromId: player.id,
          toId: buyer.id,
          fromProps: [bestLiquidation.propId],
          toProps: [],
          fromMoney: 0,
          toMoney: bestLiquidation.ask,
          createdAt: Date.now(),
        };
        tradeReviewShownKey = "";
        addLog(
          `${player.name} offered ${SPACES[bestLiquidation.propId]?.name || "a property"} to ${buyer.name} for ${fmtCurrency(bestLiquidation.ask)}.`,
          "important",
        );
        renderAll();
        updateActionButtons();
        return true;
      }
    }
  }

  return false;
}

function maybeScheduleOfflineAiTurn() {
  if (!G || G.gameOver || !Array.isArray(G.players) || !G.players.length) {
    clearOfflineAiTimer(true);
    return;
  }

  const gameScreen = document.getElementById("game-screen");
  if (!gameScreen || gameScreen.classList.contains("hidden")) {
    clearOfflineAiTimer(true);
    return;
  }

  if (isOnlineGame() && ONLINE.isApplyingRemote) {
    clearOfflineAiTimer(false);
    return;
  }

  const current = curPlayer();
  const bidderId = currentAuctionBidderId();
  const bidder = Number.isInteger(bidderId) ? G.players[bidderId] : null;
  const tradeRecipient = G.pendingTrade
    ? G.players[Number(G.pendingTrade.toId)]
    : null;
  const debtRaw = DEBT_PROMPT.active
    ? DEBT_PROMPT
    : G?.debtPrompt && G.debtPrompt.active
      ? G.debtPrompt
      : null;
  const debtPayerId = Number(debtRaw?.payerId);
  const debtPayer = Number.isInteger(debtPayerId)
    ? G.players[debtPayerId]
    : null;
  const debtTurnMismatch = !!(
    debtRaw &&
    debtPayer &&
    !debtPayer.bankrupt &&
    Number(G.currentPlayerIdx) !== debtPayer.id
  );
  const aiDebtNeedsAction = !!(
    debtRaw &&
    debtPayer &&
    !debtPayer.bankrupt &&
    isAiPlayer(debtPayer)
  );
  const aiNeedsAction =
    (isAiPlayer(current) && !current.bankrupt) ||
    (isAiPlayer(current) && current.bankrupt) ||
    (!!G.auctionState && isAiPlayer(bidder) && !bidder.bankrupt) ||
    (!!G.pendingTrade &&
      isAiPlayer(tradeRecipient) &&
      !tradeRecipient.bankrupt) ||
    aiDebtNeedsAction ||
    debtTurnMismatch;

  if (!aiNeedsAction) {
    clearOfflineAiTimer(true);
    return;
  }

  const stateKey = offlineAiStateKey();
  const now = Date.now();
  if (isOnlineGame()) {
    if (!canRunAiController(now)) {
      const runnerUid = activeOnlineRunnerUid(now) || "none";
      // If the designated runner is not us and IS a connected player, wait for them
      const connectedUids = uniqueConnectedRoomUids();
      const runnerIsConnected =
        runnerUid !== "none" && connectedUids.includes(runnerUid);
      const runnerIsUs = runnerUid === String(ONLINE.localUid || "");
      // If runner is absent or is us (stale lease), try to claim lease immediately
      if (!runnerIsConnected || runnerIsUs) {
        clearOfflineAiTimer(false);
        AI_CTRL.lastKey = "";
        ensureAiRunnerLease(true).then(() => maybeScheduleOfflineAiTurn());
        return;
      }
      const waitKey = `${stateKey}:lease:${runnerUid}`;
      if (AI_CTRL.timerId && AI_CTRL.lastKey === waitKey) return;
      clearOfflineAiTimer(false);
      AI_CTRL.lastKey = waitKey;
      AI_CTRL.timerId = setTimeout(async () => {
        AI_CTRL.timerId = null;
        await ensureAiRunnerLease();
        maybeScheduleOfflineAiTurn();
      }, 520);
      return;
    }

    const leaseRemaining = (Number(ONLINE.aiRunner?.until) || 0) - now;
    if (leaseRemaining < AI_RUNNER_RENEW_MS) {
      ensureAiRunnerLease(true);
    }
  } else if (!canRunAiController(now)) {
    clearOfflineAiTimer(true);
    return;
  }

  if (AI_CTRL.timerId && AI_CTRL.lastKey === stateKey) return;

  clearOfflineAiTimer(false);
  AI_CTRL.lastKey = stateKey;
  AI_CTRL.timerId = setTimeout(
    runOfflineAiStep,
    380 + Math.floor(Math.random() * 280),
  );
}

function tryAutoResolveAiDebtPrompt() {
  if (!hasPendingDebtPromptForCurrentPlayer()) return false;

  const payer = curPlayer();
  if (!payer || !isAiPlayer(payer)) return false;
  if (payer.bankrupt) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return true;
  }

  const due = Math.max(0, Number(DEBT_PROMPT.amount) || 0);
  if (due <= 0) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return true;
  }

  if (tryResolveDebtPrompt()) return true;

  const raised = sellBuildingsForEmergencyCash(payer);
  if (raised > 0) {
    addLog(
      `${payer.name} sold buildings to cover debt (raised ${fmtCurrency(raised)}).`,
      "important",
    );
  }

  let usedMortgages = 0;
  while (payer.money < due && usedMortgages < 32) {
    const target = due + Math.floor(aiCashReserve(payer) * 0.25);
    const mortgaged = aiTryMortgageToTarget(payer, target);
    if (!mortgaged) break;
    usedMortgages++;
  }
  if (usedMortgages > 0) {
    addLog(
      `${payer.name} used ${usedMortgages} emergency mortgage${usedMortgages > 1 ? "s" : ""} to settle debt.`,
      "important",
    );
  }

  if (tryResolveDebtPrompt()) return true;

  const recipient =
    DEBT_PROMPT.recipientId !== null
      ? G.players[DEBT_PROMPT.recipientId]
      : null;
  const toParking = !!DEBT_PROMPT.toParking;
  resetDebtPrompt();
  declareBankruptcy(
    payer,
    recipient && !recipient.bankrupt ? recipient : null,
    due,
    toParking,
  );
  return true;
}

function runOfflineAiStep() {
  AI_CTRL.timerId = null;

  if (!G || G.gameOver || !Array.isArray(G.players) || !G.players.length) {
    AI_CTRL.lastKey = "";
    return;
  }
  if (!canRunAiController()) {
    AI_CTRL.lastKey = "";
    maybeScheduleOfflineAiTurn();
    return;
  }

  if (isOnlineGame() && ONLINE.isApplyingRemote) {
    AI_CTRL.lastKey = "";
    maybeScheduleOfflineAiTurn();
    return;
  }

  const gameScreen = document.getElementById("game-screen");
  if (!gameScreen || gameScreen.classList.contains("hidden")) return;
  if (MOVE_FX.active) {
    maybeScheduleOfflineAiTurn();
    return;
  }
  const cardFxPending = (Number(ONLINE.pendingCardResolutions) || 0) > 0;
  if (cardFxPending) {
    maybeScheduleOfflineAiTurn();
    return;
  }

  restoreDebtPromptFromGameState();
  const debtStateAdjusted = normalizeDebtPromptTurn();
  if (debtStateAdjusted) {
    renderAll();
    updateActionButtons();
    if (isOnlineGame() && !ONLINE.isApplyingRemote) {
      syncRoomState("normalize-debt-turn").catch((err) => {
        console.error(err);
      });
    }
  }

  if (G.pendingTrade) {
    const trade = G.pendingTrade;
    const recipient = G.players[Number(trade.toId)];
    if (isAiPlayer(recipient) && !recipient.bankrupt) {
      const receiveValue =
        (trade.fromProps || []).reduce(
          (sum, id) => sum + estimateAssetValue(id),
          0,
        ) + Math.max(0, Number(trade.fromMoney) || 0);
      const giveValue =
        (trade.toProps || []).reduce(
          (sum, id) => sum + estimateAssetValue(id),
          0,
        ) + Math.max(0, Number(trade.toMoney) || 0);
      const reserve = aiCashReserve(recipient);
      const stressed = recipient.money < Math.floor(reserve * 0.5);
      const critical = recipient.money < Math.floor(reserve * 0.24);
      const cashDelta =
        Math.max(0, Number(trade.fromMoney) || 0) -
        Math.max(0, Number(trade.toMoney) || 0);
      const swing = aiEvaluateTradeGroupSwing(trade, recipient.id);
      const scale = aiEconomyScale();

      if (
        swing.oppMonopoliesGained > 0 &&
        !critical &&
        swing.aiMonopoliesGained < swing.oppMonopoliesGained
      ) {
        respondTrade(false);
        return;
      }

      let score = receiveValue - giveValue;
      score += swing.aiMonopoliesGained * Math.floor(2200 * scale);
      score -= swing.aiMonopoliesLost * Math.floor(2600 * scale);
      score -=
        swing.oppMonopoliesGained * Math.floor((critical ? 1100 : 4200) * scale);
      score += swing.oppMonopoliesLost * Math.floor(850 * scale);
      score += Math.floor(swing.aiProgressDelta * 1000 * scale);
      score -= Math.floor(Math.max(0, swing.oppProgressDelta) * 1200 * scale);
      if (stressed && cashDelta > 0) score += Math.floor(cashDelta * 0.75);

      const acceptThreshold = stressed
        ? -Math.floor(reserve * 0.14)
        : Math.floor(reserve * 0.05);
      const accept = score >= acceptThreshold;
      respondTrade(accept);
      return;
    }
  }

  if (G.auctionState) {
    const bidderId = currentAuctionBidderId();
    const bidder = Number.isInteger(bidderId) ? G.players[bidderId] : null;
    if (isAiPlayer(bidder) && !bidder.bankrupt) {
      const a = G.auctionState;
      const reserve = aiCashReserve(bidder);
      const nextBid = (Number(a.currentBid) || 0) + 100;
      if (
        bidder.money < nextBid &&
        aiTryMortgageToTarget(bidder, nextBid + Math.floor(reserve * 0.4))
      ) {
        return;
      }

      const threatCount = aiCountOpponentMonopolyThreats(
        a.propId,
        bidder.id,
        a.activePlayers,
      );
      const basePrice =
        Number(SPACES[a.propId]?.price) || estimateAssetValue(a.propId);
      const defensePremium =
        threatCount > 0
          ? Math.floor(basePrice * (0.24 + 0.08 * Math.min(2, threatCount - 1)))
          : 0;
      const valueCap = Math.floor(
        (aiPropertyPriority(bidder, a.propId) + defensePremium) *
          (0.93 + Math.random() * 0.16),
      );
      const reserveFactor = threatCount > 0 ? 0.3 : 0.45;
      const cashCap = Math.max(
        0,
        bidder.money - Math.floor(reserve * reserveFactor),
      );
      const maxBid = Math.max(0, Math.min(valueCap, cashCap));

      if (nextBid > maxBid || bidder.money < nextBid) {
        passAuction();
        return;
      }

      const room = maxBid - (Number(a.currentBid) || 0);
      let increment = 100;
      if (room >= 1000) increment = 1000;
      else if (room >= 500) increment = 500;
      else if (room >= 200) increment = 200;
      placeBid(increment);
      return;
    }
  }

  const p = curPlayer();
  if (!isAiPlayer(p)) return;

  if (tryAutoResolveAiDebtPrompt()) {
    renderAll();
    updateActionButtons();
    if (isOnlineGame() && !ONLINE.isApplyingRemote) {
      syncRoomState("ai-debt-resolution").catch((err) => {
        console.error(err);
      });
    }
    return;
  }

  if (p.bankrupt) {
    if (G.phase === "roll") G.phase = "end";
    endTurn();
    return;
  }

  if (G.pendingBuy !== null) {
    const spaceId = G.pendingBuy;
    const sp = SPACES[spaceId];
    const price = Number(sp?.price) || 0;
    const reserve = aiCashReserve(p);
    const auctionsEnabled = isAuctionSystemEnabled();
    if (
      p.money < price &&
      aiTryMortgageToTarget(p, price + Math.floor(reserve * 0.35))
    ) {
      return;
    }
    const score = aiPropertyPriority(p, spaceId);
    const shouldBuy =
      p.money >= price &&
      (!auctionsEnabled ||
        score >= Math.floor(price * 1.2) ||
        p.money - price >= reserve ||
        Math.random() < 0.3);
    closeOverlay("buy-overlay");
    if (shouldBuy) {
      actionBuy();
    } else if (auctionsEnabled) {
      startAuction();
    } else {
      G.pendingBuy = null;
      G.phase = "end";
      addLog(
        `${p.name} skipped ${sp?.name || "this property"}. Auctions are disabled, so it remains unsold.`,
        "important",
      );
      renderAll();
      updateActionButtons();
    }
    return;
  }

  if (G.phase === "roll") {
    const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
    if (
      p.inJail &&
      (p.jailTurns >= 2 || (p.money >= bailAmount * 6 && Math.random() < 0.55))
    ) {
      payBailout();
      return;
    }
    rollDice();
    return;
  }

  if (G.phase === "action" || G.phase === "end") {
    const reserve = aiCashReserve(p);
    if (
      p.money < Math.floor(reserve * 0.35) &&
      aiTryMortgageToTarget(p, Math.floor(reserve * 0.85))
    ) {
      return;
    }
    if (aiTryUnmortgage(p)) {
      return;
    }
    if ((G.phase === "action" || G.phase === "end") && aiTryBuildOne(p)) {
      return;
    }
    if (aiTryProposeTrade(p)) {
      const tradeRecipient = G.pendingTrade
        ? G.players[Number(G.pendingTrade.toId)]
        : null;
      if (
        G.pendingTrade &&
        tradeRecipient &&
        !isAiPlayer(tradeRecipient) &&
        G.currentPlayerIdx === p.id
      ) {
        endTurn();
      }
      return;
    }
    endTurn();
  }
}

function updateActionButtons() {
  const p = curPlayer();
  const onProp = G.properties[p.pos];
  const sp = SPACES[p.pos];
  restoreDebtPromptFromGameState();
  const turnOwnedByMe = canLocalControlTurn();
  const aiTurnActive = isAiPlayer(p) && !p.bankrupt;
  const movementLocked = MOVE_FX.active;
  const cardFxPending = (Number(ONLINE.pendingCardResolutions) || 0) > 0;
  const canHumanAct =
    turnOwnedByMe && !aiTurnActive && !movementLocked && !cardFxPending;
  const debtRaw = DEBT_PROMPT.active
    ? DEBT_PROMPT
    : G?.debtPrompt && G.debtPrompt.active
      ? G.debtPrompt
      : null;
  const debtPayerId = Number(debtRaw?.payerId);
  const debtPayer = Number.isInteger(debtPayerId)
    ? G.players[debtPayerId]
    : null;
  const debtPromptActive = !!(debtRaw && debtPayer && !debtPayer.bankrupt);
  const debtPending = debtPromptActive && debtPayer.id === G.currentPlayerIdx;
  const debtShortBy = debtPromptActive
    ? Math.max(0, Number(debtRaw.amount || 0) - Number(debtPayer.money || 0))
    : 0;
  const managementPhase =
    G.phase === "roll" || G.phase === "action" || G.phase === "end";
  const tradePending = !!G.pendingTrade;
  const canBuyAny =
    !debtPending && G.phase === "action" && onProp && onProp.owner === null;
  const canBuild =
    !debtPending && managementPhase && buildableGroups(p).length > 0;
  const canMortgage =
    managementPhase &&
    (p.properties.length > 0 ||
      p.railroads.length > 0 ||
      p.utilities.length > 0);
  const canTrade =
    !debtPending &&
    managementPhase &&
    !tradePending &&
    G.players.filter((x) => !x.bankrupt).length > 1;
  const canEnd = !debtPending && (G.phase === "action" || G.phase === "end");
  const inJail = p.inJail;
  const runnerUid =
    aiTurnActive && isOnlineGame() ? activeOnlineRunnerUid() : "";
  const runnerName = runnerUid
    ? indexedObjectToArray(lobbyPlayers).find(
        (lp) => String(lp?.uid || "") === runnerUid,
      )?.name || (runnerUid === ONLINE.hostUid ? "Host" : "another client")
    : "another client";
  const aiWaitingForRunner =
    aiTurnActive && isOnlineGame() && !canRunAiController();

  if (G.gameOver) {
    [
      "btn-buy",
      "mb-buy",
      "btn-build",
      "mb-build",
      "btn-mortgage",
      "mb-mortgage",
      "btn-trade",
      "mb-trade",
      "btn-end",
      "mb-end",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });

    ["btn-pay-jail", "mb-pay-jail"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });

    const rollBtn = document.getElementById("roll-btn");
    if (rollBtn) {
      rollBtn.disabled = true;
      rollBtn.textContent = "🏆 Game Over";
    }

    const cm = document.getElementById("center-msg");
    if (cm)
      cm.textContent =
        "🏆 Match finished. Use Winner actions to view board or start a new game.";

    const mobileTurnLine = document.getElementById("mobile-turnline");
    if (mobileTurnLine) mobileTurnLine.textContent = "🏆 Match finished";

    stopTimer();
    return;
  }

  ["btn-buy", "mb-buy"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canBuyAny;
  });
  ["btn-build", "mb-build"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canBuild;
  });
  ["btn-mortgage", "mb-mortgage"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canMortgage;
  });
  ["btn-trade", "mb-trade"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canTrade;
  });
  ["btn-end", "mb-end"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !canHumanAct || !canEnd;
  });

  const rollBtn = document.getElementById("roll-btn");
  if (rollBtn) {
    rollBtn.disabled = debtPromptActive || G.phase !== "roll" || !canHumanAct;
    rollBtn.textContent = movementLocked
      ? `🏃 ${p.name} is moving...`
      : cardFxPending
        ? `🃏 Resolving card effect...`
        : debtPromptActive
          ? debtPending && turnOwnedByMe
            ? `💀 Resolve debt / bankruptcy`
            : `💀 ${debtPayer?.name || "Player"} resolving debt`
          : aiTurnActive
            ? aiWaitingForRunner
              ? `🤖 Waiting for ${runnerName}`
              : `🤖 ${p.name} is thinking...`
            : !turnOwnedByMe
              ? `⏳ ${p.name} is playing`
              : inJail && G.phase === "roll"
                ? "🎲 Roll for Doubles"
                : "🎲 Roll Dice";
  }

  // Jail bail button
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
  const bailVis =
    canHumanAct && inJail && G.phase === "roll" && p.money >= bailAmount;
  ["btn-pay-jail", "mb-pay-jail"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = bailVis ? "" : "none";
    el.textContent = `💳 Pay ${fmtCurrency(bailAmount)} Bail`;
  });

  // Center message
  const cm = document.getElementById("center-msg");
  if (cm) {
    if (movementLocked)
      cm.textContent = `${p.name} is hopping across the board...`;
    else if (cardFxPending) cm.textContent = `Resolving card effect...`;
    else if (debtPromptActive) {
      cm.textContent = debtPending
        ? `💀 Debt alert: short by ${fmtCurrency(debtShortBy)}. Mortgage/sell or declare bankruptcy.`
        : `💀 ${debtPayer?.name || "Player"} is resolving debt (short ${fmtCurrency(debtShortBy)}).`;
    } else if (aiTurnActive)
      cm.textContent = aiWaitingForRunner
        ? `🤖 Waiting for ${runnerName} to run AI`
        : `🤖 ${p.name} is making a move`;
    else if (!turnOwnedByMe) cm.textContent = `Watching ${p.name}'s turn`;
    else if (inJail && G.phase === "roll")
      cm.textContent = `Roll doubles or pay ${fmtCurrency(bailAmount)} bail`;
    else if (G.phase === "roll")
      cm.textContent = `${p.name}'s turn to roll (or manage assets first)`;
    else if (G.phase === "action") cm.textContent = `Landed on ${sp.name}`;
    else
      cm.textContent =
        TIMER.duration > 0
          ? `Auto-advancing in ${TIMER.duration}s…`
          : `End turn when ready`;
  }

  const mobileTurnLine = document.getElementById("mobile-turnline");
  if (mobileTurnLine) {
    if (movementLocked)
      mobileTurnLine.textContent = `🏃 ${p.name} is moving...`;
    else if (cardFxPending)
      mobileTurnLine.textContent = "🃏 Resolving card effect...";
    else if (debtPromptActive) {
      mobileTurnLine.textContent = debtPending
        ? `💀 Debt short ${fmtCurrency(debtShortBy)} • mortgage/sell or bankrupt`
        : `💀 ${debtPayer?.name || "Player"} is resolving debt`;
    } else if (aiTurnActive)
      mobileTurnLine.textContent = aiWaitingForRunner
        ? `🤖 Waiting for ${runnerName}`
        : `🤖 ${p.name} is thinking`;
    else if (!turnOwnedByMe)
      mobileTurnLine.textContent = `⏳ Watching ${p.name}'s turn`;
    else if (inJail && G.phase === "roll")
      mobileTurnLine.textContent = `⛓️ Roll doubles or pay ${fmtCurrency(bailAmount)} bail`;
    else if (G.phase === "roll")
      mobileTurnLine.textContent = "🎲 Roll dice or manage assets";
    else if (G.phase === "action")
      mobileTurnLine.textContent = `📍 ${sp.name} • choose an action`;
    else
      mobileTurnLine.textContent =
        TIMER.duration > 0
          ? `⏱ Auto-end: ${TIMER.duration}s after move`
          : "✅ End your turn when ready";
  }

  // Prompt jailed player with clear choices at the start of their roll phase.
  if (canHumanAct && inJail && G.phase === "roll") {
    const promptKey = `${G.currentPlayerIdx}:${p.jailTurns}:${G.phase}`;
    if (
      jailPromptShownKey !== promptKey &&
      !document.querySelector(".overlay.show")
    ) {
      jailPromptShownKey = promptKey;
      showJailPrompt(p, "turn");
    }
  }

  maybeShowPendingTradeReview();

  // Start auto-advance timer when player enters the 'end' phase (move done, can end turn)
  if (G.phase === "end" && !G.gameOver && canHumanAct) {
    startTimer();
  } else {
    stopTimer();
  }
}

// ═══════════════════════════════════════════════
//  DICE & MOVEMENT
// ═══════════════════════════════════════════════
async function rollDice() {
  if (!requireTurnControl()) return;
  const p = getLivePlayer(curPlayer());
  if (!p || p.bankrupt) return;
  if (G.phase !== "roll" || MOVE_FX.active) return;

  const d1 = rand(1, 6),
    d2 = rand(1, 6);
  const doubles = d1 === d2;
  G.dice = [d1, d2];
  G.lastDoubles = doubles;
  playSfx("dice");

  // Animate dice
  ["die1", "die2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("rolling");
      setTimeout(() => el.classList.remove("rolling"), 400);
    }
  });
  setTimeout(() => {
    const die1 = document.getElementById("die1");
    const die2 = document.getElementById("die2");
    if (die1) die1.dataset.v = d1;
    if (die2) die2.dataset.v = d2;
  }, 200);

  addLog(
    `${p.name} rolled ${d1}+${d2}=${d1 + d2}${doubles ? " (DOUBLES! 🎲🎲)" : ""}`,
  );

  if (p.inJail) {
    await handleJailRoll(p.id, d1, d2, doubles);
    return;
  }

  if (doubles) {
    p.doublesCount++;
    if (p.doublesCount >= 3) {
      addLog(`${p.name} rolled 3 doubles in a row — Go to Jail!`, "danger");
      sendToJail(p);
      G.phase = "action";
      renderAll();
      updateActionButtons();
      return;
    }
  } else {
    p.doublesCount = 0;
  }

  await movePlayer(p.id, d1 + d2, doubles);
}

async function handleJailRoll(player, d1, d2, doubles) {
  const p = getLivePlayer(player);
  if (!p || p.bankrupt) return;
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
  if (doubles) {
    p.inJail = false;
    p.jailTurns = 0;
    p.doublesCount = 0;
    addLog(`${p.name} rolled doubles — released from jail!`, "success");
    await movePlayer(p.id, d1 + d2, false);
  } else {
    p.jailTurns++;
    if (p.jailTurns >= 3) {
      // Force pay
      addLog(
        `${p.name} must pay ${fmtCurrency(bailAmount)} to leave jail after 3 turns.`,
        "danger",
      );
      const paid = chargeMoney(p, bailAmount);
      if (!paid) {
        G.phase = "end";
        renderAll();
        updateActionButtons();
        return;
      }
      if (p.bankrupt) {
        G.phase = "end";
        renderAll();
        updateActionButtons();
        checkBankruptcy();
        return;
      }
      p.inJail = false;
      p.jailTurns = 0;
      await movePlayer(p.id, d1 + d2, false);
    } else {
      addLog(`${p.name} failed to roll doubles. Jail turn ${p.jailTurns}/3.`);
      G.phase = "end";
      renderAll();
      updateActionButtons();
    }
  }
}

async function movePlayer(player, steps, rolledDoubles) {
  const p = getLivePlayer(player);
  if (!p || p.bankrupt || !Number.isInteger(steps) || steps <= 0) return;
  const playerId = p.id;
  const oldPos = p.pos;
  const newPos = (p.pos + steps) % 40;
  const goSalary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
  let goPaid = false;
  // Pass GO
  if (newPos < oldPos) {
    p.money += goSalary;
    goPaid = true;
    addLog(
      `${p.name} passed GO! Collected ${fmtCurrency(goSalary)}`,
      "success",
    );
  }

  G.phase = "action";
  const moved = await animatePlayerStepMovement(playerId, steps);
  if (!moved) return;
  MOVE_FX.active = true;
  MOVE_FX.playerId = playerId;
  updateActionButtons();
  try {
    const livePlayer = getLivePlayer(playerId);
    if (!livePlayer || livePlayer.bankrupt) return;
    livePlayer.pos = newPos;
    renderAll();
    await waitMs(160);
    landOn(livePlayer, rolledDoubles, { goPaid });
  } finally {
    MOVE_FX.active = false;
    MOVE_FX.playerId = null;
    updateActionButtons();
  }
}

async function movePlayerTo(player, target, collectGo = true) {
  const p = getLivePlayer(player);
  if (!p || p.bankrupt) return;
  const playerId = p.id;
  const oldPos = p.pos;
  const goSalary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
  const stepsForward = (target - oldPos + 40) % 40;
  let goPaid = false;
  if (collectGo && stepsForward > 0 && target < oldPos) {
    p.money += goSalary;
    goPaid = true;
    addLog(
      `${p.name} passed GO! Collected ${fmtCurrency(goSalary)}`,
      "success",
    );
  }

  if (stepsForward > 0 && stepsForward <= 12) {
    const moved = await animatePlayerStepMovement(playerId, stepsForward);
    if (!moved) return;
  } else {
    const live = getLivePlayer(playerId);
    if (!live || live.bankrupt) return;
    live.pos = target;
    renderMarkers();
    if (stepsForward > 0) pulseBoardSpace(target, "step-arrive", 360);
  }

  MOVE_FX.active = true;
  MOVE_FX.playerId = playerId;
  updateActionButtons();
  try {
    const livePlayer = getLivePlayer(playerId);
    if (!livePlayer || livePlayer.bankrupt) return;
    livePlayer.pos = target;
    renderAll();
    await waitMs(140);
    landOn(livePlayer, false, { goPaid });
  } finally {
    MOVE_FX.active = false;
    MOVE_FX.playerId = null;
    updateActionButtons();
  }
}

function landOn(p, rolledDoubles, opts = null) {
  const playerId = Number(p?.id);
  if (
    !Number.isInteger(playerId) ||
    playerId < 0 ||
    playerId >= G.players.length
  )
    return;
  if (Number(G.currentPlayerIdx) !== playerId) return;

  const sp = SPACES[p.pos];
  const goSalary = getThemeGoSalary(G.boardThemeId || selectedThemeId);
  const goPaid = !!(opts && opts.goPaid);
  addLog(`${p.name} landed on ${sp.name}`);

  if (sp.type === "go") {
    if (!goPaid) {
      addLog(
        `${p.name} landed on GO — collect ${fmtCurrency(goSalary)}!`,
        "success",
      );
      p.money += goSalary;
    }
    G.phase = "end";
  } else if (sp.type === "jail") {
    addLog(`${p.name} is just visiting jail.`);
    G.phase = "end";
  } else if (sp.type === "parking") {
    addLog(`${p.name} is just visiting free parking.`);
    G.phase = "end";
  } else if (sp.type === "gotojail") {
    sendToJail(p);
    G.phase = "end";
  } else if (sp.type === "chance") {
    drawCard("chance", p);
    return;
  } else if (sp.type === "community") {
    drawCard("community", p);
    return;
  } else if (sp.type === "tax") {
    addLog(`${p.name} pays ${fmtCurrency(sp.amount)} tax.`, "danger");
    playSfx("tax");
    chargeMoney(p, sp.amount, null, true);
    G.phase = "end";
  } else if (
    sp.type === "property" ||
    sp.type === "railroad" ||
    sp.type === "utility"
  ) {
    const prop = G.properties[p.pos];
    if (!prop) {
      G.phase = "end";
    } else if (prop.mortgaged) {
      addLog(`${sp.name} is mortgaged — no rent.`);
      G.phase = "end";
    } else if (prop.owner === null) {
      // Can buy
      G.pendingBuy = p.pos;
      promptBuy(p, sp);
      renderAll();
      updateActionButtons();
      return;
    } else if (prop.owner === p.id) {
      addLog(`${p.name} owns ${sp.name}.`);
      G.phase = "end";
    } else {
      // Pay rent
      const rent = calcRent(sp, prop);
      const owner = G.players[prop.owner];
      addLog(
        `${p.name} pays ${fmtCurrency(rent)} rent to ${owner.name} for ${sp.name}.`,
        "danger",
      );
      playSfx("rent");
      showRentModal(p, owner, sp.name, rent);
      chargeMoney(p, rent, owner);
      G.phase = "end";
    }
  }

  // If rolled doubles and not in jail, get another roll
  if (rolledDoubles && !p.inJail && !G.gameOver) {
    addLog(`${p.name} rolled doubles — roll again!`, "success");
    G.phase = "roll";
  }

  renderAll();
  updateActionButtons();
  checkBankruptcy();
}

// ═══════════════════════════════════════════════
//  RENT CALCULATION
// ═══════════════════════════════════════════════
function countOwnedSpacesByType(ownerId, type) {
  if (!Number.isInteger(ownerId) || !type) return 0;
  let count = 0;
  for (let id = 0; id < SPACES.length; id++) {
    const space = SPACES[id];
    const prop = G.properties[id];
    if (!space || !prop || space.type !== type) continue;
    if (prop.owner === null || prop.owner === undefined) continue;
    const propOwner = Number(prop.owner);
    if (Number.isInteger(propOwner) && propOwner === ownerId) count++;
  }
  return count;
}

function currentDiceTotalForUtilityRent() {
  const rawDie1 = Number(G?.dice?.[0]);
  const rawDie2 = Number(G?.dice?.[1]);
  if (!Number.isFinite(rawDie1) || !Number.isFinite(rawDie2)) return 0;
  const die1 = Math.max(1, Math.min(6, Math.trunc(rawDie1)));
  const die2 = Math.max(1, Math.min(6, Math.trunc(rawDie2)));
  return die1 + die2;
}

function calcRent(sp, prop) {
  if (prop.mortgaged) return 0;
  if (sp.type === "railroad") {
    if (prop.owner === null || prop.owner === undefined) return 0;
    const ownerId = Number(prop.owner);
    if (
      !Number.isInteger(ownerId) ||
      ownerId < 0 ||
      ownerId >= G.players.length
    )
      return 0;
    const rrCount = Math.max(1, countOwnedSpacesByType(ownerId, "railroad"));
    const rentIdx = Math.min(sp.rent.length - 1, rrCount - 1);
    return Number(sp.rent[rentIdx]) || 0;
  }
  if (sp.type === "utility") {
    if (prop.owner === null || prop.owner === undefined) return 0;
    const ownerId = Number(prop.owner);
    if (
      !Number.isInteger(ownerId) ||
      ownerId < 0 ||
      ownerId >= G.players.length
    )
      return 0;
    const utilCount = Math.max(1, countOwnedSpacesByType(ownerId, "utility"));
    const diceTotal = currentDiceTotalForUtilityRent();
    const utilRentCfg = getThemeUtilityRentMultipliers(
      G.boardThemeId || selectedThemeId,
    );
    if (diceTotal <= 0) return 0;
    return utilCount >= 2
      ? diceTotal * utilRentCfg.both
      : diceTotal * utilRentCfg.one;
  }
  if (prop.hotel) return sp.rent[5];
  if (prop.houses > 0) return sp.rent[prop.houses];
  // Check monopoly
  const owner = G.players[prop.owner];
  const groupIds = SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
  const monopoly = groupIds.every(
    (id) => G.properties[id]?.owner === prop.owner,
  );
  return monopoly ? sp.rent[0] * 2 : sp.rent[0];
}

// ═══════════════════════════════════════════════
//  CARDS
// ═══════════════════════════════════════════════
function drawCard(type, p) {
  let card;
  if (type === "chance") {
    card = G.chanceDeck[G.chanceIdx % G.chanceDeck.length];
    G.chanceIdx++;
  } else {
    card = G.communityDeck[G.communityIdx % G.communityDeck.length];
    G.communityIdx++;
  }
  const playerId = Number(p?.id);
  const drawPlayer = getLivePlayer(playerId) || p;
  const cardText = formatThemeCurrencyText(card.text);
  addLog(
    `${drawPlayer.name} drew ${type === "chance" ? "Chance" : "Community Chest"}: ${cardText}`,
  );
  playSfx("card");

  ONLINE.pendingCardResolutions =
    (Number(ONLINE.pendingCardResolutions) || 0) + 1;

  const finalizeCardResolution = async (shouldSync = true) => {
    const pending = Number(ONLINE.pendingCardResolutions) || 0;
    ONLINE.pendingCardResolutions = Math.max(0, pending - 1);
    renderAll();
    updateActionButtons();
    maybeScheduleOfflineAiTurn();

    try {
      if (shouldSync && isOnlineGame() && !ONLINE.isApplyingRemote) {
        await syncRoomState("drawCard");
      }
    } catch (err) {
      console.error(err);
    }
  };

  document.getElementById("card-icon").textContent =
    type === "chance" ? "❓" : "📦";
  document.getElementById("card-title").textContent =
    type === "chance" ? "Chance Card" : "Community Chest";
  document.getElementById("card-desc").textContent = cardText;

  const apply = async () => {
    const actor = getLivePlayer(playerId);
    if (!actor || actor.bankrupt) return;
    if (Number(G.currentPlayerIdx) !== actor.id) return;

    if (card.action === "money") {
      if (card.value > 0) {
        actor.money += card.value;
        addLog(
          `${actor.name} received ${fmtCurrency(card.value)} from a card effect.`,
          "success",
        );
        toast(`+${fmtCurrency(card.value)}`, "gold");
      } else {
        const paid = chargeMoney(actor, -card.value, null, true);
        if (paid)
          addLog(
            `${actor.name} paid ${fmtCurrency(-card.value)} due to a card effect.`,
            "danger",
          );
      }
    } else if (card.action === "goto") {
      await movePlayerTo(actor.id, card.value, card.value < actor.pos);
      return;
    } else if (card.action === "jail") {
      sendToJail(actor);
    } else if (card.action === "jailcard") {
      actor.jailFreeCards++;
      addLog(`${actor.name} got a Get Out of Jail Free card!`, "success");
    } else if (card.action === "nearest") {
      const nearest = nearestRailroad(actor.pos);
      await movePlayerTo(actor.id, nearest);
      return;
    } else if (card.action === "repairs") {
      let cost = 0;
      actor.properties.forEach((id) => {
        const pr = G.properties[id];
        if (pr.hotel) cost += card.value.hotel;
        else cost += pr.houses * card.value.house;
      });
      if (cost > 0) {
        chargeMoney(actor, cost, null, true);
        addLog(
          `${actor.name} paid ${fmtCurrency(cost)} for repairs.`,
          "danger",
        );
      }
    } else if (card.action === "birthday") {
      G.players.forEach((op, oi) => {
        if (oi !== actor.id && !op.bankrupt) {
          op.money -= card.value;
          actor.money += card.value;
        }
      });
      addLog(
        `${actor.name} collected ${fmtCurrency(card.value)} from each player for birthday!`,
        "success",
      );
    }
    G.phase = rolledDoublesThisTurn() ? "roll" : "end";
    renderAll();
    updateActionButtons();
    checkBankruptcy();
  };

  if (shouldAutoActForAi(getLivePlayer(playerId) || p)) {
    closeOverlay("card-overlay");
    apply()
      .then(() => finalizeCardResolution(true))
      .catch((err) => {
        console.error(err);
        finalizeCardResolution(false).catch((syncErr) =>
          console.error(syncErr),
        );
      });
    return;
  }

  closeOverlay("card-overlay");
  openOverlay("card-overlay");
  const cardConfirmBtn = document.querySelector("#card-overlay .btn");
  if (!cardConfirmBtn) {
    finalizeCardResolution(false).catch((err) => console.error(err));
    return;
  }
  cardConfirmBtn.onclick = async () => {
    closeOverlay("card-overlay");
    try {
      await apply();
      await finalizeCardResolution(true);
    } catch (err) {
      console.error(err);
      await finalizeCardResolution(false);
    }
  };
}

function nearestRailroad(pos) {
  const rrs = [5, 15, 25, 35];
  let nearest = rrs[0],
    minDist = 40;
  rrs.forEach((r) => {
    const dist = r > pos ? r - pos : 40 - pos + r;
    if (dist < minDist) {
      minDist = dist;
      nearest = r;
    }
  });
  return nearest;
}

// ═══════════════════════════════════════════════
//  BUY / AUCTION
// ═══════════════════════════════════════════════
function promptBuy(p, sp) {
  if (shouldAutoActForAi(p)) {
    closeOverlay("buy-overlay");
    return;
  }

  const buyBtn = document.querySelector("#buy-overlay .btn-primary");
  const auctionBtn = document.getElementById("buy-auction-btn");
  const auctionsEnabled = isAuctionSystemEnabled();

  if (p.money < sp.price) {
    if (buyBtn) buyBtn.style.display = "none";
    if (auctionBtn) auctionBtn.style.display = auctionsEnabled ? "" : "none";
    document.getElementById("buy-title").textContent = auctionsEnabled
      ? `Can't Afford — Auction!`
      : `Can't Afford`;
    document.getElementById("buy-desc").textContent = auctionsEnabled
      ? `${sp.name} costs ${fmtCurrency(sp.price)} but you only have ${fmtCurrency(p.money)}. It goes to auction.`
      : `${sp.name} costs ${fmtCurrency(sp.price)} but you only have ${fmtCurrency(p.money)}. Auctions are OFF, so this property remains unsold.`;
    openOverlay("buy-overlay");
    return;
  }

  if (buyBtn) buyBtn.style.display = "";
  if (auctionBtn) auctionBtn.style.display = auctionsEnabled ? "" : "none";
  document.getElementById("buy-title").textContent = `Buy ${sp.name}?`;
  document.getElementById("buy-desc").textContent = auctionsEnabled
    ? `Price: ${fmtCurrency(sp.price)}. You have ${fmtCurrency(p.money)}. Buy now or send to auction.`
    : `Price: ${fmtCurrency(sp.price)}. You have ${fmtCurrency(p.money)}. Auctions are OFF for this match.`;
  openOverlay("buy-overlay");
}

function confirmBuy() {
  closeOverlay("buy-overlay");
  actionBuy();
}

function actionBuy() {
  if (!requireTurnControl()) return;
  if (MOVE_FX.active) return;
  const p = curPlayer();
  if (G.pendingBuy === null) return;
  const id = G.pendingBuy;
  const sp = SPACES[id];
  if (p.money < sp.price) {
    toast("Not enough money!", "danger");
    return;
  }
  p.money -= sp.price;
  G.properties[id].owner = p.id;
  if (sp.type === "property") p.properties.push(id);
  else if (sp.type === "railroad") p.railroads.push(id);
  else if (sp.type === "utility") p.utilities.push(id);
  G.pendingBuy = null;
  addLog(
    `${p.name} bought ${sp.name} for ${fmtCurrency(sp.price)}!`,
    "success",
  );
  playSfx("buy");
  toast(`🏠 Bought ${sp.name}!`, "gold");
  G.phase = "end";
  renderAll();
  animatePropertyPurchase(id);
  updateActionButtons();
}

function startAuction() {
  if (!requireTurnControl()) return;
  closeOverlay("buy-overlay");
  const id = G.pendingBuy;
  G.pendingBuy = null;
  const sp = SPACES[id];
  if (!isAuctionSystemEnabled()) {
    if (sp) {
      addLog(`Auction is disabled. ${sp.name} remains unsold.`, "important");
    }
    G.phase = "end";
    renderAll();
    updateActionButtons();
    return;
  }
  if (
    !beginAuction(id, {
      source: "market",
      bidderStartIdx: G.currentPlayerIdx,
    })
  ) {
    addLog("Auction could not start (no eligible bidders).", "danger");
    G.phase = "end";
    renderAll();
    updateActionButtons();
  }
}

function beginAuction(propId, { source = "market", bidderStartIdx = 0 } = {}) {
  if (!isAuctionSystemEnabled()) return false;
  const sp = SPACES[propId];
  const prop = G.properties[propId];
  if (!sp || !prop || prop.owner !== null) return false;
  const activePlayers = G.players.filter((p) => !p.bankrupt).map((p) => p.id);
  if (!activePlayers.length) return false;
  const startPos = activePlayers.includes(bidderStartIdx)
    ? activePlayers.indexOf(bidderStartIdx)
    : 0;
  const openingPercent = pickAuctionOpeningPercent();
  const openingBid = getAuctionOpeningBid(sp.price, openingPercent);

  G.auctionState = {
    propId,
    propName: sp.name,
    currentBid: openingBid,
    highBidder: null,
    passed: new Set(),
    bidderIdx: startPos,
    activePlayers,
    source,
  };
  addLog(
    `Auction opened for ${sp.name} at ${fmtCurrency(openingBid)} (${openingPercent}% opening bid).`,
  );
  playSfx("auction-open");
  renderAuction();
  openOverlay("auction-overlay");
  maybeScheduleOfflineAiTurn();
  return true;
}

function queueBankAuctions(propIds = []) {
  if (!isAuctionSystemEnabled()) return;
  if (!Array.isArray(G.bankAuctionQueue)) G.bankAuctionQueue = [];
  propIds.forEach((id) => {
    if (!Number.isInteger(id)) return;
    if (!G.bankAuctionQueue.includes(id)) G.bankAuctionQueue.push(id);
  });
}

function launchNextBankAuction() {
  if (!isAuctionSystemEnabled()) {
    G.auctionState = null;
    G.bankAuctionQueue = [];
    return false;
  }
  if (G.auctionState) return true;
  if (!Array.isArray(G.bankAuctionQueue)) G.bankAuctionQueue = [];

  while (G.bankAuctionQueue.length) {
    const nextId = G.bankAuctionQueue.shift();
    const prop = G.properties[nextId];
    if (!prop || prop.owner !== null) continue;
    const started = beginAuction(nextId, {
      source: "bank",
      bidderStartIdx: 0,
    });
    if (started) {
      addLog(`Bank auction started for ${SPACES[nextId].name}.`, "important");
      return true;
    }
  }
  return false;
}

function renderAuction() {
  const a = G.auctionState;
  if (!a) return;
  const aiBidderTurn = isOfflineAiAuctionTurn();
  const bidderId = currentAuctionBidderId();
  const bidder = Number.isInteger(bidderId) ? G.players[bidderId] : null;
  const leader = Number.isInteger(a.highBidder)
    ? G.players[a.highBidder]
    : null;
  const basePrice = Number(SPACES[a.propId]?.price) || 0;
  document.getElementById("auc-prop-name").textContent = a.propName;
  document.getElementById("auc-base-price").textContent =
    fmtCurrency(basePrice);
  document.getElementById("auc-bid").textContent = fmtCurrency(a.currentBid);
  document.getElementById("auc-leader").textContent = leader?.name || "None";
  document.getElementById("auc-bidder").textContent = bidder
    ? `${bidder.name}${aiBidderTurn ? " (AI thinking...)" : ""}`
    : "Waiting for bidder sync...";
  document.getElementById("auc-bidder-money").textContent = fmtCurrency(
    bidder?.money || 0,
  );

  openOverlay("auction-overlay");

  const canAct = !aiBidderTurn && canLocalControlAuctionAction();
  document.querySelectorAll("#bid-btns button").forEach((btn) => {
    btn.disabled = !canAct;
  });
}

function nextAuctionBidderIndex(a, startIdx) {
  if (!a || !Array.isArray(a.activePlayers) || !a.activePlayers.length)
    return -1;
  if (!(a.passed instanceof Set)) {
    a.passed = new Set(
      indexedObjectToArray(a.passed).map(Number).filter(Number.isInteger),
    );
  }

  const len = a.activePlayers.length;
  let cursor = Number.isFinite(Number(startIdx))
    ? Math.trunc(Number(startIdx))
    : 0;
  for (let i = 0; i < len; i++) {
    const idx = ((cursor % len) + len) % len;
    const playerId = Number(a.activePlayers[idx]);
    if (!a.passed.has(playerId)) return idx;
    cursor++;
  }
  return -1;
}

function finalizeAuction(a) {
  if (!a) return;
  const source = a.source || "market";
  let awardedPropId = null;
  closeOverlay("auction-overlay");

  if (a.highBidder !== null && a.currentBid > 0) {
    const winner = G.players[a.highBidder];
    const sp = SPACES[a.propId];
    const prop = G.properties[a.propId];
    if (winner && sp && prop && prop.owner === null) {
      winner.money -= a.currentBid;
      prop.owner = winner.id;
      prop.houses = 0;
      prop.hotel = false;
      addOwnedAsset(winner, a.propId);
      awardedPropId = a.propId;
      addLog(
        `${winner.name} wins auction for ${sp.name} at ${fmtCurrency(a.currentBid)}!`,
        "success",
      );
      playSfx("auction-win");
    } else {
      addLog(
        `Auction for ${a.propName} ended with invalid winner state; property remains unsold.`,
        "danger",
      );
    }
  } else {
    addLog(
      `Auction cancelled — all players passed. ${a.propName} remains unsold.`,
    );
  }

  G.auctionState = null;

  if (source === "bank") {
    if (launchNextBankAuction()) {
      renderAll();
      if (Number.isInteger(awardedPropId))
        animatePropertyPurchase(awardedPropId);
      updateActionButtons();
      return;
    }
    addLog("Bank auction series completed.", "important");
    checkBankruptcy();
  }

  G.phase = "end";
  renderAll();
  if (Number.isInteger(awardedPropId)) animatePropertyPurchase(awardedPropId);
  updateActionButtons();
}

function placeBid(amount) {
  if (!requireAuctionControl()) return;
  const a = G.auctionState;
  if (!a) return;
  if (!(a.passed instanceof Set)) {
    a.passed = new Set(
      indexedObjectToArray(a.passed).map(Number).filter(Number.isInteger),
    );
  }
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return;
  const bidder = G.players[bidderId];
  if (!bidder || bidder.bankrupt) return;
  const newBid = a.currentBid + amount;
  if (bidder.money < newBid) {
    toast("Not enough money!", "danger");
    return;
  }
  a.currentBid = newBid;
  a.highBidder = bidder.id;
  addLog(`${bidder.name} bids ${fmtCurrency(newBid)} for ${a.propName}`);
  playSfx("bid");

  const remaining = a.activePlayers.filter((id) => !a.passed.has(id));
  if (remaining.length <= 1 && a.highBidder !== null) {
    finalizeAuction(a);
    return;
  }

  const nextIdx = nextAuctionBidderIndex(a, Number(a.bidderIdx) + 1);
  if (nextIdx < 0) {
    addLog(
      "Auction state had no eligible next bidder; finalizing current auction.",
      "danger",
    );
    finalizeAuction(a);
    return;
  }
  a.bidderIdx = nextIdx;
  renderAuction();
  maybeScheduleOfflineAiTurn();
}

function passAuction() {
  if (!requireAuctionControl()) return;
  const a = G.auctionState;
  if (!a) return;
  if (!(a.passed instanceof Set)) {
    a.passed = new Set(
      indexedObjectToArray(a.passed).map(Number).filter(Number.isInteger),
    );
  }
  const bidderId = currentAuctionBidderId();
  if (!Number.isInteger(bidderId)) return;
  const bidder = G.players[bidderId];
  if (!bidder) return;
  a.passed.add(bidder.id);
  addLog(`${bidder.name} passes the auction`);
  // Check if only one active bidder remains
  const remaining = a.activePlayers.filter((id) => !a.passed.has(id));
  if (
    remaining.length === 0 ||
    (remaining.length === 1 && a.highBidder !== null)
  ) {
    finalizeAuction(a);
    return;
  }

  const nextIdx = nextAuctionBidderIndex(a, Number(a.bidderIdx) + 1);
  if (nextIdx < 0) {
    addLog(
      "Auction pass advanced to no eligible bidder; finalizing current auction.",
      "danger",
    );
    finalizeAuction(a);
    return;
  }
  a.bidderIdx = nextIdx;
  renderAuction();
  maybeScheduleOfflineAiTurn();
}

// ═══════════════════════════════════════════════
//  BUILDING
// ═══════════════════════════════════════════════
function buildableGroups(p) {
  const groups = {};
  p.properties.forEach((id) => {
    const sp = SPACES[id];
    if (!groups[sp.group]) groups[sp.group] = [];
    groups[sp.group].push(id);
  });
  const buildable = [];
  Object.keys(groups).forEach((g) => {
    const groupIds = SPACES.filter(
      (s) => s.type === "property" && s.group === parseInt(g),
    ).map((s) => s.id);
    const monopoly = groupIds.every((id) => G.properties[id]?.owner === p.id);
    const hasMortgaged = groupIds.some((id) => !!G.properties[id]?.mortgaged);
    if (monopoly && !hasMortgaged) buildable.push(groupIds);
  });
  return buildable;
}

function openBuildModal() {
  const p = curPlayer();
  const groups = buildableGroups(p);
  const el = document.getElementById("build-list");
  el.innerHTML = "";
  if (groups.length === 0) {
    el.innerHTML =
      '<p style="color:rgba(255,255,255,.5);font-size:.85rem">No complete color groups to build on.</p>';
  }
  groups.forEach((ids) => {
    ids.forEach((id) => {
      const sp = SPACES[id];
      const prop = G.properties[id];
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:.7rem;padding:.6rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.4rem";
      const c = COLOR[sp.color];
      const houseCost = sp.house;
      const canBuildMore =
        !prop.hotel && prop.houses < 4 && p.money >= houseCost;
      const canBuildHotel =
        prop.houses === 4 && !prop.hotel && p.money >= houseCost;
      const canSell = prop.houses > 0 || prop.hotel;
      row.innerHTML = `
        <div style="width:10px;height:10px;border-radius:2px;background:${c};flex-shrink:0"></div>
        <div style="flex:1;color:#fff;font-size:.85rem;font-weight:600">${sp.name}</div>
        <div style="color:rgba(255,255,255,.5);font-size:.78rem">${prop.hotel ? "🏨" : "🏠".repeat(prop.houses) || "—"}</div>
        <button onclick="buildHouse(${id})" ${canBuildMore && !prop.hotel ? "" : canBuildHotel ? "" : "disabled"} style="background:${canBuildMore || canBuildHotel ? "#2ecc71" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">${prop.houses === 4 && !prop.hotel ? `🏨 Hotel (${fmtCurrency(houseCost)})` : `🏠 Build (${fmtCurrency(houseCost)})`}</button>
        <button onclick="sellHouse(${id})" ${canSell ? "" : "disabled"} style="background:${canSell ? "#e74c3c" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">Sell (${fmtCurrency(Math.floor(houseCost / 2))})</button>
      `;
      el.appendChild(row);
    });
  });
  openOverlay("build-overlay");
}

function buildHouse(propId) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[propId];
  const prop = G.properties[propId];
  if (!sp || !prop || sp.type !== "property") return;
  if (prop.owner !== p.id) {
    toast("You do not own this property.", "danger");
    return;
  }
  if (prop.mortgaged) {
    toast("Cannot build on a mortgaged property.", "danger");
    return;
  }
  if (prop.hotel) {
    toast("This property already has a hotel.", "danger");
    return;
  }

  const groupIds = SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
  const monopoly = groupIds.every((id) => G.properties[id]?.owner === p.id);
  if (!monopoly) {
    toast("Own the full color group to build.", "danger");
    return;
  }
  if (groupIds.some((id) => G.properties[id]?.mortgaged)) {
    toast("Unmortgage this color group before building.", "danger");
    return;
  }

  const cost = sp.house;
  if (p.money < cost) {
    toast("Not enough money!", "danger");
    return;
  }
  p.money -= cost;
  playSfx("build");
  if (prop.houses >= 4) {
    prop.hotel = true;
    prop.houses = 0;
    addLog(
      `${p.name} built a hotel on ${sp.name} for ${fmtCurrency(cost)}.`,
      "success",
    );
  } else {
    prop.houses++;
    addLog(
      `${p.name} built house #${prop.houses} on ${sp.name} for ${fmtCurrency(cost)}.`,
      "success",
    );
  }
  renderAll();
  if (actorIsAi) closeOverlay("build-overlay");
  else openBuildModal(); // refresh
  updateTopBar();
}

function sellHouse(propId) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[propId];
  const prop = G.properties[propId];
  const refund = Math.floor(sp.house / 2);
  p.money += refund;
  playSfx("sell");
  if (prop.hotel) {
    prop.hotel = false;
    prop.houses = 4;
    addLog(`${p.name} sold hotel on ${sp.name} for ${fmtCurrency(refund)}.`);
  } else {
    prop.houses--;
    addLog(`${p.name} sold house on ${sp.name} for ${fmtCurrency(refund)}.`);
  }
  renderAll();
  if (actorIsAi) {
    closeOverlay("build-overlay");
  } else {
    const resolved = tryResolveDebtPrompt();
    if (resolved) {
      closeOverlay("build-overlay");
      updateTopBar();
      return;
    }
    openBuildModal();
  }
  updateTopBar();
}

// ═══════════════════════════════════════════════
//  MORTGAGE
// ═══════════════════════════════════════════════
function propertyHasBuildings(id) {
  const prop = G.properties[id];
  return !!(prop && (prop.houses > 0 || prop.hotel));
}

function propertyGroupHasBuildings(id, includeSelf = true) {
  const sp = SPACES[id];
  if (!sp || sp.type !== "property") return false;
  const groupIds = SPACES.filter(
    (s) => s.type === "property" && s.group === sp.group,
  ).map((s) => s.id);
  return groupIds.some(
    (gid) => (includeSelf || gid !== id) && propertyHasBuildings(gid),
  );
}

function tradeAssetBuildingBlockReason(id) {
  const sp = SPACES[id];
  if (!sp) return "";
  if (propertyHasBuildings(id))
    return `Sell buildings on ${sp.name} before trading it.`;
  if (propertyGroupHasBuildings(id, false)) {
    return `Sell buildings in the ${sp.color} group before trading ${sp.name}.`;
  }
  return "";
}

function mortgageValueForSpace(sp) {
  return Math.floor((Number(sp?.price) || 0) / 2);
}

function canMortgageAsset(player, id) {
  const sp = SPACES[id];
  const prop = G.properties[id];
  if (!sp || !prop || prop.owner !== player.id || prop.mortgaged) return false;
  if (propertyHasBuildings(id)) return false;

  // Monopoly rule: cannot mortgage a color property while any property in that color group has buildings.
  if (sp.type === "property") {
    if (propertyGroupHasBuildings(id, true)) return false;
  }
  return true;
}

function openMortgageModal() {
  const p = curPlayer();
  const el = document.getElementById("mortgage-list");
  el.innerHTML = "";
  const allProps = [...p.properties, ...p.railroads, ...p.utilities];
  if (allProps.length === 0) {
    el.innerHTML =
      '<p style="color:rgba(255,255,255,.5);font-size:.85rem">You own no properties.</p>';
  }
  allProps.forEach((id) => {
    const sp = SPACES[id];
    const prop = G.properties[id];
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;align-items:center;gap:.7rem;padding:.6rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.4rem";
    const color = sp.type === "property" ? COLOR[sp.color] : "#666";
    const canMortgage = canMortgageAsset(p, id);
    const mortgageValue = mortgageValueForSpace(sp);
    const unmortgageCost = Math.floor(mortgageValue * 1.1);
    const canUnmortgage = prop.mortgaged && p.money >= unmortgageCost;
    row.innerHTML = `
      <div style="width:10px;height:10px;border-radius:2px;background:${color};flex-shrink:0"></div>
      <div style="flex:1;color:${prop.mortgaged ? "rgba(255,255,255,.4)" : "#fff"};font-size:.85rem;font-weight:600">${sp.name}${prop.mortgaged ? " (mortgaged)" : ""}</div>
      ${
        !prop.mortgaged
          ? `<button onclick="mortgageProp(${id})" ${canMortgage ? "" : "disabled"} style="background:${canMortgage ? "#d97706" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">Mortgage ${fmtCurrency(mortgageValue)}</button>`
          : `<button onclick="unmortgageProp(${id})" ${canUnmortgage ? "" : "disabled"} style="background:${canUnmortgage ? "#2ecc71" : "rgba(255,255,255,.1)"};border:none;color:#fff;border-radius:5px;padding:.3rem .5rem;cursor:pointer;font-size:.75rem">Unmortgage ${fmtCurrency(unmortgageCost)}</button>`
      }
    `;
    el.appendChild(row);
  });
  openOverlay("mortgage-overlay");
}

function mortgageProp(id) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[id];
  const prop = G.properties[id];
  if (!canMortgageAsset(p, id)) {
    toast("Sell buildings in this color group before mortgaging.", "danger");
    return;
  }
  const mortgageValue = mortgageValueForSpace(sp);
  prop.mortgaged = true;
  p.money += mortgageValue;
  playSfx("mortgage");
  addLog(`${p.name} mortgaged ${sp.name} for ${fmtCurrency(mortgageValue)}.`);
  renderAll();
  if (actorIsAi) closeOverlay("mortgage-overlay");
  else openMortgageModal();
  if (!actorIsAi) {
    if (tryResolveDebtPrompt()) return;
  }
  updateTopBar();
}

function unmortgageProp(id) {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  const actorIsAi = shouldAutoActForAi(p);
  const sp = SPACES[id];
  const prop = G.properties[id];
  const cost = Math.floor(mortgageValueForSpace(sp) * 1.1);
  if (p.money < cost) {
    toast("Not enough money!", "danger");
    return;
  }
  prop.mortgaged = false;
  p.money -= cost;
  playSfx("unmortgage");
  addLog(`${p.name} unmortgaged ${sp.name} for ${fmtCurrency(cost)}.`);
  renderAll();
  if (actorIsAi) closeOverlay("mortgage-overlay");
  else openMortgageModal();
  if (!actorIsAi) {
    if (tryResolveDebtPrompt()) return;
  }
  updateTopBar();
}

// ═══════════════════════════════════════════════
//  TRADE
// ═══════════════════════════════════════════════
let tradeSelected = { mine: [], theirs: [] };

function getLocalPlayerIndex() {
  if (!isOnlineGame()) return G.currentPlayerIdx;
  return resolveLocalPlayerIndex();
}

function getPendingTradeRole() {
  if (!G.pendingTrade) return "none";
  if (!isOnlineGame()) {
    const recipient = G.players[Number(G.pendingTrade.toId)];
    return isAiPlayer(recipient) ? "ai-recipient" : "offline";
  }
  const me = getLocalPlayerIndex();
  if (me === G.pendingTrade.toId) return "recipient";
  if (me === G.pendingTrade.fromId) return "proposer";
  return "spectator";
}

function tradeOfferPropsHtml(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    return '<div style="color:rgba(255,255,255,.4);font-size:.82rem">No properties</div>';
  }
  return ids
    .map((id) => {
      const sp = SPACES[id];
      if (!sp) return "";
      const c = sp.type === "property" ? COLOR[sp.color] : "#666";
      return `<div class="trade-prop-item" style="cursor:default"><div class="tprop-dot" style="background:${c}"></div>${escHtml(sp.name)}</div>`;
    })
    .join("");
}

function renderTradeReviewModal() {
  const modal = document.getElementById("trade-review-modal");
  const trade = G.pendingTrade;
  if (!modal) return;
  if (!trade) {
    modal.innerHTML =
      '<h2>🤝 Trade</h2><p style="color:rgba(255,255,255,.6)">No pending trade proposal.</p>';
    return;
  }

  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];
  if (!from || !to) {
    modal.innerHTML =
      '<h2>🤝 Trade</h2><p style="color:#ff9ca1">This trade is no longer valid.</p>';
    return;
  }

  const role = getPendingTradeRole();
  const canRespond = role === "recipient" || role === "offline";
  const canCancel = role === "proposer" || role === "offline";
  const statusLabel =
    role === "recipient"
      ? "📨 Your response is needed"
      : role === "proposer"
        ? `⏳ Waiting for ${to.name}`
        : role === "ai-recipient"
          ? `🤖 ${to.name} is reviewing this trade`
          : role === "offline"
            ? "🧪 Local trade review mode"
            : "ℹ️ Trade in progress";
  const statusStyle =
    role === "recipient"
      ? "background:rgba(22,163,74,.2);border:1px solid rgba(74,222,128,.45);color:#b7f7cb;"
      : role === "proposer"
        ? "background:rgba(37,99,235,.25);border:1px solid rgba(125,211,252,.45);color:#d8ecff;"
        : role === "ai-recipient"
          ? "background:rgba(59,130,246,.2);border:1px solid rgba(147,197,253,.5);color:#dbeafe;"
          : role === "offline"
            ? "background:rgba(217,119,6,.2);border:1px solid rgba(252,211,77,.45);color:#ffe9b8;"
            : "background:rgba(148,163,184,.2);border:1px solid rgba(203,213,225,.45);color:#e2e8f0;";
  const roleText =
    role === "recipient"
      ? "You received this trade offer."
      : role === "proposer"
        ? `Waiting for ${to.name} to respond.`
        : role === "ai-recipient"
          ? `${to.name} is deciding automatically.`
          : role === "offline"
            ? `${from.name} offered this trade to ${to.name}.`
            : "Trade in progress.";

  modal.innerHTML = `
    <h2>🤝 Trade Proposal</h2>
    <div style="display:inline-flex;align-items:center;padding:.28rem .62rem;border-radius:999px;font-size:.74rem;font-weight:700;letter-spacing:.02em;margin-bottom:.55rem;${statusStyle}">${escHtml(statusLabel)}</div>
    <p style="color:rgba(255,255,255,.62);font-size:.82rem;margin-bottom:.75rem">${escHtml(roleText)}</p>
    <div class="trade-sides">
      <div>
        <h4>${escHtml(from.name)} gives</h4>
        <div class="trade-prop-list">${tradeOfferPropsHtml(trade.fromProps)}</div>
        <div style="margin-top:.5rem;color:rgba(255,255,255,.7);font-size:.82rem">Money: ${fmtCurrency(trade.fromMoney || 0)}</div>
      </div>
      <div>
        <h4>${escHtml(to.name)} gives</h4>
        <div class="trade-prop-list">${tradeOfferPropsHtml(trade.toProps)}</div>
        <div style="margin-top:.5rem;color:rgba(255,255,255,.7);font-size:.82rem">Money: ${fmtCurrency(trade.toMoney || 0)}</div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="respondTrade(true)" ${canRespond ? "" : "disabled"}>✅ Accept</button>
      <button class="btn btn-danger" onclick="respondTrade(false)" ${canRespond ? "" : "disabled"}>❌ Decline</button>
      <button class="btn" style="background:rgba(255,255,255,.1);color:#fff" onclick="cancelTradeProposal()" ${canCancel ? "" : "disabled"}>Cancel Proposal</button>
    </div>
  `;
}

function maybeShowPendingTradeReview() {
  const overlay = document.getElementById("trade-review-overlay");
  if (!overlay) return;
  if (!G.pendingTrade) {
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
    return;
  }

  const role = getPendingTradeRole();
  if (role === "spectator") {
    closeOverlay("trade-review-overlay");
    return;
  }

  renderTradeReviewModal();
  const key = `${G.pendingTrade.id || "trade"}:${role}`;
  if (!overlay.classList.contains("show") || tradeReviewShownKey !== key) {
    tradeReviewShownKey = key;
    const activeOverlay = document.querySelector(".overlay.show");
    if (!activeOverlay || activeOverlay.id === "trade-review-overlay") {
      openOverlay("trade-review-overlay");
    }
  }
}

function validatePendingTrade(trade) {
  if (!trade) return "Trade proposal is missing.";
  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];
  if (!from || !to || from.bankrupt || to.bankrupt)
    return "One of the players is bankrupt.";
  if (trade.fromMoney > from.money)
    return `${from.name} no longer has enough cash.`;
  if (trade.toMoney > to.money) return `${to.name} no longer has enough cash.`;

  for (const id of trade.fromProps || []) {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop || prop.owner !== from.id)
      return `${from.name} no longer owns ${sp?.name || "a property"}.`;
    const blockReason = tradeAssetBuildingBlockReason(id);
    if (blockReason) return blockReason;
  }

  for (const id of trade.toProps || []) {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop || prop.owner !== to.id)
      return `${to.name} no longer owns ${sp?.name || "a property"}.`;
    const blockReason = tradeAssetBuildingBlockReason(id);
    if (blockReason) return blockReason;
  }

  return "";
}

function applyAcceptedTrade(trade) {
  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];

  (trade.fromProps || []).forEach((id) => {
    const prop = G.properties[id];
    if (!prop) return;
    prop.owner = to.id;
    clearOwnedAsset(from, id);
    addOwnedAsset(to, id);
  });

  (trade.toProps || []).forEach((id) => {
    const prop = G.properties[id];
    if (!prop) return;
    prop.owner = from.id;
    clearOwnedAsset(to, id);
    addOwnedAsset(from, id);
  });

  from.money = from.money - (trade.fromMoney || 0) + (trade.toMoney || 0);
  to.money = to.money - (trade.toMoney || 0) + (trade.fromMoney || 0);

  addLog(`${from.name} and ${to.name} completed a trade.`, "success");
}

function openTradeModal() {
  if (G.pendingTrade) {
    toast("Resolve the current trade proposal first.", "danger");
    maybeShowPendingTradeReview();
    return;
  }

  const p = curPlayer();
  const sel = document.getElementById("trade-partner");
  sel.innerHTML = "";
  G.players.forEach((op, i) => {
    if (i !== p.id && !op.bankrupt) {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = `${op.token} ${op.name}`;
      sel.appendChild(opt);
    }
  });
  tradeSelected = { mine: [], theirs: [] };
  document.getElementById("trade-my-money").value = 0;
  document.getElementById("trade-their-money").value = 0;
  if (!sel.options.length) {
    toast("No valid trade partners available.", "danger");
    return;
  }
  renderTradeProps();
  openOverlay("trade-overlay");
}

function renderTradeProps() {
  const p = curPlayer();
  const partnerId = parseInt(
    document.getElementById("trade-partner").value,
    10,
  );
  const partner = G.players[partnerId];

  const renderList = (el, props, isMyList) => {
    el.innerHTML = "";
    props.forEach((id) => {
      const sp = SPACES[id];
      const listKey = isMyList ? "mine" : "theirs";
      const list = tradeSelected[listKey];
      const blockReason = tradeAssetBuildingBlockReason(id);
      const selected = list.includes(id);
      if (blockReason && selected) {
        const idx = list.indexOf(id);
        if (idx >= 0) list.splice(idx, 1);
      }
      const item = document.createElement("div");
      item.className =
        "trade-prop-item" + (selected && !blockReason ? " selected" : "");
      const c = sp.type === "property" ? COLOR[sp.color] : "#666";
      item.innerHTML = `<div class="tprop-dot" style="background:${c}"></div>${sp.name}`;
      if (blockReason) {
        item.style.opacity = ".55";
        item.style.cursor = "not-allowed";
        item.title = blockReason;
      }
      item.onclick = () => {
        if (blockReason) {
          toast(blockReason, "danger");
          return;
        }
        const idx = list.indexOf(id);
        if (idx >= 0) list.splice(idx, 1);
        else list.push(id);
        renderTradeProps();
      };
      el.appendChild(item);
    });
    if (props.length === 0)
      el.innerHTML =
        '<div style="color:rgba(255,255,255,.3);font-size:.8rem;padding:.3rem">No properties</div>';
  };

  const myAll = [...p.properties, ...p.railroads, ...p.utilities];
  const theirAll = partner
    ? [...partner.properties, ...partner.railroads, ...partner.utilities]
    : [];
  renderList(document.getElementById("trade-my-props"), myAll, true);
  renderList(document.getElementById("trade-their-props"), theirAll, false);
}

function confirmTrade() {
  if (!requireTurnControl()) return;
  if (G.pendingTrade) {
    toast("A trade is already pending.", "danger");
    return;
  }

  const p = curPlayer();
  const partnerId = parseInt(
    document.getElementById("trade-partner").value,
    10,
  );
  const partner = G.players[partnerId];
  if (!partner || partner.bankrupt || partner.id === p.id) {
    toast("Select a valid trade partner.", "danger");
    return;
  }

  const myMoney = Math.max(
    0,
    parseInt(document.getElementById("trade-my-money").value, 10) || 0,
  );
  const theirMoney = Math.max(
    0,
    parseInt(document.getElementById("trade-their-money").value, 10) || 0,
  );

  const myBlocked = tradeSelected.mine.find(
    (id) => !!tradeAssetBuildingBlockReason(id),
  );
  if (myBlocked !== undefined) {
    toast(tradeAssetBuildingBlockReason(myBlocked), "danger");
    return;
  }
  const theirBlocked = tradeSelected.theirs.find(
    (id) => !!tradeAssetBuildingBlockReason(id),
  );
  if (theirBlocked !== undefined) {
    toast(tradeAssetBuildingBlockReason(theirBlocked), "danger");
    return;
  }

  if (myMoney > p.money) {
    toast("You don't have that much money!", "danger");
    return;
  }
  if (theirMoney > partner.money) {
    toast(`${partner.name} doesn\'t have that much!`, "danger");
    return;
  }

  const myInvalidOwner = tradeSelected.mine.find(
    (id) => G.properties[id]?.owner !== p.id,
  );
  if (myInvalidOwner !== undefined) {
    toast(`You no longer own ${SPACES[myInvalidOwner].name}.`, "danger");
    return;
  }
  const partnerInvalidOwner = tradeSelected.theirs.find(
    (id) => G.properties[id]?.owner !== partner.id,
  );
  if (partnerInvalidOwner !== undefined) {
    toast(
      `${partner.name} no longer owns ${SPACES[partnerInvalidOwner].name}.`,
      "danger",
    );
    return;
  }

  if (
    !tradeSelected.mine.length &&
    !tradeSelected.theirs.length &&
    myMoney === 0 &&
    theirMoney === 0
  ) {
    toast("Add cash or properties to propose a trade.", "danger");
    return;
  }

  G.pendingTrade = {
    id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    fromId: p.id,
    toId: partner.id,
    fromProps: [...tradeSelected.mine],
    toProps: [...tradeSelected.theirs],
    fromMoney: myMoney,
    toMoney: theirMoney,
    createdAt: Date.now(),
  };

  tradeReviewShownKey = "";
  addLog(`${p.name} proposed a trade to ${partner.name}.`, "important");
  closeOverlay("trade-overlay");
  renderAll();
  updateActionButtons();
  toast(`Trade proposal sent to ${partner.name}.`, "gold");
}

function respondTrade(acceptTrade) {
  const trade = G.pendingTrade;
  if (!trade) return;

  if (isOnlineGame()) {
    const me = getLocalPlayerIndex();
    const recipient = G.players[trade.toId];
    const aiRecipient = recipient && isAiPlayer(recipient);
    if (me !== trade.toId && !(aiRecipient && canRunAiController())) {
      toast(
        `Only ${G.players[trade.toId]?.name || "the recipient"} can respond.`,
        "danger",
      );
      return;
    }
  }

  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];

  if (!acceptTrade) {
    aiRecordTradeResolution(trade, false);
    addLog(
      `${to?.name || "Player"} declined ${from?.name || "player"}'s trade proposal.`,
      "danger",
    );
    G.pendingTrade = null;
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
    renderAll();
    updateActionButtons();
    return;
  }

  const invalidReason = validatePendingTrade(trade);
  if (invalidReason) {
    addLog(`Trade proposal canceled: ${invalidReason}`, "danger");
    toast(invalidReason, "danger");
    G.pendingTrade = null;
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
    renderAll();
    updateActionButtons();
    return;
  }

  applyAcceptedTrade(trade);
  aiRecordTradeResolution(trade, true);
  G.pendingTrade = null;
  tradeReviewShownKey = "";
  closeOverlay("trade-review-overlay");
  renderAll();
  updateActionButtons();
  checkBankruptcy();
  toast("Trade completed! 🤝", "gold");
}

function cancelTradeProposal() {
  const trade = G.pendingTrade;
  if (!trade) return;

  if (isOnlineGame()) {
    const me = getLocalPlayerIndex();
    if (me !== trade.fromId) {
      toast(
        `Only ${G.players[trade.fromId]?.name || "the proposer"} can cancel this trade.`,
        "danger",
      );
      return;
    }
  }

  const from = G.players[trade.fromId];
  const to = G.players[trade.toId];
  addLog(
    `${from?.name || "Player"} canceled the trade proposal to ${to?.name || "player"}.`,
    "danger",
  );
  G.pendingTrade = null;
  tradeReviewShownKey = "";
  closeOverlay("trade-overlay");
  closeOverlay("trade-review-overlay");
  renderAll();
  updateActionButtons();
}

// ═══════════════════════════════════════════════
//  JAIL
// ═══════════════════════════════════════════════
function showJailPrompt(p, mode = "turn") {
  const iconEl = document.getElementById("jail-icon");
  const titleEl = document.getElementById("jail-title");
  const descEl = document.getElementById("jail-desc");
  const actionsEl = document.getElementById("jail-actions");
  if (!iconEl || !titleEl || !descEl || !actionsEl || !p) return;
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);

  if (shouldAutoActForAi(p)) {
    closeOverlay("jail-overlay");
    return;
  }

  if (mode === "sent") {
    iconEl.textContent = "🚔";
    titleEl.textContent = "Go to Jail!";
    descEl.textContent =
      p.jailFreeCards > 0
        ? `You have ${p.jailFreeCards} Get Out of Jail Free card(s). On your turn, choose to roll dice or use a card to get out.`
        : `On your turn, choose to roll dice for doubles or pay ${fmtCurrency(bailAmount)} bail.`;
    actionsEl.innerHTML =
      '<button class="btn btn-primary btn-full" onclick="closeOverlay(\'jail-overlay\')">OK</button>';
    openOverlay("jail-overlay");
    return;
  }

  const myTurn = canLocalControlTurn();
  const canPay = p.jailFreeCards > 0 || p.money >= bailAmount;
  const bailLabel =
    p.jailFreeCards > 0
      ? `🎟 Use Card${p.jailFreeCards > 1 ? ` (${p.jailFreeCards})` : ""}`
      : `💳 Pay ${fmtCurrency(bailAmount)} Bail`;

  iconEl.textContent = "⛓️";
  titleEl.textContent = `${p.name} is in Jail`;

  if (!myTurn) {
    descEl.textContent = `Waiting for ${p.name} to choose: roll dice or pay bail.`;
    actionsEl.innerHTML =
      '<button class="btn btn-full" style="background:rgba(255,255,255,.12);color:#fff" onclick="closeOverlay(\'jail-overlay\')">Close</button>';
    openOverlay("jail-overlay");
    return;
  }

  descEl.textContent = `Choose now: roll for doubles or ${p.jailFreeCards > 0 ? "use a card to leave jail" : `pay ${fmtCurrency(bailAmount)} bail`}.`;
  actionsEl.innerHTML = `
    <button class="btn btn-primary" onclick="closeOverlay('jail-overlay'); rollDice();">🎲 Roll Dice</button>
    <button class="btn ${canPay ? "btn-gold" : ""}" ${canPay ? "" : "disabled"} style="${canPay ? "" : "background:rgba(255,255,255,.12);color:rgba(255,255,255,.45)"}" onclick="closeOverlay('jail-overlay'); payBailout();">${bailLabel}</button>
  `;
  openOverlay("jail-overlay");
}

function sendToJail(p) {
  p.inJail = true;
  p.jailTurns = 0;
  p.pos = 10;
  p.doublesCount = 0;
  addLog(`${p.name} goes to jail! ⛓️`, "danger");
  playSfx("jail");
  showJailPrompt(p, "sent");
}

function payBailout() {
  if (!requireTurnControl()) return;
  const p = curPlayer();
  if (!p.inJail) return;
  const bailAmount = getThemeJailBail(G.boardThemeId || selectedThemeId);
  if (p.jailFreeCards > 0) {
    p.jailFreeCards--;
    p.inJail = false;
    p.jailTurns = 0;
    addLog(`${p.name} used a Get Out of Jail Free card!`, "success");
    playSfx("bail");
  } else if (p.money >= bailAmount) {
    chargeMoney(p, bailAmount, null, true);
    p.inJail = false;
    p.jailTurns = 0;
    addLog(
      `${p.name} paid ${fmtCurrency(bailAmount)} bail and is free!`,
      "success",
    );
    playSfx("bail");
  } else {
    toast("Not enough money!", "danger");
    return;
  }
  renderAll();
  updateActionButtons();
}

// ═══════════════════════════════════════════════
//  MONEY & BANKRUPTCY
// ═══════════════════════════════════════════════
function sellBuildingsForEmergencyCash(player) {
  if (!player || player.bankrupt) return 0;
  let raised = 0;
  player.properties.forEach((id) => {
    const sp = SPACES[id];
    const prop = G.properties[id];
    if (!sp || !prop) return;
    if (prop.hotel) {
      const refund = Math.floor((sp.house * 5) / 2);
      prop.hotel = false;
      prop.houses = 0;
      player.money += refund;
      raised += refund;
      addLog(
        `${player.name} sold hotel on ${sp.name} for ${fmtCurrency(refund)}.`,
        "danger",
      );
    }
    if (prop.houses > 0) {
      const count = prop.houses;
      const refund = Math.floor((sp.house * count) / 2);
      prop.houses = 0;
      player.money += refund;
      raised += refund;
      addLog(
        `${player.name} sold ${count} house${count > 1 ? "s" : ""} on ${sp.name} for ${fmtCurrency(refund)}.`,
        "danger",
      );
    }
  });
  return raised;
}

function addOwnedAsset(player, id) {
  const sp = SPACES[id];
  if (!sp || !player) return;
  if (sp.type === "property" && !player.properties.includes(id))
    player.properties.push(id);
  else if (sp.type === "railroad" && !player.railroads.includes(id))
    player.railroads.push(id);
  else if (sp.type === "utility" && !player.utilities.includes(id))
    player.utilities.push(id);
}

function clearOwnedAsset(player, id) {
  removeFrom(player.properties, id);
  removeFrom(player.railroads, id);
  removeFrom(player.utilities, id);
}

function markPlayerBankruptStanding(player, state = G) {
  if (!player || !state || typeof state !== "object") return null;

  const existingOrder = Number(player.bankruptOrder);
  if (Number.isInteger(existingOrder) && existingOrder > 0) {
    const currentSeq = Math.max(0, Number(state.bankruptcySeq) || 0);
    state.bankruptcySeq = Math.max(currentSeq, existingOrder);
    return existingOrder;
  }

  const nextOrder = Math.max(0, Number(state.bankruptcySeq) || 0) + 1;
  state.bankruptcySeq = nextOrder;
  player.bankruptOrder = nextOrder;
  return nextOrder;
}

function syncDebtPromptToGameState() {
  if (!G || typeof G !== "object") return;
  if (!DEBT_PROMPT.active) {
    G.debtPrompt = null;
    return;
  }
  const payerIdRaw = Number(DEBT_PROMPT.payerId);
  const recipientIdRaw = Number(DEBT_PROMPT.recipientId);
  G.debtPrompt = {
    active: true,
    payerId: Number.isInteger(payerIdRaw) ? payerIdRaw : null,
    amount: Math.max(0, Number(DEBT_PROMPT.amount) || 0),
    recipientId: Number.isInteger(recipientIdRaw) ? recipientIdRaw : null,
    toParking: !!DEBT_PROMPT.toParking,
  };
}

function restoreDebtPromptFromGameState(state = G) {
  if (!state || typeof state !== "object") {
    resetDebtPrompt(false);
    return false;
  }
  const raw =
    state.debtPrompt && typeof state.debtPrompt === "object"
      ? state.debtPrompt
      : null;
  if (!raw || raw.active === false) {
    resetDebtPrompt(false);
    if (state === G) state.debtPrompt = null;
    return false;
  }

  const payerId = Number(raw.payerId);
  const payerValid =
    Number.isInteger(payerId) &&
    Array.isArray(state.players) &&
    payerId >= 0 &&
    payerId < state.players.length;
  const payer = payerValid ? state.players[payerId] : null;
  if (!payer || payer.bankrupt) {
    resetDebtPrompt(false);
    if (state === G) state.debtPrompt = null;
    return false;
  }

  const recipientIdRaw = Number(raw.recipientId);
  const recipientId =
    Number.isInteger(recipientIdRaw) &&
    recipientIdRaw >= 0 &&
    recipientIdRaw < state.players.length
      ? recipientIdRaw
      : null;

  DEBT_PROMPT.active = true;
  DEBT_PROMPT.payerId = payerId;
  DEBT_PROMPT.amount = Math.max(0, Number(raw.amount) || 0);
  DEBT_PROMPT.recipientId = recipientId;
  DEBT_PROMPT.toParking = !!raw.toParking;

  if (state === G) syncDebtPromptToGameState();
  return true;
}

function normalizeDebtPromptTurn() {
  if (
    !DEBT_PROMPT.active ||
    !G ||
    !Array.isArray(G.players) ||
    !G.players.length
  )
    return false;
  const payerId = Number(DEBT_PROMPT.payerId);
  if (
    !Number.isInteger(payerId) ||
    payerId < 0 ||
    payerId >= G.players.length ||
    G.players[payerId]?.bankrupt
  ) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return true;
  }
  if (Number(G.currentPlayerIdx) !== payerId) {
    G.currentPlayerIdx = payerId;
    if (G.phase === "roll") G.phase = "action";
    return true;
  }
  return false;
}

function hasPendingDebtPromptForCurrentPlayer() {
  return !!(
    DEBT_PROMPT.active &&
    Number(DEBT_PROMPT.payerId) === Number(G.currentPlayerIdx)
  );
}

function resetDebtPrompt(updateGameState = true) {
  DEBT_PROMPT.active = false;
  DEBT_PROMPT.payerId = null;
  DEBT_PROMPT.amount = 0;
  DEBT_PROMPT.recipientId = null;
  DEBT_PROMPT.toParking = false;
  if (updateGameState && G && typeof G === "object") {
    G.debtPrompt = null;
  }
}

function showDebtPrompt(p, amount, recipient = null, toParking = false) {
  if (!p) return;
  DEBT_PROMPT.active = true;
  DEBT_PROMPT.payerId = p.id;
  DEBT_PROMPT.amount = Math.max(0, Number(amount) || 0);
  DEBT_PROMPT.recipientId =
    recipient && !recipient.bankrupt ? recipient.id : null;
  DEBT_PROMPT.toParking = !!toParking;

  const shortBy = Math.max(0, DEBT_PROMPT.amount - (Number(p.money) || 0));
  const creditorName =
    DEBT_PROMPT.recipientId !== null
      ? G.players[DEBT_PROMPT.recipientId]?.name || "another player"
      : "the bank";
  const titleEl = document.getElementById("bankrupt-name");
  const descEl = document.getElementById("bankrupt-desc");
  const continueBtn = document.getElementById("bankrupt-continue-btn");
  const mortgageBtn = document.getElementById("bankrupt-mortgage-btn");
  const sellBtn = document.getElementById("bankrupt-sell-btn");
  if (titleEl)
    titleEl.textContent = `${p.name} must pay ${fmtCurrency(DEBT_PROMPT.amount)}`;
  if (descEl) {
    descEl.textContent = `${p.name} owes ${creditorName} and is short by ${fmtCurrency(shortBy)}. Sell buildings or mortgage properties to raise funds, or declare bankruptcy.`;
  }
  if (continueBtn) continueBtn.textContent = "Declare Bankruptcy";
  if (mortgageBtn) mortgageBtn.style.display = "";
  if (sellBtn) {
    const hasBuildings = (p.properties || []).some((id) =>
      propertyHasBuildings(id),
    );
    sellBtn.style.display = hasBuildings ? "" : "none";
  }
  syncDebtPromptToGameState();
  openOverlay("bankrupt-overlay");
}

function openMortgageForDebt() {
  if (!hasPendingDebtPromptForCurrentPlayer()) {
    closeOverlay("bankrupt-overlay");
    return;
  }
  closeOverlay("bankrupt-overlay");
  openMortgageModal();
}

function openBuildForDebt() {
  if (!hasPendingDebtPromptForCurrentPlayer()) {
    closeOverlay("bankrupt-overlay");
    return;
  }
  closeOverlay("bankrupt-overlay");
  openBuildModal();
}

function tryResolveDebtPrompt() {
  if (!DEBT_PROMPT.active) return false;
  const payer = G.players[DEBT_PROMPT.payerId];
  if (!payer || payer.bankrupt) {
    resetDebtPrompt();
    closeOverlay("bankrupt-overlay");
    return false;
  }

  const due = Math.max(0, Number(DEBT_PROMPT.amount) || 0);
  if (payer.money < due) return false;

  payer.money -= due;
  const recipient =
    DEBT_PROMPT.recipientId !== null
      ? G.players[DEBT_PROMPT.recipientId]
      : null;
  if (recipient && !recipient.bankrupt) recipient.money += due;

  const creditorName =
    recipient && !recipient.bankrupt ? recipient.name : "the bank";
  addLog(
    `${payer.name} settled debt of ${fmtCurrency(due)} to ${creditorName}.`,
    "success",
  );
  resetDebtPrompt();
  closeOverlay("bankrupt-overlay");
  closeOverlay("mortgage-overlay");
  renderAll();
  updateActionButtons();
  return true;
}

function chargeMoney(p, amount, recipient = null, toParking = false) {
  if (amount <= 0) {
    if (recipient) recipient.money += Math.abs(amount);
    return true;
  }
  if (!p || p.bankrupt) return false;

  const actorIsAi = shouldAutoActForAi(p);

  if (p.money < amount && actorIsAi) {
    const raised = sellBuildingsForEmergencyCash(p);
    if (raised > 0) {
      addLog(
        `${p.name} raised ${fmtCurrency(raised)} by liquidating buildings.`,
        "important",
      );
    }
  }

  if (actorIsAi && p.money < amount) {
    let usedMortgages = 0;
    while (p.money < amount && usedMortgages < 32) {
      const target = amount + Math.floor(aiCashReserve(p) * 0.25);
      const mortgaged = aiTryMortgageToTarget(p, target);
      if (!mortgaged) break;
      usedMortgages++;
    }
    if (usedMortgages > 0) {
      addLog(
        `${p.name} used ${usedMortgages} emergency mortgage${usedMortgages > 1 ? "s" : ""} to avoid bankruptcy.`,
        "important",
      );
    }
  }

  if (p.money >= amount) {
    p.money -= amount;
    if (recipient && !recipient.bankrupt) recipient.money += amount;
    if (DEBT_PROMPT.active && DEBT_PROMPT.payerId === p.id) {
      resetDebtPrompt();
      closeOverlay("bankrupt-overlay");
    }
    return true;
  }

  if (!actorIsAi) {
    showDebtPrompt(
      p,
      amount,
      recipient && !recipient.bankrupt ? recipient : null,
      toParking,
    );
    return false;
  }

  // Cannot cover debt even after liquidation.
  declareBankruptcy(
    p,
    recipient && !recipient.bankrupt ? recipient : null,
    amount,
    toParking,
  );
  return false;
}

function showRentModal(payer, owner, propName, rent) {
  if (shouldAutoActForAi(payer)) {
    closeOverlay("rent-overlay");
    return;
  }
  document.getElementById("rent-title").textContent = `Rent for ${propName}`;
  document.getElementById("rent-desc").textContent =
    `${payer.name} pays ${fmtCurrency(rent)} to ${owner.name}.`;
  openOverlay("rent-overlay");
}

function checkBankruptcy() {
  G.players.forEach((p) => {
    if (p.bankrupt || p.money >= 0) return;
    declareBankruptcy(p, null, Math.abs(p.money), true);
  });
  maybeShowWinnerFromState();
}

function declareBankruptcy(p, creditor = null, debtAmount = 0, toBank = false) {
  if (!p || p.bankrupt) return;
  playSfx("bankrupt");
  if (DEBT_PROMPT.active && DEBT_PROMPT.payerId === p.id) {
    resetDebtPrompt();
  }

  if (
    G.pendingTrade &&
    (G.pendingTrade.fromId === p.id || G.pendingTrade.toId === p.id)
  ) {
    const from = G.players[G.pendingTrade.fromId];
    const to = G.players[G.pendingTrade.toId];
    addLog(
      `Trade proposal between ${from?.name || "players"} and ${to?.name || "players"} was canceled due to bankruptcy.`,
      "danger",
    );
    G.pendingTrade = null;
    tradeReviewShownKey = "";
    closeOverlay("trade-review-overlay");
  }

  sellBuildingsForEmergencyCash(p);
  p.bankrupt = true;
  markPlayerBankruptStanding(p, G);
  p.inJail = false;

  const assets = [...p.properties, ...p.railroads, ...p.utilities];
  const auctionsEnabled = isAuctionSystemEnabled();

  if (creditor && !creditor.bankrupt && creditor.id !== p.id) {
    addLog(
      `${p.name} is BANKRUPT to ${creditor.name}! Assets transferred.`,
      "danger",
    );
    if (p.money > 0) creditor.money += p.money;
    p.money = 0;

    let interestDue = 0;
    assets.forEach((id) => {
      const prop = G.properties[id];
      const sp = SPACES[id];
      if (!prop || !sp) return;
      clearOwnedAsset(p, id);
      prop.owner = creditor.id;
      addOwnedAsset(creditor, id);
      if (prop.mortgaged) {
        const interest = Math.ceil(mortgageValueForSpace(sp) * 0.1);
        interestDue += interest;
      }
    });

    if (interestDue > 0) {
      creditor.money -= interestDue;
      addLog(
        `${creditor.name} paid ${fmtCurrency(interestDue)} mortgage interest to the bank.`,
        "danger",
      );
      if (creditor.money < 0 && !creditor.bankrupt) {
        addLog(
          `${creditor.name} cannot cover mortgage interest and goes bankrupt to the bank.`,
          "danger",
        );
        declareBankruptcy(creditor, null, Math.abs(creditor.money), true);
      }
    }

    document.getElementById("bankrupt-name").textContent =
      `${p.name} is Bankrupt!`;
    document.getElementById("bankrupt-desc").textContent =
      `${p.name} could not pay ${creditor.name} and turned over all assets.`;
  } else {
    const debtTxt = debtAmount > 0 ? ` (${fmtCurrency(debtAmount)})` : "";
    addLog(
      auctionsEnabled
        ? `${p.name} is BANKRUPT to the Bank${debtTxt}. Bank auctions all properties.`
        : `${p.name} is BANKRUPT to the Bank${debtTxt}. Auction system is OFF, so properties return to the bank unsold.`,
      "danger",
    );
    p.money = 0;

    const auctionIds = [];
    assets.forEach((id) => {
      const prop = G.properties[id];
      if (!prop) return;
      clearOwnedAsset(p, id);
      prop.owner = null;
      prop.houses = 0;
      prop.hotel = false;
      prop.mortgaged = false;
      auctionIds.push(id);
    });

    if (auctionsEnabled) {
      queueBankAuctions(auctionIds);
      if (auctionIds.length) {
        addLog(
          `Bank queued ${auctionIds.length} property auction${auctionIds.length > 1 ? "s" : ""}.`,
          "important",
        );
      }
    } else {
      G.bankAuctionQueue = [];
      G.auctionState = null;
    }

    document.getElementById("bankrupt-name").textContent =
      `${p.name} is Bankrupt!`;
    document.getElementById("bankrupt-desc").textContent = auctionsEnabled
      ? `${p.name} could not pay the Bank. Their properties are queued for auction.`
      : `${p.name} could not pay the Bank. Their properties returned to the bank without auction.`;
  }

  const continueBtn = document.getElementById("bankrupt-continue-btn");
  const mortgageBtn = document.getElementById("bankrupt-mortgage-btn");
  const sellBtn = document.getElementById("bankrupt-sell-btn");
  if (continueBtn) continueBtn.textContent = "Continue";
  if (mortgageBtn) mortgageBtn.style.display = "none";
  if (sellBtn) sellBtn.style.display = "none";

  p.properties = [];
  p.railroads = [];
  p.utilities = [];
  p.bankrupt = true;

  if (shouldAutoActForAi(p)) {
    closeOverlay("bankrupt-overlay");
    G.phase = "end";
    renderAll();
    updateActionButtons();
    if (launchNextBankAuction()) return;
    checkBankruptcy();
    return;
  }

  openOverlay("bankrupt-overlay");
}

function confirmBankruptcy() {
  if (hasPendingDebtPromptForCurrentPlayer()) {
    const payer = G.players[DEBT_PROMPT.payerId];
    const recipient =
      DEBT_PROMPT.recipientId !== null
        ? G.players[DEBT_PROMPT.recipientId]
        : null;
    const debt = Math.max(0, Number(DEBT_PROMPT.amount) || 0);
    const toParking = !!DEBT_PROMPT.toParking;
    resetDebtPrompt();
    if (payer && !payer.bankrupt) {
      declareBankruptcy(
        payer,
        recipient && !recipient.bankrupt ? recipient : null,
        debt,
        toParking,
      );
    }
    return;
  }

  closeOverlay("bankrupt-overlay");
  G.phase = "end";
  renderAll();
  updateActionButtons();
  if (launchNextBankAuction()) return;
  checkBankruptcy();
}

// ═══════════════════════════════════════════════
//  TURN MANAGEMENT
// ═══════════════════════════════════════════════
function endTurn() {
  if (!requireTurnControl()) return;
  if (MOVE_FX.active || (Number(ONLINE.pendingCardResolutions) || 0) > 0) {
    if (!isAiPlayer(curPlayer())) {
      toast("Wait for movement/card effects to finish.", "danger");
    }
    return;
  }
  if (hasPendingDebtPromptForCurrentPlayer()) {
    showDebtPrompt(
      curPlayer(),
      DEBT_PROMPT.amount,
      DEBT_PROMPT.recipientId !== null
        ? G.players[DEBT_PROMPT.recipientId]
        : null,
      DEBT_PROMPT.toParking,
    );
    toast("Settle debt by mortgaging or declare bankruptcy.", "danger");
    return;
  }
  if (G.phase === "roll") {
    toast("You must roll dice first!", "danger");
    return;
  }
  stopTimer();
  G.pendingBuy = null;

  // Advance to next non-bankrupt player
  let next = (G.currentPlayerIdx + 1) % G.players.length;
  let count = 0;
  while (G.players[next].bankrupt && count < G.players.length) {
    next = (next + 1) % G.players.length;
    count++;
  }
  G.currentPlayerIdx = next;
  AI_CTRL.lastTradeAttemptKey = "";
  G.phase = "roll";
  G.lastDoubles = false;
  playSfx("turn");

  const p = curPlayer();
  addLog(`─────── ${p.name}'s turn ───────`, "important");
  renderAll();
  updateActionButtons();
}

// ═══════════════════════════════════════════════
//  SHOW PROPERTY INFO
// ═══════════════════════════════════════════════
function showSpaceInfo(id) {
  const sp = SPACES[id];
  const prop = G.properties[id];
  const modal = document.getElementById("prop-modal");

  if (sp.type === "property") {
    const owner =
      prop?.owner !== null && prop?.owner !== undefined
        ? G.players[prop.owner]
        : null;
    const c = COLOR[sp.color];
    modal.innerHTML = `
      <div class="prop-color-header" style="background:linear-gradient(135deg,${c},${c}cc)">${sp.name}</div>
      ${owner ? `<div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:.75rem">Owned by <span style="color:${owner.color};font-weight:700">${owner.token} ${owner.name}</span>${prop.mortgaged ? " (Mortgaged)" : ""}</div>` : '<div style="color:rgba(255,255,255,.5);font-size:.82rem;margin-bottom:.75rem">For Sale — ' + fmtCurrency(sp.price) + "</div>"}
      <table class="prop-table">
        <tr><td>Purchase Price</td><td>${fmtCurrency(sp.price)}</td></tr>
        <tr><td>Rent</td><td>${fmtCurrency(sp.rent[0])}</td></tr>
        <tr><td>Rent w/ Monopoly</td><td>${fmtCurrency(sp.rent[0] * 2)}</td></tr>
        <tr><td>Rent 1 House</td><td>${fmtCurrency(sp.rent[1])}</td></tr>
        <tr><td>Rent 2 Houses</td><td>${fmtCurrency(sp.rent[2])}</td></tr>
        <tr><td>Rent 3 Houses</td><td>${fmtCurrency(sp.rent[3])}</td></tr>
        <tr><td>Rent 4 Houses</td><td>${fmtCurrency(sp.rent[4])}</td></tr>
        <tr><td>Rent Hotel</td><td>${fmtCurrency(sp.rent[5])}</td></tr>
        <tr><td>House Cost</td><td>${fmtCurrency(sp.house)}</td></tr>
        <tr><td>Mortgage Value</td><td>${fmtCurrency(mortgageValueForSpace(sp))}</td></tr>
        ${prop ? `<tr><td>Buildings</td><td>${prop.hotel ? "🏨 Hotel" : prop.houses > 0 ? "🏠×" + prop.houses : "None"}</td></tr>` : ""}
      </table>
      <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('prop-overlay')">Close</button>
    `;
  } else if (sp.type === "railroad") {
    const owner =
      prop?.owner !== null && prop?.owner !== undefined
        ? G.players[prop.owner]
        : null;
    modal.innerHTML = `
      <div class="prop-color-header" style="background:linear-gradient(135deg,#333,#555)">🚂 ${sp.name}</div>
      ${owner ? `<div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:.75rem">Owned by <span style="color:${owner.color};font-weight:700">${owner.token} ${owner.name}</span></div>` : '<div style="color:rgba(255,255,255,.5);font-size:.82rem;margin-bottom:.75rem">For Sale — ' + fmtCurrency(sp.price) + "</div>"}
      <table class="prop-table">
        <tr><td>Price</td><td>${fmtCurrency(sp.price)}</td></tr>
        <tr><td>Rent (1 RR)</td><td>${fmtCurrency(sp.rent[0])}</td></tr>
        <tr><td>Rent (2 RRs)</td><td>${fmtCurrency(sp.rent[1])}</td></tr>
        <tr><td>Rent (3 RRs)</td><td>${fmtCurrency(sp.rent[2])}</td></tr>
        <tr><td>Rent (4 RRs)</td><td>${fmtCurrency(sp.rent[3])}</td></tr>
        <tr><td>Mortgage</td><td>${fmtCurrency(mortgageValueForSpace(sp))}</td></tr>
      </table>
      <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('prop-overlay')">Close</button>
    `;
  } else {
    modal.innerHTML = `
      <div style="font-size:2.5rem;text-align:center;margin-bottom:.75rem">${sp.icon || "📋"}</div>
      <h2 style="color:#fff;text-align:center;margin-bottom:.5rem">${sp.name}</h2>
      <p style="color:rgba(255,255,255,.6);text-align:center">${sp.desc || ""}</p>
      <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('prop-overlay')">Close</button>
    `;
  }
  openOverlay("prop-overlay");
}

// ═══════════════════════════════════════════════
//  WINNER
// ═══════════════════════════════════════════════
function showWinner(p) {
  if (!p) return;
  playSfx("win");
  G.gameOver = true;
  G.auctionState = null;
  G.bankAuctionQueue = [];
  closeAllOverlays();
  closeDrawer();
  document.getElementById("winner-trophy").textContent = p.token;
  document.getElementById("winner-name").textContent = p.name + " Wins!";
  document.getElementById("winner-sub").textContent =
    `${p.name} is the ${(window.ACTIVE_THEME || BOARD_THEMES.dhaka).name} Monopoly champion with ${fmtCurrency(p.money)}!`;
  renderWinnerLeaderboard(p.id);
  // Confetti
  const cont = document.getElementById("confetti-container");
  cont.innerHTML = "";
  const emojis = ["🎉", "🎊", "🏆", "⭐", "🌟", "💰", "🎲"];
  for (let i = 0; i < 20; i++) {
    const span = document.createElement("div");
    span.className = "confetti";
    span.textContent = emojis[i % emojis.length];
    span.style.left = Math.random() * 100 + "vw";
    span.style.animationDelay = Math.random() * 3 + "s";
    span.style.animationDuration = 2 + Math.random() * 2 + "s";
    cont.appendChild(span);
  }
  showScreen("winner-screen");
}

function renderWinnerLeaderboard(winnerId) {
  const host = document.getElementById("winner-leaderboard");
  if (!host) return;
  if (!G || !Array.isArray(G.players) || !G.players.length) {
    host.innerHTML = "";
    return;
  }

  const entries = G.players.map((player) => ({
    player,
    cash: Number(player.money) || 0,
    bankruptOrder:
      Number.isInteger(Number(player.bankruptOrder)) &&
      Number(player.bankruptOrder) > 0
        ? Number(player.bankruptOrder)
        : -1,
  }));

  entries.sort((a, b) => {
    const aBankrupt = !!a.player.bankrupt;
    const bBankrupt = !!b.player.bankrupt;
    if (aBankrupt !== bBankrupt) return aBankrupt ? 1 : -1;

    // Rank eliminated players by who survived longer (last bankrupt first).
    if (aBankrupt && bBankrupt && a.bankruptOrder !== b.bankruptOrder) {
      return b.bankruptOrder - a.bankruptOrder;
    }

    if (b.cash !== a.cash) return b.cash - a.cash;
    return String(a.player.name || "").localeCompare(
      String(b.player.name || ""),
    );
  });

  const winnerIdx = entries.findIndex(
    (entry) => Number(entry.player.id) === Number(winnerId),
  );
  if (winnerIdx > 0) {
    const [winnerEntry] = entries.splice(winnerIdx, 1);
    entries.unshift(winnerEntry);
  }

  const others = entries
    .filter((entry) => Number(entry.player.id) !== Number(winnerId))
    .slice(0, 5);

  if (!others.length) {
    host.innerHTML = '<div class="winner-leader-empty">No other players.</div>';
    return;
  }

  host.innerHTML = others
    .map((entry, idx) => {
      const rank = idx + 2;
      const player = entry.player;
      const status = player.bankrupt
        ? entry.bankruptOrder > 0
          ? ` • Bankrupt #${entry.bankruptOrder}`
          : " • Bankrupt"
        : " • Still standing";
      return `
      <div class="winner-leader-row">
        <div class="winner-leader-left">
          <span class="winner-leader-rank">#${rank}</span>
          <span class="winner-leader-token">${escHtml(player.token || "👤")}</span>
          <span class="winner-leader-name">${escHtml(player.name || "Player")}${status}</span>
        </div>
        <span class="winner-leader-money">${fmtCurrency(entry.cash)}</span>
      </div>
    `;
    })
    .join("");
}

function maybeShowWinnerFromState() {
  if (!G || !Array.isArray(G.players) || !G.players.length) return false;
  const active = G.players.filter((player) => !player.bankrupt);
  if (active.length !== 1) return false;
  const winnerScreen = document.getElementById("winner-screen");
  if (winnerScreen && !winnerScreen.classList.contains("hidden")) return true;
  showWinner(active[0]);
  return true;
}

function viewBoardAfterWin() {
  if (!G || !G.gameOver) return;
  closeAllOverlays();
  closeDrawer();
  renderAll();
  showScreen("game-screen");
}

function restartGame() {
  stopTimer();
  clearOfflineAiTimer(true);
  showScreen("lobby-screen");
}

// ═══════════════════════════════════════════════
//  CHAT & LOG
// ═══════════════════════════════════════════════
function normalizeLogEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const text = String(entry.text || "").trim();
  if (!text) return null;
  const time = Number(entry.time) || Date.now();
  return {
    id: String(entry.id || ""),
    text,
    type: String(entry.type || ""),
    time,
  };
}

function getLogEntryKey(entry) {
  if (!entry || typeof entry !== "object") return "";
  const explicitId = String(entry.id || "");
  if (explicitId) return explicitId;
  const ts = Number(entry.time) || 0;
  const type = String(entry.type || "");
  const text = String(entry.text || "");
  return `${ts}|${type}|${text}`;
}

function clearLogArchive(gameStartedAt = 0) {
  LOG_ARCHIVE.length = 0;
  LOG_ARCHIVE_KEYS.clear();
  LOG_ARCHIVE_GAME_STARTED_AT = Number(gameStartedAt) || 0;
}

function appendLogsToArchive(entries) {
  if (!Array.isArray(entries) || !entries.length) return;
  for (let i = 0; i < entries.length; i++) {
    const normalized = normalizeLogEntry(entries[i]);
    if (!normalized) continue;
    const key = getLogEntryKey(normalized);
    if (!key || LOG_ARCHIVE_KEYS.has(key)) continue;
    LOG_ARCHIVE.push(normalized);
    LOG_ARCHIVE_KEYS.add(key);
  }

  if (LOG_ARCHIVE.length > GAME_LOG_ARCHIVE_LIMIT) {
    const overflow = LOG_ARCHIVE.length - GAME_LOG_ARCHIVE_LIMIT;
    const removed = LOG_ARCHIVE.splice(0, overflow);
    for (let i = 0; i < removed.length; i++) {
      const key = getLogEntryKey(removed[i]);
      if (key) LOG_ARCHIVE_KEYS.delete(key);
    }
  }
}

function getFullLogEntries() {
  if (Array.isArray(G.log) && G.log.length) {
    appendLogsToArchive(G.log);
  }
  if (LOG_ARCHIVE.length) return LOG_ARCHIVE;
  return Array.isArray(G.log) ? G.log : [];
}

function addLog(text, type = "") {
  const entry = normalizeLogEntry({
    id: `lg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
    text,
    type,
    time: Date.now(),
  });
  if (!entry) return;
  if (!G.log) G.log = [];
  G.log.push(entry);
  appendLogsToArchive([entry]);
  if (G.log.length > GAME_LOG_LIMIT) G.log = G.log.slice(-GAME_LOG_LIMIT);
  renderGameLog();
}

function getLastChatMessage() {
  return Array.isArray(G.chat) && G.chat.length
    ? G.chat[G.chat.length - 1]
    : null;
}

function chatMessageKey(msg) {
  if (!msg) return "";
  const ts = Number(msg.time) || 0;
  const who = String(msg.uid || msg.name || "");
  const text = String(msg.text || "");
  return `${ts}|${who}|${text}`;
}

function isChatPanelOpenOnMobile() {
  const drawer = document.getElementById("mobile-drawer");
  if (!drawer || !drawer.classList.contains("open")) return false;
  return !!document.getElementById("drawer-chat");
}

function showChatPreview(msg) {
  const key = chatMessageKey(msg);
  if (!key || CHAT_PREVIEW.lastShownKey === key) return;
  CHAT_PREVIEW.lastShownKey = key;

  const isMobile = !!(
    window.matchMedia && window.matchMedia("(max-width: 899px)").matches
  );
  if (!isMobile || isChatPanelOpenOnMobile()) return;

  const activeId = document.activeElement?.id || "";
  if (activeId === "chat-input" || activeId === "drawer-chat-input") return;

  const token = String(msg.token || "💬");
  const name = String(msg.name || "Player").trim() || "Player";
  const cleanText = String(msg.text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleanText) return;
  const preview =
    cleanText.length > 56 ? `${cleanText.slice(0, 56)}...` : cleanText;
  toast(`${token} ${name}: ${preview}`, "chat");
}

function sendChat() {
  const inp = document.getElementById("chat-input");
  const text = inp.value.trim();
  if (!text) return;
  inp.value = "";
  if (!G.chat) G.chat = [];
  const p = isOnlineGame()
    ? (G.players || []).find((x) => x.uid === ONLINE.localUid)
    : curPlayer();
  if (!p) return;
  G.chat.push({
    uid: p.uid || null,
    name: p.name,
    token: p.token,
    color: p.color,
    text,
    time: Date.now(),
  });
  if (G.chat.length > 120) G.chat = G.chat.slice(-120);
  showChatPreview(getLastChatMessage());
  renderChatLog();
  const dc = document.getElementById("drawer-chat");
  if (dc) dc.innerHTML = document.getElementById("chat-log").innerHTML;
}

// ═══════════════════════════════════════════════
//  DRAWER (mobile)
// ═══════════════════════════════════════════════
function openDrawer(type) {
  const content = document.getElementById("drawer-content");
  if (type === "players") {
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-display)">👥 Players</h3>
      ${(G.players || [])
        .map((p, i) => {
          const active = i === G.currentPlayerIdx;
          const where = p.inJail
            ? "In Jail"
            : SPACES[p.pos]?.name || "On board";
          const border = active ? "var(--gold-light)" : "rgba(255,255,255,.14)";
          const bg = active ? "rgba(201,151,28,.12)" : "rgba(255,255,255,.05)";
          const color = sanitizeColor(p.color, "#ffffff");
          return `<div onclick="showPlayerPortfolio(${i});closeDrawer()" style="display:flex;align-items:center;gap:.55rem;padding:.5rem .55rem;border:1px solid ${border};border-radius:8px;background:${bg};margin-bottom:.38rem;cursor:pointer">
          <div style="font-size:1.15rem;color:${color}">${p.token}</div>
          <div style="min-width:0;flex:1">
            <div style="color:#fff;font-weight:700;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}${p.bankrupt ? " 💀" : ""}</div>
            <div style="color:rgba(255,255,255,.5);font-size:.74rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(where)}</div>
          </div>
          <div style="font-size:.82rem;color:var(--gold-light);font-weight:700">${fmtCurrency(p.money)}</div>
        </div>`;
        })
        .join("")}
      <p style="color:rgba(255,255,255,.45);font-size:.74rem;margin-top:.35rem">Tap a player card to view full portfolio and assets.</p>
    `;
  } else if (type === "log") {
    content.innerHTML =
      '<h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-display)">📋 Game Log</h3>' +
      G.log
        .slice(-30)
        .map(
          (l) =>
            `<div class="log-entry${l.type ? " log-" + l.type : ""}">${escHtml(l.text || "")}</div>`,
        )
        .join("");
  } else if (type === "chat") {
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:.75rem;font-family:var(--font-display)">💬 Chat</h3>
      <div id="drawer-chat" style="max-height:300px;overflow-y:auto"></div>
      <div style="display:flex;gap:.5rem;margin-top:.75rem">
        <input id="drawer-chat-input" type="text" placeholder="Message..." style="flex:1;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:.4rem .6rem;color:#fff;font-family:var(--font-body)">
        <button onclick="sendChatFromDrawer()" style="background:var(--green);border:none;color:#fff;border-radius:6px;padding:.4rem .7rem;cursor:pointer;font-weight:600">Send</button>
      </div>
    `;
    // Clone chat messages
    const dc = document.getElementById("drawer-chat");
    dc.innerHTML = document.getElementById("chat-log").innerHTML;
  } else if (type === "settings") {
    const dur = TIMER.duration;
    const sfxVolumePct = Math.round(clampSfxVolume(SFX.volume) * 100);
    const sfxEnabled = !!SFX.enabled;
    const bgmEnabled = !!SFX.bgmEnabled;
    const canLeave = isOnlineGame() && ONLINE.status === "playing";
    const leaveBlock = canLeave
      ? `<hr style="border:none;border-top:1px solid rgba(255,255,255,.12);margin:1rem 0">
         <div style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:.6rem">Online match</div>
         <button onclick="closeDrawer();openLeaveGameModal()" style="width:100%;padding:.6rem .9rem;border:none;border-radius:8px;background:linear-gradient(135deg,#7f1d1d,#c0392b);color:#fff;font-weight:700;cursor:pointer">🚪 Leave Game</button>`
      : "";
    content.innerHTML = `
      <h3 style="color:#fff;margin-bottom:1rem;font-family:var(--font-display)">⚙️ Timer & Sound Settings</h3>
      <div style="margin-bottom:1rem;padding:.75rem;border:1px solid rgba(255,255,255,.14);border-radius:10px;background:rgba(255,255,255,.05)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.65rem">
          <div>
            <div style="color:#fff;font-size:.88rem;font-weight:700">Sound Effects</div>
            <div style="color:rgba(255,255,255,.52);font-size:.76rem">Dice, rent, jail, auction, and win sounds</div>
          </div>
          <button onclick="toggleSfxEnabled()" style="padding:.42rem .75rem;border:1px solid ${sfxEnabled ? "rgba(45,160,90,.5)" : "rgba(255,255,255,.25)"};background:${sfxEnabled ? "rgba(45,160,90,.22)" : "rgba(255,255,255,.07)"};color:${sfxEnabled ? "#86efac" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:.8rem;font-weight:700">${sfxEnabled ? "On" : "Off"}</button>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;margin-bottom:.65rem">
          <div>
            <div style="color:#fff;font-size:.88rem;font-weight:700">Background Music</div>
            <div style="color:rgba(255,255,255,.52);font-size:.76rem">Plays during active match</div>
          </div>
          <button onclick="toggleBgmEnabled()" style="padding:.42rem .75rem;border:1px solid ${bgmEnabled ? "rgba(240,192,64,.5)" : "rgba(255,255,255,.25)"};background:${bgmEnabled ? "rgba(240,192,64,.18)" : "rgba(255,255,255,.07)"};color:${bgmEnabled ? "var(--gold-light)" : "rgba(255,255,255,.76)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:.8rem;font-weight:700">${bgmEnabled ? "On" : "Off"}</button>
        </div>
        <label style="color:rgba(255,255,255,.72);font-size:.82rem;display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem">
          <span>Volume</span>
          <span id="sfx-volume-label">${sfxVolumePct}%</span>
        </label>
        <input type="range" min="0" max="100" value="${sfxVolumePct}" oninput="document.getElementById('sfx-volume-label').textContent=this.value+'%';setSfxVolume(Number(this.value)/100,false)" onchange="setSfxVolume(Number(this.value)/100,true)" style="width:100%;accent-color:var(--gold-light)">
      </div>
      <p style="color:rgba(255,255,255,.6);font-size:.85rem;margin-bottom:1rem">
        After a player finishes their move, a countdown begins. When it hits zero, the turn automatically advances — even if they haven't clicked End Turn.
      </p>
      <div style="margin-bottom:1rem">
        <label style="color:rgba(255,255,255,.7);font-size:.85rem;display:block;margin-bottom:.4rem">Auto-advance delay</label>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${[0, 10, 20, 30, 45, 60].map((v) => `<button onclick="setTimerDuration(${v})" style="padding:.5rem .9rem;border:1px solid ${dur === v ? "var(--gold-light)" : "rgba(255,255,255,.2)"};background:${dur === v ? "rgba(201,151,28,.25)" : "rgba(255,255,255,.07)"};color:${dur === v ? "var(--gold-light)" : "rgba(255,255,255,.7)"};border-radius:7px;cursor:pointer;font-family:var(--font-body);font-size:.85rem;font-weight:600">${v === 0 ? "Off" : v + "s"}</button>`).join("")}
        </div>
      </div>
      <p style="color:rgba(255,255,255,.4);font-size:.78rem">Timer only runs during the "end turn" phase (after rolling & landing). It pauses while modals are open.</p>
      ${leaveBlock}
    `;
  }
  document.getElementById("mobile-drawer").classList.add("open");
}

function sendChatFromDrawer() {
  const inp = document.getElementById("drawer-chat-input");
  if (!inp) return;
  document.getElementById("chat-input").value = inp.value;
  sendChat();
  inp.value = "";
  const dc = document.getElementById("drawer-chat");
  if (dc) dc.innerHTML = document.getElementById("chat-log").innerHTML;
}

function closeDrawer() {
  document.getElementById("mobile-drawer").classList.remove("open");
}

// ═══════════════════════════════════════════════
//  OVERLAYS
// ═══════════════════════════════════════════════
function openOverlay(id) {
  document.getElementById(id).classList.add("show");
}
function closeOverlay(id) {
  document.getElementById(id).classList.remove("show");
}
function closeAllOverlays() {
  document
    .querySelectorAll(".overlay.show")
    .forEach((el) => el.classList.remove("show"));
}

const SFX_EVENT_FILES = Object.freeze({
  dice: ["sounds/dice_roll_sfx.mp3"],
  buy: ["sounds/clicktap_sfx.mp3"],
  rent: ["sounds/decline_sfx.mp3"],
  tax: ["sounds/decline_sfx.mp3"],
  card: ["sounds/clicktap_sfx.mp3"],
  jail: ["sounds/decline_sfx.mp3"],
  bail: ["sounds/clicktap_sfx.mp3"],
  build: ["sounds/clicktap_sfx.mp3"],
  sell: ["sounds/clicktap_sfx.mp3"],
  mortgage: ["sounds/decline_sfx.mp3"],
  unmortgage: ["sounds/clicktap_sfx.mp3"],
  "auction-open": ["sounds/clicktap_sfx.mp3"],
  bid: ["sounds/clicktap_sfx.mp3"],
  "auction-win": ["sounds/clicktap_sfx.mp3"],
  bankrupt: ["sounds/game_over_sfx.mp3"],
  turn: ["sounds/clicktap_sfx.mp3"],
  win: ["sounds/win_sfx.mp3"],
  inability: ["sounds/inability_sfx.mp3"],
});

const SFX_BGM_FILE = "sounds/background_01.mp3";
const SFX_BGM_VOLUME_FACTOR = 0.34;

const SFX = {
  enabled: true,
  bgmEnabled: true,
  volume: SFX_DEFAULT_VOLUME,
  ctx: null,
  master: null,
  noiseBuffer: null,
  lastPlayedAt: {},
  assetPool: {},
  activeClips: new Set(),
  bgmAudio: null,
};

function clampSfxVolume(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SFX_DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, n));
}

function getVisibleScreenId() {
  return document.querySelector(".screen:not(.hidden)")?.id || "";
}

function getSfxFilesForEvent(name) {
  const raw = SFX_EVENT_FILES[String(name || "")];
  if (!raw) return [];
  return Array.isArray(raw) ? raw.filter(Boolean) : [String(raw)];
}

function ensureSfxAssetTemplate(src) {
  if (!src) return null;
  if (SFX.assetPool[src]) return SFX.assetPool[src];
  try {
    const audio = new Audio(src);
    audio.preload = "auto";
    audio.load();
    SFX.assetPool[src] = audio;
    return audio;
  } catch (_err) {
    return null;
  }
}

function preloadSfxAssets() {
  const files = new Set();
  Object.values(SFX_EVENT_FILES).forEach((list) => {
    (Array.isArray(list) ? list : [list]).forEach((src) => {
      if (src) files.add(String(src));
    });
  });
  files.add(SFX_BGM_FILE);
  files.forEach((src) => {
    ensureSfxAssetTemplate(src);
  });
}

function ensureBgmAudio() {
  if (SFX.bgmAudio) return SFX.bgmAudio;
  try {
    const bgm = new Audio(SFX_BGM_FILE);
    bgm.preload = "auto";
    bgm.loop = true;
    bgm.volume = clampSfxVolume(SFX.volume * SFX_BGM_VOLUME_FACTOR);
    SFX.bgmAudio = bgm;
    return bgm;
  } catch (_err) {
    return null;
  }
}

function loadSfxPreferences() {
  try {
    const enabledRaw = localStorage.getItem(SFX_PREF_ENABLED_KEY);
    if (enabledRaw === "0" || enabledRaw === "1") {
      SFX.enabled = enabledRaw === "1";
    }
    const bgmRaw = localStorage.getItem(SFX_PREF_BGM_ENABLED_KEY);
    if (bgmRaw === "0" || bgmRaw === "1") {
      SFX.bgmEnabled = bgmRaw === "1";
    }
    const volumeRaw = localStorage.getItem(SFX_PREF_VOLUME_KEY);
    if (volumeRaw !== null) {
      SFX.volume = clampSfxVolume(volumeRaw);
    }
  } catch (_err) {}
}

function persistSfxPreferences() {
  try {
    localStorage.setItem(SFX_PREF_ENABLED_KEY, SFX.enabled ? "1" : "0");
    localStorage.setItem(SFX_PREF_BGM_ENABLED_KEY, SFX.bgmEnabled ? "1" : "0");
    localStorage.setItem(SFX_PREF_VOLUME_KEY, String(SFX.volume));
  } catch (_err) {}
}

function ensureSfxEngine() {
  if (SFX.ctx && SFX.master) return SFX.ctx;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  try {
    const ctx = new AudioCtx();
    const master = ctx.createGain();
    master.gain.value = SFX.enabled ? SFX.volume : 0;
    master.connect(ctx.destination);
    SFX.ctx = ctx;
    SFX.master = master;
    return ctx;
  } catch (_err) {
    return null;
  }
}

function syncBgmForScreen(screenId = getVisibleScreenId()) {
  const bgm = ensureBgmAudio();
  if (!bgm) return;

  bgm.volume = clampSfxVolume(SFX.volume * SFX_BGM_VOLUME_FACTOR);
  const shouldPlay = !!(
    SFX.enabled &&
    SFX.bgmEnabled &&
    screenId === "game-screen" &&
    !G?.gameOver
  );
  if (!shouldPlay) {
    bgm.pause();
    if (screenId !== "game-screen") {
      try {
        bgm.currentTime = 0;
      } catch (_err) {}
    }
    return;
  }

  const p = bgm.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
}

function updateSfxMasterGain() {
  if (SFX.ctx && SFX.master) {
    const target = SFX.enabled ? SFX.volume : 0;
    SFX.master.gain.setTargetAtTime(target, SFX.ctx.currentTime, 0.015);
  }
  syncBgmForScreen();
}

function unlockSfxEngine() {
  const ctx = ensureSfxEngine();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  syncBgmForScreen();
}

function installSfxUnlockListeners() {
  const unlock = () => {
    unlockSfxEngine();
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock);
}

function setSfxEnabled(enabled, notify = true) {
  SFX.enabled = !!enabled;
  persistSfxPreferences();
  ensureSfxEngine();
  updateSfxMasterGain();
  if (notify)
    toast(SFX.enabled ? "🔊 Sound enabled" : "🔇 Sound muted", "gold");
}

function toggleSfxEnabled() {
  setSfxEnabled(!SFX.enabled, true);
  openDrawer("settings");
}

function setBgmEnabled(enabled, notify = true) {
  SFX.bgmEnabled = !!enabled;
  persistSfxPreferences();
  syncBgmForScreen();
  if (notify)
    toast(SFX.bgmEnabled ? "🎵 Music enabled" : "🎵 Music muted", "gold");
}

function toggleBgmEnabled() {
  setBgmEnabled(!SFX.bgmEnabled, true);
  openDrawer("settings");
}

function setSfxVolume(volume, notify = false) {
  SFX.volume = clampSfxVolume(volume);
  persistSfxPreferences();
  ensureSfxEngine();
  updateSfxMasterGain();
  if (notify) toast(`🔉 SFX volume ${Math.round(SFX.volume * 100)}%`, "gold");
}

function ensureSfxNoiseBuffer(ctx) {
  if (SFX.noiseBuffer && SFX.noiseBuffer.sampleRate === ctx.sampleRate)
    return SFX.noiseBuffer;
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.9));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  SFX.noiseBuffer = buffer;
  return buffer;
}

function playSfxTone(freq, duration, opts = {}) {
  const ctx = SFX.ctx;
  if (!ctx || !SFX.master || !Number.isFinite(freq) || freq <= 0) return;
  const type = String(opts.type || "sine");
  const gainValue = Math.max(0.0001, Number(opts.gain) || 0.12);
  const attack = Math.max(0.001, Number(opts.attack) || 0.003);
  const release = Math.max(0.01, Number(opts.release) || 0.08);
  const start = ctx.currentTime + Math.max(0, Number(opts.start) || 0) + 0.004;

  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (Number.isFinite(Number(opts.detune))) {
    osc.detune.setValueAtTime(Number(opts.detune), start);
  }

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gainValue, start + attack);
  amp.gain.exponentialRampToValueAtTime(
    0.0001,
    start + Math.max(0.02, duration) + release,
  );

  osc.connect(amp);
  amp.connect(SFX.master);
  osc.start(start);
  osc.stop(start + Math.max(0.02, duration) + release + 0.02);
}

function playSfxNoise(duration, opts = {}) {
  const ctx = SFX.ctx;
  if (!ctx || !SFX.master) return;
  const start = ctx.currentTime + Math.max(0, Number(opts.start) || 0) + 0.004;
  const gainValue = Math.max(0.0001, Number(opts.gain) || 0.05);
  const release = Math.max(0.01, Number(opts.release) || 0.06);
  const freq = Math.max(120, Number(opts.frequency) || 1100);

  const src = ctx.createBufferSource();
  src.buffer = ensureSfxNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(freq, start);
  filter.Q.value = 0.9;

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gainValue, start);
  amp.gain.exponentialRampToValueAtTime(
    0.0001,
    start + Math.max(0.02, duration) + release,
  );

  src.connect(filter);
  filter.connect(amp);
  amp.connect(SFX.master);
  src.start(start);
  src.stop(start + Math.max(0.02, duration) + release + 0.02);
}

function canPlaySfx(name, cooldownMs = 80) {
  const now =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const key = String(name || "generic");
  const last = Number(SFX.lastPlayedAt[key]) || 0;
  if (now - last < Math.max(0, cooldownMs)) return false;
  SFX.lastPlayedAt[key] = now;
  return true;
}

function playSfxAsset(name, options = {}) {
  const files = getSfxFilesForEvent(name);
  if (!files.length) return false;
  const src = files.length === 1 ? files[0] : files[rand(0, files.length - 1)];
  const template = ensureSfxAssetTemplate(src);
  if (!template) return false;

  try {
    const clip = template.cloneNode(true);
    clip.preload = "auto";
    clip.volume = clampSfxVolume(
      SFX.volume * Math.max(0, Number(options.volumeFactor) || 1),
    );
    SFX.activeClips.add(clip);
    const clear = () => SFX.activeClips.delete(clip);
    clip.addEventListener("ended", clear, { once: true });
    clip.addEventListener("error", clear, { once: true });
    const p = clip.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        clear();
      });
    }
    return true;
  } catch (_err) {
    return false;
  }
}

function playSfxSynthFallback(name) {
  switch (name) {
    case "dice":
      playSfxNoise(0.09, { gain: 0.04, frequency: 1200 });
      playSfxTone(210 + rand(0, 50), 0.05, {
        type: "triangle",
        gain: 0.07,
      });
      playSfxTone(280 + rand(0, 70), 0.06, {
        type: "triangle",
        gain: 0.06,
        start: 0.055,
      });
      break;
    case "win":
      playSfxTone(392, 0.09, { type: "triangle", gain: 0.08 });
      playSfxTone(523.25, 0.1, {
        type: "triangle",
        gain: 0.08,
        start: 0.1,
      });
      playSfxTone(659.25, 0.12, {
        type: "triangle",
        gain: 0.08,
        start: 0.22,
      });
      playSfxTone(783.99, 0.16, {
        type: "triangle",
        gain: 0.08,
        start: 0.34,
      });
      break;
    case "bankrupt":
      playSfxNoise(0.14, { gain: 0.04, frequency: 420 });
      playSfxTone(165, 0.24, { type: "square", gain: 0.07, start: 0.02 });
      break;
    default:
      playSfxTone(500, 0.05, { type: "sine", gain: 0.04 });
      break;
  }
}

function playSfx(name, options = {}) {
  if (!SFX.enabled) return;
  const ctx = ensureSfxEngine();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }

  const cooldownByName = {
    dice: 130,
    bid: 90,
    build: 90,
    sell: 90,
    mortgage: 110,
    unmortgage: 110,
    turn: 150,
    rent: 130,
    jail: 220,
    card: 120,
    bankrupt: 260,
    win: 550,
    inability: 240,
  };

  if (
    !canPlaySfx(name, Number(options.cooldownMs) || cooldownByName[name] || 90)
  )
    return;
  if (playSfxAsset(name, options)) return;
  playSfxSynthFallback(name);
}

// ═══════════════════════════════════════════════
//  TOAST
// ═══════════════════════════════════════════════
let toastTimer;
function toast(msg, type = "") {
  if (type === "danger") {
    const lower = String(msg || "").toLowerCase();
    if (
      lower.includes("not enough") ||
      lower.includes("must") ||
      lower.includes("cannot") ||
      lower.includes("wait")
    ) {
      playSfx("inability", { cooldownMs: 260 });
    } else {
      playSfx("rent", { cooldownMs: 240 });
    }
  }
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = type ? `toast-${type}` : "";
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2500);
}

// ═══════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════
function curPlayer() {
  return G.players[G.currentPlayerIdx];
}
function getLivePlayer(playerOrId, state = G) {
  if (!state || !Array.isArray(state.players) || !state.players.length)
    return null;
  const id =
    typeof playerOrId === "object" && playerOrId !== null
      ? Number(playerOrId.id)
      : Number(playerOrId);
  if (!Number.isInteger(id) || id < 0 || id >= state.players.length)
    return null;
  return state.players[id] || null;
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function fmt(n) {
  return Math.abs(n).toLocaleString("en-BD");
}
function fmtCurrency(n) {
  const t = window.ACTIVE_THEME || BOARD_THEMES.dhaka;
  return `${t.currency}${Math.abs(n).toLocaleString(t.locale)}`;
}
function formatThemeCurrencyText(text) {
  const raw = String(text || "");
  if (!raw) return "";
  return raw.replace(/৳\s*([0-9][0-9,]*)/g, (m, digits) => {
    const amount = Number(String(digits).replace(/,/g, ""));
    return Number.isFinite(amount) ? fmtCurrency(amount) : m;
  });
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function removeFrom(arr, val) {
  const i = arr.indexOf(val);
  if (i >= 0) arr.splice(i, 1);
}
function escHtml(t) {
  return String(t ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escAttr(t) {
  return escHtml(String(t)).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function rolledDoublesThisTurn() {
  return G.lastDoubles;
}

const PORTFOLIO_VIEW = {
  playerIdx: -1,
  tab: "properties",
};

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMoneyAmountFromText(text) {
  const raw = String(text || "");
  if (!raw) return 0;

  const symbols = Array.from(
    new Set([
      ...Object.values(BOARD_THEMES || {})
        .map((t) => String(t?.currency || "").trim())
        .filter(Boolean),
      "৳",
      "$",
      "⚜",
    ]),
  );
  if (!symbols.length) return 0;

  const pattern = symbols.map(escapeRegExp).join("|");
  const match = raw.match(new RegExp(`(?:${pattern})\\s*([0-9][0-9,]*)`));
  if (!match) return 0;

  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function classifyMoneyLogForPlayer(logEntry, playerName) {
  const text = String(logEntry?.text || "");
  if (!text) return null;

  const lower = text.toLowerCase();
  // Card draw description can contain fee text that is not the final settled amount.
  if (lower.includes("drew chance") || lower.includes("drew community chest"))
    return null;

  const amount = parseMoneyAmountFromText(text);
  if (!amount) return null;

  const safeName = escapeRegExp(playerName);
  const startsWithPlayer = new RegExp(`^${safeName}\\b`).test(text);

  const isRentPayer = new RegExp(
    `^${safeName}\\s+pays\\s+.*\\s+rent\\s+to\\s+`,
  ).test(text);
  if (isRentPayer) return { kind: "debit", amount };

  const isRentReceiver = new RegExp(
    `^.+\\s+pays\\s+.*\\s+rent\\s+to\\s+${safeName}\\b`,
  ).test(text);
  if (isRentReceiver) return { kind: "credit", amount };

  const isDebtPayer = new RegExp(
    `^${safeName}\\s+settled\\s+debt\\s+of\\s+`,
  ).test(text);
  if (isDebtPayer) return { kind: "debit", amount };

  const isDebtReceiver = new RegExp(
    `^.+\\s+settled\\s+debt\\s+of\\s+.*\\s+to\\s+${safeName}\\b`,
  ).test(text);
  if (isDebtReceiver) return { kind: "credit", amount };

  if (!startsWithPlayer) return null;

  if (lower.includes("wins auction")) return { kind: "debit", amount };
  if (
    /\b(pays|paid|bought|unmortgaged|built|tax|bail|must pay|interest)\b/.test(
      lower,
    )
  )
    return { kind: "debit", amount };
  if (
    /\b(collected|collect|sold|mortgaged|refund|dividend|raised|received)\b/.test(
      lower,
    )
  )
    return { kind: "credit", amount };
  return null;
}

function getPlayerActivityHistory(playerIdx) {
  const player = G.players[playerIdx];
  if (!player) return [];
  const allLogs = getFullLogEntries();
  if (!allLogs.length) return [];

  const safeName = escapeRegExp(player.name);
  const nameRegex = new RegExp(`\\b${safeName}\\b`);

  const rows = [];
  for (let i = 0; i < allLogs.length; i++) {
    const entry = allLogs[i] || {};
    const text = String(entry.text || "");
    if (!nameRegex.test(text)) continue;
    const parsedMoney = classifyMoneyLogForPlayer(entry, player.name);
    rows.push({
      kind: parsedMoney?.kind || "",
      amount: parsedMoney?.amount || 0,
      text,
      time: Number(entry.time) || 0,
      type: String(entry.type || ""),
    });
  }
  return rows.reverse();
}

function formatLogTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function setPortfolioTab(tab) {
  if (
    !Number.isInteger(PORTFOLIO_VIEW.playerIdx) ||
    PORTFOLIO_VIEW.playerIdx < 0
  )
    return;
  PORTFOLIO_VIEW.tab = tab === "log" ? "log" : "properties";
  showPlayerPortfolio(PORTFOLIO_VIEW.playerIdx, PORTFOLIO_VIEW.tab);
}

function showPlayerPortfolio(playerIdx, tab = "") {
  const p = G.players[playerIdx];
  if (!p) return;

  const previousPlayerIdx = PORTFOLIO_VIEW.playerIdx;
  PORTFOLIO_VIEW.playerIdx = playerIdx;
  if (tab) PORTFOLIO_VIEW.tab = tab === "log" ? "log" : "properties";
  else if (previousPlayerIdx !== playerIdx) PORTFOLIO_VIEW.tab = "properties";

  const activeTab = PORTFOLIO_VIEW.tab === "log" ? "log" : "properties";
  const modal = document.getElementById("portfolio-modal");
  const allProps = [...p.properties, ...p.railroads, ...p.utilities];

  // Group properties by color group
  const groups = {};
  allProps.forEach((id) => {
    const sp = SPACES[id];
    const prop = G.properties[id];
    const groupKey =
      sp.type === "property"
        ? `prop_${sp.group}`
        : sp.type === "railroad"
          ? "railroad"
          : "utility";
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push({ sp, prop, id });
  });

  const statusIcon = p.bankrupt
    ? "💀 BANKRUPT"
    : p.inJail
      ? "⛓️ In Jail"
      : `📍 ${SPACES[p.pos].name}`;

  const logHistory = getPlayerActivityHistory(playerIdx);
  const totalCredit = logHistory
    .filter((x) => x.kind === "credit")
    .reduce((sum, x) => sum + x.amount, 0);
  const totalDebit = logHistory
    .filter((x) => x.kind === "debit")
    .reduce((sum, x) => sum + x.amount, 0);

  let propsHtml = "";
  if (allProps.length === 0) {
    propsHtml = `<div style="color:rgba(255,255,255,.4);font-size:.9rem;text-align:center;padding:1.5rem 0">No properties owned yet</div>`;
  } else {
    Object.values(groups).forEach((items) => {
      items.forEach(({ sp, prop, id }) => {
        const c =
          sp.type === "property"
            ? COLOR[sp.color]
            : sp.type === "railroad"
              ? "#444"
              : "#557";
        const buildings = prop.hotel
          ? "🏨"
          : prop.houses > 0
            ? "🏠".repeat(prop.houses)
            : "";
        const mortgStr = prop.mortgaged
          ? ' <span style="color:#f59e0b;font-size:.72rem">[Mortgaged]</span>'
          : "";
        propsHtml += `
          <div style="display:flex;align-items:center;gap:.6rem;padding:.55rem .7rem;background:rgba(255,255,255,.06);border-radius:7px;margin-bottom:.35rem;border-left:3px solid ${c}">
            <div style="font-size:.9rem;flex:1;color:#fff;font-weight:600">${sp.name}${mortgStr}</div>
            ${buildings ? `<div style="font-size:.9rem">${buildings}</div>` : ""}
            <div style="font-size:.75rem;color:rgba(255,255,255,.45)">${fmtCurrency(sp.price || 0)}</div>
          </div>`;
      });
    });
  }

  const historyHtml = logHistory.length
    ? logHistory
        .map((item) => {
          const credit = item.kind === "credit";
          const debit = item.kind === "debit";
          const hasMoneyTag = credit || debit;
          const pillBg = credit
            ? "rgba(45,160,90,.28)"
            : debit
              ? "rgba(192,57,43,.28)"
              : "rgba(148,163,184,.26)";
          const pillColor = credit ? "#86efac" : debit ? "#fca5a5" : "#e2e8f0";
          const tagLabel = credit
            ? "CREDIT"
            : debit
              ? "DEBIT"
              : item.type
                ? item.type.toUpperCase()
                : "LOG";
          const sign = credit ? "+" : debit ? "-" : "";
          const amountHtml = hasMoneyTag
            ? `<span style="font-size:.86rem;font-weight:700;color:${pillColor}">${sign}${fmtCurrency(item.amount)}</span>`
            : "";
          return `
          <div style="padding:.6rem .7rem;border-radius:8px;margin-bottom:.42rem;border:1px solid rgba(201,151,28,.22);background:rgba(255,255,255,.08)">
            <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem">
              <span style="font-size:.72rem;font-weight:700;padding:.1rem .42rem;border-radius:999px;background:${pillBg};color:${pillColor}">${tagLabel}</span>
              ${amountHtml}
              <span style="margin-left:auto;font-size:.72rem;color:rgba(255,255,255,.45)">${formatLogTime(item.time)}</span>
            </div>
            <div style="font-size:.8rem;color:rgba(255,255,255,.72);line-height:1.4">${escHtml(item.text)}</div>
          </div>
        `;
        })
        .join("")
    : `<div style="color:rgba(255,255,255,.45);font-size:.9rem;text-align:center;padding:1.5rem 0">No logs for this player yet</div>`;

  const propertiesTabBtnStyle =
    activeTab === "properties"
      ? "background:rgba(201,151,28,.25);border:1px solid rgba(201,151,28,.45);color:var(--gold-light);"
      : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);";
  const logTabBtnStyle =
    activeTab === "log"
      ? "background:rgba(37,99,235,.25);border:1px solid rgba(125,211,252,.45);color:#dbeafe;"
      : "background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.78);";

  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:.8rem;margin-bottom:1rem">
      <div style="font-size:2rem;color:${p.color}">${p.token}</div>
      <div>
        <div style="font-family:var(--font-display);font-size:1.3rem;color:#fff;font-weight:700">${p.name}${p.bankrupt ? " 💀" : ""}</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.5);margin-top:.15rem">${statusIcon}</div>
      </div>
      <div style="margin-left:auto;text-align:right">
        <div style="font-size:1.2rem;font-weight:800;color:var(--gold-light)">${fmtCurrency(p.money)}</div>
        <div style="font-size:.72rem;color:rgba(255,255,255,.4)">${allProps.length} ${allProps.length === 1 ? "property" : "properties"}</div>
      </div>
    </div>
    ${p.jailFreeCards > 0 ? `<div style="background:rgba(201,151,28,.15);border:1px solid rgba(201,151,28,.3);border-radius:7px;padding:.5rem .8rem;margin-bottom:.75rem;color:var(--gold-light);font-size:.82rem">🎴 ${p.jailFreeCards}× Get Out of Jail Free card</div>` : ""}
    <div style="display:flex;gap:.45rem;margin-bottom:.75rem">
      <button style="flex:1;padding:.45rem .6rem;border-radius:8px;cursor:pointer;font-size:.82rem;font-weight:700;${propertiesTabBtnStyle}" onclick="setPortfolioTab('properties')">🏘 Properties</button>
      <button style="flex:1;padding:.45rem .6rem;border-radius:8px;cursor:pointer;font-size:.82rem;font-weight:700;${logTabBtnStyle}" onclick="setPortfolioTab('log')">📋 Game Log</button>
    </div>
    <div style="display:${activeTab === "properties" ? "" : "none"}">
      <div style="font-size:.8rem;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Properties</div>
      ${propsHtml}
    </div>
    <div style="display:${activeTab === "log" ? "" : "none"}">
      <div style="display:flex;gap:.6rem;margin-bottom:.6rem">
        <div style="flex:1;background:rgba(45,160,90,.15);border:1px solid rgba(45,160,90,.35);border-radius:8px;padding:.42rem .55rem">
          <div style="font-size:.68rem;letter-spacing:.05em;text-transform:uppercase;color:rgba(134,239,172,.8)">Total Credit</div>
          <div style="font-size:.95rem;font-weight:800;color:#86efac">+${fmtCurrency(totalCredit)}</div>
        </div>
        <div style="flex:1;background:rgba(192,57,43,.15);border:1px solid rgba(192,57,43,.35);border-radius:8px;padding:.42rem .55rem">
          <div style="font-size:.68rem;letter-spacing:.05em;text-transform:uppercase;color:rgba(252,165,165,.8)">Total Debit</div>
          <div style="font-size:.95rem;font-weight:800;color:#fca5a5">-${fmtCurrency(totalDebit)}</div>
        </div>
      </div>
      <div style="font-size:.8rem;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;margin-bottom:.5rem">Player History (Whole Match)</div>
      ${historyHtml}
    </div>
    <button class="btn btn-full" style="background:rgba(255,255,255,.1);color:#fff;margin-top:1rem" onclick="closeOverlay('portfolio-overlay')">Close</button>
  `;
  openOverlay("portfolio-overlay");
}

function openHomePage() {
  showScreen("home-screen");
}

function openBugReport() {
  let opened = false;
  try {
    const win = window.open(BUG_REPORT_URL, "_blank", "noopener,noreferrer");
    opened = !!win;
    if (opened) {
      try {
        win.opener = null;
      } catch (_e) {}
    }
  } catch (_err) {
    opened = false;
  }
  if (!opened) {
    toast(
      "Could not open bug report in a new tab. Allow pop-ups and try again.",
      "danger",
    );
  }
}

function openWhatsNewPage() {
  if (openWhatsNewPage._busy) return;
  openWhatsNewPage._busy = true;
  const btn = document.getElementById("credits-logs-btn");
  if (btn) btn.disabled = true;
  document.body.classList.add("route-leaving");
  window.setTimeout(() => {
    window.location.href = "whats-new.html";
  }, 170);
}

function openTestLabPage() {
  if (openTestLabPage._busy) return;
  openTestLabPage._busy = true;
  document.body.classList.add("route-leaving");
  window.setTimeout(() => {
    window.location.href = "test-lab.html";
  }, 170);
}

function openBoardEditorPage() {
  if (openBoardEditorPage._busy) return;
  openBoardEditorPage._busy = true;
  document.body.classList.add("route-leaving");
  const seed = String(ACTIVE_CUSTOM_BOARD_SEED || "").trim();
  if (seed) {
    localStorage.setItem(CUSTOM_BOARD_EDITOR_STORAGE_KEY, seed);
  }
  window.setTimeout(() => {
    window.location.href = "boardeditor.html";
  }, 170);
}

function openOfflineSetupPage() {
  LOBBY_CONTEXT = "offline";
  renderLobby();
  updateOnlineLobbyUI();
  showScreen("lobby-screen");
}

function openOnlineSetupPage(mode = "host") {
  LOBBY_CONTEXT = "online";
  setOnlineMode(mode);
  updateOnlineLobbyUI();
  showScreen("online-screen");
}

function openOnlineRoomPage() {
  LOBBY_CONTEXT = "online";
  renderLobby();
  updateOnlineLobbyUI();
  showScreen("lobby-screen");
}

function handleLobbyBack() {
  if (isOnlineGame()) {
    leaveOnlineRoom(true, true).catch((err) => {
      console.error(err);
      toast("Could not leave room cleanly.", "danger");
    });
    return;
  }
  if (LOBBY_CONTEXT === "online") {
    openOnlineSetupPage(ONLINE.mode);
    return;
  }
  openHomePage();
}

function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
  syncBgmForScreen(id);
}

// ═══════════════════════════════════════════════
//  AUTO-ADVANCE TIMER
// ═══════════════════════════════════════════════
const TIMER = {
  duration: 30, // seconds; 0 = off
  remaining: 0,
  intervalId: null,
  paused: false,
};

function setTimerDuration(secs) {
  if (isOnlineGame() && !ONLINE.isHost) {
    toast("Only the host can change timer settings in online mode.", "danger");
    return;
  }

  const next = Math.max(0, Number(secs) || 0);
  TIMER.duration = next;
  const timerInput = document.getElementById("lobby-timer");
  if (timerInput) timerInput.value = String(next);
  stopTimer();
  if (
    G &&
    Array.isArray(G.players) &&
    G.phase === "end" &&
    canLocalControlTurn()
  ) {
    startTimer();
  }
  // Re-open settings with updated state
  openDrawer("settings");
  toast(next === 0 ? "⏱ Timer disabled" : `⏱ Timer set to ${next}s`, "gold");
  syncLobbySettingsToRoom().catch((err) => {
    console.error(err);
    toast("Failed to sync timer setting online.", "danger");
  });
}

function startTimer() {
  if (TIMER.duration === 0) return;
  stopTimer();
  TIMER.remaining = TIMER.duration;
  TIMER.paused = false;
  updateTimerUI();
  document.getElementById("timer-wrap").classList.remove("hidden");
  TIMER.intervalId = setInterval(() => {
    if (TIMER.paused) return;
    // Pause if any overlay is open
    const anyOpen = document.querySelector(".overlay.show");
    if (anyOpen) return;
    TIMER.remaining--;
    updateTimerUI();
    if (TIMER.remaining <= 0) {
      stopTimer();
      endTurn();
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(TIMER.intervalId);
  TIMER.intervalId = null;
  document.getElementById("timer-wrap").classList.add("hidden");
}

function updateTimerUI() {
  const arc = document.getElementById("timer-arc");
  const num = document.getElementById("timer-num");
  if (!arc || !num) return;
  const frac = TIMER.remaining / TIMER.duration;
  const circumference = 94.25; // 2π×15
  arc.style.strokeDashoffset = circumference * (1 - frac);
  const danger = TIMER.remaining <= 5;
  arc.classList.toggle("danger", danger);
  num.classList.toggle("danger", danger);
  num.textContent = TIMER.remaining;
}

function updateViewportHeightVar() {
  const viewportHeight =
    window.visualViewport?.height ||
    window.innerHeight ||
    document.documentElement.clientHeight;
  if (!viewportHeight) return;
  document.documentElement.style.setProperty(
    "--vh",
    `${viewportHeight * 0.01}px`,
  );
}

function installOnlineMutationHooks() {
  ONLINE_MUTATION_FUNCS.forEach((name) => {
    const fn = window[name];
    if (typeof fn !== "function" || fn.__onlineWrapped) return;
    const wrapped = async function (...args) {
      const result = fn.apply(this, args);
      if (result && typeof result.then === "function") {
        await result;
      }
      if (isOnlineGame() && !ONLINE.isApplyingRemote) {
        if (
          name === "rollDice" &&
          (Number(ONLINE.pendingCardResolutions) || 0) > 0
        ) {
          return result;
        }
        await syncRoomState(name);
      }
      return result;
    };
    wrapped.__onlineWrapped = true;
    window[name] = wrapped;
  });
}

function installLobbyEvents() {
  const nameInput = document.getElementById("online-player-name");
  const codeInput = document.getElementById("join-room-code");
  const passInput = document.getElementById("join-room-password");
  const visSelect = document.getElementById("room-visibility");
  const startMoney = document.getElementById("starting-money");
  const timerSelect = document.getElementById("lobby-timer");
  const auctionSelect = document.getElementById("auction-enabled");
  const customSeedInput = document.getElementById("custom-board-seed");

  const rememberedName = localStorage.getItem("monopoly_online_name");
  if (nameInput && rememberedName) nameInput.value = rememberedName;

  if (nameInput) {
    nameInput.addEventListener("change", () => {
      const val = sanitizeName(nameInput.value, "Player");
      nameInput.value = val;
      localStorage.setItem("monopoly_online_name", val);
    });
  }

  if (codeInput) {
    codeInput.addEventListener("input", () => {
      codeInput.value = sanitizeRoomId(codeInput.value);
    });
  }

  if (passInput) {
    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") joinOnlineRoom();
    });
  }

  if (visSelect) {
    visSelect.addEventListener("change", () => {
      const pass = document.getElementById("host-room-password");
      if (!pass) return;
      const closed = visSelect.value === "closed";
      pass.disabled = !closed;
      pass.placeholder = closed ? "Set password" : "Not needed for open room";
    });
    visSelect.dispatchEvent(new Event("change"));
  }

  if (startMoney) {
    startMoney.addEventListener("change", () => {
      syncLobbySettingsToRoom();
    });
  }

  if (timerSelect) {
    timerSelect.addEventListener("change", () => {
      syncLobbySettingsToRoom();
    });
  }

  if (auctionSelect) {
    auctionSelect.addEventListener("change", () => {
      syncLobbySettingsToRoom();
    });
  }

  if (customSeedInput) {
    const onSeedInputUpdated = () => {
      const normalized = normalizeCustomBoardSeedText(customSeedInput.value);
      if (!normalized) {
        setCustomBoardStatus(
          "No custom board loaded. Paste a seed or use saved seed.",
        );
        return;
      }
      if (normalized === ACTIVE_CUSTOM_BOARD_SEED) {
        setCustomBoardStatus(
          'Seed matches the loaded custom board. Select "Custom" in board themes to play it.',
        );
        return;
      }
      setCustomBoardStatus(
        `Seed ready (${normalized.length} chars). Click "Load Seed" to apply it.`,
      );
    };
    customSeedInput.addEventListener("paste", () => {
      requestAnimationFrame(() => {
        const normalized = normalizeCustomBoardSeedText(customSeedInput.value);
        if (normalized && normalized !== customSeedInput.value) {
          customSeedInput.value = normalized;
        }
        onSeedInputUpdated();
      });
    });
    customSeedInput.addEventListener("input", onSeedInputUpdated);
    customSeedInput.addEventListener("change", onSeedInputUpdated);
  }

  setInterval(() => {
    if (!ONLINE.ready) return;
    if (isOnlineGame()) {
      pulseRoomHeartbeat();
      return;
    }
    if (ONLINE.mode === "join") {
      refreshOpenRoomsList();
      return;
    }
    cleanupAbandonedRooms(null, false).catch((err) => {
      console.error("Background room cleanup failed.", err);
    });
  }, 8000);

  setInterval(() => {
    const gameScreen = document.getElementById("game-screen");
    if (!gameScreen || gameScreen.classList.contains("hidden")) return;
    if (!G || G.gameOver) return;
    maybeScheduleOfflineAiTurn();
  }, 1400);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
updateViewportHeightVar();
window.addEventListener("resize", updateViewportHeightVar);
window.addEventListener("orientationchange", updateViewportHeightVar);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportHeightVar);
}

loadSfxPreferences();
preloadSfxAssets();
installSfxUnlockListeners();

installOnlineMutationHooks();
installLobbyEvents();
registerServiceWorker();
initializeCustomBoardFromStorage();
refreshStartingMoneyUi(selectedThemeId, false);
renderLobby();
updateOnlineLobbyUI();
showScreen("home-screen");
