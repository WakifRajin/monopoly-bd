// ═══════════════════════════════════════════════
//  SAVE AND RESUME
//  Games on this device (hot-seat and against the AI) are saved to this
//  browser as they are played, and can be continued from the home screen
//  after a refresh, a crash or closing the tab. Online and Same Wi-Fi matches
//  live on the network and are not saved here.
// ═══════════════════════════════════════════════

// Up to three games are kept, one slot per game (keyed by when it started),
// so starting a new game no longer throws away the one in progress.
const SAVE_SLOT_PREFIX = "monopoly_save_v2_";
const SAVE_INDEX_KEY = "monopoly_save_index_v2";
const SAVE_LEGACY_KEY = "monopoly_saved_game_v1";
const SAVE_VERSION = 2;
const SAVE_MAX_SLOTS = 3;
const SAVE = { timer: 0, lastJson: "", warnedFull: false };

function isSavableGame() {
  const onLan = typeof LAN !== "undefined" && LAN.active;
  return !!(
    G &&
    Array.isArray(G.players) &&
    G.players.length &&
    G.gameStartedAt &&
    !G.gameOver &&
    !isOnlineGame() &&
    !onLan &&
    // A hidden board's games are not kept in the browser.
    !isHiddenTheme(G.boardThemeId)
  );
}

// A move, or a card still waiting to be read, is not written half-way: the
// last save from before it is kept until the game settles again.
function isStableForSave() {
  return !(
    MOVE_FX.active ||
    (Number(ONLINE.pendingCardResolutions) || 0) > 0 ||
    document.getElementById("card-overlay")?.classList.contains("show")
  );
}

function saveSlotId(game) {
  return String(Number(game?.gameStartedAt) || 0);
}

function readSaveIndex() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVE_INDEX_KEY) || "[]");
    return Array.isArray(list) ? list.map(String).filter((id) => /^\d+$/.test(id)) : [];
  } catch (_err) {
    return [];
  }
}

function writeSaveIndex(ids) {
  try {
    localStorage.setItem(SAVE_INDEX_KEY, JSON.stringify([...new Set(ids)]));
  } catch (_err) {
    /* the slots themselves still hold the games */
  }
}

// Older saves are brought up to date step by step, so a save from any
// earlier build still opens.
function migrateSave(save) {
  if (!save || typeof save !== "object") return null;
  let out = save;
  if (out.v === 1) out = { ...out, v: 2 };
  return out.v === SAVE_VERSION ? out : null;
}

// The one-slot save of earlier builds becomes a slot of its own, once.
function migrateLegacySave() {
  let raw = null;
  try {
    raw = localStorage.getItem(SAVE_LEGACY_KEY);
  } catch (_err) {
    return;
  }
  if (!raw) return;
  try {
    const save = migrateSave(JSON.parse(raw));
    if (save && save.game) {
      const id = saveSlotId(save.game);
      localStorage.setItem(SAVE_SLOT_PREFIX + id, JSON.stringify(save));
      writeSaveIndex([id, ...readSaveIndex()]);
    }
  } catch (_err) {
    /* an unreadable old save is simply dropped */
  }
  try {
    localStorage.removeItem(SAVE_LEGACY_KEY);
  } catch (_err) {}
}

function readSaveSlot(id) {
  let save = null;
  try {
    save = migrateSave(JSON.parse(localStorage.getItem(SAVE_SLOT_PREFIX + id) || "null"));
  } catch (_err) {
    return null;
  }
  if (!save || !save.game) return null;
  const players = indexedObjectToArray(save.game.players);
  if (!players.length || save.game.gameOver) return null;
  save.id = id;
  return save;
}

function removeSaveSlot(id) {
  try {
    localStorage.removeItem(SAVE_SLOT_PREFIX + id);
  } catch (_err) {}
  writeSaveIndex(readSaveIndex().filter((x) => x !== String(id)));
}

// Every saved game, newest first. Slots that no longer read are cleared out.
function readSavedGames() {
  migrateLegacySave();
  const out = [];
  for (const id of readSaveIndex()) {
    const save = readSaveSlot(id);
    if (save) out.push(save);
    else removeSaveSlot(id);
  }
  return out.sort((a, b) => (Number(b.savedAt) || 0) - (Number(a.savedAt) || 0));
}

// The most recent saved game (or a given one).
function readSavedGame(id = null) {
  if (id !== null && id !== undefined) return readSaveSlot(String(id));
  return readSavedGames()[0] || null;
}

function saveGameNow() {
  if (!isSavableGame()) return false;
  if (!isStableForSave()) {
    scheduleSave();
    return false;
  }
  let json = "";
  const id = saveSlotId(G);
  try {
    syncDebtPromptToGameState();
    const game = safeGameStateForRoom();
    game.chat = Array.isArray(G.chat) ? G.chat.slice(-120) : [];
    json = JSON.stringify({
      v: SAVE_VERSION,
      savedAt: Date.now(),
      build: window.APP_BUILD || "",
      timer: TIMER.duration,
      game,
    });
  } catch (err) {
    console.warn("Could not save the game:", err);
    return false;
  }
  if (json === SAVE.lastJson) return true;
  const write = () => {
    localStorage.setItem(SAVE_SLOT_PREFIX + id, json);
    writeSaveIndex([id, ...readSaveIndex().filter((x) => x !== id)]);
  };
  try {
    write();
  } catch (err) {
    // Storage full: make room by dropping the oldest other saved game, then
    // try once more. Say so once if it still does not fit.
    const others = readSaveIndex().filter((x) => x !== id);
    if (others.length) {
      removeSaveSlot(others[others.length - 1]);
      try {
        write();
      } catch (_err2) {
        warnSaveFull();
        return false;
      }
    } else {
      warnSaveFull();
      return false;
    }
  }
  SAVE.lastJson = json;
  // Keep only the newest few games.
  const ids = readSaveIndex();
  ids.slice(SAVE_MAX_SLOTS).forEach(removeSaveSlot);
  return true;
}

function warnSaveFull() {
  if (SAVE.warnedFull) return;
  SAVE.warnedFull = true;
  toast("This game can't be saved: the browser's storage is full.", "danger");
}

function scheduleSave() {
  if (!isSavableGame()) return;
  clearTimeout(SAVE.timer);
  SAVE.timer = setTimeout(saveGameNow, 400);
}

// Clears the current game's slot (a finished game has nothing to continue),
// or a given one.
function clearSavedGame(id = null) {
  clearTimeout(SAVE.timer);
  SAVE.lastJson = "";
  const target = id !== null && id !== undefined ? String(id) : G ? saveSlotId(G) : "";
  if (target) removeSaveSlot(target);
  renderContinueCard();
}

function describeSavedGame(save) {
  const g = save.game;
  const players = indexedObjectToArray(g.players);
  const theme = BOARD_THEMES[g.boardThemeId]?.name || (g.boardThemeId === CUSTOM_BOARD_THEME_ID ? "Custom board" : "");
  const turns = Number(g.turnCount) || 0;
  const cur = players[Number(g.currentPlayerIdx)];
  const when = new Date(Number(save.savedAt) || Date.now());
  const sameDay = new Date().toDateString() === when.toDateString();
  const stamp = sameDay
    ? when.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : when.toLocaleDateString([], { day: "numeric", month: "short" });
  const parts = [
    `${players.length} players`,
    theme,
    turns ? `${turns} turn${turns === 1 ? "" : "s"} in` : "",
    cur ? `${cur.name}'s turn` : "",
    `saved ${stamp}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function renderContinueCard() {
  const card = document.getElementById("hp-continue");
  if (!card) return;
  const saves = readSavedGames();
  const save = saves[0] || null;
  card.hidden = !save;
  card.dataset.saveId = save ? save.id : "";
  const sub = document.getElementById("hp-continue-sub");
  if (save && sub) sub.textContent = describeSavedGame(save);
  const discard = document.getElementById("hp-continue-discard");
  if (discard) {
    discard.dataset.confirm = "";
    discard.textContent = "Discard";
  }
  // The other saved games, each with its own Continue.
  const more = document.getElementById("hp-continue-more");
  if (more) {
    const rest = saves.slice(1);
    more.hidden = !rest.length;
    more.innerHTML = rest.length
      ? `<span class="hp-continue-more-title">${escHtml(uiText("Other saved games"))}</span>` +
        rest
          .map(
            (sv) => `<div class="hp-continue-row"><span>${escHtml(describeSavedGame(sv))}</span>
              <span class="hp-continue-row-actions">
                <button type="button" class="mp-btn mp-btn-ghost mp-btn-sm" onclick="discardSavedGameById('${sv.id}')">Discard</button>
                <button type="button" class="mp-btn mp-btn-secondary mp-btn-sm" onclick="resumeSavedGame('${sv.id}')">Continue</button>
              </span></div>`,
          )
          .join("")
      : "";
  }
}

// Two taps, so a stray one cannot throw away a long game.
function discardSavedGame() {
  const btn = document.getElementById("hp-continue-discard");
  if (btn && btn.dataset.confirm !== "1") {
    btn.dataset.confirm = "1";
    btn.textContent = "Tap again to discard";
    setTimeout(() => {
      if (btn.dataset.confirm === "1") {
        btn.dataset.confirm = "";
        btn.textContent = "Discard";
      }
    }, 3500);
    return;
  }
  const id = document.getElementById("hp-continue")?.dataset.saveId;
  clearSavedGame(id || null);
  toast("Saved game discarded", "gold");
}

function discardSavedGameById(id) {
  clearSavedGame(id);
  toast("Saved game discarded", "gold");
}

function resumeSavedGame(id = null) {
  const slot = id || document.getElementById("hp-continue")?.dataset.saveId || null;
  const save = readSavedGame(slot);
  if (!save) {
    toast("That saved game could not be opened.", "danger");
    renderContinueCard();
    return;
  }
  try {
    resumeSave(save);
  } catch (err) {
    // A save this build cannot read must not leave the player stuck on the
    // home screen with the same broken Continue button.
    console.error("Could not resume the saved game:", err);
    removeSaveSlot(save.id);
    G = {};
    showScreen("home-screen");
    renderContinueCard();
    toast("That saved game was damaged and has been removed.", "danger");
  }
}

function resumeSave(save) {
  const raw = save.game;
  const themeId = String(raw.boardThemeId || "");
  if (themeId === CUSTOM_BOARD_THEME_ID && !String(raw.customBoardSeed || "").trim()) {
    toast("The custom board for this game is missing.", "danger");
    return;
  }
  if (themeId !== CUSTOM_BOARD_THEME_ID && !BOARD_THEMES[themeId]) {
    toast("The board for this game is no longer available.", "danger");
    return;
  }
  clearOfflineAiTimer(true);
  stopTimer();

  // Time away from the game does not count against a match time limit.
  const now = Date.now();
  const savedAt = Number(save.savedAt) || now;
  const pausedAt = Number(raw.pausedAt) || 0;
  raw.pausedMs = (Number(raw.pausedMs) || 0) + Math.max(0, now - savedAt) + (pausedAt ? Math.max(0, savedAt - pausedAt) : 0);
  raw.pausedAt = null;

  const chat = Array.isArray(raw.chat) ? raw.chat : [];
  hydrateRemoteGameState(raw);
  if (themeId === CUSTOM_BOARD_THEME_ID && G.boardThemeId !== CUSTOM_BOARD_THEME_ID) {
    toast("The custom board for this game could not be loaded.", "danger");
    return;
  }
  G.chat = chat;
  AI_CTRL.lastKey = "";
  AI_CTRL.lastTradeAttemptKey = "";
  MOVE_FX.active = false;
  MOVE_FX.playerId = null;
  jailPromptShownKey = "";
  tradeReviewShownKey = "";
  TIMER.duration = Math.max(0, Number(save.timer) || 0);
  appendLogsToArchive(G.log || []);
  // The saved game is still the current one; keep it until it ends.
  SAVE.lastJson = "";

  buildBoard();
  showScreen("game-screen");
  addLog("Game resumed.", "important");
  renderAll();
  resumeOpenDecision();
  updateActionButtons();
  recordRecentActivity({
    kind: "local",
    title: "Local game",
    detail: `Resumed · ${describeSavedGame(save)}`,
    themeId: G.boardThemeId,
  });
}

// Reopens whatever the saved turn was waiting on.
function resumeOpenDecision() {
  const p = curPlayer();
  if (!p || G.gameOver) return;
  if (DEBT_PROMPT.active) {
    const payer = G.players[DEBT_PROMPT.payerId];
    if (payer && !isAiPlayer(payer)) {
      const recipient = DEBT_PROMPT.recipientId !== null ? G.players[DEBT_PROMPT.recipientId] : null;
      showDebtPrompt(payer, DEBT_PROMPT.amount, recipient, DEBT_PROMPT.toParking);
    }
    return;
  }
  if (hasPendingBuy() && !isAiPlayer(p)) {
    promptBuy(p, SPACES[Number(G.pendingBuy)]);
  }
}

// Saving happens after every render (debounced), and at once when the page is
// hidden or closed, which is the moment a phone is most likely to drop it.
function installAutosave() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGameNow();
  });
  window.addEventListener("pagehide", saveGameNow);
}

// The leave prompt says what actually happens to the game.
function updateExitGuardCopy() {
  const desc = document.getElementById("exit-guard-desc");
  const leave = document.getElementById("exit-guard-leave");
  const saved = isSavableGame();
  if (desc)
    desc.textContent = saved
      ? "Your game is saved. You can continue it from the home screen."
      : "Your game is still in progress. Leaving now ends it for you.";
  if (leave) leave.textContent = saved ? "Save and leave" : "Leave match";
}
