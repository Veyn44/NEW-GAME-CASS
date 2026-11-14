# ACTUAL WORK — Engine / Dev Lab / Cassandra restructuring

Last updated: 2026-11-14  
Repository: `Veyn44/NEW-GAME-CASS`  
Working baseline inspected: `main` at `494307b19494b1212d6f431764107dc524c6ede1` (roadmap documentation commit)

> This is the live work log and handoff document. It records what we are doing now, what has actually been inspected, proposed ownership, and the next safe action. It does not replace `NEXT_STEPS.md`; that file is the long-range roadmap.

## 1. Current objective

Restructure the existing project into three areas in one repository:

- **Engine** — reusable technology, independent of both applications.
- **Dev Lab** — the Engine's development workspace, using the same Engine runtime systems as the game.
- **Cassandra** — the actual game, with its own gameplay rules, content and UI, depending on Engine.

Dependency direction:

`Dev Lab → Engine`  
`Cassandra → Engine`

Engine must not import Dev Lab or Cassandra. Dev Lab must not be required to run Cassandra. Cassandra must not be required to run Dev Lab.

## 2. Safety / recovery position

- The user confirms that the Phase 2 work was merged into `main` and that the merged state is archived in the separate archive repository.
- The archived repository was previously verified to have the same tree as active `main` at that time. This is an additional recovery reference, not a substitute for checking the current active `main` SHA before a risky operation.
- Current `main` before this work log: `494307b19494b1212d6f431764107dc524c6ede1`.
- No source files have been moved or behavior changed in this work step.
- User manually deleted the two merged maintenance branches:
  - `maintenance/active-world-viewport-cleanup-2026-11-13`
  - `maintenance/safe-cleanup-2026-11-13`
- `refactor/dev-lab-entrypoint-decoupling-2026-11-14` was deleted after PR #5 was closed without merging.
- PR #4 (`docs/phase-3-roadmap-2026-11-14`) remains open and is not approved as the current architecture plan. Review it for useful details before deciding its fate.
- `next-step/phase-2` was retained pending final archive/recovery confirmation; user now confirms there is an archived Phase 2 merge. Verify archive identity before deleting that old branch.
- **Branch rule:** do not create a branch without first explaining why and asking the user. Do not merge to `main`, delete historical branches, rewrite history or discard work without explicit approval.

## 3. Actual repository structure inspected on main

Current source tree (abridged only for test files):

```text
.github/
  workflows/
    core-tests.yml
    pages-preview.yml
CASSANDRA_VISION.md
NEXT_STEPS.md
PROJECT_HISTORY.md
README.md
index.html
package.json
src/
  adapters/
    presentation/
      dev-world-preview.css
      dev-world-preview.js
      world-preview-model.js
    storage/
      local-file-save-adapter.js
  application/
    application-shell.js
    database/
      database-loader.js
      definition-registry.js
    input/
      viewport-input-controller.js
  content/
    database/
      definitions/
        pawns/
          johny.json
  core/
    README.md
    core-assembly.js
    entity-registry.js
    event-bus.js
    game-clock.js
    game-context.js
    logger.js
    persistence.js
    simulation-scheduler.js
    system-bootstrap.js
    system-registry.js
    world-context.js
    world-registry.js
  gameplay/
    colony/
      colony-control-system.js
    input/
      game-input-system.js
    unit/
      unit-system.js
  host/
    README.md
    create-game-runtime.js
tests/
  ... core, integration, fixtures and unit tests ...
```

Project scripts (from `package.json`):
- `npm run test:core`
- `npm run test:host`
- `npm run test:all`

Node requirement: >=20.

## 4. Initial file ownership proposal

This is a source-informed proposal, not yet a final move list. Some files combine responsibilities and must be split rather than blindly moved.

| Current file / area | Proposed destination | Reason / caution |
|---|---|---|
| `src/core/**` | `engine/core/**` | Already documented as domain-neutral. Preserve its tested contracts; do not rewrite just to relocate it. |
| `src/host/create-game-runtime.js` | `engine/runtime/**` | Generic runtime composition wrapper. Its comment currently says “Cassandra host runtime”; update wording only when moving and verify no Cassandra assumptions remain. |
| `src/gameplay/unit/unit-system.js` | `cassandra/gameplay/unit/**` | Explicitly documents itself as Cassandra Unit domain layer. It maps a Unit to a definition while Core owns identity and placement. |
| `src/gameplay/colony/colony-control-system.js` | `cassandra/gameplay/colony/**` | Contains Colony Leader, Draft state, WASD interpretation and fixed movement speed (4 tiles/second). All game-specific. |
| `src/content/database/definitions/**` | `cassandra/database/definitions/**` | Johny is Cassandra-specific content, not Engine data. |
| `src/application/database/definition-registry.js` | `engine/database/**`, after refactor | Registry/normalization/index/detail loading are reusable mechanism. But `INSTANCE_KINDS = ["unit"]` is a Cassandra-specific leak; the generic registry must not hard-code Unit. Decide a generic definition/instance contract before changing it. |
| `src/application/database/database-loader.js` | Split | Generic package/definition loading mechanism to Engine; direct Johny JSON import and Cassandra package registration to Cassandra. |
| `src/gameplay/input/game-input-system.js` | Split/rehome | Currently exposes a viewport controller's state as `game.input-api`; input source contract is not yet generic. Need design the Engine input/action API and Cassandra action definitions first. |
| `src/application/input/viewport-input-controller.js` | Split between Engine input/control contracts and host/Dev Lab browser adapter | It currently handles physical key/button state, pause/resume snapshots, inspection suppression and pointer deltas. It is also named viewport-specific. Do not move unchanged into Engine without deciding which behavior is general and which is DOM/host interaction. |
| `src/adapters/presentation/dev-world-preview.js` | `dev-lab/presentation/**` | Directly queries `#world-canvas`, controls canvas rendering, world markers, selection and placement. It is Dev Lab UI/presentation, not Engine. |
| `src/adapters/presentation/dev-world-preview.css` | `dev-lab/presentation/**` | Dev Lab visual styling. |
| `src/adapters/presentation/world-preview-model.js` | Probably `dev-lab/presentation/**` | Contains camera/viewport sizing and preview-specific constants. Review whether any pure math is genuinely reusable before extracting anything to Engine. |
| `src/adapters/storage/local-file-save-adapter.js` | Split between Engine persistence contract and Dev Lab adapter (or Cassandra adapter later) | Browser file picker, Blob/download, `.cass` extension, `cassandra.save` envelope and `dev-lab-workspace` slot are application-specific. Core already defines the adapter-neutral persistence contract. |
| `src/application/application-shell.js` | Split into `dev-lab/application/**` and game-specific modules under `cassandra/**` | Large mixed composition root. It directly imports Dev Lab preview, browser save adapter, Unit, Colony Control, database and viewport input. Do not simply rename/move this monolith. |
| `index.html` | Separate `dev-lab/index.html` and `cassandra/index.html` (or root routing with separate entry modules) | Current HTML hosts the combined application. Exact Pages route strategy must be designed with workflow/config. |
| `tests/**` | Organize by Engine, Dev Lab, Cassandra and cross-layer integration | Preserve test intent and coverage. Avoid mass-renaming tests in the same change as source moves unless necessary. |

## 5. Important source observations

### Engine / Core
- `src/core/README.md` describes a domain-neutral Core.
- Core owns identity, world registry/context, clock, scheduler, event bus, bootstrap and persistence coordination.
- Core documentation explicitly says domain systems/entities/world rules are registered by the host and are not embedded in Core.
- `src/host/create-game-runtime.js` wraps `createCoreAssembly`, accepts host systems/tasks/adapters, and forwards lifecycle/advance/pause/resume/destroy.
- Host README says browser input, rendering and storage implementations stay outside Core and outside domain systems.
- The Core is already a relatively clean foundation. Preserve it and move it mechanically before considering any internal redesign.

### Cassandra gameplay
- Unit system explicitly says: “Cassandra Unit domain layer. Core owns identity and physical placement; this system owns only the Unit-to-definition relationship.”
- Colony Control stores leader/drafted state, reads WASD and applies fixed 4 tiles/second movement. This belongs to Cassandra.
- Johny definition is a content asset with id `pawn.johny`, category Pawns, entityType human, attributes and `spawnableAs: ["unit"]`. The definition belongs to Cassandra. The generic database mechanism must not know the specific Pawn/Johny data.

### Database boundary
- Current registry is mostly generic normalization/registration/index/detail logic, but it hardcodes the only supported instance kind as `unit`.
- Current loader directly imports Johny JSON and registers it. That import belongs in Cassandra's data package/composition, not Engine.
- Proposed target: Engine owns registry, package loading contracts, schema/validation and definition/instance mechanics; Cassandra supplies definitions and package registration; Dev Lab can inspect any loaded package or an empty/test catalog.
- Exact package format, schema extensibility, versioning and lifecycle remain to design.

### Input / Control Modes boundary
- Current viewport controller owns physical keyboard/mouse state, pause/resume behavior, inspection suppression and pointer delta accumulation.
- Current Game Input system is a thin service wrapper over that controller.
- Colony Control interprets `KeyW/A/S/D` as movement and applies Cassandra speed/rules.
- Agreed target: Engine owns general input/action registration and routing, pause, camera-mode coordination and Control Modes/possession. Cassandra defines concrete actions/key bindings, Draft meaning, eligibility and controlled entity behavior.
- Exact mode API and division between generic input source adapters vs. Engine input state are not yet designed. Avoid prematurely moving the viewport controller unchanged.

### Storage / persistence
- Core already owns an adapter-neutral persistence coordinator and requires a host-supplied adapter.
- Current local file adapter is browser-specific and embeds Cassandra file format/extension plus Dev Lab workspace slot. It cannot simply become a generic Engine adapter unchanged.
- Need distinguish persistence mechanism/contract (Engine) from browser file UI/format/slot policy (application adapter and/or Cassandra save package).

### Application shell
- Current shell combines DOM queries, menu/view routing, database UI, unit placement/inspection, world preview interaction, save/load, pause, camera/input and runtime composition.
- It imports Cassandra gameplay and Dev Lab preview directly.
- It is the largest mixed-responsibility module and should be decomposed by responsibility after a dependency map is completed.

## 6. Proposed target top-level layout (draft)

```text
engine/
  core/
  runtime/
  world/              # only if distinct reusable modules are needed
  entities/           # generic Entity contracts; Core identity remains source of truth
  database/
  input/
  control/            # Control Modes, possession and camera coordination
  persistence/        # contracts/mechanisms; host adapters remain outside
  presentation/       # generic presentation contracts only, if needed

dev-lab/
  index.html
  application/
  editor/
  inspector/
  debug/
  presentation/
  adapters/           # browser UI, canvas, local file tooling

cassandra/
  index.html
  application/
  gameplay/
    unit/
    colony/
  database/
    definitions/
  input/              # Cassandra actions and bindings
  control/            # Draft conditions and Cassandra control policy
  ui/
  presentation/
  audio/

tests/
  engine/
  dev-lab/
  cassandra/
  integration/
```

Do not create empty folders in advance. Introduce a folder when the first real module moves into it. Names and exact subfolders remain subject to review.

## 7. Migration method — safe sequence

1. **Read-only inventory (current step):** enumerate files, exports/imports, side effects, runtime composition, tests and current entry point. No source movement.
2. **Approve ownership map:** review this document with the user; resolve uncertain modules and folder names.
3. **Baseline:** run the complete test suite and record exact output and current browser acceptance behavior.
4. **Mechanical Core move:** move Core and its tests/docs without changing implementation semantics; update imports and test paths; run all tests.
5. **Move clearly Cassandra-specific modules:** Unit, Colony Control and Johny content; keep APIs/behavior unchanged; run all tests.
6. **Split database mechanism/content loading:** first define generic package contract, then extract loader and remove hard-coded `unit` kind from Engine mechanism without breaking Cassandra.
7. **Design and implement Input + Control Modes:** only after agreed interface contract; separate browser physical input adapter from generic routing and Cassandra action policy.
8. **Split application composition:** extract Dev Lab application/UI from Cassandra game composition; create separate entrypoints and test both.
9. **Persistence adapter split and Pages:** preserve save compatibility; verify one deployment and direct routes.
10. **Full dependency/removal tests and architecture audit.**

After each coherent step: run relevant tests, then full suite; inspect imports; verify affected application manually. Do not combine a file move with gameplay behavior redesign.

## 8. Current status

- [x] New long-range roadmap committed in `NEXT_STEPS.md`.
- [x] User confirmed Control Modes belong to Engine as a general mechanism; Cassandra defines actions and transition rules.
- [x] User confirmed Engine Entity is generic and Unit belongs to Cassandra.
- [x] User confirmed database mechanism belongs to Engine and game data to Cassandra.
- [x] User confirmed maintenance branches were manually deleted.
- [x] PR #5 closed without merge; its branch deleted.
- [x] Current main source tree inspected.
- [x] First-pass ownership proposal documented here.
- [ ] Complete import/export and runtime-composition dependency map.
- [ ] Review and approve proposed folder ownership with user.
- [ ] Fresh full test baseline and manual Dev Lab acceptance record.
- [ ] Verify archived Phase 2 snapshot against active main and then decide whether to delete `next-step/phase-2`.
- [ ] Review PR #4 for useful world/grid requirements; do not assume its decisions are approved.
- [ ] No source code moved yet.

## 9. Immediate next action

Continue the read-only inventory:
- map imports/exports for every current source module;
- trace how `application-shell.js` composes the runtime and which HTML elements it requires;
- map test files to the modules/contracts they protect;
- identify direct DOM/browser globals and accidental game-specific imports;
- return a concrete module-by-module move/split list for user approval.

Only after that approval should the first source file be moved. No new branch is required for the read-only inventory or this documentation update.


## 10. Dependency and composition map — first pass completed

This section is based on the current `main` source and tests inspected on 2026-11-14. It is a direct-import / runtime-service map, not yet a complete static call graph.

### Current runtime composition

`index.html` loads only `src/application/application-shell.js`. The shell is currently the single composition root for the combined menu + Dev Lab + database UI.

The shell directly imports:
- Dev Lab canvas adapter: `src/adapters/presentation/dev-world-preview.js`
- Host wrapper: `src/host/create-game-runtime.js`
- Browser file save adapter: `src/adapters/storage/local-file-save-adapter.js`
- Cassandra Unit system: `src/gameplay/unit/unit-system.js`
- Game Input wrapper: `src/gameplay/input/game-input-system.js`
- Cassandra Colony Control: `src/gameplay/colony/colony-control-system.js`
- Cassandra definition registry and canonical content loader
- Viewport input controller

At startup the shell:
1. Creates a browser local-file save adapter.
2. Creates an input controller.
3. Creates a host runtime around Core.
4. Registers Game Input, Unit and Colony Control as host systems.
5. Registers a simulation task owned by `game.colony-control`.
6. Loads Johny's Cassandra definition.
7. Registers Dev Lab test worlds (64, 128, 256 tiles).
8. Activates one world and wires UI services.
9. Starts a browser `requestAnimationFrame` loop.

This confirms that current Dev Lab is not a thin viewer of a separately composed Engine: its shell currently composes the runtime and injects Cassandra gameplay systems into the Dev Lab session.

### Direct dependency graph (current)

```text
index.html
  └─ application-shell.js
      ├─ dev-world-preview.js
      │   └─ world-preview-model.js
      ├─ create-game-runtime.js
      │   └─ core/core-assembly.js
      │       ├─ Core registries, clock, scheduler, events, persistence, bootstrap
      │       └─ injected host systems + simulation tasks
      ├─ local-file-save-adapter.js
      ├─ viewport-input-controller.js
      ├─ definition-registry.js
      ├─ database-loader.js
      │   ├─ Johny JSON
      │   └─ definition-registry.js
      ├─ unit-system.js
      │   ├─ Core Entity Registry
      │   ├─ Core World Registry
      │   ├─ Core World Context
      │   ├─ Core Persistence
      │   └─ injected definitionLookup
      ├─ game-input-system.js
      │   └─ injected viewport input controller
      └─ colony-control-system.js
          ├─ game.unit-api
          ├─ game.input-api
          ├─ core.world-registry
          └─ core.persistence
```

### What the Colony Control system actually does

Current file: `src/gameplay/colony/colony-control-system.js`.

It is a small Cassandra gameplay system with these responsibilities:

- Stores the current Colony Leader's Unit ID and whether Draft is active.
- Allows the application/gameplay layer to set a leader, enable/disable Draft, or toggle Draft.
- While Draft is active, reads the active input state and interprets WASD as movement directions.
- Normalizes diagonal movement so diagonal travel is not faster than cardinal travel.
- Moves the leader through the Unit API at a fixed `4 tiles/second`.
- Refuses to move when Draft is inactive, there is no leader, delta time is invalid, or the leader is not in the active world.
- Automatically disengages Draft if the leader is missing/not in a world or belongs to a world that is no longer active.
- Saves/restores the leader ID and Draft flag through a Core Persistence participant.

It does **not** create entities, render the pawn, implement the camera, listen to DOM keyboard events, decide which physical key toggles Draft, or own generic entity possession. Those responsibilities are elsewhere today.

Why it belongs to Cassandra rather than Engine:
- “Colony Leader” is a game role, not a universal property of every Entity.
- “Draft” is a Cassandra gameplay concept/command.
- The current WASD movement and fixed speed are the rules of this specific controllable Pawn, not rules that every engine entity should obey.
- The decision to stop Draft when the Leader is in a different active world is currently a game policy tied to the colony leader.
- Another game using the same Engine might have no colony, no leader, no Pawn and no Draft at all.

What should move/generalize into Engine:
- Generic Control Modes and possession (the capability to direct control toward a selected Entity).
- Generic input action registration/routing and pause handling.
- Generic camera coordination/follow behavior where appropriate.
- Generic movement primitives only if multiple real systems need them and their semantics can be expressed without Cassandra assumptions.

What remains in Cassandra:
- The concept of Colony Leader.
- Whether an entity is eligible to be drafted.
- The Draft action and its binding (currently F).
- What Draft means for this game.
- Movement rules/speed/constraints for the controlled Pawn.
- Any colony-specific state and persistence.

So the future design should not simply rename Colony Control to Engine Control. Instead, Engine provides the reusable mechanism; Cassandra's Colony Control becomes a policy/gameplay system that requests a possession/control mode and supplies the game-specific behavior.

### Existing test coverage mapped to responsibilities

| Test file | What it protects | Proposed future ownership |
|---|---|---|
| `tests/*registry*.test.js`, `tests/world-context.test.js`, `tests/event-bus.test.js`, `tests/clock-scheduler.test.js`, `tests/lifecycle-bootstrap.test.js`, `tests/persistence-logger.test.js`, `tests/core-integration.test.js` | Core infrastructure contracts | Engine |
| `tests/unit/host-runtime.test.js` | Generic host wrapper and runtime composition | Engine runtime / integration |
| `tests/unit/unit-system.test.js`, `johny-world-entity.test.js` | Cassandra Unit ↔ Core Entity/World integration and Johny content | Cassandra + integration |
| `tests/unit/colony-control-system.test.js` | Draft, leader state, WASD movement, speed, diagonal normalization, persistence, inactive-world disengage | Cassandra gameplay |
| `tests/unit/game-input-system.test.js`, `viewport-input-controller.test.js` | Current input service/controller semantics | Split: Engine input contract + host adapter + Cassandra bindings |
| `tests/unit/database-definition-registry.test.js`, `database-loader.test.js` | Definition registry validation and Cassandra content loading | Split: Engine database mechanism + Cassandra package/content |
| `tests/unit/local-file-save-adapter.test.js`, `workspace-persistence.test.js` | Browser file adapter and Dev Lab workspace save/load | Dev Lab adapter + Engine persistence integration |
| `tests/unit/world-preview.test.js` | Camera/preview model math and canvas-facing preview behavior | Dev Lab presentation unless reusable contract is proven |
| Browser HTML tests | Browser-hosted behavior of Core demos | Engine test harness |

### Newly confirmed architecture risks

1. The generic `createGameRuntime` wrapper currently lives under `src/host`, and its source comment still calls it a “Cassandra host runtime”. The implementation itself wraps Core and injected systems; the comment is stale/domain-branded.
2. `application-shell.js` has both application composition and large amounts of DOM/UI logic. It should be split by responsibility, not moved wholesale.
3. The shell contains direct key binding policy: F toggles Draft, WASD changes meaning based on Draft state, Space pauses/resumes. This confirms that key meanings currently live in the Dev Lab shell rather than in a clean Cassandra action map or generic Engine action registry.
4. Free-camera WASD is currently implemented in the shell (`applyFreeCameraInput`, speed 30), while drafted WASD is implemented in Colony Control (speed 4) and the shell follows the leader camera. The intended Control Modes design should own generic mode/camera/input routing; Cassandra should provide movement/action policy.
5. The local save adapter uses Cassandra file format/name and Dev Lab workspace slot in one class. Keep it outside Engine until its generic and application-specific parts are separated.

## 11. Completed implementation slice — content package injection

Approved by the user on 2026-11-14. Implemented on the existing `work` branch only; no new branches were created.

### Goal

Remove the Dev Lab application's direct dependency on Cassandra's content package while preserving the current Pages application composition and its loaded Johny definition.

### Changes made

- `dev-lab/application/application-shell.js`
  - Removed the direct import of `cassandra/database/load-cassandra-database.js`.
  - Removed the direct `loadCassandraDatabase()` startup call.
  - Exported `startDevLab({ loadContentPackage })`. The content provider is optional and defaults to an async no-op, so Dev Lab itself can initialize without Cassandra content.
  - The Dev Lab shell still reads definitions through the generic Engine definition registry.
- `application-entry.js` (new)
  - Added a temporary top-level composition root.
  - It imports the Cassandra content loader and passes it to `startDevLab`.
  - This preserves the current deployed application behavior while keeping Cassandra content wiring outside the Dev Lab application module.
- `index.html`
  - Switched the module entry from the Dev Lab shell directly to `application-entry.js`.
- `tests/unit/dev-lab-content-boundary.test.js` (new)
  - Checks that the Dev Lab shell no longer imports or invokes the Cassandra database loader.
  - Checks that the composition root supplies Cassandra content explicitly.
- `.github/workflows/core-tests.yml`
  - Added a Node syntax check for `application-entry.js`.

### Intentionally unchanged

- Cassandra definition JSON and the Cassandra package loader.
- Engine definition registry and package loader behavior.
- Unit, Colony Control and input systems.
- Save format, persistence behavior, Core simulation and browser UI logic.
- `main` branch and all other branches.

### Verification status

- GitHub compare confirms `work` remains ahead of `main`; no changes were made to `main`.
- The new boundary test is included in `npm run test:host` through the existing wildcard test command.
- At the time this log was updated, the GitHub Actions status endpoint had not yet reported a result for the latest commit. Do not mark CI or manual Pages/browser acceptance as passed until those results are observed.
- Manual browser acceptance has not been performed by the assistant.

### Next safe step

Inspect and separate the Cassandra Unit/Colony runtime composition from the Dev Lab workspace. Do not move or generalize those systems until their contracts and current imports have been mapped. Keep the same approval-before-change workflow. The menu click failure remains a separate unresolved defect and is not claimed fixed by this content-boundary change.


## 12. Completed implementation slice — generic Engine input service

Approved by the user on 2026-11-14. Implemented on the existing `work` branch only.

### Goal

Move the reusable input-service contract out of Cassandra gameplay while keeping physical input collection and Dev Lab host behavior outside Engine.

### Changes made

- Added `engine/input/input-system.js` exporting `createInputSystem`.
- The Engine service is now identified as `engine.input` and provides `engine.input-api`.
- The service still receives a host-owned controller through dependency injection and exposes only `getState()` and `consumeFrameInput()`.
- Updated the Dev Lab application shell to compose the Engine input service.
- Updated Cassandra Colony Control to require `engine.input-api`; its Draft, WASD interpretation, movement speed and persistence behavior were not changed.
- Removed the old game-scoped `src/gameplay/input/game-input-system.js`.
- Corrected test imports to the current Dev Lab input-controller location and updated the input-service and Colony Control integration tests.
- Added a syntax check for the new Engine input module to the CI workflow.

### Intentionally unchanged

- `dev-lab/input/viewport-input-controller.js` remains a Dev Lab/host adapter. It continues to own physical key/button state, pause/resume snapshots, inspection suppression and focus-loss cleanup.
- DOM event bindings and meanings of WASD, F, Space and Escape remain in the Dev Lab shell.
- Cassandra Unit and Colony Control gameplay rules remain Cassandra-owned.
- Core simulation, environment behavior, save data shape and menu behavior were not changed.

### Verification status

Source-level references were updated and the old game-scoped input module was removed. The repository's automated test workflow and browser Pages behavior still need confirmation after this commit; no successful CI or manual browser test is claimed here.


## 13. Completed implementation slice — runtime composition outside Dev Lab

Approved by the user on 2026-11-14. Implemented on the existing `work` branch only.

### Goal

Move ownership of Cassandra gameplay runtime composition to the Cassandra application entry point. Keep Dev Lab capable of starting an Engine runtime without Cassandra gameplay.

### Changes made

- `application-entry.js`
  - Now owns `createCassandraRuntime()`.
  - Composes Engine Input, Cassandra Unit and Cassandra Colony Control as host systems.
  - Owns the Cassandra Colony Control simulation task and its fixed-step update policy.
  - Exposes `resolveCassandraRuntimeServices()` to map Core and game services to the Dev Lab application-facing runtime service contract.
  - Passes the runtime factory and service resolver into `startDevLab()`.
- `dev-lab/application/application-shell.js`
  - No longer imports or constructs Cassandra Unit, Colony Control or Engine Input systems.
  - Accepts `createRuntime` and `resolveRuntimeServices` dependencies.
  - Supplies Dev Lab-owned input and presentation callbacks to the runtime factory.
  - Consumes runtime services through the injected service resolver instead of hard-coding Cassandra service IDs.
  - Advances the runtime whenever the Core clock is available, including a standalone runtime without a Unit API.
- Added `dev-lab/application/create-dev-lab-runtime.js`
  - Provides a standalone Engine runtime with a Dev Lab-owned camera simulation system.
  - Registers no Cassandra gameplay systems.
- Added `tests/unit/dev-lab-runtime.test.js` and expanded `tests/unit/dev-lab-content-boundary.test.js`.
  - Cover the standalone runtime and enforce the source-level boundary between Dev Lab and Cassandra gameplay.
- Updated `.github/workflows/core-tests.yml` to syntax-check the standalone runtime module.

### Intentionally unchanged

- Cassandra Unit System and Colony Control implementation and gameplay rules.
- Engine Core, environment simulation, world and persistence behavior.
- Physical input collection in `dev-lab/input/viewport-input-controller.js`.
- Dev Lab UI, rendering, workspace save format and browser input bindings.
- The existing menu-button responsiveness issue; it remains a separate unresolved defect.
- `main` and all other branches.

### Verification status

- Source inspection confirms the Dev Lab shell no longer imports Cassandra gameplay modules or refers directly to Cassandra Unit/Colony Control service IDs.
- The Cassandra entry point now supplies the Cassandra runtime factory and service resolver.
- A runtime integration test was added to start and advance the standalone Dev Lab runtime without Cassandra gameplay.
- The test suite has not been executed in this environment. Do not mark CI as passed until the GitHub Actions run for the resulting commit completes successfully.
- Manual Pages/browser acceptance has not been performed by the assistant.

### Remaining architecture boundary

This slice separates runtime composition, not the entire application. Dev Lab UI still understands Unit and Colony Control API shapes when those services are supplied. Cassandra currently uses Dev Lab as its host application. A later phase must separate the Cassandra application shell/UI from Dev Lab to make Cassandra fully runnable without Dev Lab.
