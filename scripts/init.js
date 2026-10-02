// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
// Each step runs on its own: if one throws (say, a stale cached script is
// missing a function), the rest of start-up still happens.
function initStep(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Start-up step "${name}" failed:`, err);
  }
}

initStep("viewport", () => {
  updateViewportHeightVar();
  window.addEventListener("resize", updateViewportHeightVar);
  window.addEventListener("orientationchange", updateViewportHeightVar);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateViewportHeightVar);
  }
});

initStep("sound", () => {
  loadSfxPreferences();
  preloadSfxAssets();
  installSfxUnlockListeners();
});

initStep("language", installI18n);
initStep("app shell", installAppShell);
initStep("autosave", installAutosave);
initStep("online hooks", installOnlineMutationHooks);
initStep("lobby events", installLobbyEvents);
initStep("keyboard", installKeyboardShortcuts);
initStep("dialog close buttons", installModalCloseButtons);
initStep("sticky headers", installStickyHeaders);
initStep("service worker", registerServiceWorker);
initStep("custom board", initializeCustomBoardFromStorage);
initStep("lobby preferences", loadLobbyPrefs);
initStep("starting money", () => refreshStartingMoneyUi(selectedThemeId, false));
initStep("lobby", renderLobby);
initStep("online lobby", updateOnlineLobbyUI);
initStep("home", () => showScreen("home-screen"));
initStep("saved game", renderContinueCard);
initStep("online rejoin", renderRejoinCard);
initStep("launch shortcut", handleLaunchShortcut);
