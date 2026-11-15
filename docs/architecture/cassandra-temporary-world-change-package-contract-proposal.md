# Cassandra Temporary World Result & Change Package Contract — Working Proposal

**Status:** Working proposal; the delta/change-package concept and expedition outcomes are agreed, protocol details are proposed and require review  
**Branch:** `work`  
**Scope:** Cassandra-owned protocol for resolving a Temporary World encounter and applying its results to persistent campaign/Main World state  
**Related Engine contracts:** World Lifecycle, Grid Geometry, Spatial Composition, Spatial Placement Integration

This document specifies the Cassandra-side boundary between a temporary encounter runtime and persistent campaign/location state. It does not define a generic Engine transfer API. It is a design proposal only: no source/runtime changes, save-format changes, PR merge or update to `main` are authorized.

## 1. Purpose and non-negotiable direction

A Temporary World is a runtime instance used to simulate an expedition or encounter. It is not itself the persistent identity of the physical location it represents.

The persistent Main World remains authoritative for the ongoing colony/campaign state. During an expedition, Cassandra pauses Main World simulation and runs the Temporary World. When the encounter resolves, Cassandra returns a versioned delta/change package and applies only its validated changes.

The governing model is:

`new persistent state = previous persistent state + validated encounter changes`

The protocol must never replace the whole Main World with a snapshot of the Temporary World.

The Engine provides generic world lifecycle, identity, placement, spatial composition and persistence mechanisms. Cassandra owns expedition meaning, identity projection, outcome rules, package contents, validation, conflict handling and commit orchestration.

## 2. Separate the three kinds of state

The design distinguishes three related but different records:

### 2.1 Persistent campaign and Main World state

This is the authoritative state that continues across expeditions. It includes the colony and persistent campaign entities, inventories/resources, shuttle identity and references to discovered locations.

Main World simulation is disabled by Cassandra while the encounter is active. Its world-local simulated time does not advance while the Temporary World runs.

### 2.2 Persistent location record

A visited physical location may outlive any particular Temporary World runtime instance.

A location record may retain:
- Stable location identity and generation seed.
- Durable terrain/layout changes.
- Resource inventory and the amounts actually extracted.
- Surviving persistent objects and their durable state.
- Encounter-level Clear/Not Clear result.
- Any host-defined retirement/Done state and compact discovery metadata.

The location record is not the Temporary World save. It is the durable campaign representation from which a later Temporary World can be reconstructed.

A reusable location may be reconstructed from its generation seed plus recorded durable changes. A one-off encounter may be discarded after resolution. A permanently retired/Done location may retain only the minimal identity/visited marker required by the universe map.

### 2.3 Temporary World runtime

The Temporary World contains the active encounter simulation: generated terrain, temporary entities, participants, shuttle representation, combat state, projectiles and other encounter-local state.

It may contain only the relevant projection of the Main World/campaign state; it does not need to duplicate the entire persistent world.

The Temporary World runtime is disposable after its final consequences have been resolved and its result package has been safely applied. Disposing the runtime must not implicitly delete the persistent location record.

## 3. Identity across the two worlds

### 3.1 Do not place one Engine entity in two worlds simultaneously

The current Engine placement contract has one placement record per entity. The agreed placement integration also requires one coordinated World Context / Spatial Composition placement.

Therefore, a persistent campaign entity must not be represented by reusing the same live Engine entity ID for a second simultaneous placement in the Temporary World.

Instead, Cassandra should distinguish:

- **Campaign identity:** the durable identity of the pawn, shuttle, item, machine or other persistent campaign object.
- **Encounter runtime identity:** the Engine entity ID used by the Temporary World instance while the encounter is active.
- **Projection mapping:** an explicit mapping between a campaign identity and its encounter runtime representation.

The projection is a runtime representation, not a second persistent campaign entity. When the encounter ends, the package refers to campaign identities for updates and to encounter identities only as provenance/evidence for the result.

### 3.2 Participant mapping

At expedition creation, Cassandra creates a stable session mapping for each participating persistent entity:

- Campaign entity ID.
- Temporary runtime entity ID.
- Projection role/type.
- Baseline version or state fingerprint used for conflict validation.
- Transfer eligibility and any host-defined constraints.

For example, the shuttle keeps one persistent campaign identity. Its physical encounter representation has a separate runtime entity ID linked through the session mapping. The same principle applies to pawns and persistent equipment represented in the encounter.

The mapping is session-scoped and must be persisted with the pending expedition/recovery state. It must not rely on array positions, display names or runtime iteration order.

### 3.3 Encounter-only entities and newly acquired objects

Not every Temporary World entity maps to a persistent campaign entity.

- Enemies, projectiles and other encounter-only entities normally remain temporary and are not copied into the campaign as individual entities.
- A persistent object found, created or acquired during the encounter may be emitted as a create operation with a package-local result key.
- During commit, Cassandra assigns or resolves its durable campaign/location identity and records that mapping in the application ledger.
- A surviving object left at the location may instead become part of the persistent location record.
- Temporary runtime IDs must never be reused as durable campaign IDs merely because they are available.

Exact rules for each Cassandra entity category remain Cassandra domain policy.

## 4. Expedition session and package envelope

The following is a conceptual envelope, not a final serialized schema or public API. Field names are illustrative.

### 4.1 Expedition session

An expedition session should identify:
- Stable expedition/session ID.
- Persistent source/Main World ID.
- Persistent location ID, where the encounter represents a revisitable physical location.
- Temporary World runtime ID.
- Generation seed and location-record revision used to construct the encounter.
- Session start/baseline revision for each participating campaign aggregate.
- Campaign-to-encounter identity mappings.
- Expedition mode and other host-defined context.
- Current recovery/checkpoint status.

The session is Cassandra-owned. Engine World IDs and Entity IDs are references, not the definition of an expedition.

### 4.2 Change package

A completed encounter produces an immutable, versioned package containing at least:

- Package ID and expedition/session ID.
- Package schema version.
- Source Main World and location identities.
- Baseline revisions/preconditions for every persistent aggregate the package intends to change.
- Final outcome: normal End Expedition or Abandon Expedition, plus encounter-level Clear/Not Clear.
- Ordered domain operations and their dependencies.
- Identity mapping/provenance needed to resolve campaign entities and new result objects.
- A deterministic content digest or equivalent integrity check.
- Package creation/finalization metadata in simulation terms where needed; no wall-clock elapsed-time simulation is implied.

The package is a set of intended domain changes, not a serialized replacement Main World.

### 4.3 Immutable after finalization

Once finalized and durably recorded, a package is immutable. A retry must apply the same package, not regenerate it from a mutated or partially disposed Temporary World.

If a package is invalid or conflicts with the target state, Cassandra creates an explicit resolution/replacement workflow. It must not silently edit the original package and reuse its ID.

## 5. Change operation model

The package should contain typed Cassandra domain operations rather than an unrestricted generic object merge or arbitrary JSON patch.

Candidate operation families include:

| Operation family | Meaning |
|---|---|
| Persistent entity update | Apply a validated state change to an existing campaign entity, such as damage, condition, status or position |
| Entity removal/death | Apply a validated death/removal outcome to a mapped campaign entity |
| Entity creation | Create a durable campaign entity from a package-local result key |
| Inventory change | Apply explicit item/stack additions, removals, consumption or transfers |
| Resource delta | Apply actual extracted/consumed/earned quantities to the relevant resource aggregate |
| Location change | Apply durable terrain, excavation, structure or surviving-object changes to the persistent location record |
| Encounter outcome | Record Clear/Not Clear and other durable encounter-level results |
| Participant return | Resolve which mapped pawns and campaign objects return with the shuttle |
| Reward/result | Apply campaign rewards and other explicit encounter consequences |

This list is a proposal, not a final fixed enum. Cassandra may refine operation types as its domain model becomes concrete.

### 5.1 Prefer intent-specific operations

Operations should express the intended change, not blindly replace large nested state snapshots.

Examples:
- Apply 12 units of actually extracted titanium to the campaign inventory and deduct the same amount from the location's remaining resource inventory.
- Apply a damage/condition result to a specific campaign pawn, subject to the expected baseline version.
- Add an acquired item stack to the returning shuttle cargo.
- Persist a surviving structure at its final location coordinates.
- Mark the encounter Clear without persisting individual enemy runtime entities.

For inventories and resources, the package should identify the affected aggregate and exact quantity/identity change. It should not replace an entire inventory snapshot if unrelated items could have changed independently.

### 5.2 Complete package atomicity

The proposed default is all-or-nothing application for one finalized package:
- Validate every operation and every precondition first.
- Prepare all target changes without exposing them.
- Commit the campaign/Main World changes, persistent location changes and application ledger together.
- If any required operation fails, commit none of the package.
- Do not apply a successful prefix and discard the rest.

If a future gameplay requirement needs optional or independently committable results, it must define explicit package subtransactions and their dependencies. It must not arise accidentally from partial failure.

## 6. Baseline validation and conflict detection

A package is valid only against the persistent state from which its encounter projection was created, subject to explicit Cassandra merge rules.

At expedition start, record the baseline revision/version or stable fingerprint for each persistent aggregate that may be changed. Examples include:
- A participating pawn or shuttle.
- Its inventory/cargo aggregate.
- The persistent location record and its resource inventory.
- Any other campaign record the encounter may update.

At application time:
1. Resolve every referenced campaign identity.
2. Verify that the source world/location still exists and has the expected lifecycle/status.
3. Compare the current revision of every touched aggregate with the package precondition.
4. Validate operation-specific constraints, resource quantities, ownership, capacity and legal outcomes.
5. Validate that every projection mapping is unique and consistent.
6. Reject references to unknown, removed, ineligible or mismatched entities.
7. Prepare the complete target state only after all validation succeeds.

Use per-aggregate preconditions rather than a single global Main World revision where practical. This allows unrelated campaign state to remain outside the conflict boundary.

The fact that Main World simulation is paused reduces ordinary conflicts but does not eliminate them: other campaign systems, player actions, recovery workflows or external persistence operations may still change relevant records.

### 6.1 Stale or conflicting package

If a touched aggregate has changed since the baseline:
- Mark the package as conflicted.
- Preserve the immutable package and diagnostics.
- Do not overwrite the newer persistent state.
- Do not automatically rebase or reinterpret the package.
- Require an explicit Cassandra resolution policy or a new package derived from an explicitly approved reconciliation.

A conflict in one required operation rejects the entire package under the proposed all-or-nothing rule.

## 7. Atomic application and idempotency

### 7.1 Commit boundary

The application transaction includes all affected persistent state:
- Main World/campaign entities.
- Inventory and resource aggregates.
- Persistent location record.
- Encounter outcome and location status.
- Identity mappings for newly created durable objects.
- Package application ledger/status.

These changes must become visible together or not at all.

The transaction coordinator is Cassandra-owned. It may use Engine persistence preparation/commit/rollback mechanisms, but Engine must not understand the meaning of expedition operations.

The commit must not mutate the Temporary World as a side effect of applying the package. The Temporary World is already frozen at finalization.

### 7.2 Idempotency

Applying the same package more than once must not duplicate rewards, consume resources twice, create duplicate entities or repeat damage.

Use:
- Stable package ID.
- Expedition/session ID.
- Package content digest.
- Durable application ledger recording the committed package and its result.

The ledger update must be part of the same atomic commit as the domain changes.

Repeated application of an already committed package with the same digest returns an already-applied result without repeating effects. Reuse of a package ID with a different digest is an integrity error.

### 7.3 Durable pending package

A finalized package must be persisted before it is applied, so a crash or interrupted save cannot lose the result or require rerunning encounter consequences.

The pending package and its recovery state are Cassandra-owned persistent campaign data. They must survive save/load until the package is either committed or explicitly rejected/resolved.

The proposed recovery behavior is:
- A package in Pending state is revalidated and may be retried.
- A package in Conflict state remains retained for explicit reconciliation.
- A package in Applied state is never applied again.
- A package in Rejected state remains diagnosable; it is not silently deleted.
- No pending package is automatically changed or rebased during load.

Exact status names and user-facing recovery UI are implementation details.

## 8. End Expedition and Abandon Expedition

These are distinct Cassandra outcomes and must not be collapsed into a generic close operation.

### 8.1 Normal End Expedition

Agreed gameplay requirement:
- Normal End Expedition is available only when every living pawn assigned to the expedition is inside the shuttle.
- The game must continuously or clearly determine whether this condition is met.
- The operation represents an orderly return with the shuttle's current onboard contents.

The package should:
- Return the shuttle's persistent campaign state through its projection mapping.
- Return every eligible onboard living pawn and their applicable carried/equipped state.
- Return onboard cargo and other explicitly transferable objects.
- Apply actual resource extraction and encounter rewards.
- Persist location changes and surviving objects left at the location.
- Record the encounter's Clear/Not Clear result.

Any bodies, equipment or other persistent objects left at the location are handled by location persistence and encounter final consequences, not silently moved into shuttle cargo.

### 8.2 Abandon Expedition

Abandon is an emergency/forced return and is not equivalent to normal evacuation.

Agreed gameplay requirements:
- The shuttle may return while pawns and equipment remain behind.
- The package includes only the appropriate surviving/onboard state that returns with the shuttle.
- Left-behind pawns, bodies, equipment and other objects are evaluated under final encounter consequences and may be retained in the persistent location record if they survive.
- The encounter may still yield XP, resources or other partial rewards. Not Clear does not mean the expedition produced no result.
- If the entire crew dies, the game should automatically offer the abandon outcome; it may be the only available action, and the shuttle begins its return.

The package must make the return/left-behind disposition explicit. It must not infer that every participant returns simply because the Temporary World is closing.

### 8.3 Final encounter consequences

Before creating the final package, Cassandra evaluates all final encounter consequences that are defined to occur when the expedition ends or is abandoned. This includes any enemy destruction/behavior rules affecting abandoned objects.

The package must describe the post-consequence state. Those consequences must not be run again on package retry.

Enemies are transient encounter entities and are not persisted as long-lived individual campaign entities. Their later presence is regenerated according to encounter rules:
- If the encounter is Clear, enemies do not respawn on a later visit.
- If it is Not Clear, enemies may be regenerated on a later visit according to the location's rules.
- Not Clear does not itself mean the expedition failed.

## 9. Location resource and terrain persistence

The location record is updated with the durable result of the encounter, not the entire Temporary World snapshot.

Agreed Cassandra resource rules:
- Deep Scan reveals information about deposits; it does not consume or reserve resources.
- Discarding scan information does not affect deposits.
- On encounter close/commit, deduct only resources actually extracted.
- Unmined resources remain available for later visits.
- Physical deposit details may be instantiated when an encounter is opened, but they must remain consistent with the parent location's shared resource inventory and prior extracted amounts.

Therefore, the package should include explicit extraction quantities and location resource deltas. It must not treat scanned, revealed or generated deposits as already consumed.

For reusable physical locations, persist durable terrain/resource changes and surviving persistent objects. Reconstruct the next Temporary World from the location seed plus those changes. Do not run background simulation or elapsed-time catch-up while the location is inactive.

## 10. Resolution lifecycle

The proposed normal processing sequence is:

1. **Check outcome eligibility.** Confirm normal End Expedition conditions, or select the Abandon path.
2. **Freeze encounter simulation.** Stop new simulation steps and player actions that could change the final result.
3. **Evaluate final consequences.** Resolve end-of-encounter rules once, including abandoned-object outcomes.
4. **Build the result.** Produce the complete immutable change package from the frozen encounter state and session identity mapping.
5. **Persist pending package.** Durably save the finalized package and recovery metadata before attempting application.
6. **Validate.** Check package integrity, identity mapping, baseline revisions and all domain preconditions against persistent campaign/location state.
7. **Prepare.** Build the complete post-commit state without exposing partial changes.
8. **Commit atomically.** Apply campaign, location, identity-mapping and package-ledger changes together.
9. **Confirm application.** Mark/record the package as Applied as part of the same transaction.
10. **Dispose Temporary World.** Only after successful application and durable confirmation may the Temporary World runtime be disposed and its temporary session data released.
11. **Resume Main World.** Re-enable Main World simulation and restore the appropriate focus/rendering according to Cassandra's host flow.

The Main World remains paused through validation and commit. Its world-local simulated time does not advance during the expedition or while a pending package is being resolved.

### 10.1 Failure and recovery

If package creation or persistence fails:
- Do not dispose the Temporary World.
- Keep it frozen and retain enough state to retry finalization safely.
- Do not rerun already completed final consequences without an explicit idempotent checkpoint.

If validation detects a conflict:
- Keep the package and diagnostics.
- Do not commit any operation.
- Keep the encounter/session recoverable and do not resume Main World simulation until Cassandra has resolved the pending expedition according to an explicit recovery policy.

If preparation or commit fails:
- Commit no partial domain changes.
- Retain the durable pending package.
- Keep the Temporary World frozen or retain a durable recovery checkpoint sufficient to inspect/retry.
- Retry the same immutable package; do not regenerate rewards or consequences.

If the process crashes after package persistence but before commit:
- Restore the pending package and frozen/recoverable encounter state.
- Do not automatically simulate either world.
- Revalidate and retry the same package under Cassandra recovery control.

If the process crashes after a successful atomic commit:
- The application ledger proves the package is already applied.
- A retry returns Already Applied and cannot duplicate results.
- Temporary World disposal and Main World resume can safely continue.

A conflict or unresolved pending package must not be silently discarded in order to resume the campaign.

## 11. Persistence and versioning

Cassandra owns persistence for:
- Expedition session identity and projection mapping while active.
- Frozen/recoverable Temporary World state required before package finalization.
- Finalized pending change packages.
- Package application ledger.
- Persistent location records and their revisions.
- Any durable identity mapping needed to reconstruct results after load.

The package schema and location record schema must be versioned independently of Engine spatial snapshot schema. Engine persists generic world/grid/spatial state; Cassandra migrates its own domain state and package semantics.

A save/load must not produce a state where:
- A package is marked Applied but its domain changes are absent.
- Domain changes are committed but the package ledger says Pending.
- A pending package is lost.
- A package can be applied twice.
- A Temporary World is disposed while its only result is still held in volatile memory.
- Main World simulation resumes while an unresolved package still owns the campaign transition.

Legacy `.cass` migration and the mapping of existing map/environment data into Spatial Composition are outside this contract and remain a separate open design gate.

## 12. Ownership boundaries

**Cassandra owns:**
- Expedition/session lifecycle and the one-active-encounter gameplay rule.
- Main World pause/resume policy.
- Persistent location identity and location-record persistence.
- Campaign-to-encounter identity projection.
- Change-package schema, operations, revisions and digest.
- End/Abandon eligibility and final encounter consequences.
- Package validation, conflict resolution, transaction coordination, idempotency and recovery.
- Resource extraction, rewards, Clear/Not Clear and Done semantics.
- Temporary World construction and disposal.

**Engine owns:**
- Generic world lifecycle and simulation participation mechanisms.
- Entity and World identity registries.
- World Context placement and Spatial Composition occupancy according to their contracts.
- Generic persistence participant and transaction primitives.
- No knowledge of expeditions, shuttles, pawns, rewards, resources, Clear/Not Clear or change-package operations.

**Presentation owns:**
- Showing encounter status, return eligibility, package/recovery errors and resulting state.
- No authoritative transfer or commit logic.

## 13. Acceptance scenarios

1. Starting an expedition creates a Temporary World without replacing or cloning the entire Main World.
2. Main World simulation is disabled while the Temporary World simulates.
3. Main World local simulated time remains unchanged throughout the expedition.
4. A persistent campaign entity has one campaign identity and a distinct Temporary World runtime projection ID.
5. The shuttle projection maps back to the same persistent shuttle campaign identity.
6. Temporary-only enemies and projectiles do not become persistent campaign entities.
7. A package contains only explicit intended changes and cannot overwrite unrelated Main World state.
8. A package records baseline revisions for every persistent aggregate it changes.
9. A change to an unrelated Main World aggregate does not create a false conflict when it is outside the package's write/precondition set.
10. A change to a touched aggregate causes a conflict and prevents the entire package from applying.
11. Invalid identity mappings, missing entities, invalid quantities or illegal domain outcomes reject the entire package.
12. A failure in any package operation commits none of the package.
13. Main World, location record and package ledger become visible atomically.
14. Reapplying an already-applied package does not duplicate rewards, resource changes, entity creation or damage.
15. Reusing a package ID with a different digest is rejected as an integrity error.
16. A pending package survives save/load and can be retried without rerunning encounter consequences.
17. A crash before commit leaves a recoverable pending package and does not resume Main World simulation.
18. A crash after commit cannot cause the package to be applied twice.
19. Normal End Expedition is unavailable while any living assigned pawn is outside the shuttle.
20. Normal End Expedition returns the shuttle, all eligible onboard living pawns and onboard cargo.
21. Abandon can return the shuttle while leaving pawns/equipment behind.
22. Left-behind objects are persisted only if they survive final encounter consequences.
23. Entire-crew death offers the abandon outcome and does not invent a normal evacuation.
24. Clear prevents enemy respawn on a later visit; Not Clear may allow regeneration.
25. Not Clear does not suppress partial rewards or mean the expedition failed.
26. Deep Scan and discarding scan information do not consume or reserve resources.
27. Only actually extracted resources are deducted; unmined resources remain at the location.
28. A reusable location is reconstructed from its seed and durable changes, not from an assumed continuously simulated background world.
29. A one-off or Done location follows its explicit persistence/disposal policy without changing generic Engine World semantics.
30. Temporary World disposal occurs only after the result is durably applied, or after an explicitly approved equivalent recovery guarantee is established.
31. Main World simulation resumes only after the package is resolved and the Temporary World transition is safely completed.
32. Existing `.cass` compatibility and environment simulation behavior remain unchanged until their separate migration and regression gates are approved.

## 14. Open implementation/design details

The following remain proposals or require further review; this document does not silently decide them:

- Exact package schema, operation names and canonical digest algorithm.
- Exact campaign aggregate/versioning mechanism and whether versions are per record or per aggregate.
- Exact persistent entity categories eligible for projection and return.
- Exact disposition rules for each pawn/body/equipment category under End and Abandon.
- Whether pending package recovery keeps the full frozen Temporary World snapshot or a smaller sufficient recovery checkpoint.
- Exact persistence transaction coordinator and its integration with current Cassandra save participants.
- Whether some operation families need explicitly independent subtransactions in a future gameplay design.
- Exact location persistence policy for each location type (reusable, one-off, Done/retired).
- Exact user-facing conflict/recovery flow.
- Legacy `.cass` migration and spatial-state conversion, which remain outside this contract.

The recommended default is a Cassandra-owned, all-or-nothing, version-checked, idempotent package with a durable pending state. Keep the Main World paused and the Temporary World frozen until the package is applied or an explicit recovery decision is made.

## 15. Related documents

- `phase-3-brainstorm.md`
- `phase-3-implementation-plan.md`
- `world-lifecycle-contract-proposal.md`
- `spatial-placement-integration-contract-proposal.md`
- `spatial-composition-contract-proposal.md`
- `movement-collision-contract-proposal.md`
