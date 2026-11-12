# Phase 2 — First Testable Game Layer

**Status:** 2.0 technical architecture complete; 2.1 Host Runtime Shell implemented and verified in CI. Pawn/gameplay implementation has not started.  
**Working branch:** `next-step/phase-2`  
**Base:** `main` at the Phase 1 Core baseline plus project documentation.  
**Purpose:** Build the smallest real host-game slice that proves the Core can support a running Cassandra game layer, without guessing the full future game.

## 1. Development model

Cassandra is developed in bounded phases. Each phase has one integration branch named `next-step/phase-N`. All substeps for that phase are implemented and tested on that branch. Substeps are logical milestones, not automatically separate Git branches.

- `main` contains only completed, reviewed and accepted phase results.
- A new `next-step/phase-N` branch starts from the current `main`.
- Work is committed in small, meaningful commits within that phase branch.
- GitHub Actions runs the existing Core regression suite on pushes to `main` and `next-step/**`, so the active phase branch receives continuous Core protection.
- The whole phase is tested together on the same branch, not just each substep in isolation.
- Fixes stay on the phase branch until its acceptance criteria pass.
- Only after review and acceptance is the phase merged into `main`.
- The next phase starts from the newly accepted `main`.
- A short-lived experiment branch may be used only when a risky technical question needs isolation; its accepted result returns to the current phase branch.

This keeps one clear active development target and prevents unfinished combinations from leaking into the stable baseline.

## 2. Core protection rule

**A gameplay system must adapt to Core; Core must not be reshaped merely to make one gameplay system easier to implement.**

Core changes are exceptional. They may be proposed only when all of the following are true:

1. A concrete Core limitation has been demonstrated in code or a failing integration test.
2. The limitation blocks meaningful future progress or violates a required general-purpose runtime contract.
3. The problem cannot reasonably be solved in the host layer, a gameplay system, or an adapter.
4. The proposed Core change is domain-neutral and benefits the runtime beyond one game feature.
5. The impact on existing contracts, tests, the archive baseline and migration path is documented.

If these conditions are not met, change the host/gameplay system or its adapter. Never change Core just to avoid writing a proper adapter.

The archived Core repository is a reference baseline, not a development target. Any exceptional Core proposal must be reviewed separately before implementation; this phase does not authorize changes to Core.

## 3. Phase 2 goal

At the end of Phase 2, NEW-GAME-CASS should contain a minimal, runnable and testable host-game foundation:

- the host can compose and start the existing Core;
- one simple world can be created and activated;
- a Pawn can be represented as a host-owned domain entity with stable identity;
- the Pawn can be placed in the world and moved through a small, explicit control path;
- simulation updates are executed through the existing Core scheduler contract;
- the resulting state can be tested and, where included in the phase, saved/restored through the existing persistence contract;
- a minimal diagnostic view or harness makes the slice observable without committing to final UI or art direction.

This is a technical vertical slice, not a declaration of the final game design. It exists to make later decisions against a working system rather than against abstractions alone.

## 4. Substeps

### 2.0 — Architecture and system contracts

**Purpose:** Decide the smallest useful shape of the host layer before implementation.

**Work:**
- Complete `docs/architecture/GAME_SYSTEMS_ARCHITECTURE.md` with initial system boundaries, ownership and dependencies.
- Complete `docs/architecture/PHASE_2_SYSTEM_CONTRACTS.md` with host, world, Pawn, locomotion and persistence boundaries checked against the actual Core API.
- Adopt `docs/standards/SYSTEM_DEVELOPMENT_STANDARD.md` as the required template for new systems.
- Confirm which Core services the host needs and how the host composes them.
- Identify the minimum Pawn/world slice and explicitly list what is not part of this phase.
- Record unresolved design questions instead of silently inventing permanent game rules.

**Files:** `docs/phases/PHASE_2.md`, `docs/architecture/GAME_SYSTEMS_ARCHITECTURE.md`, `docs/architecture/REPOSITORY_STRUCTURE.md`, `docs/architecture/PHASE_2_SYSTEM_CONTRACTS.md`, `docs/standards/SYSTEM_DEVELOPMENT_STANDARD.md`, and `docs/testing/PHASE_2_TEST_PLAN.md`.

**Creates for future development:** a shared vocabulary, explicit ownership boundaries and a repeatable system contract. Future systems can be added without having to predict or redesign the entire game now.

**Acceptance:** documents agree with the actual Core API; no gameplay implementation is added in this substep.

### 2.1 — Host Runtime Shell

**Purpose:** Prove that NEW-GAME-CASS can run as a host application of the archived Core.

**Work:**
- Add a host entry point and one explicit composition function for the Core Assembly.
- Register only the systems needed by the Phase 2 slice.
- Supply an explicit persistence adapter appropriate to the development environment; do not rely on Core's test-only in-memory adapter as production storage.
- Define host start, stop and failure cleanup.
- Keep rendering, input and browser concerns outside Core.
- Add a minimal development/test entry point. Avoid a UI framework unless a concrete need is demonstrated.

**Target area:** `src/host/` for application composition and lifecycle; adapters live in `src/adapters/`.

**Creates for future development:** a stable place to attach systems, input, presentation and storage without turning Core into a game-specific container.

**Acceptance:** a test can compose, start and destroy the host; invalid system configuration fails safely; Core tests remain green.

### 2.2 — World and Pawn Foundation

**Purpose:** Introduce the first real game-owned data without moving gameplay concepts into Core.

**Work:**
- Define the smallest useful Pawn domain model and its owner system.
- Use Core Entity Registry for identity/lifecycle primitives; do not duplicate identity generation in Pawn code.
- Use Core World Registry/World Context for world registration, activation and exclusive placement.
- Keep Pawn-specific attributes and state in the Pawn-owning game system, not in Core metadata as a substitute for a domain model.
- Define how a Pawn is created, placed, removed/stored and restored.
- Start with one simple test world. Do not yet introduce ships, floors, colonies, encounters or galaxy generation.

**Target area:** each gameplay system receives its own folder under `src/systems/<system-name>/`; shared world definitions/configuration live under `src/worlds/` only if they become reusable assets. Exact system names and service IDs must follow the approved contracts.

**Creates for future development:** a stable entity foundation for later Pawn Life, movement, needs, equipment, jobs, AI and world transitions.

**Acceptance:** a Pawn receives a stable identity, has exactly one valid placement, can be queried through its public service, and its owner system can snapshot/restore its domain state without bypassing Core contracts.

### 2.3 — Minimal Locomotion and Control Path

**Purpose:** Make the Pawn/world foundation observable and exercise the simulation loop with a real gameplay operation.

**Work:**
- Define a small movement command/API owned by the relevant gameplay system.
- Keep raw keyboard/browser input in a host adapter; the Pawn system must not read browser globals or DOM events.
- Apply movement in a synchronous simulation task compatible with the Core fixed-step scheduler.
- Establish a minimal coordinate convention and movement boundary for this test world; do not assume it is the final map/grid/physics model.
- Add only the collision or boundary behavior required for a safe, testable first slice. If a dedicated spatial/physics system becomes necessary, document that dependency rather than hiding it inside Pawn identity.
- Add a minimal debug presentation or test harness only to the extent needed to observe position and control.

**Creates for future development:** a verified path from player intent → host input adapter → gameplay service/command → scheduled simulation update → world placement/state → observable output. Later navigation, AI, jobs and animation can build on this path.

**Acceptance:** movement is deterministic under the chosen fixed-step test conditions; input does not mutate domain state directly; bounds/collision rules are covered by tests; pause stops simulation updates.

### 2.4 — Phase Integration, Persistence and Verification

**Purpose:** Verify the complete Phase 2 slice as one coherent host application.

**Work:**
- Integrate the host, world, Pawn and locomotion pieces on this branch.
- Register the Pawn-owning system as a persistence participant using the actual Core contract.
- Verify save/restore preserves Pawn identity, domain state and world placement consistently.
- Test start/stop, pause/resume, invalid setup, system failure and cleanup.
- Run all Core regression tests and all Phase 2 automated tests.
- Perform the manual browser/runtime check if a browser harness was added.
- Update this plan with actual implementation paths, final contracts, test evidence and any deferred work.

**Creates for future development:** the first verified end-to-end game slice and a real reference implementation for future systems.

**Acceptance:** all required automated checks pass; no duplicate/lost Pawn or invalid world placement after restore; no unapproved Core changes; manual checks are recorded honestly; the branch is ready for review before merge.

## 5. Repository layout and merge plan

The branch is organized by responsibility, not by the chronological order in which files were written. Directories are created when they contain real files; empty placeholder folders are not committed.

```text
/
├── .github/workflows/          # CI and repository automation
├── docs/
│   ├── phases/                 # Phase plans, scope and acceptance criteria
│   ├── architecture/           # Architecture maps and repository structure
│   ├── standards/              # Required system/design standards
│   └── testing/                # Test plans, evidence and manual procedures
├── src/
│   ├── core/                   # Frozen Core baseline; changes require exceptional review
│   ├── host/                   # Host composition, startup and shutdown
│   ├── adapters/
│   │   ├── input/              # Keyboard/mouse/device → game requests
│   │   ├── presentation/       # Renderer, camera and debug view
│   │   └── storage/            # Host-provided durable storage adapter
│   ├── systems/                # One folder per gameplay system; each owns its data
│   └── worlds/                 # Reusable world definitions/assets, if needed
└── tests/
    ├── core/                   # Existing Core regression suite (preserve its behavior)
    ├── unit/                   # Isolated system rules
    ├── contract/               # Public API and service contracts
    ├── integration/            # Real Core + gameplay system combinations
    └── e2e/                    # Runnable host/gameplay vertical slice
```

The existing Core tests currently live directly under `tests/`. They will not be moved as a cosmetic refactor during Phase 2. Their current paths and `npm run test:core` entry point remain stable; a future test-layout migration must be explicit, update the runner and CI together, and prove that no tests were dropped. New Phase 2 tests use the categories above where practical.

### Merge map into `main`

The phase branch is not merged as a collection of unrelated files. At completion, its reviewed result is mapped into these stable responsibility groups:

| Phase 2 output | Stable location in `main` | Merge condition |
|---|---|---|
| Phase plan and decisions | `docs/phases/` | Final status, actual paths and deferred items recorded |
| System boundaries and repository map | `docs/architecture/` | Matches the implemented contracts |
| System authoring rules | `docs/standards/` | Applies to actual Core API and lessons from Phase 2 |
| Host runtime | `src/host/` | Start/stop/failure tests pass |
| Input, presentation and storage adapters | `src/adapters/` | No domain logic or Core internals leak into adapters |
| Pawn/world/movement gameplay code | `src/systems/` and `src/worlds/` | Ownership, public contracts, persistence and integration tests pass |
| New automated tests | `tests/unit/`, `tests/contract/`, `tests/integration/`, `tests/e2e/` | Included in documented runners and CI |

Before merge, I will: (1) inspect the full branch diff against its recorded `main` base; (2) verify no Core files changed without an approved exception; (3) run the complete Core and Phase 2 suites; (4) inspect the final directory tree and imports; (5) verify documentation and test commands; (6) prepare a merge summary and explicit acceptance checklist. Only then will I ask you to approve merging the complete phase into `main`. Until that approval, `main` remains untouched.

The merge should preserve meaningful history. Prefer a normal merge commit for a completed phase so the phase boundary remains visible and auditable; do not squash away the milestone history unless there is a concrete repository-management reason and we agree on it.

## 6. Explicitly out of scope

Phase 2 does not attempt to implement the full game. Unless evidence from the vertical slice makes a narrowly scoped dependency unavoidable, defer:

- Pawn needs, health, age, skills, professions or relationships;
- inventory, equipment, crafting or economy;
- combat, damage, weapons, projectiles or enemies with AI;
- construction, ship modules, doors, hulls or floors;
- atmosphere, temperature, electricity or other environment simulation;
- colony automation, jobs and schedules;
- galaxy generation, navigation, shuttle, expeditions or encounter transitions;
- final UI, art, animation, audio and production save storage;
- multiplayer, modding, scripting or parallel simulation.

The old CASSANDRA3 repository may be consulted as a historical design/prototype reference. It is not an implementation dependency and must not be modified as part of this phase.

## 7. Testing policy

Every substep adds tests at the level of its public contract. The phase branch must also run the entire existing Core suite.

- Unit tests cover the system's own rules and state transitions.
- Contract tests cover public service inputs, outputs and error behavior.
- Integration tests cover interactions with actual Core services.
- End-to-end tests cover the host → world → Pawn → movement path.
- Persistence tests cover preparation, commit and rollback behavior.
- Manual checks are recorded separately and never described as automated tests.

A test is PASS only after it has actually run and passed. Prepared tests are not evidence of working behavior.

## 8. Phase completion checklist

- [x] 2.0 technical architecture and system contracts documented and checked against the actual Core API.
- [x] 2.1 host runtime composition, scheduler bridge, pause/resume and failure cleanup implemented; 6/6 host tests and 198/198 Core tests passed in CI.
- [ ] 2.2 world and Pawn identity/placement contracts pass.
- [ ] 2.3 movement/control path passes deterministic tests.
- [ ] 2.4 persistence and full integration pass.
- [ ] Existing Core regression suite passes unchanged.
- [ ] No Core change was made without the exceptional review described above.
- [ ] Documentation reflects implemented behavior, not intended behavior.
- [ ] Phase branch reviewed and explicitly accepted before merge to `main`.

## 9. Change log

| Date | Change |
|---|---|
| 2026-11-12 | Initial Phase 2 plan created on `next-step/phase-2`; implementation not started. |
| 2026-11-12 | Core regression workflow extended to run on active `next-step/**` branches. |
| 2026-11-12 | Repository folder layout and explicit phase-to-main merge map documented. |
| 2026-11-12 | Initial host/world/Pawn/locomotion contracts checked against Core source; game-facing Pawn details remain open. |
| 2026-11-12 | 2.1 host runtime shell implemented in `src/host/`; CI passed 198/198 Core tests and 6/6 host tests. |
| 2026-11-12 | Approved square world dimensions (64/128/256 primary presets), independent grid overlay and initial 64 × 32 viewport target documented. Added a minimal browser preview with size selection, grid toggle, pan and zoom. |


## 10. Dev Lab viewport correction — 2026-11-12

- Removed automatic Johny Unit creation. The canonical Database definition remains; Dev Lab starts with zero live Units.
- Registered 64 × 64, 128 × 128 and 256 × 256 test-world presets in World Registry and made the selector activate the matching descriptor.
- Replaced the lower, layout-expanding Unit inspector with a floating Quick Select overlay inside the viewport.
- Positioned Quick Select at the upper-left of the viewport. The overlay does not participate in canvas sizing.
- Added a paused-only INFO disclosure for selected live Unit details. Empty-space click clears selection.
- Kept future object categories on a generic presentation contract; no fake objects or sprites are created.
- Updated WHATANDWHY.md and the application-shell architecture with superseding decisions while retaining original decision history.
- Automated and browser verification: pending.
