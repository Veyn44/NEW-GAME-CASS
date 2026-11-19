function normalizeBindings(bindings) {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) {
    throw new TypeError("Action bindings must be an object.");
  }
  const normalized = {};
  for (const [action, codes] of Object.entries(bindings)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(action) || !Array.isArray(codes) || codes.length === 0
      || codes.some((code) => typeof code !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(code))) {
      throw new TypeError(`Invalid binding for action "${action}".`);
    }
    if (new Set(codes).size !== codes.length) throw new TypeError(`Duplicate key in action "${action}".`);
    normalized[action] = Object.freeze([...codes]);
  }
  const allCodes = Object.entries(normalized).flatMap(([action, codes]) => codes.map((code) => ({ action, code })));
  const conflicts = new Set();
  for (let i = 0; i < allCodes.length; i += 1) {
    for (let j = i + 1; j < allCodes.length; j += 1) {
      if (allCodes[i].code === allCodes[j].code) conflicts.add(allCodes[i].code);
    }
  }
  if (conflicts.size) throw new Error(`Key binding conflict: ${[...conflicts].join(", ")}`);
  return Object.freeze(normalized);
}

/** Maps physical keyboard codes to game actions without assigning gameplay meaning to keys. */
export function createActionMappingController({ bindings = {} } = {}) {
  const initialBindings = normalizeBindings(bindings);
  let currentBindings = initialBindings;
  const heldCodes = new Set();
  const heldActions = new Set();

  function actionsFor(code) {
    return Object.entries(currentBindings)
      .filter(([, codes]) => codes.includes(code))
      .map(([action]) => action);
  }

  function keyDown(code) {
    if (typeof code !== "string" || heldCodes.has(code)) return Object.freeze([]);
    heldCodes.add(code);
    const activated = [];
    for (const action of actionsFor(code)) {
      if (!heldActions.has(action)) {
        heldActions.add(action);
        activated.push(action);
      }
    }
    return Object.freeze(activated);
  }

  function keyUp(code) {
    heldCodes.delete(code);
    for (const action of actionsFor(code)) {
      if (!currentBindings[action].some((boundCode) => heldCodes.has(boundCode))) heldActions.delete(action);
    }
  }

  function setBinding(action, codes) {
    if (!Object.hasOwn(currentBindings, action)) throw new Error(`Unknown action "${action}".`);
    const next = normalizeBindings({ ...currentBindings, [action]: codes });
    currentBindings = next;
    heldCodes.clear();
    heldActions.clear();
    return currentBindings;
  }

  function replaceBindings(nextBindings) {
    currentBindings = normalizeBindings(nextBindings);
    heldCodes.clear();
    heldActions.clear();
    return currentBindings;
  }

  function clearHeld() {
    heldCodes.clear();
    heldActions.clear();
  }

  function reset() {
    currentBindings = initialBindings;
    heldCodes.clear();
    heldActions.clear();
    return currentBindings;
  }

  return Object.freeze({
    keyDown,
    keyUp,
    getState: () => Object.freeze(Object.fromEntries(
      Object.keys(currentBindings).map((action) => [action, heldActions.has(action)])
    )),
    getBindings: () => currentBindings,
    setBinding,
    replaceBindings,
    reset,
    clearHeld
  });
}

