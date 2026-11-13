# Core Audit — Phase 2 Architecture Review

**Reviewed revision:** `4dfafb66a7d5d03c2fd082c3738315d499c13753`  
**Branch:** `next-step/phase-2`  
**Review type:** Source/API inspection, architecture-document consistency review and CI evidence review. No Core source was modified.

## Executive result

The existing Core is a coherent, domain-neutral foundation for the first Cassandra gameplay slice. It already provides the generic services needed for stable identity, bounded world descriptors, exclusive entity placement, lifecycle orchestration, fixed-step simulation, events and transactional persistence.

No demonstrated Core limitation currently blocks the planned first World/Pawn slice. The next work should be implemented in the host/gameplay layer. Do not expand Core pre-emptively.

## Reviewed Core modules

| Module | Actual ownership / contract |
|---|---|
| System Registry | System/service declarations, unique providers, dependency validation and deterministic initialization order |
| System Bootstrap | Initialize/start/pause/resume/destroy lifecycle, failure cleanup and service publication |
| Game Context | Read-only access boundary to declared public services and infrastructure services |
| Core Assembly | Composition of Core services, host systems/tasks, lifecycle serialization and persistence safe boundary |
| Event Bus | Synchronous ordered event delivery, detached immutable payloads, queue recovery after drain-limit fault |
| Game Clock | Scaled simulation time and composable pause reasons |
| Simulation Scheduler | Synchronous fixed-step tasks, deterministic ordering, backlog/catch-up limits and fault/overload handling |
| Entity Registry | Stable identity, persistent/scoped identity lifecycles, metadata and identity snapshots |
| World Registry | Host-defined world descriptors, dimensions, metadata and one active-world pointer |
| World Context | Exclusive entity placement in a world or store, bounds validation and placement snapshots |
| Persistence | System-owned snapshots, schema versions/migrations and prepare/commit/rollback restore transactions |
| Logger | Bounded structured technical diagnostics |

## Verified integration facts

- Core Assembly is composed through `createCoreAssembly({ saveAdapter, hostSystems, simulationTasks, eventSources, ... })`.
- A save adapter is mandatory and must implement `read(slotId)` and atomic `writeAtomic(slotId, data)`.
- The host wrapper `createGameRuntime` delegates lifecycle and scheduler advancement; it does not own gameplay state or choose rendering/input/storage implementations.
- Host simulation tasks are synchronous and are ordered according to the validated system dependency order.
- Core Entity Registry, World Registry and World Context register their own persistence participants with orders -100, -90 and -80 respectively.
- The World Context restore defers cross-registry reference validation until commit, after identity and world snapshots have committed.
- The latest CI run for the reviewed revision, [run 43212856169](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43212856169), completed successfully. It ran `npm run test:all` (Core regression plus all `tests/unit/*.test.js` tests). The current documented Core baseline is 198 tests; the two current unit files contain 14 tests (6 host-runtime and 8 world-preview).
- The Pages deployment for the same revision also completed successfully.
- The branch compares as 58 commits ahead of `main`, 0 behind. `src/core/` is unchanged from the recorded main base.

## Important boundaries and constraints for Cassandra

### 1. Core does not contain a tile map

World Registry stores a descriptor: ID, type, dimensions, coordinate-system label and opaque metadata. World Context stores entity placement coordinates. Neither stores tile cells, terrain, walls, obstacles, occupancy rules, collision geometry, pathfinding, rendering or map generation.

Those belong to Cassandra's world/gameplay layer.

### 2. Core world dimensions are bounded

World Registry requires positive finite width and height. World Context requires finite coordinates in the half-open range `0 <= x < width`, `0 <= y < height`. It accepts fractional coordinates; if Cassandra's authoritative model uses integer tile coordinates, the game-owned world/Pawn boundary must enforce that rule.

The preview's 64/128/256 presets and 64×32 view are presentation settings. The first authoritative gameplay test world is now approved at 128 × 128; this does not determine the permanent home-world or temporary-world dimensions.

### 3. Only one world is marked active at a time

World Registry exposes one `activeWorldId`. It can retain multiple registered worlds, but activating one makes the previous active world inactive. World Context placement validation does not require the target world to be the active world.

Cassandra's approved lifecycle is one persistent world plus at most one active temporary world. Core's single active-world pointer fits this: the persistent world remains registered but inactive while the temporary world is active. Core activation alone does not pause Scheduler tasks; Cassandra must centrally gate world-scoped simulation so only the active world's rules advance. See [World Lifecycle](WORLD_LIFECYCLE.md).

### 4. Identity, domain state and placement have separate owners

- Entity Registry owns stable generic identity and generic lifecycle metadata.
- A gameplay system owns Pawn-specific data.
- World Context owns the Pawn's world placement.
- Persistence coordinates snapshots; it does not serialize private Pawn data on the Pawn system's behalf.

A Pawn must not be represented only by Core metadata.

### 5. Persistence restore order matters

Core participants are ordered:
- Entity Registry: -100
- World Registry: -90
- World Context: -80

A Pawn participant that must validate restored identities and placements should prepare detached data without mutating state, then validate cross-references during its commit after Core participants have committed. Its rollback must restore the prior Pawn state. The persistence coordinator rolls back committed participants in reverse order if a later commit fails.

### 6. Runtime and production storage are not yet the same thing

The host shell requires a save adapter, and tests use `MemorySaveAdapter`. A durable production storage adapter has not been implemented. The current host runtime is a composition/lifecycle shell, not yet a complete browser/game application loop.

## Findings

### No Core change is currently justified

The inspected APIs can support:
- a bounded host-defined test world;
- stable Pawn identity;
- one valid placement per Pawn;
- deterministic movement through a synchronous simulation task;
- system-owned Pawn persistence.

Potential future requirements such as multiple simultaneously active worlds, unbounded coordinates, collision/pathfinding or specialized tile storage are not reasons to change Core now. First implement the relevant host/gameplay adapter and demonstrate a concrete limitation.

### One architectural clarification is required before implementation

The current preview is an empty visual harness. It does not create a Core world, register entities or connect Canvas rendering to simulation state. The next gameplay slice must establish an authoritative world model and then connect the presentation adapter to read that state. The preview must not become a second source of truth.

## Proposed next architecture: World and Pawn Foundation

1. **World bootstrap / definition:** create one bounded world descriptor through `core.world-registry` and activate it. Keep dimensions configurable; do not hardcode the preview preset as a final design choice.
2. **Game-owned world model:** add a real owner for tile/world content only when the first map data exists. It should own the authoritative tile/cell data and any tile-specific queries/rules. It must not mirror Core entity identity or placement.
3. **Pawn system:** add `game.pawn` to own Pawn domain records and a narrow public service for create/query/list/remove. Use Core Entity Registry for identity and World Context for placement.
4. **Creation transaction:** validate the world position first; register identity; prepare Pawn data; place the identity; publish the Pawn record only when the operation succeeds. If placement fails after identity allocation, retire the allocated identity and leave no live orphan.
5. **Locomotion:** begin as a small movement module within Pawn unless movement proves it needs independent ownership. Store player intent through the Pawn public service; consume it in a synchronous scheduler task. Input adapter never writes world placement directly.
6. **Presentation:** render from authoritative world/Pawn services. Camera and Canvas remain presentation-only; no simulation state is written by the renderer.
7. **Persistence:** register the Pawn participant after Core participants in restore order; snapshot Pawn-owned data only, with prepare/commit/rollback and schema versioning.
8. **Tests:** unit and public-contract tests first, then Core integration and persistence tests. Add the first host → world → Pawn → movement integration path only after the individual contracts are stable.

## Decisions intentionally left open

These require game-design input and must not be guessed by implementation:
- The permanent home/base world's actual dimensions and content; the first test world is 128 × 128.
- The retention and exit policy for temporary worlds.
- The Pawn's player-facing identity/appearance fields and creation meaning.
- The intended movement feel and whether movement is tile-step or continuous in time/space.
- The first visible test environment's content and visual representation.

## Audit conclusion

**Core status: suitable for Phase 2 gameplay integration.**  
**Core changes: none recommended.**  
**Next implementation target: World/Pawn Foundation in the host/gameplay layer, after the open game-facing choices above are resolved.**


## Follow-up audit — Colony Leader movement integration (2026-11-12)

**Reviewed revision:** `793a47c89aba826e1b3945047995310e0b0bac68`  
**Branch:** `next-step/phase-2`  
**Review type:** Source/API inspection plus successful GitHub Actions regression run.

The Colony Leader / Draft / locomotion slice was added entirely in the host/gameplay/presentation layers. No file under `src/core/` was changed.

### Core capability verification

- `WorldContext.moveEntity(entityId, target)` accepts finite fractional coordinates and validates the target against the registered world's half-open bounds. The existing implementation already supports smooth movement; no Core coordinate change was required.
- `SimulationScheduler` accepts a host-selected `fixedStepSeconds`. Dev Lab now supplies `1 / 60` second for its movement workload; the Core default remains 6 seconds for other compositions.
- Host systems can declare dependencies on `game.unit-api`, `game.input-api` and `core.persistence`, and a synchronous simulation task can consume those services in deterministic scheduler order.
- Unit gameplay now owns the movement policy and fractional-position validation. Core continues to own identity, placement commit and world-bound validation.
- Unit persistence validation accepts finite fractional placements, while initial placement remains integer/tile-snapped. Colony Control persists its current leader ID and Draft state as a separate gameplay participant.

### Verification evidence

- GitHub Actions: [run 43313238282](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43313238282), commit `793a47c89aba826e1b3945047995310e0b0bac68`.
- `npm run test:all`: Core 198/198 passed; host/unit 38/38 passed; 0 failures.
- Browser entry-point syntax checks passed for `application-shell.js` and `dev-world-preview.js`.
- The run confirms regression compatibility and gameplay-system unit tests. It does not constitute a manual browser test of live keyboard, camera and canvas behavior.

### Updated conclusion

**Core status: suitable for the Phase 2 Colony Leader movement slice.**  
**Core source changes: none.**  
**Host-specific configuration:** Dev Lab uses a 1/60-second fixed step; this does not alter Core defaults.  
**Remaining verification:** manual browser checks for Draft toggle, movement feel, camera reacquisition and pause/resume behavior.
