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
installKeyboardShortcuts();
registerServiceWorker();
initializeCustomBoardFromStorage();
loadLobbyPrefs();
refreshStartingMoneyUi(selectedThemeId, false);
renderLobby();
updateOnlineLobbyUI();
showScreen("home-screen");
