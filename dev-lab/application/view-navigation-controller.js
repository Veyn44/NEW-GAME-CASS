/**
 * Owns Dev Lab screen navigation and the definition-catalog overlay lifecycle.
 * Application-specific pause, placement, and settings behavior is injected by
 * the host so this controller remains independent of gameplay systems.
 */
export function createDevLabViewNavigationController({
  elements,
  definitionCatalog,
  canOpenViewportDatabase = () => true,
  beforeLeaveWorkspace = () => {},
  onSettingsReturn = () => {},
  onPauseMainMenu = () => {},
  onNavigateSettings = () => {},
  scrollToTop = () => {},
  dispatchResize = () => {}
} = {}) {
  const required = [
    "views", "navButtons", "databaseView", "databaseHome",
    "databaseModeLabel", "databaseBackButton", "viewportPanel",
    "settingsBackButton", "backMenuButtons", "pauseSettingsButton",
    "pauseMainMenuButton", "viewportDatabaseButton"
  ];
  if (!elements || required.some((key) => !elements[key])) {
    throw new TypeError("Dev Lab navigation elements are required.");
  }
  if (!definitionCatalog || typeof definitionCatalog.open !== "function"
    || typeof definitionCatalog.close !== "function") {
    throw new TypeError("Dev Lab navigation requires a definition catalog controller.");
  }

  const {
    views, navButtons, databaseView, databaseHome, databaseModeLabel,
    databaseBackButton, viewportPanel, settingsBackButton, backMenuButtons,
    pauseSettingsButton, pauseMainMenuButton, viewportDatabaseButton
  } = elements;
  let viewportDatabaseOpen = false;
  let settingsReturnView = "menu";

  function showView(name) {
    if (!views.some((view) => view.dataset.view === name)) return false;
    if (viewportDatabaseOpen && name !== "dev-lab") closeViewportDatabase();

    const currentView = elements.body.dataset.currentView;
    if (currentView === "dev-lab" && name !== "dev-lab") {
      beforeLeaveWorkspace(name);
    }

    for (const view of views) view.hidden = view.dataset.view !== name;
    elements.body.dataset.currentView = name;
    scrollToTop();
    if (name === "dev-lab") dispatchResize();
    return true;
  }

  function openDatabase() {
    if (viewportDatabaseOpen) closeViewportDatabase();
    databaseView.dataset.mode = "browse";
    databaseModeLabel.textContent = "ENGINE / CONTENT CATALOG";
    definitionCatalog.open("browse");
    return showView("database");
  }

  function openViewportDatabase() {
    if (!canOpenViewportDatabase() || viewportDatabaseOpen) return false;
    definitionCatalog.open("viewport");
    databaseView.dataset.mode = "viewport";
    databaseView.classList.add("database-overlay");
    databaseModeLabel.textContent = "ENGINE / DEV LAB";
    databaseBackButton.textContent = "CLOSE DATABASE";
    viewportPanel.append(databaseView);
    databaseView.hidden = false;
    viewportDatabaseOpen = true;
    return true;
  }

  function closeViewportDatabase() {
    if (!viewportDatabaseOpen) return false;
    databaseHome.after(databaseView);
    databaseView.hidden = true;
    databaseView.classList.remove("database-overlay");
    databaseView.dataset.mode = "browse";
    databaseBackButton.textContent = "← Main menu";
    databaseModeLabel.textContent = "ENGINE / CONTENT CATALOG";
    viewportDatabaseOpen = false;
    definitionCatalog.close();
    return true;
  }

  function openSettings(returnView = "menu") {
    settingsReturnView = returnView;
    onNavigateSettings(returnView);
    return showView("settings");
  }

  function returnFromSettings() {
    const returnView = settingsReturnView;
    showView(returnView);
    onSettingsReturn(returnView);
  }

  for (const button of navButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.navigate === "database") openDatabase();
      else if (button.dataset.navigate === "settings") openSettings("menu");
      else showView(button.dataset.navigate);
    });
  }

  settingsBackButton.addEventListener("click", returnFromSettings);
  pauseSettingsButton.addEventListener("click", () => openSettings("dev-lab"));
  pauseMainMenuButton.addEventListener("click", () => {
    onPauseMainMenu();
    showView("menu");
  });
  for (const button of backMenuButtons) {
    button.addEventListener("click", () => {
      if (button === databaseBackButton && viewportDatabaseOpen) closeViewportDatabase();
      else showView("menu");
    });
  }
  viewportDatabaseButton.addEventListener("click", openViewportDatabase);

  return Object.freeze({
    showView,
    openDatabase,
    openSettings,
    openViewportDatabase,
    closeViewportDatabase,
    returnFromSettings,
    isViewportDatabaseOpen: () => viewportDatabaseOpen,
    getCurrentView: () => elements.body.dataset.currentView,
    getSettingsReturnView: () => settingsReturnView
  });
}
