/**
 * Owns pause-overlay visibility and delegates application effects through
 * injected callbacks and the shared view-navigation contract.
 */
export function createPauseMenuController({
  elements,
  navigation,
  workspaceView,
  menuView = "menu",
  canOpen = () => true,
  onOpen = () => {},
  onClose = () => {},
  onVisibilityChange = () => {}
} = {}) {
  const required = ["menu", "resumeButton", "settingsButton", "mainMenuButton"];
  if (!elements || required.some((key) => !elements[key])) {
    throw new TypeError("Pause menu elements are required.");
  }
  if (typeof workspaceView !== "string" || !workspaceView) {
    throw new TypeError("Pause menu requires a workspaceView identifier.");
  }
  if (!navigation || typeof navigation.openSettings !== "function"
    || typeof navigation.showView !== "function") {
    throw new TypeError("Pause menu requires a view navigation controller.");
  }

  const { menu, resumeButton, settingsButton, mainMenuButton } = elements;
  let open = !menu.hidden;

  function setOpen(nextOpen) {
    const next = Boolean(nextOpen);
    if (next === open) return false;
    open = next;
    menu.hidden = !open;
    if (open) onOpen();
    else onClose();
    onVisibilityChange(open);
    return true;
  }

  function show() {
    if (!canOpen()) return false;
    return setOpen(true);
  }

  function hide() {
    return setOpen(false);
  }

  function toggle() {
    return open ? hide() : show();
  }

  resumeButton.addEventListener("click", hide);
  settingsButton.addEventListener("click", () => {
    if (open) navigation.openSettings(workspaceView);
  });
  mainMenuButton.addEventListener("click", () => {
    if (!open) return;
    hide();
    navigation.showView(menuView);
  });

  return Object.freeze({
    open: show,
    close: hide,
    toggle,
    isOpen: () => open
  });
}
