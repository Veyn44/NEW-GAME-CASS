# Spatial Placement & Persistence Integration — Working Proposal

**Status:** Source-audited working proposal; no runtime implementation approved  
**Branch:** `work`  
**Source audit:** 2026-11-15  
**Scope:** Atomic persistence/restore of the coordinated World Context + Spatial Composition placement state

This document resolves the implementation-level persistence question exposed by the approved placement ownership contract. It proposes the smallest integration boundary that preserves the existing Engine Persistence prepare/commit/rollback model without allowing observers to see contradictory placement state.

It does not authorize source/runtime changes, save-format changes, PR creation/merge or updates to `main`.

## 1. Source-audited current behavior

### 1.1 Persistence participant contract

Source: `engine/core/persistence.js`

The current Persistence implementation:

- Registers required/optional participants with a stable ID, schema version and numeric order.
- Sorts participants by `order`, then participant ID.
- Captures every required participant at the Core safe boundary.
- On load, validates/migrates snapshots and calls `prepareRestore` for every participant before starting any commit.
- Requires each prepared transaction to provide `commit()` and `rollback()`.
- Commits prepared transactions sequentially using `await transaction.commit()`.
- If a commit fails, calls rollback in reverse order, including rollback on the participant whose commit threw.
- Logs rollback failures as critical, but cannot guarantee recovery if a participant's rollback itself fails.

The prepare-all-before-commit behavior is useful and should be retained. However, separate participant commits are not one indivisible synchronous operation: the current coordinator awaits each commit separately. Two mutually dependent placement services must therefore not rely on adjacent participant order alone to hide an intermediate cross-service state.

### 1.2 Current participant ordering

Source: `engine/core/entity-registry.js`, `engine/core/world-registry.js`, `engine/core/world-context.js`, `engine/core/core-assembly.js`

Current default orders and registration:

| Participant | Default order | Dependency |
|---|---:|---|
| `core.entity-registry` | -100 | Stable entity identities/lifecycle |
| `core.world-registry` | -90 | World descriptors/lifecycle/grid capability |
| `core.world-context` | -80 | Entity and World references |

Core Assembly currently registers those three participants. The explicit order ensures Entity Registry and World Registry commit before World Context validates its references.

### 1.3 World Context restore

Source: `engine/core/world-context.js`

World Context currently:

- Detaches and validates the snapshot shape during `prepareRestore`.
- Can defer reference validation until commit.
- At commit, validates entity and world references against the already-restored registries, then swaps the complete placement map.
- Retains the previous placement map for rollback.

This is already a good staged-restore pattern. It does not yet know about Spatial Composition and cannot cross-validate a grid anchor/footprint against a separate spatial snapshot.

### 1.4 Safe boundary

Source: `engine/core/core-assembly.js`

The current safe-boundary wrapper:
- Rejects persistence during a simulation step, event delivery/pending events, runtime destruction or a faulted scheduler.
- Serializes overlapping save/load operations.
- Holds an independent GameClock pause reason while the persistence queue drains.

This protects persistence against ordinary simulation/event mutation. It does not replace the requirement that a placement pair itself commit as one non-observable operation.

## 2. Required invariant

For every grid-backed entity, World Context and Spatial Composition are one logical placement aggregate:

- World Context owns world association and storage/world placement.
- Spatial Composition owns the grid anchor, footprint, orientation and occupied-cell records.
- Both must restore from one consistent saved state.
- No query, event listener, renderer, system or subsequent persistence capture may observe one side restored while the other side is not.
- If a later unrelated persistence participant fails, rollback must restore both placement services to their previous complete state.

Changing participant order alone is insufficient to guarantee this invariant.

## 3. Recommended integration: one composite placement-state participant

**Recommended default:** Introduce one Engine-owned persistence coordinator for the combined placement state. It captures and restores the canonical World Context and Spatial Composition snapshots as one composite participant transaction.

Conceptual participant identity (illustrative): `core.spatial-placement`.

Its snapshot contains two distinct canonical sub-snapshots:
- World Context placement snapshot, including non-grid world placements and storage placements.
- Spatial Composition snapshot, including grid anchors, footprints, orientations and cell-associated spatial contents.

This is a persistence transaction boundary, not a merged data-ownership model:
- World Context continues to own its placement semantics.
- Spatial Composition continues to own its spatial records.
- The coordinator does not create duplicate placement or occupancy records.
- Derived occupancy indexes are rebuilt from Spatial Composition's canonical records.
- No second independent World Context or Spatial Composition participant may also persist the same canonical state in the same Core assembly; duplicate capture/restore authority would reintroduce split-brain risk.

The existing standalone World Context participant may remain available for a host that does not assemble the spatial capability. A Core assembly that enables the coordinated spatial capability must register the composite participant instead of registering World Context and Spatial Composition separately.

The exact stable participant ID and schema version should be finalized with the implementation. Under the agreed save policy, no migration is required merely to preserve arbitrary earlier save versions; unsupported saves may be rejected.

## 4. Composite restore sequence

The composite participant should implement one prepared transaction:

1. Persistence validates the outer save, state identity and participant schema.
2. Entity Registry and World Registry snapshots are prepared and committed first, preserving the current dependency order.
3. The composite placement participant receives its complete detached composite snapshot.
4. It prepares World Context and Spatial Composition replacement states independently, without exposing either.
5. It validates their internal consistency together:
   - Every grid-backed World Context placement has exactly one matching Spatial Composition entity record.
   - Every Spatial Composition entity record references an entity with a matching World Context world placement.
   - World IDs and grid descriptors exist and agree.
   - The anchor is an integer cell coordinate and maps to the World Context cell center using the approved rule.
   - The complete oriented footprint is in bounds and exactly matches the derived occupancy.
   - Storage and non-grid placements do not have grid occupancy.
   - Entity identities are valid and eligible.
   - Duplicate, missing or contradictory placement records reject the complete restore.
6. The composite transaction's single `commit()` performs any final reference checks and synchronously swaps both prepared service states within one call stack, with no await, event publication or observer callback between swaps.
7. If either internal swap unexpectedly fails, the composite transaction synchronously restores any already-swapped service before returning failure. If it cannot prove restoration, it reports a fatal integrity fault and the runtime remains stopped.
8. If a later Persistence participant fails, Persistence invokes the composite transaction's `rollback()`, restoring both previous service states together.

The composite commit is the only externally visible placement-state commit point. Persistence may await that one transaction normally; it must not split the two service swaps into separate awaited participant commits.

## 5. Capture and save consistency

- Persistence capture remains at the existing safe boundary.
- The placement coordinator must prevent capture during a placement mutation.
- The composite participant captures both canonical sub-snapshots from one stable state.
- A snapshot must never combine World Context from before a move with Spatial Composition from after it.
- If a capture cannot obtain a consistent pair, the save fails; it must not write a partial or self-contradictory snapshot.
- The outer adapter's existing atomic-write contract remains unchanged.

## 6. Mutation boundary and existing public APIs

Source audit of `engine/core/world-context.js` confirms that World Context currently exposes public mutation methods including `placeEntity`, `storeEntity`, `placeInStore`, `moveEntity` and `removePlacement`.

The future integration must ensure callers cannot mutate only one side for a grid-backed entity.

Recommended behavior:
- Route every grid-backed placement mutation through the Placement Coordinator.
- Preserve existing World Context-only behavior for non-grid placements and storage where no grid occupancy exists.
- Reject or internally redirect a direct World Context mutation that would affect a grid-backed placement unless it carries the coordinator's internal transaction capability.
- Make Spatial Composition's low-level occupancy mutation methods internal to the coordinator or require the same capability.
- Keep notifications/events after the composite state is fully committed.

The exact encapsulation mechanism (private methods, internal capability token, facade or equivalent) is an implementation detail. It must not rely only on caller convention or code review.

## 7. Why not two independent persistence participants?

Registering World Context at -80 and Spatial Composition at -70 would give a deterministic order and allow the latter to validate the already-committed World Context. It would still expose an intermediate state between awaited commits, and a direct reader could observe that state.

It also creates a more complex rollback boundary when a later participant fails. A composite transaction avoids this by making the two service-state swaps one synchronous commit and one rollback unit, while leaving Entity Registry and World Registry as separate earlier dependencies.

A generic transaction-group feature in Persistence could also solve this, but would expand the generic Core contract for a single known pair. The composite participant is the smaller initial design. Revisit a generic group primitive only if a second independent use case demonstrates the need.

## 8. Proposed restore dependency order

| Order | Participant/aggregate | Purpose |
|---:|---|---|
| -100 | Entity Registry | Restore identity/lifecycle records |
| -90 | World Registry | Restore world descriptors and optional grid descriptors |
| -80 | Composite Spatial Placement State | Restore World Context + Spatial Composition atomically |
| later | Cassandra/application participants | Restore domain state that references the core entities/worlds/placements |

The numeric values are proposed defaults consistent with current ordering, not a requirement that every host use these exact numbers. The dependency relation is normative: identities and world/grid descriptors must be available before placement restore; domain participants that require restored placement must run after the composite state.

## 9. Required tests

1. Composite capture contains both canonical sub-snapshots from one consistent state.
2. Capture is rejected or deferred while a coordinated placement mutation is active.
3. Restore rejects a missing World Context side for a grid-backed spatial entity.
4. Restore rejects a missing Spatial Composition side for a grid-backed World Context placement.
5. Restore rejects mismatched world IDs, anchors, orientations and footprints.
6. Restore rejects storage/non-grid entities with active grid occupancy.
7. Restore validates grid anchor to World Context cell-center mapping exactly.
8. Restore commits both services before any observer can run.
9. Injected failure during the second internal swap restores the first service before returning.
10. A later participant failure invokes composite rollback and restores both prior states.
11. Rollback failure marks the runtime as critically faulted/stopped; it cannot continue with split placement state.
12. Entity Registry or World Registry restore failure prevents the composite placement commit.
13. Non-grid placement and storage round-trip unchanged.
14. Existing World Context-only hosts without spatial capability retain their current participant path.
15. Unknown/unsupported save schema is rejected before any participant commits.
16. A successful save/load round-trip rebuilds derived occupancy indexes deterministically.

## 10. Source audit record

Audited on branch `work`:
- `engine/core/persistence.js` — participant ordering, prepare-all/commit-sequential restore, reverse rollback and safe-boundary contract.
- `engine/core/entity-registry.js` — default participant order -100 and staged identity restore.
- `engine/core/world-registry.js` — default participant order -90 and staged world restore.
- `engine/core/world-context.js` — default participant order -80, deferred reference validation, public placement mutation methods and rollback.
- `engine/core/core-assembly.js` — current participant registration and serialized safe-boundary queue.
- `tests/core-integration.test.js` — existing restore-order, identity/placement round-trip, v1 migration and participant-set tests.
- `tests/persistence-logger.test.js` — existing Persistence transaction and rollback behavior.

## 11. Open implementation details

- Exact composite participant ID and snapshot schema.
- Exact coordinator module location and service registration.
- Exact prepared-state representation used by World Context and Spatial Composition.
- Internal capability/encapsulation mechanism that prevents one-sided mutation.
- Fatal integrity-fault signaling and runtime stop/recovery integration.
- Exact placement lifecycle coverage for entity removal, storage and non-grid transitions.

These are technical implementation details to resolve during the corresponding source slice. They do not require another architectural choice from the user at this stage.
