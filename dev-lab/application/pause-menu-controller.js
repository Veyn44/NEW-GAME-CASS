/**
 * Owns the Dev Lab pause overlay and its UI actions. Runtime pause state stays
 * in the application shell; this controller only manages overlay visibility
 * and delegates navigation/runtime effects to the host.
 */
export function createDevLabPauseMenuController({
  elements,
  navigation,
  canOpen = () => true,
  onOpen = () => {},
  onClose = () => {},
  onVisibilityChange = () => {}
} = {}) {
  const required = ["menu", "resumeButton", "settingsButton", "mainMenuButton"];
  if (!elements || required.some((key) => !elements[key])) {
    throw new TypeError("Dev Lab pause menu elements are required.");
  }
  if (!navigation || typeof navigation.openSettings !== "function"
    || typeof navigation.showView !== "function") {
    throw new TypeError("Dev Lab pause menu requires a navigation controller.");
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
    if (open) navigation.openSettings("dev-lab");
  });
  mainMenuButton.addEventListener("click", () => {
    if (!open) return;
    hide();
    navigation.showView("menu");
  });

  return Object.freeze({
    open: show,
    close: hide,
    toggle,
    isOpen: () => open
  });
}
