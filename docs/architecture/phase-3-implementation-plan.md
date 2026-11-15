# Phase 3 Physical World — Implementation Plan

**Status:** Slices 1–6 are implemented on `work`; initial Dev Lab spatial test workflows, Cassandra grid/Unit movement, Main/Temporary World session and the first Change Package protocol foundation are implemented. Production campaign persistence, domain integration and final acceptance remain in progress. Automated tests may run during implementation; user-led acceptance testing remains deferred until Phase 3 is complete. The latest confirmed GitHub Actions run passed 205/205 Core tests and 228/228 host tests.  
**Branch:** `work`  
**Source audit:** 2026-11-15  
**Scope:** Implementation sequencing for reusable Engine grid/spatial capabilities and their Cassandra/Dev Lab integration

This plan translates the current Phase 3 design material into an implementation sequence. The user explicitly authorized implementation to begin on `work`. That authorization is being applied slice by slice: a completed, tested slice does not automatically authorize dependent or unrelated changes, and it does not authorize a merge to `main`.

Several topics in Steps 7–9 remain open. Isolated Engine capabilities may proceed where their own contracts are settled; Cassandra integration and persistence remain gated by their outstanding design and source-audit requirements.

## 1. Starting point and constraints

### 1.1 Current implementation baseline

The following files were inspected on `work`:

**Engine Core**
- `engine/core/entity-registry.js` — stable entity identity/lifecycle and its persistence participant.
- `engine/core/world-registry.js` — world descriptors, lifecycle status and its persistence participant.
- `engine/core/world-context.js` — one current placement record per entity (world-space position or store placement), transfer and persistence.
- `engine/core/persistence.js` — ordered persistence participants, schema validation/migration and staged transactional restore.
- `engine/core/core-assembly.js` — Core service registration, dependency wiring and persistence participant registration.
- `engine/core/game-clock.js` and `engine/core/simulation-scheduler.js` — current shared time/scheduler infrastructure; not part of the spatial implementation scope.
- `engine/core/README.md` — current Core service documentation.

**Existing tests**
- `tests/entity-registry.test.js`
- `tests/core-integration.test.js`
- `tests/core-registry.test.js`
- `tests/clock-scheduler.test.js`
- `tests/lifecycle-bootstrap.test.js`
- `tests/persistence-logger.test.js`
- `tests/unit/` — application/runtime and other unit tests.

The repository currently has no `engine/spatial/` directory or dedicated grid/composition/query/movement implementation module in the inspected Engine tree. The proposed paths below are new targets, not claims about existing files.

### 1.2 Existing contracts that must remain intact

- Entity Registry remains the identity/lifecycle authority; spatial occupancy must reference entity IDs, not duplicate entity identity.
- World Registry remains the world descriptor/lifecycle authority. A world's dimensions must not be treated as proof that it has a grid.
- World Context's current continuous world-space placement and storage/transfer behavior must not be silently reinterpreted as integer cell occupancy.
- Persistence's participant contract, safe-boundary behavior and transactional restore model must be extended deliberately, not bypassed.
- Grid capability is optional per World. Cassandra's Main and Temporary Worlds use it; Engine must not impose a two-world maximum.
- A cell can contain multiple independent contents. An entity may occupy multiple cells while retaining one identity.
- Empty cells remain implicit/neutral; vacuum and other environmental states are explicit host-owned content.
- Engine exposes generic spatial facts. Cassandra owns terrain, vacuum meaning, passability, buildability, movement speed, damage and gameplay outcomes.
- Main World pause during an expedition remains Cassandra policy.
- No background simulation is introduced for inactive worlds.
- No backward compatibility guarantee is required for saves from older Cassandra versions. Unsupported old saves may be rejected safely; selected migrations are optional and explicitly version-scoped.
- Existing tested environment/simulation behavior must not be changed without a demonstrated dependency and separate approval.

### 1.3 Cassandra source audit (2026-11-15)

The current Cassandra prototype source has now been inspected:

- `src/gameplay/unit/unit-system.js` — Unit identity/definition records are persisted separately from placement. Creation uses integer tile coordinates; movement accepts fractional coordinates and writes them directly through World Context. Unit removal clears World Context placement, retires the Core identity and removes the Unit domain record.
- `src/gameplay/colony/colony-control-system.js` — Cassandra owns the current movement speed (4 tiles/second), diagonal normalization, Draft/input eligibility and the rule that only a leader in `WorldRegistry.activeWorldId` is moved.
- `cassandra/application/cassandra-runtime-host.js` — current runtime composes Input, Unit and Colony Control and runs one Colony Control simulation task.
- `cassandra/application/cassandra-application-shell.js` — registers 64×64, 128×128 and 256×256 worlds, activates one selected world, supplies integer tile placement coordinates and uses the workspace-only `.cass` save identity.
- `shared/presentation/world-viewport.js` — marker drawing and camera following currently add 0.5 to stored Unit coordinates. Once grid-backed World Context positions represent cell centers, these offsets must not be applied a second time.
- Tests: `tests/unit/unit-system.test.js`, `tests/unit/colony-control-system.test.js`, `tests/unit/cassandra-runtime-host.test.js` and `tests/core-integration.test.js`.

Important integration consequence: the existing Unit movement path is continuous/fractional while grid occupancy is discrete/integer. Grid adoption must explicitly define how Cassandra-owned movement progress and visual interpolation relate to committed cell anchors. Do not silently round fractional positions or move Pawn speed/input rules into Engine.

The current branch contains no Cassandra environment simulation, world-generation, expedition or Temporary World implementation modules, and no corresponding tests. These future systems cannot be source-audited from the current tree. Do not infer their persistence or behavior from the workspace prototype; audit them when those systems are introduced or located.

## 2. Proposed target architecture

Introduce a focused Engine spatial capability under a new `engine/spatial/` directory. Keep generic geometry, composition/occupancy, queries and movement separate from application-specific rules.

### 2.1 Proposed modules

| Proposed path | Responsibility | Depends on |
|---|---|---|
| `engine/spatial/grid-geometry.js` | Grid descriptor validation, integer cell coordinates, bounds, coordinate conversion, neighbor and named distance primitives | No application/game systems |
| `engine/spatial/spatial-composition.js` | Cell-associated records, entity footprints, occupancy indexes, atomic occupancy updates, read-only query surface, spatial snapshot validation | Entity Registry, World Registry/grid descriptor |
| `engine/spatial/spatial-movement.js` | Generic move transaction over complete footprints; target bounds/overlap facts; host policy boundary | Spatial Composition |
| `engine/spatial/README.md` | Public ownership, contracts, integration and usage notes | The above modules |

The exact class/function names and whether geometry is a pure utility module or a registered service are implementation details. The recommended starting point is a pure geometry module and a single Spatial Composition service that owns both occupancy and its read-only query surface. Movement is a thin separate service so mutation policy and query/storage concerns remain distinguishable.

Do not create separate query storage or duplicate indexes in a standalone query service. Queries should read the authoritative Spatial Composition state.

### 2.2 Core assembly integration

Proposed integration touchpoints:
- `engine/core/core-assembly.js` — register Spatial Composition and Movement services only after their contracts and dependencies are finalized; add their persistence participant(s) in dependency-safe order.
- `engine/core/README.md` — document new services and ownership.
- `engine/core/world-registry.js` — change only if the approved grid descriptor contract requires an explicit World capability field/API. Do not infer grid support from existing dimensions.
- `engine/core/world-context.js` — change only after the placement-authority integration question in Section 8 is resolved. Preserve its current API behavior otherwise.

No changes to GameClock or SimulationScheduler are required for the spatial foundation.

### 2.3 Application boundary

Cassandra integration remains under `cassandra/` and must use Engine capabilities through the application's runtime composition. Cassandra retains its own world-generation, environment, pawn/unit, combat, construction and expedition rules.

Dev Lab integration remains under `dev-lab/` and should consume the same Engine spatial APIs. It must not implement a parallel occupancy or movement model.

Presentation remains a consumer. Viewport coordinates, rendering order, interpolation and overlays must not become authoritative spatial state.

## 3. Implementation sequence

The sequence below is dependency-ordered. Each slice has its own review checkpoint and must pass its acceptance tests before the next dependent slice begins.

### Slice 0 — Design closure and compatibility baseline

**Purpose:** Establish a safe baseline before any implementation.

Tasks:
1. Review the World Lifecycle, Grid Geometry, Spatial Composition, Movement & Collision, Spatial Query and this Implementation Plan together.
2. Complete the remaining Phase 3 design areas that are prerequisites: Step 7 ownership/transfer, Step 8 persistence and `.cass` compatibility, and Step 9 integrated acceptance.
3. Resolve the placement-authority decision in Section 8.
4. Confirm the inspected Unit/Colony Control and viewport paths; locate environment, world-generation and temporary-world/expedition code only if/when those systems exist in the branch.
5. Record current supported `.cass` format/fixture coverage and expected rejection behavior for unsupported historical versions before adding spatial snapshots.
6. Run and record the existing Core and application test suites on the untouched baseline.

**Exit criteria:**
- No unresolved architectural choice blocks the first implementation slice.
- Current-format save behavior and safe rejection of unsupported historical formats have a concrete test/fixture strategy; legacy migration fixtures are required only for explicitly supported migration paths.
- Existing environment simulation behavior is covered by regression tests.
- The Grid Geometry contract and its relevant ownership/coordinate decisions are settled. Remaining Cassandra package/storage decisions do not block this isolated geometry slice.

**No source changes in this slice.**

### Slice 1 — Grid Geometry primitives

**Status:** Implemented and verified 2026-11-15.

**Files added:**
- `engine/spatial/grid-geometry.js`.
- `engine/spatial/README.md`.
- `tests/unit/grid-geometry.test.js`.

Tasks:
- Validate optional grid descriptors with positive safe-integer width/height.
- Validate integer cell coordinates and half-open bounds.
- Provide explicit world-position-to-cell conversion using floor semantics.
- Provide cell-center conversion.
- Provide 4-way and 8-way neighbor enumeration with no wrapping.
- Provide Manhattan and Chebyshev distance helpers.
- Keep non-grid Worlds valid and do not reinterpret World Registry dimensions.

**Implemented behavior:**
- Positive safe-integer grid dimensions and safe-integer cell coordinates.
- Half-open rectangular bounds and explicit out-of-bounds errors.
- Continuous world-position to cell conversion using `floor`, including negative positions without clamping.
- Approved anchor-cell center mapping `(x + 0.5, y + 0.5)`.
- Deterministic 4-way and 8-way neighbors, clipped at edges with no wrapping.
- Manhattan and Chebyshev distance helpers with safe-integer overflow rejection.
- Immutable detached results and stable error codes.

**Verification:**
- 13 focused geometry tests added.
- GitHub Actions `Core and host tests`: [run 43737845841](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43737845841) — `npm run test:all` passed (125 tests, 0 failures); browser entry-point syntax checks passed.
- Existing World Registry and World Context files/tests were not changed.
- No cell contents, occupancy, world descriptor integration or game rules were introduced.

### Slice 1b — World Registry grid capability descriptor

**Status:** Implemented and verified 2026-11-15.

**Files changed:**
- `engine/core/world-registry.js`.
- `tests/world-registry.test.js`.
- `tests/core-integration.test.js`.

**Implemented behavior:**
- `registerWorld()` accepts an optional `grid: { width, height }`; omitted or `null` means no grid.
- The immutable World descriptor exposes `grid: null` or a validated positive safe-integer grid descriptor.
- Generic World `dimensions` remain unchanged and do not imply grid support; grid dimensions are stored separately.
- World Registry snapshot schema is now version 3.
- Explicit version-1 and version-2 snapshot migrations add `grid: null` while preserving existing world metadata/reference migration behavior.
- Snapshot validation requires the explicit grid field and rejects malformed descriptors.

**Verification:**
- Tests cover non-grid defaults, independent grid/world dimensions, immutability, invalid registration, snapshot round-trip, malformed snapshots and v1/v2 migration.
- GitHub Actions [run 43738206447](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43738206447) — Core suite 204/204 passed, host suite 125/125 passed, browser syntax checks passed.
- No World Context placement semantics or Core Assembly service registration changed.

### Slice 2 — Spatial Composition storage and occupancy

**Status:** Spatial Composition storage and occupancy are implemented and verified. The read-only query and generic movement capabilities are implemented separately in Slices 3 and 4 below.

**Slice 2a — cell content and footprint geometry:**
- Sparse cell-associated content, stable IDs, categories/layers, immutable payloads, deterministic snapshots and pure footprint geometry are implemented in `engine/spatial/spatial-composition.js`.

**Slice 2b — coordinated entity occupancy:**
- Added canonical one-record-per-entity occupancy (world, anchor, footprint, orientation) and derived cell-to-entity indexes.
- Added `engine/spatial/placement-coordinator.js` as the required grid placement mutation boundary.
- Grid anchor maps to WorldContext position `(x + 0.5, y + 0.5)`; multi-cell entity identity is not duplicated.
- Grid placement, relocation, rotation/footprint replacement, grid-world transfer, grid-to-non-grid transfer, grid-to-storage, storage-to-grid and retirement are prepared and committed synchronously across WorldContext, EntityRegistry lifecycle and Spatial Composition.
- Direct one-sided WorldContext grid placement/move/storage/removal and direct EntityRegistry store/removal while grid-occupied are rejected.
- Core Assembly registers Spatial Composition and Placement Coordinator.
- Core Persistence uses one composite `core.spatial-placement` participant for WorldContext + Spatial Composition. Entity Registry and World Registry restore first; the composite validates the pair and commits both services in one synchronous participant call.
- Added unit and Core integration tests for occupancy indexes, atomic moves, lifecycle transitions, direct-mutation guards, composite restore and real save/load round-trip.

**Ownership boundary:** Engine permits overlapping entity footprints; host/game policy decides whether overlap is legal. No pathfinding, passability, collision response or Cassandra movement rules are implemented here.

**Verification:** Final CI run `43740768452` passed: Core `205/205`, Host `151/151`, browser syntax check passed. Implementation head at this checkpoint: `97a8d87162ab2d712f9dcf3db419b49686b9a2f4`. Do not infer Cassandra integration from this Engine slice.

### Slice 3 — Spatial Query surface

**Implemented on `work`:**
- `engine/spatial/spatial-composition.js` — read-only query surface.
- `engine/core/core-assembly.js` — injects Entity Registry for generic entity-kind filters.
- `tests/unit/spatial-query.test.js` — focused query acceptance coverage.

Implemented methods:
- `queryCell(worldId, cell, filters)` — separate content and entity occupancy facts.
- `queryRegion(worldId, region, filters)` — half-open rectangles or finite cell sets; only occupied cells are materialized in results.
- `queryEntitiesInRegion(worldId, region, { kinds })` — entity-ID deduplication and matched-cell reporting.
- `getEntityFootprint(entityId)` — full authoritative footprint; distinguishes unknown entity from non-grid placement.
- `queryNeighbors(worldId, cell, { topology })` — explicit four-way/eight-way topology.
- `queryRadius(worldId, center, { radius, metric })` — explicit Manhattan/Chebyshev metric.

Filters:
- Category and layer filter cell-associated content only.
- Entity kind filters Entity Registry metadata only.
- Empty arrays mean no restriction; malformed filters reject.

**Exit criteria covered by the Slice 3 test suite:**
- Deterministic row-major cell order, stable entity IDs and multi-cell deduplication.
- Half-open region boundaries, explicit-cell deduplication and reject-by-default out-of-bounds behavior.
- Immutable results and no mutation/materialization of untouched cells.
- Distinct invalid-region, bounds, unknown-world, non-grid-world, unknown-entity and non-spatial-placement errors.
- Local cell lookups use the cell index rather than scanning Entity Registry.
- Region scans use sparse stored content/occupancy records; no full grid materialization.

**Deferred:** Independent unloaded-snapshot availability, category/layer secondary indexes pending profiling, async/paginated queries, arbitrary predicates, subscriptions, Cassandra/Dev Lab adoption and movement integration.

### Slice 4 — Generic Movement transaction

**Implemented on `work`:**
- `engine/spatial/spatial-movement.js` — synchronous host-policy movement transaction.
- `engine/core/core-assembly.js` — registers `core.spatial-movement` after its dependencies.
- `tests/unit/spatial-movement.test.js` — focused movement acceptance coverage.

Behavior:
- Moves an entity's existing complete grid footprint to a target world/anchor/orientation.
- Derives and validates every target cell before host policy evaluation.
- Supplies immutable mover/current/target facts, target-cell contents and deduplicated geometric overlaps.
- Requires a synchronous host policy per call; no default allow/block policy exists in Engine.
- Accepts boolean or structured `{ accepted, code?, reason? }` decisions.
- Commits accepted moves only through Placement Coordinator.
- Returns stable `moved`, `unchanged`, `rejected`, `invalid`, `out-of-bounds`, `unavailable`, `policy-error` or `failed` outcomes.
- Policy rejection, malformed/throwing/async policy and bounds failure leave the previous placement unchanged.
- Re-entrant movement of the same entity is rejected, including while an unsupported asynchronous policy is still settling.

**Exit criteria covered by focused tests:**
- Multi-cell translation and rotation, including removal of all old occupied cells.
- Geometric overlap and cell-content facts, without Engine passability semantics.
- Host policy can accept overlap or reject a target.
- Cross-grid-world relocation preserves entity identity.
- Same-position, out-of-bounds footprint, unavailable/non-grid/closed world and invalid entity cases.
- Policy rejection, exception, async/malformed return, sync and async mutation attempts, decision-accessor mutation, and re-entrant attempt.

**Boundary note:** The policy receives immutable facts and is synchronous. During evaluation, Engine guards Spatial Composition content/occupancy writes and Placement Coordinator commits/restore rollbacks; policy decision properties are normalized under the same guard. The host must still avoid mutating unrelated external state captured by its closure. Cassandra movement, speed, input, interpolation, passability and collision consequences remain untouched.

### Slice 5 — Persistence and restore integration

**Status:** Implemented on `work`; the latest confirmed CI run passed the full Core and host suites. IndexedDB campaign persistence remains a candidate backend pending real-browser durability/recovery verification.

**Implemented files and behavior:**
- `engine/spatial/placement-coordinator.js` owns the composite `core.spatial-placement` persistence participant.
- The participant captures World Context and Spatial Composition canonical snapshots together, validates their consistency, prepares both replacements and commits/rolls them back as one synchronous aggregate.
- `engine/core/core-assembly.js` registers Entity Registry, World Registry and the composite placement participant in dependency order; it does not register duplicate independent placement snapshots.
- Fatal rollback-integrity failure faults the coordinator and pauses the Core clock through the host callback.
- `tests/unit/placement-coordinator.test.js` covers composite restore, mismatch rejection, authority guards, rollback integrity faulting and rollback when a later Persistence participant fails.
- `tests/core-integration.test.js` covers the real Core Assembly grid placement save/load round-trip and cross-registry restore rollback.

**Remaining verification:** Verify the candidate campaign backend in actual target browsers; unsupported historical `.cass` envelope rejection is covered by automated tests.

**Original implementation checklist (completed unless noted):**
- Add an Engine-owned composite placement-state persistence coordinator/participant (detailed in Section 14 of `spatial-placement-integration-contract-proposal.md`) that captures World Context and Spatial Composition canonical snapshots together.
- Keep Entity Registry and World Registry as earlier restore dependencies; restore the composite placement state after both.
- Do not register independent World Context and Spatial Composition participants for the same canonical placement state in one Core assembly.
- Update `engine/core/core-assembly.js` to register it after dependency ordering is approved.
- Add `tests/unit/spatial-persistence.test.js`.
- Extend `tests/core-integration.test.js` for cross-participant restore behavior.
- Update relevant `.cass` fixtures/migration tests only after the save-format strategy is approved.

Tasks:
- Persist authoritative cell-associated records and entity footprint/occupancy data.
- Do not persist derived indexes if they can be deterministically rebuilt.
- Validate world IDs, grid bounds, entity references, footprints, stable IDs and duplicate occupancy during restore preparation.
- Build restored spatial state off to the side; commit as one participant transaction and support rollback.
- Ensure participant ordering works with World Registry and Entity Registry references.
- Make World Context + Spatial Composition restore one synchronous composite commit/rollback boundary; separate awaited participant commits are insufficient for cross-service atomicity.
- Preserve the World Context-only persistence path for hosts that do not assemble the spatial capability.
- Define explicit rejection or an intentionally supported, version-scoped migration for saves that predate the spatial participant.
- Keep envelope/version boundaries explicit; never silently reinterpret an unsupported envelope, metadata or application identity.
- Never interpret an absent spatial snapshot as empty by default. Reject the save unless a deliberately supported migration can derive the spatial state from authoritative legacy data.

**Exit criteria:**
- Save/load round trips preserve all authoritative spatial records.
- Invalid snapshots fail without leaving partially restored spatial state.
- Cross-participant failure rolls back earlier commits.
- Fixtures for currently supported `.cass` formats load and preserve their documented behavior; unsupported historical versions reject without runtime or source-file mutation.
- New saves can be reopened and spatial indexes rebuilt deterministically.

### Slice 6 — Runtime assembly and Core integration

**Status:** Core Assembly integration is implemented on `work`; the latest full CI run passed, including non-spatial host tests and standalone Dev Lab/Cassandra-hosted spatial acceptance.

**Implemented:**
- `engine/core/core-assembly.js` registers Spatial Composition, Placement Coordinator and Spatial Movement with explicit service IDs and dependency declarations.
- Persistence registers the composite placement participant after Entity Registry and World Registry.
- The Core service graph remains application-neutral and does not import Cassandra or Dev Lab.
- `tests/core-integration.test.js` verifies grid placement persistence through the actual Core Assembly and retains non-grid World Context behavior coverage.

**Remaining:** Browser-level teardown/lifecycle verification; automated Core/host suite currently passes.

**Original implementation checklist:**
- Update `engine/core/core-assembly.js`.
- Update `engine/core/README.md`.
- Extend `tests/core-integration.test.js` and add spatial assembly tests as needed.

Tasks:
- Register the new services with explicit dependency declarations.
- Expose stable service IDs through the runtime context.
- Register persistence participants in a documented order.
- Verify service teardown does not leave listeners, indexes or world references alive.
- Keep Engine import direction clean: Engine must not import Cassandra or Dev Lab.
- Ensure worlds without grid capability continue to work with existing Core behavior.

**Exit criteria:**
- Core can start with spatial capability available.
- Existing non-spatial Engine hosts remain compatible.
- Persistence round trips work through the actual Core assembly.
- No circular dependencies or application imports enter Engine.

### Slice 7 — Cassandra integration

**Status:** Main World grid/Unit integration, Main + Temporary World session, Unit identity projection and persistence, Change Package/Change Buffer protocol and candidate IndexedDB CAS backend are implemented on `work`; authoritative campaign domain operations, full expedition workflow, backend browser verification and final acceptance remain outstanding.

**Implemented initial sub-slice:**
- Cassandra's 64×64, 128×128 and 256×256 selectable Main Worlds explicitly declare matching Engine grid capabilities.
- `src/gameplay/unit/unit-system.js` routes grid placement, cell transitions and retirement through Placement Coordinator and Spatial Movement.
- Unit domain state now owns continuous movement progress separately from Engine's discrete grid anchor. The initial tile `(x,y)` starts at world-space cell center `(x+0.5,y+0.5)`; occupancy advances only when the progress crosses a cell boundary.
- Unit snapshot schema is version 2 and persists continuous progress. Old Unit snapshot schema versions are rejected; this is consistent with Cassandra's no-general-backward-compatibility policy.
- `src/gameplay/colony/colony-control-system.js` continues to own the 4 tiles/second movement speed and diagonal normalization, but now advances Unit progress rather than mutating Engine placement coordinates directly.
- The current Cassandra movement policy explicitly accepts valid grid transitions, preserving the prototype's existing lack of blocking/collision rules. This is a Cassandra-owned policy seam, not a claim that passability/collision gameplay is implemented.
- `src/gameplay/world/cassandra-world-session-system.js` owns Cassandra's one-Main/one-Temporary session policy without imposing a world-count limit in Engine. It registers a Temporary World on demand, switches active participation, supports returning/re-entering, and retains the Temporary World for safe result handling rather than disposing it prematurely.
- The world-session system owns independent local simulated-time counters. The runtime schedules time against the active Main or Temporary World and commits that local delta only after the corresponding Core simulation tick succeeds; a later task/clock failure cannot advance world-local time. While Temporary is active, Main local time does not advance. Returning to Main does not add Temporary elapsed time to Main.
- Units created in a World marked `metadata.role: "temporary"` receive a scoped runtime identity (`world:<worldId>`), while Main World Units retain persistent identity. Unit restore validates the Temporary World scope.
- The `game.world-session` persistence participant restores Main/Temporary identity, active World selection and local clocks after World Registry restoration.\n- `src/gameplay/expedition/cassandra-change-package-system.js` now defines canonical SHA-256 package envelopes, versioned location provenance, per-aggregate baseline checks, typed operation dependencies, explicit return dispositions, durable pending Change Buffer staging with a separately hashed expedition checkpoint, detached Candidate State construction, exact resultKey-to-campaign-ID mapping with its own digest, Major State/aggregate revision increments, an Applied ledger and idempotent retry behavior. No-op outcome packages are also supported.\n- `src/gameplay/expedition/cassandra-expedition-projection.js` now records one-to-one persistent campaign entity ↔ Temporary World scoped runtime identity mappings, validates Engine identity/scope/kind, supports snapshot restore and requires exactly one return-manifest disposition for every mapped persistent entity.\n- `src/gameplay/expedition/cassandra-unit-expedition-projection.js` now creates actual Temporary World Unit instances through the existing Unit API, maps them back to persistent campaign Units and rolls back partial batch creation on failure. Current projection copies only the modeled definition and grid-cell position.\n- `src/gameplay/expedition/cassandra-expedition-projection-system.js` is now composed into the Cassandra runtime and persists the mapping at participant order 30, after Unit and World Session restoration; the integration test removes projected Units and confirms persistence restore reconstructs both their Engine identities and mapping.\n- The coordinator requires a whole-campaign-snapshot atomic storage adapter and a Cassandra manifest reconciliation callback. It intentionally rejects the current `dev-lab-workspace` `.cass` adapter; no false atomicity is claimed. A candidate browser adapter now stores the whole campaign snapshot in one IndexedDB record under a strict-durability readwrite transaction with same-transaction compare-and-swap revisions, preventing cross-tab lost updates; actual target-browser durability/recovery verification remains open.
- Shared viewport marker and camera-follow APIs now consume world-space positions directly. The extra `+0.5` presentation offset is removed; Dev Lab test markers supply cell centers explicitly.
- Unit inspection distinguishes integer grid cell coordinates from continuous movement progress.

**Verification coverage added/updated (automated execution may run during implementation; user-led acceptance remains deferred):**
- Unit creation, discrete occupancy, within-cell progress, cell-boundary crossing, fractional-progress save/restore, edge clamping, policy rejection, non-grid compatibility, multi-world occupancy isolation and Temporary World scoped-identity restore.
- Colony movement speed, cardinal movement, diagonal normalization, Draft gating, active-world gating and persistence.
- Main/Temporary World session lifecycle, single-temporary constraint, independent local clocks, Main-time pause, return behavior, world-session persistence restore and no local-time commit after a failed scheduler step.

**Remaining:** Full participation gating for future Cassandra simulation systems; extend Unit projection beyond currently modeled definition/position and add shuttle/other persistent-entity projections; authoritative campaign aggregate models; production browser verification/integration of the IndexedDB campaign adapter; typed domain operation handlers and full conservation/reconciliation rules; expedition creation/End/Abandon workflow; safe Temporary World disposal after package commit; and environment/world-generation integration when authoritative modules exist. The current branch still has no authoritative environment, world-generation or expedition gameplay modules to integrate.

**Target area:** Existing Cassandra application/gameplay modules, exact paths to be confirmed by the required source audit in Slice 0.

Tasks:
- Add explicit grid capability to Cassandra Main World and Temporary Worlds.
- Preserve the expected 128×128 and 256×256 world sizes without imposing those sizes in Engine.
- Map existing Cassandra structures, environment, pawns, items, projectiles and other spatial data into the generic composition model according to Cassandra-owned semantics.
- Integrate the current Unit/Colony Control movement path through a Cassandra adapter. Define how fractional movement progress maps to discrete committed grid anchors and presentation interpolation; preserve Cassandra-owned speed, diagonal normalization and input rules.
- Update viewport marker/camera coordinate consumers so the approved cell-center convention is applied exactly once.
- Preserve current environment simulation rules and test outcomes.
- Keep Main World pause/resume during expeditions as Cassandra policy.
- Keep expedition creation, identity mapping, result/change package, validation and commit semantics in Cassandra unless a separately approved generic Engine contract is defined.
- Do not implement a cross-world transfer by simply moving a pawn's Engine placement record; expedition transfer and returning a change package are a separate domain workflow.

**Exit criteria:**
- Main and Temporary Worlds can coexist with their own independent spatial state.
- Existing Unit/Colony Control gameplay tests pass or are deliberately updated for the approved grid movement contract.
- Environment/world-generation/expedition regression gates are added only when those systems and their authoritative source/tests exist; their absence in the current branch is recorded, not guessed.
- A temporary encounter does not mutate unrelated Main World state while the Main World is paused.
- Expedition results apply only the intended changes, once the separate transfer protocol is specified and implemented.
- 128×128 and 256×256 worlds behave correctly.

### Slice 8 — Dev Lab inspection and test integration

**Status:** Implemented on `work`; automated standalone Dev Lab vs Cassandra-hosted Engine spatial acceptance now verifies identical authoritative Core contracts and placement/query behavior.

**Implemented initial sub-slice:**
- `dev-lab/application/create-dev-lab-runtime.js` continues to compose the shared Engine Core runtime; no parallel spatial model was added.
- `dev-lab/application/application-shell.js` resolves the Engine Spatial Composition, Spatial Movement, Placement Coordinator and Entity Registry services from the runtime context.
- Dev Lab's 64×64, 128×128 and 256×256 worlds now declare explicit Engine grid capabilities matching their dimensions.
- `dev-lab/application/spatial-inspector.js` provides read-only adapters over `SpatialComposition.queryCell`, `queryNeighbors`, `queryRadius` and `getEntityFootprint`.
- `shared/presentation/world-viewport.js` reports the clicked grid cell while paused; the Dev Lab panel displays that cell's contents and entity occupancy.
- The inspector exposes four-way/eight-way neighbor queries, Manhattan/Chebyshev radius queries and selected-entity footprint inspection through the same Engine service.
- `tests/unit/dev-lab-spatial-inspector.test.js` covers empty-cell inspection, invalid coordinates, neighbor/radius queries, authoritative footprint reads and the shared Engine API boundary.
- `dev-lab/application/spatial-test-controller.js` creates and retires test entities through Entity Registry and Placement Coordinator, and moves them through Engine Spatial Movement with a Dev Lab-owned overlap policy.
- Dev Lab can spawn 1×1 and 2×2 test footprints, select a test entity, enter move mode, click a target cell, and see moved/rejected outcomes. Occupied footprints are visualized in the viewport; rejected moves highlight the exact overlapping cells and expose overlapping entity IDs plus source/target diagnostics; bounded movement history is inspectable; reset retires disposable test entities and clears history; restored saves rebuild markers and clear stale UI selection.
- Spawn and move reject occupied cells; test entities remain distinguishable from host-owned game entities and cannot be mutated through the test controller.
- `tests/unit/spatial-test-controller.test.js` covers spawn, multi-cell occupancy, spawn/movement overlap rejection, movement diagnostics, retirement, reset cleanup and authority boundaries.
- `.github/workflows/core-tests.yml` syntax-checks the updated viewport and Dev Lab spatial modules; both new test files are included by the existing `tests/unit/*.test.js` command.

**Remaining non-automated check:** browser-level interaction/layout review. Shared Engine behavior under standalone Dev Lab and Cassandra host is covered by automated integration acceptance. The current test tools intentionally use a small explicit Dev Lab collision policy and do not define Cassandra passability or gameplay movement rules.

**Target area:** `dev-lab/application/application-shell.js`, `dev-lab/application/spatial-inspector.js`, `dev-lab/application/spatial-test-controller.js`, `shared/presentation/world-viewport.js` and the existing Dev Lab presentation styles.

Tasks:
- Expose grid dimensions and coordinate inspection.
- Inspect cell contents by category/layer and entity occupancy/footprints.
- Visualize query results and geometric overlaps.
- Provide controlled movement attempts using the same Engine API and a neutral/test host policy.
- Show rejected move reasons without inventing Cassandra-specific rules.
- Ensure Dev Lab does not maintain a parallel spatial store.

**Exit criteria:**
- Dev Lab can create reproducible spatial scenarios and inspect the authoritative Engine result.
- Spatial overlays are read-only presentation.
- Standalone Dev Lab and Cassandra-hosted Dev Lab remain application-separated according to the application-boundary contract.

### Slice 9 — End-to-end acceptance and release gate

**Status:** Automated Core and host suites pass on `work` (205/205 Core, 228/228 host at the latest confirmed run). Multi-world occupancy, Main/Temporary clock behavior, Unit/projection persistence, package retries/CAS, unsupported historical save rejection and Dev Lab/Cassandra host parity have automated coverage. Browser-specific IndexedDB durability, UI interaction/layout, 128×128/256×256 performance measurements and any environment simulation not present in this branch remain open verification items.

Tasks:
- Run all existing Core/application tests plus current-format save tests and safe-rejection tests for unsupported historical `.cass` versions.
- Run all new geometry, composition, query, movement and persistence tests.
- Run multi-world integration scenarios.
- Verify Main World pause/Temporary World simulation/return behavior.
- Verify a failed world or failed movement policy does not corrupt another world's spatial state.
- Verify save/load at each supported lifecycle boundary.
- Review performance at representative 128×128 and 256×256 world sizes; optimize only when measurements show a need.
- Update architecture docs and application integration docs to match the final implementation.

**Exit criteria:**
- Every agreed acceptance scenario is covered by an automated test or an explicitly documented manual test.
- No known regression in existing save/load, environment simulation or current game behavior.
- No unapproved source scope, broad refactor or merge.
- The user reviews the completed implementation and explicitly authorizes any merge to `main`.

## 4. Proposed new test layout

The repository currently has both root-level tests and a `tests/unit/` directory. To keep the new tests discoverable and consistent with the current unit suite, the initial proposal is:

- `tests/unit/grid-geometry.test.js`
- `tests/unit/spatial-composition.test.js`
- `tests/unit/spatial-query.test.js`
- `tests/unit/spatial-movement.test.js`
- `tests/unit/spatial-persistence.test.js`

Integration coverage should extend:
- `tests/core-integration.test.js`
- `tests/lifecycle-bootstrap.test.js`
- Relevant Cassandra integration tests, after exact existing paths are audited.

A separate `tests/spatial/` folder is an alternative if the suite grows substantially. This is a repository organization detail, not a reason to block the design.

## 5. Dependency and initialization order

Recommended dependency graph:

```text
World Registry ───────┐
                      ├──> Spatial Composition ───> Spatial Movement
Entity Registry ──────┘             │
                                    └── owns read-only Spatial Queries

Grid Geometry
  └── pure validation/conversion/neighborhood primitives used by Spatial Composition

Persistence
  └── registers World Registry, Entity Registry, World Context and Spatial Composition
      in an explicit dependency-safe restore order

Cassandra
  └── supplies grid descriptors, content categories, placement/movement policies,
      environment and expedition rules

Dev Lab / Presentation
  └── consume the same spatial APIs; never own authoritative occupancy
```

This is a conceptual dependency graph. Exact bootstrap service IDs and participant order must be finalized against the actual restore dependency behavior before implementation.

## 6. Test strategy and compatibility gates

### 6.1 Unit tests

- Grid geometry: dimensions, integer coordinates, bounds, conversion, neighbors and distances.
- Composition: sparse cells, stable IDs, multiple contents, multi-cell footprints, orientation, index consistency, atomic updates and invalid references.
- Queries: filters, region intersection, deduplication, deterministic ordering, bounds/lifecycle errors, immutable results and no side effects.
- Movement: full-footprint relocation, policy acceptance/rejection, atomicity, bounds and overlap facts.
- Persistence: snapshot schema, validation, migrations, restore preparation, commit/rollback and deterministic index rebuild.

### 6.2 Integration tests

- Core service registration and teardown.
- Entity/World reference validation during restore.
- Spatial participant restore ordering and rollback after injected failures.
- Non-grid World compatibility.
- Multiple grid Worlds existing simultaneously.
- Independent world lifecycle and no implicit activation/loading from queries.
- Main World paused while Temporary World simulation proceeds.
- Temporary World result handling without wholesale replacement of Main World state, after Step 7's transfer protocol is designed.

### 6.3 Save compatibility

- Version the `.cass` envelope and inner schemas explicitly.
- No backward compatibility promise for prior game versions; unsupported historical versions may be rejected.
- Maintain representative fixtures for currently supported formats and any specifically supported migration path.
- Test clean rejection of unsupported versions and verify the source file/runtime remain unchanged.
- Verify that spatial snapshot introduction cannot silently erase or reinterpret existing Cassandra map/environment data.
- Treat migration failure as a failed load; do not partially commit registries or spatial state.

### 6.4 Protected regression area

The following are explicit regression boundaries:
- Environment simulation rules and their established behavior.
- GameClock and SimulationScheduler semantics.
- Existing pawn/unit gameplay and input behavior until audited.
- Existing Cassandra world generation and map state.
- Existing `.cass` save/load behavior.
- Dev Lab application isolation and Engine import direction.

## 7. Explicit initial scope exclusions

Unless a separate requirement is established, the implementation plan does not include:

- Pathfinding, navigation meshes or AI perception.
- Continuous physics, velocity or collision response.
- Universal passability, buildability, visibility or interaction rules.
- Automatic background simulation of inactive worlds.
- A fixed maximum number of Engine Worlds.
- A fixed maximum number of contents/layers/categories.
- Forced grid capability for every World.
- A general-purpose chunking/streaming system before performance evidence.
- Cross-save compatibility between Cassandra and Dev Lab.
- A cross-world transfer shortcut that bypasses Cassandra's expedition result/change-package workflow.
- Refactoring or rewriting tested environment simulation.

## 8. Blocking design questions before implementation

These are genuine architecture dependencies, not routine implementation details. They must be resolved in the design review before the affected slices begin.

### 8.1 Authority for entity placement in grid Worlds

**Agreed direction (2026-11-15):**
- World Context remains the authority for an entity's world placement or storage placement, including the world/store relationship already represented by its placement record.
- Spatial Composition is authoritative for grid-specific anchor, canonical footprint, orientation and occupied-cell indexes.
- These are complementary responsibilities, not two competing complete placement models.
- A grid-backed entity placement or relocation is one coordinated transaction. Both representations must commit together, or neither may change.
- Callers must not mutate either representation independently in a way that can desynchronize them.
- Non-grid world placement and storage placement continue to use World Context without requiring grid occupancy.

The approved grid-anchor-to-cell-center conversion, transaction coordinator boundary and restore ordering are specified in `spatial-placement-integration-contract-proposal.md`. The agreed ownership model and coordinate mapping are settled; exact API names and implementation details remain proposals.

**Decision status:** Resolved. No further authority-model decision is required.

### 8.2 Grid descriptor ownership

**Agreed direction (2026-11-15):**
- The optional grid descriptor is owned by the World Registry descriptor.
- Grid capability is explicit; existing world dimensions alone must never imply grid support.
- A World without a grid remains valid and behaves as a non-grid World.
- The descriptor contains the grid's immutable positive-integer width and height, distinct from any existing general world-bounds dimensions unless source review demonstrates they already have exactly the same contract.
- World Registry owns the capability declaration and its lifecycle/persistence. Grid Geometry validates and interprets its geometry; Spatial Composition consumes it for cell contents and occupancy.
- Adding or changing grid capability after World creation is not part of the initial contract. Grid dimensions are fixed for the lifetime of that World.

The descriptor shape, validation and snapshot details remain technical proposals in `grid-geometry-contract-proposal.md`; this ownership decision is resolved.

### 8.3 Temporary-world result/change package

**Agreed concept (recorded in the Phase 3 brainstorm):**
- Temporary World returns a delta/change package.
- Main World state is updated as previous state plus validated changes, not replaced wholesale.
- Cassandra owns expedition semantics and the meaning of returned changes.

**Approved implementation contract:** `cassandra-temporary-world-change-package-contract-proposal.md`

The proposal specifies:
- Separate persistent campaign state, persistent location records and Temporary World runtime state.
- A player-entitlement invariant: every result owed to the player has an explicit, auditable disposition and must survive identity mapping, persistence, retry and recovery failures.
- A reconciled return manifest for items, resources, participants and rewards; unknown or unmapped entries block the whole commit rather than being silently dropped.
- A two-state staging model: preserve the last-known-good Major State, retain expedition changes in a durable Change Buffer, build and validate an isolated Candidate State, and atomically promote it only after all invariants pass.
- Approved implementation defaults for a canonical package envelope, per-aggregate revisions, typed operations, package-local result identities, explicit conservation manifest, SHA-256 canonical digest, Applied ledger and single atomic campaign-save promotion. The first protocol/coordinator foundation and focused unit tests now exist on `work`.
- On entitlement/identity/conservation integrity failure, do not commit a partial result; roll back to the expedition-start checkpoint and reset/restore the complete expedition. Transient commit failures retain the Change Buffer and retry from the unchanged Major State.
- Campaign identity to encounter-runtime identity projection mapping; no simultaneous duplicate Engine placement for one entity.
- Typed Cassandra domain operations, baseline revisions/preconditions and all-or-nothing package application.
- Immutable, versioned and durably retained pending packages.
- Idempotent application ledger and recovery after interruption.
- Separate End Expedition and Abandon outcomes, final encounter consequences, Clear/Not Clear, resource extraction and location persistence.

**Still requires review/decision:**
- Detailed entity projection/return eligibility and disposition rules.
- Exact frozen Temporary World recovery checkpoint size/content.
- Candidate IndexedDB whole-snapshot backend exists; target-browser strict-durability and crash/reopen verification plus production integration remain required.
- Per-location persistence policy and user-facing conflict resolution.

**Gate:** Cassandra expedition integration (Slice 7) remains blocked until the contract is reviewed and the remaining consequential details are resolved. Isolated Engine geometry/composition work is not blocked by this Cassandra-specific protocol.

### 8.4 Save compatibility and legacy spatial state

**Source-audited findings (2026-11-15):**
- Current outer `.cass` envelope is `cassandra.save`, fileFormatVersion 1; inner Engine Persistence formatVersion is independently versioned and currently 1.
- The current shell uses slot `dev-lab-workspace` and state ID `cassandra-dev-lab-workspace`. This is a Dev Lab/workspace save path, not a complete future Cassandra campaign save.
- Core participants: Entity Registry schema 2 (v1 migration), World Registry schema 2 (v1 migration), World Context schema 1 (no migration).
- Current runtime participants: Unit schema 1 and Colony Control schema 1.
- Engine Persistence rejects missing required snapshots. Participant migration cannot synthesize a snapshot when the participant is absent from the save.
- The current audited runtime does not register a persistent environment/map/world-generation participant. No current workspace save proves compatibility for a full colony environment or campaign.

**Working contract drafted:** `cass-save-compatibility-migration-proposal.md`

The proposal specifies:
- Separate outer file, inner Engine, participant and Cassandra campaign version dimensions.
- Explicit separation of current Dev Lab/workspace saves from future Cassandra campaign saves; no cross-save conversion.
- An application-owned preflight migration for detached legacy data before Engine restore.
- No empty Spatial Composition snapshot unless a domain migration proves the world is truly empty.
- Explicit coordinate conversion, environment/map ownership audit, source-file preservation and golden fixtures.
- Failure behavior that rejects unprovable migration rather than silently losing or inventing data.

**Still requires review/decision:**
- Exact application preflight integration point and future campaign save identity/schema.
- Actual legacy Cassandra campaign/map/environment persistence source and representative fixtures.
- Coordinate conversion rules for each legacy spatial source.
- Platform-specific atomic replacement/backup guarantees and migration UI flow.

**Gate:** Persistence integration (Slice 5) remains blocked until the supported-format policy, actual current save sources and representative fixtures are reviewed and accepted. A universal legacy migration strategy is not a prerequisite.

## 9. Review checkpoints

| Checkpoint | Required review |
|---|---|
| C0 — Scoped design closure | Per-slice contracts closed before execution; downstream design gates remain separate; explicit user authorization required for each implementation scope |
| C1 — Geometry | **Passed 2026-11-15** — pure geometry and explicit World Registry grid capability; full Core/host CI green; existing placement semantics untouched |
| C2 — Composition | **Passed 2026-11-15** — sparse content, footprints, occupancy, Placement Coordinator and composite persistence implemented; full CI green |
| C3 — Queries | **Passed 2026-11-15** — read-only queries, deterministic ordering and immutable results; full Core/host CI green |
| C4 — Movement | **Passed 2026-11-15** — host-policy transaction, atomic placement commit and mutation guards; full Core/host CI green |
| C5 — Persistence | Current supported-save fixtures, explicit unsupported-version rejection, snapshot/restore ordering and rollback |
| C6 — Core integration | Service registration, dependency order and non-grid compatibility |
| C7 — Cassandra | Existing gameplay/environment regressions and expedition workflow |
| C8 — Dev Lab | Shared API usage and application boundary |
| C9 — Final acceptance | Full regression suite, integrated acceptance matrix, supported-save behavior, review and explicit merge decision |

A failed checkpoint stops only the dependent sequence. It does not authorize a broad rewrite or unrelated refactor.

## 10. Files intended to remain untouched initially

Unless an implementation dependency is demonstrated and separately approved, the initial spatial slices should not modify:

- `engine/core/game-clock.js`
- `engine/core/simulation-scheduler.js`
- Existing environment simulation modules and rules.
- Existing Cassandra Pawn/Unit movement implementation before audit.
- Existing Cassandra world-generation rules before audit.
- Existing Dev Lab application-specific persistence or save formats.
- Shared presentation/viewport authority boundaries.
- Unrelated UI, input, audio or rendering systems.

Any proposed exception must identify the concrete dependency and the smallest required change before editing.

## 11. Current readiness assessment

**Integration audit:** Completed in [`phase-3-integration-audit.md`](phase-3-integration-audit.md). No fundamental cross-contract ownership or lifecycle contradiction was found. The audit consolidates the Step 9 acceptance matrix and Step 10 dependency order.

**Ready for detailed implementation review:** Grid Geometry, Spatial Composition, Spatial Queries, Movement & Collision and the cross-contract responsibility boundaries.

**Still requires implementation-level closure:** Placement Coordinator mechanics; exact composite placement participant schema, fatal rollback behavior and supported-save fixture matrix; Cassandra campaign save identity and authoritative state participants; durable Change Buffer/Applied ledger and atomic promotion against the target storage backend; final typed package operation schemas; and the source audit of future environment, world-generation and expedition paths when those systems are present. Unit/Colony Control movement and viewport integration paths have already been inspected.

**Compatibility policy:** Backward compatibility with arbitrary old `.cass` versions is not required. Unsupported versions may be rejected safely; selected migrations are optional and explicitly version-scoped.

**Current action:** Slices 1, 1b, 2a/2b, 3 and 4 are implemented and CI-verified on `work`. Next proposed work is Slice 5 — persistence and restore integration — which remains a separate scope and requires explicit authorization. No PR merge or `main` update is implied.



## Slice 2b implementation checkpoint

- Placement Coordinator and composite persistence participant implemented on `work`.
- Grid placement authority is enforced through an internal Engine capability; direct one-sided mutation and restore are rejected.
- If a coordinated rollback itself fails, Placement Coordinator enters a fatal integrity state and Core pauses the Game Clock through `core.placement-integrity-fault`.
- Composite snapshots persist WorldContext and Spatial Composition together; derived cell indexes are rebuilt on restore.
- Cassandra Unit/Colony Control movement, viewport interpolation, environment simulation and world generation were not changed.


## Slice 3 implementation checkpoint

- Added deterministic, read-only cell, bounded-region, explicit-cell-set, entity-region, footprint, neighbor and radius query APIs.
- Entity-kind filtering uses Entity Registry metadata supplied by Core Assembly; category/layer filters remain scoped to cell-associated content.
- Region queries use sparse authoritative content/occupancy records and report only occupied cells; untouched cells remain implicit.
- Added focused tests for ordering, filters, deduplication, matched cells, bounds, invalid regions, topology/metrics, immutable results and snapshot non-mutation.
- No Cassandra movement, environment simulation, world generation, Dev Lab or persistence schema was changed.
- Final CI verification is pending.


## Slice 4 implementation checkpoint

- Added `SpatialMovement` as a small Engine service and registered it as `core.spatial-movement`.
- Host movement policy is supplied per move; Engine has no default passability or overlap decision.
- The service derives target footprint cells, gathers cell contents and geometric overlaps, evaluates the synchronous policy, then commits through Placement Coordinator.
- Added focused movement tests for acceptance, rejection, bounds, overlap, rotation, cross-world relocation, same-position and policy failure behavior.
- Cassandra Pawn/Unit movement, input, speed, interpolation, environment simulation, world generation and Dev Lab were not changed.
- Final CI verification is pending.


## Slice 4 verification checkpoint

- Final CI run: `43749324541` — [GitHub Actions](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43749324541)
- Core tests: 205/205 passed.
- Host tests: 175/175 passed.
- Browser entry-point syntax check: passed.
- No Cassandra Pawn/Unit movement, speed, input, viewport interpolation, passability, environment simulation or collision consequences were changed.
