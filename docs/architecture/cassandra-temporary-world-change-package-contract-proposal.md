# Cassandra Temporary World Result & Change Package Contract — Working Proposal

**Status:** Protocol direction and technical defaults approved for implementation on `work`; authoritative campaign storage adapter and full gameplay operation registry remain implementation gates  
**Branch:** `work`  
**Scope:** Cassandra-owned protocol for resolving a Temporary World encounter and applying its results to persistent campaign/Main World state  
**Related Engine contracts:** World Lifecycle, Grid Geometry, Spatial Composition, Spatial Placement Integration

This document specifies the Cassandra-side boundary between a temporary encounter runtime and persistent campaign/location state. It does not define a generic Engine transfer API. The Change Package / Change Buffer / Major State direction and defaults in Section 14 are approved for implementation on `work`. No PR merge or update to `main` is authorized.

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

## 3.4 Return entitlement and loss-prevention invariant

**Agreed direction (2026-11-15):** The player must receive every item, pawn, resource, reward and other result that the finalized expedition outcome says is due to return. A technical failure, identity remapping issue, save interruption, retry or Temporary World disposal must never silently erase that entitlement.

This is stronger than merely making package application atomic. Atomicity prevents partial application; the entitlement invariant ensures that the complete result remains recoverable until it has been durably committed.

### Required guarantees

- **Explicit disposition for every relevant object/stack:** Every persistent participant, item stack, resource quantity and reward in the expedition result must have a resolved disposition: returned to campaign/shuttle, retained at the persistent location, destroyed/lost by an explicit gameplay consequence, or transient/discarded by an explicit rule. No object or quantity may fall through an unspecified default.
- **Provenance and ownership:** The result must preserve who owns an item/resource and where it came from. Encounter runtime IDs are mapped to campaign identities or package-local result keys; they are never the only surviving reference to something the player is owed.
- **Conservation/reconciliation:** For transferable items and quantities, the package must account for the baseline amount, explicit consumption/use/loss, explicit additions/acquisitions, and final disposition. The reconciliation must balance. Any reduction must be explained by a valid gameplay operation, not by missing data or failed mapping.
- **No silent fallback to deletion:** Unknown, unmapped or unresolvable persistent results cause validation to fail and the package to remain pending. They must not be dropped, ignored or converted to a generic cleanup action.
- **Durable entitlement record:** Before the Temporary World can be disposed, the finalized package must durably contain the complete return manifest and all location-retention/loss outcomes. The pending package is the recoverable record of what the player is owed.
- **Atomic delivery:** The campaign inventory/entity/resource updates, location record updates, identity resolutions and Applied ledger entry commit together. There must be no state where the package is marked applied but the returned items are absent, or where items are granted but the ledger allows them to be granted again.
- **Retry without duplication or loss:** Replaying the same package either completes the same transaction or reports it already applied. It cannot drop items on retry or duplicate them.
- **Safe disposal:** Temporary World runtime data and session mappings may be released only after the return manifest and its outcomes are durable and the package has been successfully applied, or after an explicitly designed recovery mechanism proves the same information is safely retained elsewhere.

### Return manifest and reconciliation

The package should carry an explicit manifest for all persistent/transferable results. For each entry, record enough information to resolve:
- Stable campaign identity or package-local result identity.
- Item/resource/entity type and exact quantity/stack identity as applicable.
- Ownership and source (participant inventory, shuttle cargo, location loot, extracted deposit, reward, etc.).
- Final disposition (return, remain at location, consumed, destroyed/lost by an explicit consequence, or transient).
- The operation(s) responsible for any quantity/state reduction.
- Destination aggregate/owner for returned results.

The manifest is not a second source of truth. It is the auditable statement of the package's intended outcome and is validated against its typed operations before commit.

For fungible resources, reconciliation should use explicit integer/fixed-precision quantities and domain-defined units; avoid floating-point arithmetic for conserved inventory quantities. For non-fungible objects, reconcile stable object/stack identities and their single final disposition.

### Failure policy

If a manifest entry cannot be mapped, validated, reconciled or committed:
1. Reject the whole package transaction.
2. Preserve the immutable package, manifest and diagnostics.
3. Keep the package pending/conflicted and the Main World paused.
4. Do not dispose the only recoverable copy of the encounter result.
5. Require an explicit recovery/reconciliation path; never silently forgive the missing item.

A legitimate gameplay loss (for example, an item destroyed by an enemy during the encounter) is allowed only when the corresponding consequence is explicitly represented in the finalized result and its domain rules. A technical transfer failure is never a gameplay loss.

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

## 7.4 Two-state staging model: Major State + Change Buffer

**Agreed architectural direction (2026-11-15):** The persistent campaign must retain a complete, last-known-good Major State separately from the uncommitted expedition changes. The new state is calculated as:

`Candidate State = Major State + Change Buffer`

The Change Buffer must never mutate the Major State in place.

### State layers

1. **Major State (authoritative baseline):** The last complete, validated and committed campaign/location state. It remains immutable for the duration of a package-application attempt.
2. **Change Buffer (staged delta):** The complete, separately retained set of finalized expedition changes, including the return manifest, typed operations, preconditions and provenance. It is not yet authoritative campaign state.
3. **Candidate State (staged result):** A separate prepared result calculated by applying the complete Change Buffer to the Major State. It must not be exposed as committed state while validation is in progress.
4. **Committed Major State:** Only after complete validation and successful atomic commit does the Candidate State replace the previous Major State as the new authoritative baseline.

The Change Buffer is logically a staging/cache layer, but it must be durably persisted. A volatile in-memory cache alone is insufficient because a crash must not destroy the only copy of what the expedition earned or changed.

### Required processing sequence

1. Freeze and finalize the expedition outcome.
2. Persist the complete Change Buffer and the expedition-start rollback checkpoint.
3. Keep the current Major State unchanged.
4. Build Candidate State in isolated staging storage from Major State plus the complete Change Buffer.
5. Validate identities, ownership, quantities, dispositions, preconditions, resource conservation and all domain invariants against the Candidate State.
6. If validation succeeds, atomically promote Candidate State to the new Major State and mark the package Applied in the same durable transaction.
7. Only after durable confirmation may the old baseline/checkpoint and Temporary World data be retired according to the recovery policy.

The old Major State must remain available until the new Major State and Applied ledger are durably confirmed. There must never be an interval where neither a complete old state nor a complete new state is recoverable.

### Failure and rollback rules

- **Candidate calculation or validation failure:** discard the Candidate State. The Major State remains exactly unchanged. Do not apply any prefix of the Change Buffer.
- **Transient storage/commit failure:** retain the durable Change Buffer and old Major State; discard any incomplete Candidate State and retry the same package from the same baseline. Do not regenerate expedition rewards or consequences.
- **Entitlement, identity or conservation invariant violation:** treat this as a critical integrity failure, not as a normal gameplay loss. Do not commit the package. Roll the campaign back to its expedition-start Major State/checkpoint and reset/restore the entire expedition from its start checkpoint, rather than returning a partially reconciled result. The player may lose the progress of that expedition attempt, but must not lose assets they had before it or receive a corrupted partial result.
- **Unrecoverable inability to prove a complete state:** fail closed. Keep Main World simulation disabled and retain all available checkpoints, buffers and diagnostics. Never choose a partial state or silently discard an unresolved entitlement.

A legitimate in-game loss remains possible only when it is an explicit, validated gameplay consequence represented in the finalized Change Buffer. A mismatch, missing mapping, failed write or broken reconciliation is never a gameplay loss.

### Atomic promotion

The implementation may use snapshots, copy-on-write, versioned save slots, transactional storage or another mechanism, but its observable guarantee must be equivalent:
- The old Major State remains readable and recoverable during staging.
- Candidate State is isolated until fully validated.
- Promotion is atomic from the perspective of all campaign readers.
- The package Applied marker and the new Major State become durable together.
- Recovery after interruption selects either the complete old Major State with its pending Change Buffer, or the complete new Major State with the package marked Applied. It must never select a half-written mixture.

This contract describes logical state ownership and failure guarantees; it does not prescribe a specific in-memory data structure or storage technology.

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

If validation detects an ordinary stale-state conflict:
- Keep the immutable package and diagnostics.
- Do not commit any operation.
- Keep the encounter/session recoverable and do not resume Main World simulation until Cassandra resolves the conflict.

If Candidate State preparation or transient commit I/O fails:
- Commit no partial domain changes.
- Keep the old Major State unchanged and retain the durable Change Buffer.
- Discard only the incomplete Candidate State and retry from the same baseline.

If an entitlement, identity-mapping or conservation invariant fails:
- Treat it as a critical integrity failure.
- Do not return a partial result or reinterpret the missing result as a gameplay loss.
- Roll the campaign back to the expedition-start Major State/checkpoint and reset/restore the complete expedition from its start checkpoint.
- Preserve diagnostics and recovery data until the rollback is confirmed.

If the process crashes during staging or promotion, recovery must select either the complete old Major State plus pending Change Buffer, or the complete new Major State plus Applied ledger. A half-written mixed state is never acceptable.

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


## 14. Recommended technical defaults for implementation review

**Status:** Approved implementation defaults for the first Cassandra protocol version; serialized schema and runtime API remain versioned and may evolve only through explicit schema changes.

### 14.1 Canonical package envelope

Use one immutable package envelope with these conceptual fields:

| Field | Purpose |
|---|---|
| `schemaVersion` | Cassandra change-package schema version, independent of Engine save/spatial schema |
| `packageId` | Globally unique stable identity created once at finalization |
| `sessionId` | Expedition session that produced the package |
| `source` | Main World ID, persistent location ID/revision and Temporary World runtime ID |
| `baseline` | Sorted list of touched campaign aggregate IDs and their expected revisions |
| `projectionMappings` | Campaign identity ↔ encounter runtime identity mapping and baseline fingerprint |
| `operations` | Ordered typed domain operations with stable operation IDs and dependencies |
| `returnManifest` | Explicit final disposition/reconciliation for every persistent or transferable result |
| `outcome` | End/Abandon result, Clear/Not Clear and final encounter outcome metadata |
| `digest` | Integrity digest over canonical package content excluding the digest field itself |

The package is finalized once, serialized canonically and never edited in place. Any corrected outcome is a new package with a new ID and an explicit replacement/reconciliation relationship.

### 14.2 Aggregate revisions

**Recommended default:** use a monotonically increasing safe-integer revision per persistent campaign aggregate, rather than one global campaign revision.

- Every operation declares the aggregate it targets and the expected baseline revision.
- All operations against the same aggregate in one package validate against the same baseline revision.
- A successful package increments each touched aggregate exactly once, regardless of how many operations target it.
- Unrelated aggregates may change without causing a false conflict.
- A touched aggregate with a different current revision causes a package conflict; no automatic rebase is performed.
- If an aggregate cannot yet provide a monotonic revision, use a stable content fingerprint as an explicitly marked fallback, not an implicit mixture of revision types.

### 14.3 Typed operation envelope

Each operation should contain:
- Stable `operationId`, unique within the package.
- Versioned `type` from Cassandra's operation registry.
- Target aggregate identity and expected baseline revision.
- Optional `dependsOn` operation IDs.
- Typed payload with exact entity/resource/item identifiers and quantities.
- Provenance/source references back to the encounter mapping or manifest entry.

The package operation list is deterministic. Dependencies must be acyclic; independent operations are applied in stable operation-ID order. Unknown operation types, missing dependencies or cycles reject the entire package.

Recommended operation families:
- Entity create/update/retire for durable campaign identities.
- Participant disposition/return for mapped pawns and shuttle objects.
- Inventory stack transfer/add/remove/consume.
- Resource quantity delta and extraction.
- Persistent location terrain/object/resource change.
- Encounter outcome and location Clear/Not Clear/Done metadata.
- Reward/result creation.

Avoid unrestricted JSON merge/patch operations. Each operation must validate domain constraints and declare its target aggregate.

### 14.4 Identity for newly acquired objects

Temporary runtime IDs must not become campaign IDs by accident.

- New encounter results use stable package-local `resultKey` values.
- Before Candidate State construction, Cassandra resolves each result key to a durable campaign identity.
- The resolved mapping is stored in the durable pending Change Buffer before promotion, so a retry reuses the same identity.
- The Applied ledger records the final `resultKey → campaignEntityId` mapping.
- Replaying the same package cannot create a second identity for the same result key.

### 14.5 Manifest and conservation

Each persistent/transferable result must have exactly one final disposition:
- `returned` to a campaign owner/destination,
- `retainedAtLocation`,
- `consumed`,
- `destroyedOrLost` by an explicit gameplay consequence, or
- `transient` under an explicit discard rule.

For non-fungible objects, reconcile stable object/stack identity and exactly one disposition. For fungible resources, reconcile integer or fixed-precision quantities by resource type and unit; do not use floating-point quantities for conserved inventory.

A package is invalid if an item, stack, pawn, reward or resource quantity is missing from the manifest, duplicated, assigned to multiple final destinations or reduced without an explicit gameplay operation.

### 14.6 Digest and ledger

**Recommended default:** calculate a SHA-256 digest over a canonical UTF-8 serialization of the finalized package excluding the digest field. Canonicalization must define stable object-key ordering, array ordering and numeric representation. The digest detects accidental or inconsistent mutation; it is not an authentication/signature mechanism.

The Applied ledger entry should include:
- Package ID and digest.
- Session ID.
- Resulting Major State/campaign revision.
- Commit generation/sequence.
- Resolved result-key identity map.
- Applied status.

Package ID reuse with another digest is a critical integrity error. An already-applied package with the same digest returns Already Applied without repeating operations.

### 14.7 Candidate and promotion boundary

The simplest initial model is:
1. Keep Major State and durable pending Change Buffer in the authoritative campaign save.
2. Build Candidate State as an isolated detached/copy-on-write result; Candidate need not be independently authoritative or survive a crash because it can be rebuilt from the same Major State and Change Buffer.
3. Validate all operations, aggregate revisions, manifest entries, identity mappings and conservation invariants.
4. Prepare one complete replacement campaign snapshot containing the new Major State, Applied ledger entry and completed/cleared pending-buffer status.
5. Commit that replacement through one atomic durable storage operation.
6. Treat the operation as successful only after the storage adapter confirms completion and the committed state can be reopened/validated.

Before the commit, a crash recovers old Major State + pending Change Buffer. After the commit, a crash recovers new Major State + Applied ledger. No combination of separate writes may be treated as atomic.

If the target backend cannot atomically replace one complete campaign save, use immutable generation files plus a single atomically replaced manifest/pointer that selects the committed generation. If the pointer itself cannot be atomically replaced, that backend cannot satisfy the campaign commit contract and must not be used for authoritative campaign saves.

### 14.8 Current storage adapter limitation

Source audit of `src/adapters/storage/local-file-save-adapter.js` confirms:
- It accepts only the `dev-lab-workspace` slot.
- Its `.cass` outer envelope is version 1.
- With a File System Access handle it writes one complete file using `createWritable`, `write`, `close`, and attempts `abort` on failure.
- Without a persistent file handle it exports a download; this is not an atomic replacement of an existing authoritative campaign save.
- It is therefore a workspace adapter, not a campaign transaction coordinator or a multi-file transactional store.

The future campaign persistence adapter must explicitly prove the required atomic replacement/generation-manifest guarantee on its target platform. Do not infer this guarantee from the existing workspace adapter or from successful JSON serialization.

### 14.9 Open review points

These defaults are proposed to make the design implementable. The remaining technical review should focus on:
- Whether all persistent domain state can be packaged into one campaign snapshot for atomic replacement.
- Which aggregates need independent revisions and what their canonical identities are.
- The final operation family registry and payload schemas.
- Whether SHA-256 canonical digest is appropriate for the browser/runtime target.
- The actual campaign storage backend and its atomic promotion guarantee.

No Engine API or source/runtime change is authorized by this proposal.

## 15. Open implementation/design details

The following remain proposals or require further review; this document does not silently decide them:

- Exact persistent entity categories eligible for projection and return.
- Exact disposition rules for each pawn/body/equipment category under End and Abandon.
- Whether pending package recovery keeps the full frozen Temporary World snapshot or a smaller sufficient recovery checkpoint.
- Exact persistence transaction coordinator and its integration with future Cassandra campaign save participants.
- Exact location persistence policy for each location type (reusable, one-off, Done/retired).
- Exact user-facing conflict/recovery flow.
- Legacy `.cass` migration and spatial-state conversion, which remain outside this contract.

The recommended default is a Cassandra-owned, all-or-nothing, version-checked, idempotent package with a durable pending state. Keep the Main World paused and the Temporary World frozen until the package is applied or an explicit recovery decision is made.

## 16. Related documents

- `phase-3-brainstorm.md`
- `phase-3-implementation-plan.md`
- `world-lifecycle-contract-proposal.md`
- `spatial-placement-integration-contract-proposal.md`
- `spatial-composition-contract-proposal.md`
- `movement-collision-contract-proposal.md`


## 17. Implementation status (2026-11-15)

The first Cassandra-owned protocol foundation is now implemented on `work` in
`src/gameplay/expedition/cassandra-change-package-system.js`, with unit coverage in
`tests/unit/cassandra-change-package-system.test.js`.

Implemented foundations:
- Canonical JSON normalization and SHA-256 package integrity verification.
- Versioned immutable package envelopes, explicit dispositions, per-aggregate baselines and typed operation dependencies.
- Durable pending Change Buffer staging with an expedition-start checkpoint.
- Candidate State construction from a detached Major State copy.
- Per-aggregate conflict checks, handler-based typed operation validation/application and one revision increment per touched aggregate.
- Stable result-key identity mapping checkpointed into the pending buffer before promotion.
- Idempotent Applied ledger checks and retry behavior.
- A deliberately strict storage boundary requiring a whole-campaign-snapshot atomic replacement capability.

Not yet implemented or proven:
- No production campaign-save adapter currently satisfies the atomic replacement contract. The existing `dev-lab-workspace` .cass adapter is explicitly not accepted by this coordinator.
- No authoritative Cassandra aggregate model or complete domain operation registry is wired into the runtime.
- No campaign projection builder, location-record store, expedition End/Abandon workflow, Temporary World disposal gate or recovery UI is integrated.
- Unit tests have been added but the repository test suite and browser runtime still require execution/verification.

The coordinator must remain unwired to the current workspace adapter until a real campaign persistence backend proves the single-snapshot atomic promotion guarantee. A storage implementation that cannot make that guarantee must fail closed.
