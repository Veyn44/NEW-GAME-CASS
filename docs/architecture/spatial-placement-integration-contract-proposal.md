# Spatial Placement Integration Contract — Working Proposal

> **Post-merge status (2026-11-16):** The Engine grid-placement coordinator and composite persistence participant described here are included in `main` through PR #7. Exact merge-commit Core/Host CI passed in [run 43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950). Cassandra domain integration remains separately scoped; see [current-implementation-status.md](current-implementation-status.md).

**Status:** Engine grid placement coordination and composite restore implemented and merged; Cassandra domain integration remains separate.  
**Integrated branch:** `main`  
**Decision recorded:** 2026-11-15  
**Scope:** Coordinated placement between Engine Core World Context and Engine Spatial Composition

This document records the agreed placement ownership model and its implemented Engine baseline. It does not authorize unrelated Cassandra gameplay changes.

## 1. Agreed ownership

The following ownership decision is approved:

- **World Context** remains authoritative for an entity's world placement or storage placement, including its world association and the existing placement lifecycle represented by its placement record.
- **Spatial Composition** is authoritative for grid-specific placement detail: integer anchor cell, canonical footprint, orientation and derived occupied-cell indexes.
- These responsibilities are complementary. Neither service may be treated as a second complete, independently mutable placement authority.
- A grid-backed placement change is one coordinated transaction across both services. Both representations commit, or neither does.
- Non-grid world placement and storage placement continue to use World Context without requiring grid occupancy.

This contract must preserve the existing World Context behavior for non-grid worlds and storage.

## 2. Placement states

The integration distinguishes three placement cases:

| Case | World Context | Spatial Composition |
|---|---|---|
| Non-grid world placement | Authoritative world-space placement | No grid occupancy |
| Grid-backed world placement | Authoritative world association and corresponding world-space placement | Authoritative grid anchor, footprint, orientation and occupied cells |
| Storage placement | Authoritative storage placement | No active world-grid occupancy |

A grid-backed entity must never be simultaneously represented as stored and as occupying grid cells. A stored entity may retain its Entity Registry identity while having no active grid occupancy.

The contract does not require every entity in a grid world to be spatially represented. Whether an entity participates in grid occupancy is a host/application decision, subject to consistent lifecycle handling.

## 3. Coordinated transaction boundary

All operations that can change a grid-backed entity's placement must pass through one integration boundary (name illustrative: **Placement Coordinator**). Public callers must not directly update the World Context placement record and Spatial Composition occupancy separately.

The coordinator may be a thin Engine service or an explicitly assembled integration component. Its exact location and API are implementation details to settle after the existing Core assembly and service conventions are rechecked.

### 3.1 Required operation sequence

For a placement, move, rotation, footprint change, world transfer or transition to storage:

1. Resolve the entity identity and current placement from authoritative services.
2. Determine whether the operation is a non-grid, grid-backed or storage operation.
3. Validate the target world and its capabilities.
4. For a grid target, normalize the anchor, canonical footprint and orientation; derive the complete occupied-cell set.
5. Validate World Context bounds/placement constraints and Spatial Composition bounds/entity references/occupancy constraints.
6. Run the host-supplied placement policy without mutating either service.
7. Prepare both service updates without exposing partial state.
8. Commit both updates within one synchronous, non-observable transaction boundary.
9. If either commit fails, restore both services to their exact pre-operation state before returning failure.
10. Publish notifications only after both authoritative representations are consistent.

The implementation must not publish a successful result before both sides have committed.

### 3.2 Atomicity and observers

The required guarantee is logical atomicity: no public query, event listener, renderer, simulation system or persistence capture may observe a state where World Context describes the new placement while Spatial Composition still describes the old one, or vice versa.

A JavaScript implementation may achieve this with a synchronous coordinator and prepared immutable replacement structures, provided no callbacks/events are emitted between the two internal commits. If the current service design cannot guarantee this, introduce a transaction mechanism rather than weakening the guarantee.

Rollback must restore the previous complete state, not merely attempt a best-effort inverse move.

## 4. Coordinate relationship

Spatial Composition stores integer grid anchors and footprints. World Context currently stores world-space placement coordinates.

The integration must define one deterministic conversion/representation rule between the grid anchor and the World Context position. It must:

- Be stable for the lifetime of a grid world.
- Avoid lossy round-tripping or ambiguous rounding.
- Respect the established grid convention: origin at the top-left, integer cell coordinates, and cell centers at `x + 0.5, y + 0.5`.
- Keep the anchor distinct from the entity's occupied-cell set; a multi-cell footprint remains one entity placement.
- Never infer grid capability solely from existing World Context dimensions.

**Agreed direction (2026-11-15):** For every grid-backed entity, the World Context world-space position is the center of its anchor cell: `worldX = anchorX + 0.5`, `worldY = anchorY + 0.5`. The grid anchor remains an integer cell coordinate and is not the center of the complete multi-cell footprint. Non-grid world positions remain continuous and are not subject to this conversion. Implementations and restore validation must use this one deterministic mapping; they must not silently round legacy fractional positions into grid anchors.

## 5. Operation coverage

The coordinator must cover every path that can alter placement:

- Initial placement into a grid world.
- Relocation within the same grid world.
- Rotation or footprint replacement.
- Transfer from one grid world to another.
- Transfer from a non-grid world into a grid world, where explicitly supported.
- Transfer from a grid world to a non-grid world, where explicitly supported.
- Transition from a world placement to storage.
- Restoration from storage to a world placement.
- Entity removal, retirement or lifecycle changes that invalidate occupancy.

A caller must not bypass coordination by invoking a lower-level mutation API on only one side. Lower-level mutation methods should be private/internal to the coordinator or require a transaction capability that ordinary callers do not possess.

## 6. Entity lifecycle consistency

Entity Registry remains the authority for entity identity and lifecycle. Placement services reference entity IDs; they do not duplicate identity.

Required invariants:

- Every active grid occupancy references a valid, eligible Entity Registry identity.
- A removed/retired entity cannot retain active grid occupancy.
- Storing an entity removes its active grid occupancy in the same coordinated operation that updates World Context to storage.
- Restoring an entity from storage into a grid world establishes both World Context placement and Spatial Composition occupancy together.
- Removing spatial presence alone does not implicitly remove the entity identity unless the host explicitly requests the corresponding lifecycle operation.
- Entity removal and occupancy cleanup must not be independently observable.

The precise set of lifecycle statuses eligible for occupancy must follow the existing Entity Registry contract and be verified during implementation; this document does not invent new statuses.

## 7. Persistence and restore

World Context and Spatial Composition retain separate service ownership, but their authoritative placement/spatial snapshots must be restored through one composite persistence participant and one transaction boundary. See Section 14 below.

Required restore behavior:

1. Restore/validate World Registry descriptors and Entity Registry identities before validating dependent placement records.
2. Prepare World Context and Spatial Composition state without exposing either prepared state.
3. Cross-validate grid-backed entities:
   - A grid-backed World Context placement must have exactly one matching canonical Spatial Composition occupancy record.
   - A matching occupancy record must refer to an entity whose World Context placement points to the same world.
   - Anchor, orientation and footprint must derive the saved occupied cells and remain within grid bounds.
   - A stored or non-grid placement must not have active grid occupancy.
4. Reject missing, duplicate or contradictory placement representations before commit.
5. Commit both prepared states as one coordinated restore boundary, or roll back both if any participant or later restore step fails.
6. Rebuild derived occupancy indexes from canonical Spatial Composition records rather than persisting duplicate index authorities.

The source audit confirms the current Persistence coordinator prepares all participants first but commits them sequentially with an `await` between participant commits. Separate World Context and Spatial Composition participants would therefore not guarantee an unobservable atomic pair. The recommended design is one composite placement-state participant: Entity Registry and World Registry restore first, then one synchronous composite commit swaps World Context and Spatial Composition together. The existing Persistence rollback then treats the pair as one transaction if a later participant fails.

This proposal does not define legacy `.cass` migration. Under the agreed policy, old saves without spatial occupancy are rejected unless Cassandra explicitly elects to support a specific version through a Cassandra-owned migration backed by real fixtures.

## 8. Failure behavior

A failed coordinated operation must return a stable failure result and preserve the prior state in both services.

Failure classes should distinguish, at minimum:

- Unknown or lifecycle-ineligible entity.
- Unknown or unavailable world.
- Grid capability missing where required.
- Invalid anchor, footprint or orientation.
- World bounds or grid bounds violation.
- Host policy rejection.
- Inconsistent pre-existing placement state.
- Internal commit/rollback failure.

Exact result names and error codes are implementation details. A detected pre-existing mismatch is an integrity failure; the coordinator must not guess which representation to overwrite.

If rollback itself cannot restore both sides, the runtime must surface a fatal integrity fault and prevent further placement mutations or persistence capture until recovery. Silently continuing with divergent placement state is not acceptable.

## 9. Application ownership

**Engine owns:**
- The generic coordinated placement mechanism and its atomicity guarantees.
- Consistency between World Context placement and Spatial Composition occupancy.
- Generic validation, cross-service integrity checks and deterministic results.
- Generic persistence/restore coordination for its own placement records.

**Cassandra owns:**
- Which Cassandra entities participate in grid occupancy.
- Game-specific placement policy and meaning of world-space positions.
- Mapping legacy map, structures, pawns, items and environment state into the new model.
- Expedition and temporary-world result/change-package semantics.
- Gameplay consequences of placement, movement, storage, destruction or removal.

**Dev Lab owns:**
- Test scenarios and diagnostics that exercise the same Engine coordination boundary.
- No parallel placement or occupancy authority.

Presentation remains a read-only consumer and must not write either representation.

## 10. Acceptance scenarios

1. A non-grid entity placement continues to work through World Context with no Spatial Composition record.
2. A storage placement continues to work through World Context with no active grid occupancy.
3. A grid-backed entity is created with matching World Context and Spatial Composition state.
4. A successful grid move updates both representations before any observer is notified.
5. A rejected move changes neither representation.
6. A failure during the first prepared/commit phase leaves both representations unchanged.
7. A failure during the second commit restores both representations to their exact prior state.
8. A multi-cell entity has one Entity Registry identity, one World Context placement and one canonical Spatial Composition footprint record.
9. Rotation or footprint replacement updates all occupied cells atomically.
10. A transfer between grid worlds validates the target before releasing source occupancy.
11. A grid-to-storage operation removes occupancy and changes World Context placement as one operation.
12. A storage-to-grid operation creates both representations as one operation.
13. A removed entity cannot remain in Spatial Composition occupancy.
14. Direct one-sided mutation is inaccessible to ordinary application callers.
15. Queries and event listeners never observe a cross-service intermediate state.
16. Persistence capture cannot occur during a placement transaction.
17. Restore rejects missing or contradictory World Context/Spatial Composition records before commit.
18. A failure in a later persistence participant rolls back both placement representations.
19. Non-grid worlds remain valid and do not gain grid occupancy implicitly.
20. A detected integrity mismatch is surfaced; the coordinator does not silently repair by choosing one side.

## 11. Remaining integration details

The Engine-side coordinator, prepared-state mechanism, Core Assembly service registration, composite participant schema, internal mutation capability and fatal-fault clock pause are implemented on `work`.

The remaining work is application-facing and deliberately separate:
- Cassandra must decide which entity/domain classes participate in grid occupancy.
- Cassandra must adapt its current fractional Unit movement model to committed integer grid anchors without silently rounding or moving speed/input rules into Engine.
- Cassandra's viewport must remove the existing additional `+0.5` presentation offset once it consumes grid-backed WorldContext cell-center positions.
- Cassandra supplies host policy for overlap legality, passability and collision behavior.
- Dev Lab should consume the same Engine coordinator and inspectors rather than create another occupancy model.

These are technical integration tasks, not unresolved choices that block the completed Engine slice. The grid-anchor-to-cell-center mapping remains approved. The detailed source-audited restore design is recorded in Section 13 below.

## 12. Explicit non-goals

This contract does not:

- Replace World Context or Spatial Composition with a single monolithic service.
- Make World Context store multi-cell occupancy.
- Make Spatial Composition own entity identity, storage lifecycle or all world placement semantics.
- Define pathfinding, movement speed, passability, collision response or combat outcomes.
- Define Cassandra expedition transfer/change-package semantics.
- Define legacy `.cass` migration or save-envelope changes.
- Change GameClock, SimulationScheduler or tested environment simulation.
- Authorize source/runtime code changes, PR creation, merge or updates to `main`.


## 13. Source-audited persistence integration

**Status:** Implemented on `work` as the `core.spatial-placement` composite persistence participant; Cassandra integration remains separate. A rollback integrity failure faults the coordinator and pauses Core's Game Clock.

### 13.1 Current Persistence behavior

Audited sources: `engine/core/persistence.js`, `engine/core/core-assembly.js`, `engine/core/entity-registry.js`, `engine/core/world-registry.js`, `engine/core/world-context.js`.

The current Persistence coordinator:
- Sorts participants by numeric `order`, then participant ID.
- Prepares every participant transaction before starting commits.
- Commits transactions sequentially using `await transaction.commit()`.
- On failure, rolls back in reverse order, including the participant whose commit threw.
- Logs rollback failures as critical, but cannot guarantee recovery if a participant's rollback itself fails.

Current default participant order:

| Participant | Order | Dependency |
|---|---:|---|
| `core.entity-registry` | -100 | Entity identities/lifecycle |
| `core.world-registry` | -90 | World descriptors/grid capability |
| `core.world-context` | -80 | Entity and World references |

World Context already detaches and validates its snapshot during preparation, defers reference validation until commit, swaps its complete placement map, and retains the previous map for rollback.

Core Assembly's safe boundary rejects persistence during a simulation step, pending/delivering events, runtime destruction or a faulted scheduler. It serializes persistence operations and pauses the GameClock while the queue drains.

### 13.2 Why two placement participants are insufficient

Simply registering World Context at -80 and Spatial Composition at -70 would provide deterministic order, but not an indivisible commit. Persistence awaits each participant commit separately. A reader could observe the new World Context placement before Spatial Composition has committed the matching anchor/footprint, or vice versa.

Ordering is a dependency tool; it is not a substitute for a transaction spanning both services.

### 13.3 Recommended composite participant

**Recommended default:** one Engine-owned composite placement-state persistence participant captures and restores the canonical World Context and Spatial Composition snapshots together.

Illustrative participant ID: `core.spatial-placement`.

Its snapshot contains two canonical sub-snapshots:
- World Context placements, including non-grid world placements and storage placements.
- Spatial Composition anchors, footprints, orientations and cell-associated spatial contents.

This does not merge service ownership or create duplicate records. Each service remains authoritative for its own data; the coordinator supplies one transaction boundary. Derived occupancy indexes are rebuilt from canonical Spatial Composition records.

A Core assembly with the spatial capability must register this composite participant instead of registering independent World Context and Spatial Composition participants for the same state. A host without the spatial capability may retain the standalone World Context participant.

### 13.4 Restore sequence and ordering

1. Persistence validates the outer save, state identity and participant schemas.
2. Entity Registry and World Registry prepare and commit first, preserving their existing dependency order.
3. The composite participant prepares detached World Context and Spatial Composition replacement states without exposing either.
4. It cross-validates the pair: matching world/entity references, exact anchor-to-cell-center mapping, footprint/orientation bounds, derived occupancy, and absence of grid occupancy for stored or non-grid placements.
5. One synchronous composite `commit()` performs the two prepared state swaps in a single call stack, without `await`, events or callbacks between them.
6. If either internal swap fails, the composite transaction restores any already-swapped state before returning. If it cannot prove restoration, it reports a fatal integrity fault and the runtime remains stopped.
7. If a later application participant fails, Persistence calls the composite participant's `rollback()`, restoring both previous service states together.

Proposed dependency order:

| Order | Participant/aggregate | Purpose |
|---:|---|---|
| -100 | Entity Registry | Identity/lifecycle |
| -90 | World Registry | World/grid descriptors |
| -80 | Composite Spatial Placement State | World Context + Spatial Composition atomic restore |
| later | Cassandra/application participants | Domain state referencing core identities, worlds or placements |

The numeric values are proposed defaults. The dependency relation is the important contract.

### 13.5 Capture consistency

The composite participant captures both canonical snapshots from one stable state at the existing Core safe boundary. It must not combine World Context from before a move with Spatial Composition from after it. If it cannot obtain a consistent pair, the save fails rather than writing contradictory state.

### 13.6 Mutation boundary

Source audit confirms that current World Context exposes public mutation methods: `placeEntity`, `storeEntity`, `placeInStore`, `moveEntity` and `removePlacement`. The current Cassandra `UnitSystem` calls `placeEntity` when creating a unit, `moveEntity` when moving it, and `removePlacement` when removing it. Those call sites must be moved behind the Placement Coordinator for grid-backed entities; the Unit domain system remains the Cassandra-facing API.

Grid-backed mutation is routed through the Placement Coordinator. Direct WorldContext placement/move/storage/removal, direct EntityRegistry store/removal while occupied, and direct WorldContext/EntityRegistry/SpatialComposition restore paths that could invalidate active grid state require the internal Engine placement capability. Core installs this boundary at composition time. Non-grid WorldContext-only behavior remains available for ordinary placement operations; Core persistence uses the composite participant for all placement state.

### 13.7 Required tests

1. Composite capture contains both canonical sub-snapshots from one consistent state.
2. Capture cannot occur during an active coordinated placement mutation.
3. Restore rejects a missing or contradictory World Context/Spatial Composition side.
4. Restore rejects mismatched world IDs, anchors, orientations, footprints and bounds.
5. Stored/non-grid placements cannot have active grid occupancy.
6. Restore validates the approved anchor-to-cell-center mapping exactly.
7. Both service states commit before any observer can run.
8. Failure during the second internal swap restores the first before returning.
9. A later participant failure rolls back both services.
10. Rollback failure stops the runtime in a fatal integrity state.
11. Entity Registry or World Registry failure prevents placement commit.
12. Non-grid placement and storage round-trip unchanged.
13. A host without spatial capability retains its standalone World Context participant.
14. Unsupported schemas reject before participant commits.
15. Successful round-trip rebuilds derived occupancy indexes deterministically.

### 13.8 Implemented Engine mechanics and remaining open details

Implemented on `work`:
- Composite participant `core.spatial-placement`, schema version 1.
- Coordinator module `engine/spatial/placement-coordinator.js`, registered by Core Assembly.
- Prepared WorldContext, EntityRegistry lifecycle and SpatialComposition occupancy replacements with synchronous commit/rollback.
- Internal placement capability and direct-mutation/restore guards.
- Grid placement, rotation/footprint replacement, grid transfers, grid-to-storage, storage-to-grid and coordinated retirement.
- Fatal integrity state that rejects further placement/persistence operations and pauses the Core Game Clock.
- Composite restore that cross-validates WorldContext anchors, world descriptors and occupancy before swapping both services; derived indexes are rebuilt.

Remaining open details are outside this Engine slice: Cassandra's fractional movement/interpolation adaptation, domain entity eligibility, and host-specific overlap/passability/collision policy.

### 13.9 Cassandra integration notes from the current source tree

- `src/gameplay/unit/unit-system.js` creates units at integer tile coordinates, but `moveUnit()` accepts fractional coordinates and writes them directly into World Context.
- `src/gameplay/colony/colony-control-system.js` owns movement speed (4 tiles/second), diagonal normalization and input-driven movement. It only moves a drafted leader when that leader belongs to `WorldRegistry.activeWorldId`.
- `cassandra/application/cassandra-application-shell.js` registers 64×64, 128×128 and 256×256 worlds, activates one selected world, and passes integer tile coordinates from viewport placement to Unit System.
- `shared/presentation/world-viewport.js` currently adds `+0.5` when drawing markers and following the camera. Once World Context stores the approved cell-center position for grid-backed entities, those presentation offsets must not be applied a second time.
- Existing Unit tests explicitly cover fractional movement and persistence of fractional positions. Grid integration must replace or adapt those expectations deliberately; it must not silently round positions.
- The current source tree contains no Cassandra environment simulation, world-generation, expedition or temporary-world implementation modules or corresponding test files. Those systems cannot be source-audited from this branch yet; their future integration remains a separate dependency, not something to infer from the current workspace prototype.

## 14. Related contracts

- `world-lifecycle-contract-proposal.md`
- `grid-geometry-contract-proposal.md`
- `spatial-composition-contract-proposal.md`
- `movement-collision-contract-proposal.md`
- `spatial-query-contract-proposal.md`
- `phase-3-implementation-plan.md`
