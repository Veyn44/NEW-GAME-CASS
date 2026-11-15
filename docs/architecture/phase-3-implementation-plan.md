# Phase 3 Physical World — Implementation Plan

**Status:** Working implementation plan; sequencing and file targets proposed, not approved for execution  
**Branch:** `work`  
**Source audit:** 2026-11-15  
**Scope:** Implementation sequencing for reusable Engine grid/spatial capabilities and their Cassandra/Dev Lab integration

This plan translates the current Phase 3 design material into an implementation sequence. It is a planning artifact only. It does not authorize source/runtime changes, a merge, or a change to existing game behavior.

The Phase 3 brainstorm explicitly requires the complete design to be reviewed and approved before implementation begins. Several topics in Steps 7–9 remain open; this plan makes those dependencies visible instead of treating them as already decided.

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

### 1.3 Source-audit limitation

GitHub code search did not return indexed Cassandra movement implementation files. The plan therefore does not assume the current Pawn movement implementation or propose replacing it. Before Cassandra integration, locate and inspect the exact movement, world-generation, save/load and environment-system files and their tests on the working branch.

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
4. Locate the actual Cassandra movement, environment, world-generation, save/load and temporary-world/expedition code and tests.
5. Record current supported `.cass` format/fixture coverage and expected rejection behavior for unsupported historical versions before adding spatial snapshots.
6. Run and record the existing Core and application test suites on the untouched baseline.

**Exit criteria:**
- No unresolved architectural choice blocks the first implementation slice.
- Current-format save behavior and safe rejection of unsupported historical formats have a concrete test/fixture strategy; legacy migration fixtures are required only for explicitly supported migration paths.
- Existing environment simulation behavior is covered by regression tests.
- The full design is explicitly approved before code work begins.

**No source changes in this slice.**

### Slice 1 — Grid Geometry primitives

**Proposed files:**
- Add `engine/spatial/grid-geometry.js`.
- Add `tests/unit/grid-geometry.test.js` (or the repository's agreed spatial test folder).
- Update `engine/spatial/README.md` only if the directory is created in this slice.

Tasks:
- Validate optional grid descriptors with positive safe-integer width/height.
- Validate integer cell coordinates and half-open bounds.
- Provide explicit world-position-to-cell conversion using floor semantics.
- Provide cell-center conversion.
- Provide 4-way and 8-way neighbor enumeration with no wrapping.
- Provide Manhattan and Chebyshev distance helpers.
- Keep non-grid Worlds valid and do not reinterpret World Registry dimensions.

**Exit criteria:**
- Geometry tests cover valid/invalid dimensions, integer/fractional coordinates, edges, rectangular grids, coordinate conversion, neighbors and distance metrics.
- No cell contents, occupancy or game rules are introduced.
- Existing World Registry and World Context tests remain unchanged and pass.

### Slice 2 — Spatial Composition storage and occupancy

**Proposed files:**
- Add `engine/spatial/spatial-composition.js`.
- Add `tests/unit/spatial-composition.test.js`.

Tasks:
- Implement sparse storage for explicit cell-associated contents.
- Support stable content IDs, opaque host payloads, category IDs and optional layer IDs.
- Support entity-backed occupancy referencing Entity Registry IDs.
- Represent footprints as non-empty sets of integer offsets from an anchor, including the agreed orientation rules.
- Maintain entity-to-footprint and cell-to-content/occupancy lookup paths.
- Validate world/grid availability, entity references and complete footprint bounds before commit.
- Support atomic insert, update, move and removal of occupancy records.
- Remove sparse entries when their last explicit content is removed.
- Keep entity identity and domain state outside the spatial service.
- Keep overlap legality host-defined; geometric overlap facts alone do not reject placement unless a supplied policy says so.

**Exit criteria:**
- Multiple contents and multiple entities can coexist at one coordinate where host policy permits.
- Multi-cell entity identity is not duplicated.
- Invalid footprint operations leave prior authoritative state unchanged.
- Indexes agree in both directions after every committed mutation.
- Sparse empty cells are not materialized.
- Deterministic snapshot capture is possible.

### Slice 3 — Spatial Query surface

**Proposed files:**
- Extend `engine/spatial/spatial-composition.js` with read-only query methods.
- Add `tests/unit/spatial-query.test.js`.

Tasks:
- Implement cell, bounded region, explicit cell-set, entity occupancy, footprint, neighbor and radius queries.
- Support explicit category/layer/entity-kind filters without conflating them.
- Deduplicate entity-oriented results by entity ID.
- Distinguish empty success from invalid request, out-of-bounds, non-grid, unknown-world and unavailable-world outcomes.
- Use deterministic row-major cell order and stable ID ordering.
- Return immutable/defensively copied results.
- Ensure queries do not materialize cells, load worlds or mutate gameplay state.

**Exit criteria:**
- Spatial Query acceptance scenarios pass.
- Query results are consistent with occupancy indexes.
- Querying a stale result never acts as a reservation for a later move.
- Local queries use spatial indexes rather than scanning the entire Entity Registry.

### Slice 4 — Generic Movement transaction

**Proposed files:**
- Add `engine/spatial/spatial-movement.js`.
- Add `tests/unit/spatial-movement.test.js`.

Tasks:
- Accept an entity, target world, target anchor and target orientation.
- Derive and validate the full target footprint.
- Gather geometric overlaps and cell-associated contents through Spatial Composition queries.
- Invoke a host-supplied, deterministic, side-effect-free policy.
- Commit the complete footprint atomically only after validation and policy acceptance.
- Return stable moved/rejected/invalid/out-of-bounds/unavailable outcomes.
- Keep damage, knockback, speed, movement cadence, input, pathfinding, passability semantics and all gameplay consequences outside Engine.

**Exit criteria:**
- Accepted moves replace the complete footprint atomically.
- Rejected or invalid moves preserve the previous occupancy.
- Policy cannot mutate the index during evaluation.
- Multi-cell moves, rotation, bounds, overlap, same-position and failure cases are covered.
- Existing Cassandra pawn movement is not replaced until its implementation is audited and an explicit integration adapter is designed.

### Slice 5 — Persistence and restore integration

**Proposed files:**
- Extend `engine/spatial/spatial-composition.js` with a persistence participant.
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
- Define explicit rejection or an intentionally supported, version-scoped migration for saves that predate the spatial participant.
- Preserve existing `.cass` envelopes, metadata and application-specific state contracts.
- Never interpret an absent spatial snapshot as empty by default. Reject the save unless a deliberately supported migration can derive the spatial state from authoritative legacy data.

**Exit criteria:**
- Save/load round trips preserve all authoritative spatial records.
- Invalid snapshots fail without leaving partially restored spatial state.
- Cross-participant failure rolls back earlier commits.
- Existing `.cass` fixtures still load and preserve their prior behavior.
- New saves can be reopened and spatial indexes rebuilt deterministically.

### Slice 6 — Runtime assembly and Core integration

**Proposed files:**
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

**Target area:** Existing Cassandra application/gameplay modules, exact paths to be confirmed by the required source audit in Slice 0.

Tasks:
- Add explicit grid capability to Cassandra Main World and Temporary Worlds.
- Preserve the expected 128×128 and 256×256 world sizes without imposing those sizes in Engine.
- Map existing Cassandra structures, environment, pawns, items, projectiles and other spatial data into the generic composition model according to Cassandra-owned semantics.
- Integrate the existing movement implementation through a Cassandra policy/adapter rather than replacing it wholesale.
- Preserve current environment simulation rules and test outcomes.
- Keep Main World pause/resume during expeditions as Cassandra policy.
- Keep expedition creation, identity mapping, result/change package, validation and commit semantics in Cassandra unless a separately approved generic Engine contract is defined.
- Do not implement a cross-world transfer by simply moving a pawn's Engine placement record; expedition transfer and returning a change package are a separate domain workflow.

**Exit criteria:**
- Main and Temporary Worlds can coexist with their own independent spatial state.
- Existing Cassandra environment and gameplay regression tests pass.
- A temporary encounter does not mutate unrelated Main World state while the Main World is paused.
- Expedition results apply only the intended changes, once the separate transfer protocol is specified and implemented.
- 128×128 and 256×256 worlds behave correctly.

### Slice 8 — Dev Lab inspection and test integration

**Target area:** Existing Dev Lab application/presentation modules; exact paths to be confirmed from current source before edits.

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

The integration mechanics, conversion between grid anchors and World Context world-space positions, transaction coordinator boundary, and restore ordering are specified as a focused working contract in `spatial-placement-integration-contract-proposal.md`. The agreed ownership model is settled; exact API names and implementation details remain proposals.

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

**Working contract drafted:** `cassandra-temporary-world-change-package-contract-proposal.md`

The proposal specifies:
- Separate persistent campaign state, persistent location records and Temporary World runtime state.
- A player-entitlement invariant: every result owed to the player has an explicit, auditable disposition and must survive identity mapping, persistence, retry and recovery failures.
- A reconciled return manifest for items, resources, participants and rewards; unknown or unmapped entries block the whole commit rather than being silently dropped.
- A two-state staging model: preserve the last-known-good Major State, retain expedition changes in a durable Change Buffer, build and validate an isolated Candidate State, and atomically promote it only after all invariants pass.
- On entitlement/identity/conservation integrity failure, do not commit a partial result; roll back to the expedition-start checkpoint and reset/restore the complete expedition. Transient commit failures retain the Change Buffer and retry from the unchanged Major State.
- Campaign identity to encounter-runtime identity projection mapping; no simultaneous duplicate Engine placement for one entity.
- Typed Cassandra domain operations, baseline revisions/preconditions and all-or-nothing package application.
- Immutable, versioned and durably retained pending packages.
- Idempotent application ledger and recovery after interruption.
- Separate End Expedition and Abandon outcomes, final encounter consequences, Clear/Not Clear, resource extraction and location persistence.

**Still requires review/decision:**
- Exact package schema/operation types and aggregate revision model.
- Detailed entity projection/return eligibility and disposition rules.
- Recovery checkpoint strategy and transaction coordinator integration.
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
| C0 — Design closure | Phase 3 Steps 1–10 reviewed; blocking questions resolved; explicit implementation approval |
| C1 — Geometry | Grid descriptor and geometry tests; no changes to existing placement semantics |
| C2 — Composition | Ownership, footprints, overlap facts, atomic occupancy and sparse storage |
| C3 — Queries | Read-only behavior, deterministic results, lifecycle and bounds outcomes |
| C4 — Movement | Host policy boundary and atomic move results |
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

**Still requires implementation-level closure:** Placement Coordinator mechanics; exact persistence participant/restore ordering and supported-save fixture matrix; Cassandra campaign save identity and authoritative state participants; durable Change Buffer/Applied ledger and atomic promotion against the target storage backend; final typed package operation schemas; and the source audit of actual Cassandra movement, environment, world-generation and expedition paths.

**Compatibility policy:** Backward compatibility with arbitrary old `.cass` versions is not required. Unsupported versions may be rejected safely; selected migrations are optional and explicitly version-scoped.

**Current action:** Document and review only. No source/runtime code changes are authorized by this plan. No PR merge or `main` update is implied.

