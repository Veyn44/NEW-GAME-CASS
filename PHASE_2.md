# Phase 2 — First Testable Game Layer

**Status:** Proposed plan; implementation has not started.  
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
- Complete `GAME_SYSTEMS_ARCHITECTURE.md` with initial system boundaries, ownership and dependencies.
- Adopt `SYSTEM_DEVELOPMENT_STANDARD.md` as the required template for new systems.
- Confirm which Core services the host needs and how the host composes them.
- Identify the minimum Pawn/world slice and explicitly list what is not part of this phase.
- Record unresolved design questions instead of silently inventing permanent game rules.

**Files:** planning documents at repository root.

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

**Likely area:** `src/game/` or another clearly named host-layer directory, to be selected after the file layout is designed.

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

**Likely systems:** a minimal Pawn system and a minimal host world/scene definition. Exact names and service IDs must follow the approved contracts.

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

## 5. Explicitly out of scope

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

## 6. Testing policy

Every substep adds tests at the level of its public contract. The phase branch must also run the entire existing Core suite.

- Unit tests cover the system's own rules and state transitions.
- Contract tests cover public service inputs, outputs and error behavior.
- Integration tests cover interactions with actual Core services.
- End-to-end tests cover the host → world → Pawn → movement path.
- Persistence tests cover preparation, commit and rollback behavior.
- Manual checks are recorded separately and never described as automated tests.

A test is PASS only after it has actually run and passed. Prepared tests are not evidence of working behavior.

## 7. Phase completion checklist

- [ ] 2.0 architecture and system contracts accepted.
- [ ] 2.1 host runtime starts and shuts down safely.
- [ ] 2.2 world and Pawn identity/placement contracts pass.
- [ ] 2.3 movement/control path passes deterministic tests.
- [ ] 2.4 persistence and full integration pass.
- [ ] Existing Core regression suite passes unchanged.
- [ ] No Core change was made without the exceptional review described above.
- [ ] Documentation reflects implemented behavior, not intended behavior.
- [ ] Phase branch reviewed and explicitly accepted before merge to `main`.

## 8. Change log

| Date | Change |
|---|---|
| 2026-11-12 | Initial Phase 2 plan created on `next-step/phase-2`; implementation not started. |
| 2026-11-12 | Core regression workflow extended to run on active `next-step/**` branches. |
