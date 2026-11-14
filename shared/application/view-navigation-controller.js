/**
 * Coordinates application views and the definition-catalog overlay.
 * Application-specific view identifiers and lifecycle effects are injected
 * by the composition root.
 */
export function createViewNavigationController({
  elements,
  definitionCatalog,
  workspaceView,
  menuView = "menu",
  settingsView = "settings",
  databaseViewName = "database",
  catalogLabels = {
    browse: "ENGINE / CONTENT CATALOG",
    viewport: "ENGINE / WORKSPACE"
  },
  canOpenViewportDatabase = () => true,
  beforeLeaveWorkspace = () => {},
  onSettingsReturn = () => {},
  onNavigateSettings = () => {},
  scrollToTop = () => {},
  dispatchResize = () => {}
} = {}) {
  const required = [
    "views", "navButtons", "databaseView", "databaseHome",
    "databaseModeLabel", "databaseBackButton", "viewportPanel",
    "settingsBackButton", "backMenuButtons", "viewportDatabaseButton", "body"
  ];
  if (!elements || required.some((key) => !elements[key])) {
    throw new TypeError("View navigation elements are required.");
  }
  if (typeof workspaceView !== "string" || !workspaceView) {
    throw new TypeError("View navigation requires a workspaceView identifier.");
  }
  if (!definitionCatalog || typeof definitionCatalog.open !== "function"
    || typeof definitionCatalog.close !== "function") {
    throw new TypeError("View navigation requires a definition catalog controller.");
  }

  const {
    views, navButtons, databaseView, databaseHome, databaseModeLabel,
    databaseBackButton, viewportPanel, settingsBackButton, backMenuButtons,
    viewportDatabaseButton
  } = elements;
  let viewportDatabaseOpen = false;
  let settingsReturnView = menuView;

  function showView(name) {
    if (!views.some((view) => view.dataset.view === name)) return false;
    if (viewportDatabaseOpen && name !== workspaceView) closeViewportDatabase();

    const currentView = elements.body.dataset.currentView;
    if (currentView === workspaceView && name !== workspaceView) {
      beforeLeaveWorkspace(name);
    }

    for (const view of views) view.hidden = view.dataset.view !== name;
    elements.body.dataset.currentView = name;
    scrollToTop();
    if (name === workspaceView) dispatchResize();
    return true;
  }

  function openDatabase() {
    if (viewportDatabaseOpen) closeViewportDatabase();
    databaseView.dataset.mode = "browse";
    databaseModeLabel.textContent = catalogLabels.browse;
    definitionCatalog.open("browse");
    return showView(databaseViewName);
  }

  function openViewportDatabase() {
    if (!canOpenViewportDatabase() || viewportDatabaseOpen) return false;
    definitionCatalog.open("viewport");
    databaseView.dataset.mode = "viewport";
    databaseView.classList.add("database-overlay");
    databaseModeLabel.textContent = catalogLabels.viewport;
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
    databaseModeLabel.textContent = catalogLabels.browse;
    viewportDatabaseOpen = false;
    definitionCatalog.close();
    return true;
  }

  function openSettings(returnView = menuView) {
    settingsReturnView = returnView;
    onNavigateSettings(returnView);
    return showView(settingsView);
  }

  function returnFromSettings() {
    const returnView = settingsReturnView;
    showView(returnView);
    onSettingsReturn(returnView);
  }

  for (const button of navButtons) {
    button.addEventListener("click", () => {
      if (button.dataset.navigate === databaseViewName) openDatabase();
      else if (button.dataset.navigate === settingsView) openSettings(menuView);
      else showView(button.dataset.navigate);
    });
  }

  settingsBackButton.addEventListener("click", returnFromSettings);
  for (const button of backMenuButtons) {
    button.addEventListener("click", () => {
      if (button === databaseBackButton && viewportDatabaseOpen) closeViewportDatabase();
      else showView(menuView);
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
