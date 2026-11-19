/**
 * Owns the player-facing New Game navigation inside the Cassandra application.
 * This controller deliberately does not create a runtime session, world or unit.
 */
export function createNewGameFlowController({ navigation, elements } = {}) {
  const required = ["openButton", "nextButton", "optionsBackButton", "characterBackButton"];
  if (!navigation || typeof navigation.showView !== "function"
    || !elements || required.some((key) => !elements[key])) {
    throw new TypeError("New Game flow requires navigation and all screen controls.");
  }

  let currentStep = "closed";

  function showOptions() {
    currentStep = "options";
    return navigation.showView("new-game-options");
  }

  function showCharacter() {
    currentStep = "character";
    return navigation.showView("character-selection");
  }

  function open() {
    return showOptions();
  }

  elements.openButton.addEventListener("click", open);
  elements.nextButton.addEventListener("click", showCharacter);
  elements.optionsBackButton.addEventListener("click", () => {
    currentStep = "closed";
    navigation.showView("menu");
  });
  elements.characterBackButton.addEventListener("click", showOptions);

  return Object.freeze({
    open,
    showOptions,
    showCharacter,
    getCurrentStep: () => currentStep
  });
}
