# Phase 2 — Initial System Contracts

**Status:** Unit foundation, Dev Lab Database/placement/inspection, Colony Leader Draft, fixed-step locomotion and persistence are implemented and user-accepted as Phase 2. The complete phase was merged into `main` on 2026-11-13. See [Phase 2 acceptance](../phases/PHASE_2.md) and [test evidence](../testing/PHASE_2_TEST_PLAN.md).  
**Authority:** Accepted decisions in `WHATANDWHY.md`, current Core source and `src/core/README.md`.

This document defines the smallest technical contracts needed for the first runnable gameplay slice. It separates Core identity, Unit domain state and world placement. It deliberately leaves game-design fields open where they should be chosen from actual gameplay needs.

## 1. Host Runtime

The host is the application boundary, not a gameplay system and not a second Core.

### Responsibilities
- Compose the canonical Core assembly.
- Supply the required save adapter.
- Declare host/gameplay systems and synchronous simulation tasks.
- Own the browser/application lifecycle and connect input/presentation adapters.
- Start, pause, resume and destroy the runtime.
- Route diagnostics to a development view without making that view authoritative.

### Actual Core API

`createCoreAssembly({ saveAdapter, hostSystems, simulationTasks, eventSources, ...configuration })`

The returned assembly exposes:
- `start()` — starts the complete system assembly and returns Game Context.
- `context` — runtime context after successful start.
- `state` and `initializationOrder` — runtime diagnostics.
- `pause()`, `resume()`, `destroy()` — serialized lifecycle operations.

A valid host must provide `saveAdapter.read(slotId)` and `saveAdapter.writeAtomic(slotId, data)`. The test `MemorySaveAdapter` is not a production storage solution. Storage belongs to the host; each system owns its own snapshot schema.

No browser global, DOM node, renderer, input device or game-specific object belongs in Core.

## 2. World Foundation

### Core services already available
- `core.world-registry`: `registerWorld({ worldId?, type, dimensions, coordinateSystem?, metadata? })`, `activateWorld(worldId)`, `deactivateWorld(worldId)`, `get(worldId)`, `getActiveWorld()`.
- `core.world-context`: `placeEntity(entityId, worldId, position)`, `getPlacement(entityId)`, `listPlacements(...)`, `moveEntity(entityId, target)`, `removePlacement(entityId)`.

Core validates positive finite world dimensions, world lifecycle, coordinate bounds and exclusive entity placement. It does not provide map tiles, collision geometry, navigation, world generation or movement policy.

### Phase 2 usage
- Start with one host-defined test world.
- The first authoritative gameplay test world is 128 × 128 integer tile coordinates. This is a test configuration, not a permanent size rule for every Cassandra world.
- Register and activate the world through Core's public services.
- Cassandra must enforce integer tile coordinates at its own gameplay boundary; Core accepts finite fractional coordinates.
- Do not introduce a generic map/scene framework until a second concrete world or reusable behavior requires it.

World registration may be a small host bootstrap operation or part of a concrete world system. Do not create a permanent system whose only purpose is forwarding Core methods.

## 3. Domain vocabulary

### Entity — Core identity

Core Entity Registry owns stable generic identity, `kind`, scope, generic lifecycle status and generic metadata. It does not own Unit/Pawn domain state, appearance, inventory, behavior or placement.

The proposed Core Entity `kind` for the first Unit foundation is `unit`. This is a generic identity classification only.

### Unit — gameplay domain instance

Unit is a Cassandra gameplay-domain instance backed by exactly one Core Entity identity. The Unit gameplay system owns its domain record, schema and public API. A Unit instance references a canonical Unit Definition and may have one placement managed by Core World Context.

The Unit record must not duplicate:
- Core Entity ID or generic lifecycle as separately authoritative fields;
- world position or placement state;
- canonical definition data that should be referenced by stable definition ID.

The first implementation must not invent attributes such as health, age, needs, skills, jobs, inventory, equipment, personality, combat stats or appearance before their concrete requirements are established.

### Pawn — Unit belonging to player control

Pawn is a gameplay role/specialization within the Unit domain, not a Core primitive, independent identity registry or parallel entity lifecycle. A Unit is a Pawn when it belongs in any way to the player's control. This relationship does not require direct or continuous manual input.

The main protagonist is the primary fully and directly controllable Pawn. Other Pawns may be controlled through different, more indirect or limited mechanisms; those control models are deliberately deferred until their gameplay requirements are designed. A robot can be a Pawn if it belongs to the player's control. Pawn therefore describes the Unit's relationship to player control, not its species, body type, autonomy level or input method.

A Unit outside the player's control is not a Pawn merely because it is mobile, intelligent or humanoid. Pawn uses the Unit identity and instance record. Do not introduce `kind: "pawn"` in Core or a separate `game.pawn` system as the default foundation. The exact representation of player-control membership and its lifecycle is a future gameplay contract, not part of the current Unit foundation.

### Leader, direct Draft and colony-wide control

These concepts are separate gameplay relationships/states and must not be collapsed into the Pawn role:

- **Pawn:** a Unit belonging in any way to player control.
- **Colony Leader / protagonist:** the Pawn currently selected as the colony's protagonist and leader. The colony records this role by stable Unit/Entity ID; leadership is not a special Core identity kind. After a leader is lost, a future succession process may select a different Pawn as protagonist.
- **Draft:** activation of direct player control for the current Colony Leader. Draft does not target whichever Unit happens to be selected in the viewport. The control system resolves the current leader ID and makes that Unit the sole direct-control target for this Phase 2 slice. Do not add general-purpose Draft eligibility for arbitrary Pawns yet; whether that restriction remains permanent is an open future design choice.
- **Colony Control:** the player's ability to influence and direct colony-level activity through mechanisms other than direct WASD control. The colony remains controllable and its Pawns remain autonomous actors if no leader is currently available.

The current Phase 2 slice uses Johny as a temporary test leader. This is test content, not a permanent protagonist, lore commitment or identity rule.

The runtime must keep the current leader reference and current drafted-Pawn reference conceptually distinct. A leader can exist without being drafted. Draft can be cleared without changing leadership. Loss of a leader must not be interpreted as automatic colony destruction, loss of all player agency or an immediate Game Over.

Future gameplay may include evacuation/retreat, recovery of a fallen leader's body, a colony meeting and succession/leader selection. These are explicitly out of scope for Phase 2. Their future implementation must be able to distinguish leader alive/dead/missing/recovered states and must not require the colony to stop functioning while leadership is vacant.

Do not create a separate Core entity kind or registry for Leader, Draft or Colony Control. These are game-domain relationships and control state owned by future gameplay systems. The exact persistence schema and succession rules remain deferred until those systems are designed.

### Definition and instance

- **Unit Definition:** immutable canonical content, owned by the gameplay content/system owner. It is not a runtime Entity and is not registered in Core Entity Registry.
- **Unit Instance:** one actual game instance, backed by a Core Entity ID and referencing a Unit Definition by stable ID.

The application Database reads canonical definitions from their owning systems. It is not a second definition store and does not own runtime instances.

## 4. Candidate Unit system contract

- **System ID:** `game.unit`
- **Candidate service ID:** `game.unit-api`
- **Status:** implemented as the first narrow Unit foundation.

### Ownership
The Unit system owns:
- Unit instance domain records;
- references from instances to canonical Unit Definitions;
- Unit-specific domain lifecycle and validation;
- any minimal Unit-owned movement intent/state required by the first playable slice, until a separate movement owner is justified.

It does not own:
- generic identity or generic identity lifecycle;
- world registry or world placement;
- map tiles or collision policy;
- input devices, renderer or UI;
- Database navigation/presentation.

### Required Core services
- `core.entity-registry` — allocate and query generic identity; first Unit identity uses `registerPersistent({ kind: "unit", metadata })`; retire with `remove`.
- `core.world-registry` — validate the target world's descriptor and tile bounds before allocating identity.
- `core.world-context` — place/query/remove placement through its validated public API.
- `core.persistence` — register the Unit-owned snapshot participant.

Do not require `core.world-registry` if the Unit system can meet its needs through World Context. Avoid redundant dependencies.

### Implemented public API

The service `game.unit-api` exposes:
- `createUnit({ definitionId, worldId, position })` — validates a registered canonical definition, an available world and an in-bounds non-negative integer tile before allocating identity; returns the Unit record and Core placement.
- `getUnit(entityId)` — returns one detached Unit record with its current Core placement, or `null`.
- `listUnits()` — returns a stable ID-sorted frozen list of detached Unit records and placements.
- `removeUnit(entityId)` — removes the placement, retires the Core identity and removes the Unit domain record; returns `false` when the ID is not a Unit.

The Unit domain record is deliberately minimal: Core Entity ID plus canonical `definitionId`. World position is read from Core World Context and is not duplicated. Returned records and collections are immutable.

### Creation and removal consistency

Creation is a coordinated operation:
1. Validate the definition reference and requested position before allocating identity.
2. Allocate one Core Entity identity.
3. Prepare the Unit-owned domain record.
4. Place the identity through World Context.
5. Publish the Unit domain record only when all required steps succeed.
6. If a later step fails after identity allocation, remove any placement created and retire the identity. Never leave a live orphan or publish a partial Unit.

Removal must clear placement and retire the Core identity without allowing ID reuse. Define failure ordering against actual Core API behavior and test it. Stored/encounter lifecycles are not required for the first slice.

## 5. Unit persistence contract

- **Participant ID:** `game.unit`
- **Initial schema version:** 1
- Snapshot contains Unit-owned domain records and stable definition references only.
- Core Entity Registry and World Context snapshot their own data independently.
- Restore preparation validates and detaches Unit-owned data without mutating runtime state.
- Commit validates that each Unit references an appropriate restored Core identity and required placement after Core participants have committed.
- Rollback restores the previous Unit domain state.
- Do not duplicate Core identity or placement snapshots in the Unit snapshot.
- Add explicit tests for missing references, malformed records, duplicate Unit IDs, failed commit and rollback.

The exact definition availability/load order must be specified before persistence implementation. A saved Unit referencing a missing definition must fail validation or use an explicitly designed migration; it must not silently invent a replacement.

## 6. Minimal movement and control (conditional)

Do not create a separate Locomotion system merely for architectural appearance. Begin with a small Unit-owned movement module if the first playable slice needs movement. Extract `game.locomotion` only if it gains an independent data model, lifecycle or public contract.

Control path:
1. Input adapter captures device/browser input.
2. Adapter translates it into a movement request through the public Unit service.
3. The owning system stores pending intent; the adapter does not mutate authoritative position.
4. A declared synchronous simulation task consumes intent.
5. The system computes a candidate position and asks World Context to apply the validated placement update.
6. A movement event may be published after successful state transition.
7. Presentation reads authoritative services and renders; it does not write simulation state.

Core Scheduler tasks are synchronous fixed-step operations. The task receives `deltaSeconds` and `realDeltaSeconds`; the movement model must explicitly choose the relevant time basis when the game rule is decided. Promise-returning simulation tasks are invalid.

Core accepts fractional world coordinates. If Cassandra uses tile-step movement, Unit/world gameplay boundaries must validate integer tile positions and any tile occupancy rules.

### Phase 2 direct-control movement contract

- The temporary test leader Johny is the initial Colony Leader and the only direct-control target. Draft always resolves the current Colony Leader; it is not tied to viewport selection and does not require selecting the Pawn.
- Pressing F while paused toggles Draft on/off for the current Colony Leader. Draft state survives ordinary simulation pause/resume; pausing freezes movement but does not silently undraft the leader. A future succession flow can change the Colony Leader reference, after which Draft must target the newly selected protagonist.
- WASD movement is smooth top-down movement at approximately 4 world tiles per game-time second. Diagonal input is normalized to preserve the same maximum speed.
- The movement system changes authoritative Core World Context placement through the Unit/gameplay API. Rendering is a projection of authoritative fractional world coordinates, never a second movement simulation.
- Movement is deterministic fixed-step gameplay logic. It uses the scheduler's game-time `deltaSeconds`, not frame delta or render cadence. Do not change Core's global fixed step solely to tune Pawn movement; configure or structure gameplay timing at the host/gameplay boundary only when justified by tests.
- The player may freely pan/look away from the leader, including zooming to inspect elsewhere. When WASD movement is issued while Draft is active, the camera reacquires the current Colony Leader and follows/locks to that Pawn during direct movement. The player does not need to reselect the Pawn. Free camera movement alone does not cancel Draft.
- Pointer remains free across world viewport and HUD. It is never pointer-locked or confined. The pointer presentation distinguishes world-viewport targeting (a crosshair that tracks the actual pointer position) from native pointer interaction over HUD controls.
- World inspection is available while the simulation is running when Draft is OFF. Draft ON locks the inspection target to the Colony Leader. The larger INFO profile remains pause-only; Quick Select is available during running and does not continuously refresh the full profile card.
- Draft input is ignored for movement when no Colony Leader is drafted. Non-leader Pawns remain under their future AI/colony-control behavior; Phase 2 does not invent that AI.
- Collision, tile occupancy, pathfinding, attacks, aiming and multi-Pawn direct control are out of scope unless separately approved.

## 7. Events

Events announce facts after successful state changes. Candidate event types:
- `unit.created`
- `unit.removed`
- `unit.moved`

These are candidates, not a requirement to emit every event if no consumer needs it. Use the existing Core event envelope, versioned detached payloads and immutable data. Never use Event Bus as a command queue. Pawn-specific event names should wait until Pawn semantics are defined.

## 8. Simulation and world activation

Core Scheduler runs declared tasks globally. Activating a different world in World Registry does not automatically pause or filter world-scoped tasks.

Cassandra must provide a centralized world-session/simulation gate so only the currently active world's world-scoped simulation advances. Do not scatter active-world checks across unrelated systems or assume Core handles this.

## 9. Deliberately open game-design decisions

- How is a Unit's membership in player control represented, assigned and revoked?
- Which player-facing identity/display fields should the first Unit have?
- Which Unit Definition fields are genuinely required by the first concrete content?
- Is movement part of the first vertical slice, and if so what is its feel/time basis?
- What first test environment and visual representation should be used?

Do not invent answers to these for convenience. Ask for user input when a decision becomes necessary.

## 10. Phase 2 verification status

- [x] Core service IDs and public methods checked against current Core source.
- [x] Host composition and mandatory save adapter checked against Core Assembly.
- [x] Entity identity and world placement ownership separated.
- [x] Persistence participant order and transaction model checked.
- [x] Scheduler synchronous task and time-step contract checked.
- [x] Core source compared between `main` and `next-step/phase-2`; no Core differences.
- [x] Entity → Unit → Pawn vocabulary and data ownership documented.
- [x] Unit public API and minimal data schema finalized for the first foundation.
- [x] Unit creation, query, listing, removal and persistence participant implemented.
- [x] Unit identity/placement rollback and tile-coordinate validation covered by tests.
- [x] Dev Lab Database selection and paused Unit placement integration implemented through the existing Unit API; user confirms the workflow works. Automated/browser evidence is tracked separately in the Phase 2 test plan.

Actual Unit/Pawn locomotion through a gameplay-owned movement command and deterministic scheduler task remains unimplemented. Pawn-specific behavior and game-specific attributes remain deferred by design. Dev Lab's current placement and inspection UI are development tools, not substitutes for locomotion or final player-facing presentation.


## 11. Colony Leader control and locomotion implementation

The first direct-control implementation is owned by `game.colony-control` and exposed as `game.colony-control-api`. It depends on `game.unit-api`, `game.input-api` and `core.persistence`; it is not a Core primitive.

- The current leader is stored by stable Unit ID. In Dev Lab, the first successfully placed instance of canonical definition `pawn.johny` becomes the temporary Phase 2 leader. No Unit is created automatically at startup.
- `F` while paused toggles Draft for the current leader. Draft state is distinct from viewport selection and remains active across ordinary pause/resume.
- WASD moves only the current leader. Movement speed is 4 world tiles per game-time second; diagonal input is normalized.
- The movement system runs as a synchronous Scheduler task. Dev Lab configures a 1/60-second fixed step through the host runtime; Core's default fixed step is unchanged.
- Unit creation remains integer/tile-snapped. `game.unit-api.moveUnit` accepts finite fractional coordinates, applies world-edge clamping and commits the new position through Core World Context.
- Camera reacquisition is triggered by actual movement updates and targets the leader by ID. Canvas remains presentation-only.
- Colony Leader ID and Draft state are saved by a separate `game.colony-control` persistence participant. Unit and Core participants retain their own state ownership.

The initial automated checks cover movement speed, diagonal normalization, leader targeting, no movement while undrafted, fractional Unit persistence, world-edge clamping and Colony Control persistence. Manual browser verification remains required before Phase 2.3/2.4 acceptance.


## 12. Unified simulation, pointer and inspection behavior

- Pause is a simulation-clock state, not a separate viewport input mode. The same pointer and camera interaction path remains available while paused and running.
- The existing `resumeSnapshot` behavior is retained: gameplay inputs held at pause can be restored on resume unless released or invalidated by inspection/focus-loss rules.
- World camera controls (wheel zoom and middle-button drag) are available in both simulation states.
- Left-click inspection is independent of pause when Draft is OFF. Unit selection/Quick Select can be used while running. The INFO profile remains available only while paused.
- Draft is an independent player-control state, toggled with F in either simulation state. With Draft ON, Quick Select is forced to the Colony Leader and cannot be redirected to another Pawn. With Draft OFF, the current Quick Select target is cleared; no prior selection is restored.
- Enabling Draft immediately moves the camera to the Colony Leader only when the Leader is placed in the active world. While Draft remains active, wheel zoom/free look is allowed; the next WASD movement tick reacquires the Leader and recenters the camera. Draft OFF leaves the camera at its current position.
- The pointer is never confined or locked. Over the world viewport while running, a custom crosshair follows the actual pointer coordinates. Over HUD controls, the native system cursor is visible. This is presentation only and does not change pointer event routing.
- No changes to Core are required or permitted for this behavior.
