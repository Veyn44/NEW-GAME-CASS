/** Cassandra's initial keyboard layout. The Engine only knows action identifiers. */
export const DEFAULT_CASSANDRA_ACTION_BINDINGS = Object.freeze({
  moveNorth: Object.freeze(["KeyW"]),
  moveSouth: Object.freeze(["KeyS"]),
  moveWest: Object.freeze(["KeyA"]),
  moveEast: Object.freeze(["KeyD"]),
  toggleDraft: Object.freeze(["KeyF"]),
  pause: Object.freeze(["Space"]),
  dodge: Object.freeze(["ShiftLeft"]),
  crouch: Object.freeze(["ControlLeft"])
});
