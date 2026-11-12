# Phase 2 — Initial System Contracts

**Status:** Architecture proposal for Phase 2.0; not implementation.  
**Authority:** Actual public Core source and `src/core/README.md` on `main`.

This document defines the smallest technical contracts needed for the first runnable slice. It deliberately leaves game-design values and Pawn identity details open where they should be chosen from the game's intended experience.

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
- `context` — the runtime context after successful start.
- `state` and `initializationOrder` — runtime diagnostics.
- `pause()`, `resume()`, `destroy()` — serialized lifecycle operations.

A valid host must provide `saveAdapter.read(slotId)` and `saveAdapter.writeAtomic(slotId, data)`. The test `MemorySaveAdapter` is not a production storage solution. The storage adapter belongs to the host, while each system owns its own snapshot schema.

### Boundary
No browser global, DOM node, renderer, input device or game-specific object belongs in Core.

## 2. World Foundation

### Core services already available
- `core.world-registry`: `registerWorld({ worldId?, type, dimensions, coordinateSystem?, metadata? })`, `activateWorld(worldId)`, `deactivateWorld(worldId)`, `get(worldId)`, `getActiveWorld()`.
- `core.world-context`: `placeEntity(entityId, worldId, position)`, `getPlacement(entityId)`, `listPlacements(...)`, `moveEntity(entityId, target)`, `removePlacement(entityId)`.

Core validates world dimensions, lifecycle, coordinate bounds and exclusive entity placement. It does not provide map tiles, collision geometry, navigation, world generation or movement policy.

### Phase 2 usage
- Start with one host-defined test world.
- World dimensions and coordinate convention are configuration for this test, not a permanent game-wide restriction.
- Register and activate the world through Core's public services.
- Do not introduce a generic map/scene framework until a second concrete world or reusable behavior requires it.

Whether world registration is a small host bootstrap operation or a tiny `game.world` system is an implementation detail to resolve in 2.1/2.2. Do not create a permanent system whose only purpose is forwarding Core methods.

## 3. Pawn Foundation

### Candidate system
- **System ID:** `game.pawn`
- **Candidate service ID:** `game.pawn-api`
- **Status:** proposed; public method names and Pawn domain fields are not yet frozen.

### Ownership
The Pawn system owns Pawn-specific domain records and their lifecycle. It does not own generic identity or world placement.

Core ownership remains:
- Entity Registry owns stable identity and generic identity lifecycle.
- World Context owns exclusive placement and coordinates.
- Pawn system owns the domain record and its schema.

### Required Core services
- `core.entity-registry` — allocate stable identity with `registerPersistent({ kind: "pawn", metadata })`; query with `get/list`; retire with `remove`.
- `core.world-context` — place and query the Pawn's active world position.
- `core.event-bus` — announce completed Pawn lifecycle facts.
- `core.persistence` — register the Pawn system's own persistence participant.

Direct dependency on `core.world-registry` is not needed if the Pawn system uses World Context's validated placement API. Avoid redundant dependencies.

### Candidate public operations
The first public service should stay narrow:
- create a Pawn and place it in a registered world;
- query one Pawn and list Pawns;
- remove/retire a Pawn safely;
- expose only immutable/detached domain records and documented placement queries.

Exact method names, Pawn fields and creation options remain to be confirmed during 2.2. Do not invent health, age, needs, skills, jobs, inventory, appearance or personality fields for the technical foundation.

### Identity and placement lifecycle
Creation is a coordinated operation: register the identity, prepare the domain record, and establish exactly one valid world placement. If placement fails after identity allocation, the system must safely retire the allocated identity and leave no live orphan Pawn.

Removal must clear the placement and retire the identity without allowing ID reuse. Stored/encounter lifecycles are not required for the first slice.

### Persistence
- **Participant ID:** `game.pawn`
- **Initial schema version:** 1
- Snapshot contains Pawn-owned domain records only.
- Core Entity Registry and World Context continue to snapshot their own data independently.
- Restore preparation validates detached Pawn data without mutating runtime state.
- Commit verifies required Core identities/placements after their earlier Core participants have committed, then replaces the Pawn domain state.
- Rollback restores the previous Pawn domain state.
- Do not duplicate Core identity or placement snapshots inside the Pawn snapshot.

## 4. Minimal Locomotion and Control

### Initial ownership decision
Do not create a separate Locomotion system merely for architectural appearance. Start with a small movement module owned by `game.pawn`, unless implementation shows that movement has an independent lifecycle, data model or public contract that justifies `game.locomotion`.

### Control path
1. Input adapter captures a device/browser input.
2. Adapter translates it into a small movement request through the public Pawn service.
3. The system stores the pending intent; the adapter does not mutate authoritative position.
4. A declared synchronous simulation task consumes intent.
5. The system computes a candidate position and asks World Context to apply the validated placement update.
6. A completed movement event may be published after the state transition succeeds.
7. Presentation reads state and renders it; it does not write simulation state.

### Scheduler contract
The Core scheduler executes synchronous fixed-step tasks. A task is declared with a registered host system ID and an `update(step)` function. The step provides both `deltaSeconds` and `realDeltaSeconds`; the movement model must explicitly choose the appropriate time basis when its game rule is decided. Promise-returning simulation tasks are invalid.

### Initial limits
- One Pawn, one world and one control path are enough to prove the vertical slice.
- Boundary validation is required.
- Collision geometry is not a Core feature. Add a minimal host/gameplay collision rule only if the first playable test needs it.
- No pathfinding, animation, combat, AI or navigation framework is part of this substep.

## 5. Events

Events announce facts after successful state changes. Candidate event types:
- `pawn.created`
- `pawn.removed`
- `pawn.moved`

Each event uses the existing Core event envelope and a versioned, detached payload. These are candidates, not a requirement to emit every event if no consumer needs it. Never use Event Bus as a command queue.

## 6. Deliberately open game-design decisions

The following are not technical decisions for the architecture to guess:
- What makes one Pawn meaningfully different from another at creation?
- Which identity/display fields should a Pawn have from the player's perspective?
- What is the intended movement feel and time basis?
- What kind of first test environment best represents the intended game?
- Which player-facing controls should exist in the first visible slice?

I will request your input only when one of these decisions becomes necessary. Until then, technical contracts should stay minimal and reversible.

## 7. Phase 2.0 verification

- [x] Core service IDs and public methods checked against current Core source.
- [x] Host composition and mandatory save adapter checked against Core Assembly.
- [x] Entity identity and world placement ownership separated.
- [x] Persistence participant contract checked against Core Persistence.
- [x] Scheduler synchronous task and time-step contract checked.
- [x] Core protection rule and initial system boundaries documented.
- [ ] User review of the game-facing direction when a concrete Pawn/gameplay decision is needed.

**No gameplay code has been added as part of this architecture proposal.**
