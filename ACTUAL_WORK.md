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
