# Cassandra .cass Save Compatibility & Migration — Working Proposal

**Status:** Working proposal for review; no migration behavior or source changes approved  
**Branch:** work  
**Source audit:** 2026-11-15, work  
**Scope:** Existing .cass file compatibility, save identity boundaries, future spatial-state migration and safe upgrade behavior

This document records the current save implementation and proposes a safe migration boundary for future Cassandra campaign saves. It does not authorize source/runtime changes, a format bump, automatic conversion, or changes to existing save files.

## 1. Purpose and safety requirements

Phase 3 introduces optional grid descriptors, spatial composition/occupancy, spatial queries and movement integration. These capabilities add authoritative state that existing saves do not contain.

The migration must ensure:
- Existing saves are never silently interpreted as a different application or campaign.
- No existing map, entity, placement, environment, inventory or campaign data is silently discarded.
- A missing new required snapshot is never treated as an empty world unless an explicit, validated migration proves that is correct.
- Migration runs against a detached copy and does not mutate the source file.
- The complete migrated state is validated before any participant commits.
- A migration or restore failure leaves the currently loaded runtime unchanged or stopped safely, and the original save remains recoverable.
- A successfully migrated save is written as a new version/copy only after the user/application has an explicit safe-save path; the original source remains available until the new file is confirmed.

Compatibility is an application-level responsibility for Cassandra domain state. Engine provides participant schema migration and transactional restore primitives, but it must not infer Cassandra map, environment, colony or expedition semantics.

## 2. Audited current .cass file format

### 2.1 Outer file envelope

Source: src/adapters/storage/local-file-save-adapter.js

Current constants:
- format = "cassandra.save"
- fileFormatVersion = 1
- Default filename: save.cass
- MIME type: application/vnd.cassandra.save+json

The adapter writes the following logical envelope:

    {
      "format": "cassandra.save",
      "fileFormatVersion": 1,
      "data": {
        "metadata": {},
        "schemas": {},
        "snapshots": {}
      }
    }

The adapter's parser currently accepts only this exact format identifier and outer file version 1. Malformed JSON, another format identifier or another outer version is rejected. The adapter unwraps data and passes it to Engine Persistence.

The adapter exposes an atomic-write contract. With a File System Access handle it writes to a writable stream and aborts on write/close failure. Without a persistent file handle it exports a download. The actual guarantees of the browser/storage provider still need to be verified against the future target platform and interruption model.

### 2.2 Inner Engine Persistence data

Source: engine/core/persistence.js

The inner data has:
- metadata.stateId
- metadata.seed
- metadata.applicationVersion
- metadata.formatVersion
- metadata.createdAt
- metadata.kind (manual or autosave)
- schemas: participant ID → participant schema version
- snapshots: participant ID → participant-owned snapshot

Current Engine Persistence formatVersion default is 1. It is distinct from the outer adapter's fileFormatVersion. The participant schema versions are a third independent version dimension.

Engine Persistence:
- Captures all required participants in deterministic order.
- Validates and detaches JSON-like snapshot data before writing.
- Uses the adapter's writeAtomic operation.
- Validates state identity and format version on load.
- Rejects missing required snapshots.
- Migrates a participant snapshot only when that participant is present and its stored schema differs from the current schema.
- Prepares all participant restore transactions before committing any.
- Rolls back committed participants in reverse order when a commit fails, where participant rollback succeeds.
- Logs and reports rollback failures; it cannot guarantee recovery from an arbitrary participant whose rollback implementation itself fails.

**Important migration limitation:** Engine Persistence has no general hook to synthesize a snapshot for a newly introduced required participant that is entirely absent from a legacy save. Such a save fails with MISSING_REQUIRED_SNAPSHOT. A participant's migrateSnapshot only handles a snapshot that already exists.

### 2.3 Current application identity is not a campaign identity

Sources:
- cassandra/application/cassandra-application-shell.js
- src/adapters/storage/local-file-save-adapter.js
- tests/unit/workspace-persistence-controller.test.js

The current shell configures:
- Save slot: dev-lab-workspace
- State ID: cassandra-dev-lab-workspace
- File extension: .cass

The adapter itself only accepts the dev-lab-workspace slot. The current runtime is composed from the Unit System and Colony Control plus input; the visible shell is the Dev Lab/workspace-oriented prototype surface.

Therefore, the currently audited .cass path is a **Dev Lab/workspace save using the Cassandra file envelope**, not evidence of a complete future Cassandra colony/campaign save format.

This is a critical distinction. It must not be relabelled, auto-converted or treated as proof of cross-save compatibility. Cassandra and Dev Lab are separate applications with separate persistence identity and no cross-save compatibility goal.

## 3. Audited current snapshot participants

The current Core Assembly registers these Core participants:

| Participant | Current schema | Migration observed | Responsibility |
|---|---:|---|---|
| core.entity-registry | 2 | v1 → v2 | Entity identities, scope, lifecycle and metadata |
| core.world-registry | 2 | v1 → v2 | World identities, type, status, dimensions, coordinate system and metadata |
| core.world-context | 1 | None | One placement per entity: world coordinates or store |

The current Cassandra runtime additionally registers:

| Participant | Current schema | Migration observed | Responsibility |
|---|---:|---|---|
| game.unit | 1 | None | Unit ID and definition ID; placement is stored separately in World Context |
| game.colony-control | 1 | None | Colony leader identity and drafted state |

Additional audited details:
- Entity Registry snapshot stores identity/lifecycle records, not Unit domain state or placement. Its v1 migration maps legacy encounter scope fields to the current scoped identity representation.
- World Registry snapshot stores world descriptors and the active-world identity. Its v1 migration moves legacy location/encounter fields into opaque metadata.
- World Registry currently validates at most one active world in a snapshot.
- World Context stores exactly one placement per entity. It has no grid anchor, footprint or multi-cell occupancy model.
- Unit snapshots store Unit-to-definition relationships. Unit positions are held in World Context.
- Unit restore resolves each saved definition ID against the separately loaded definition registry. A missing/incompatible definition rejects restore rather than silently substituting another definition.
- Colony Control restore validates that its saved leader resolves to a restored Unit.
- The current runtime host does not register a Cassandra environment simulation participant or a world-generation/map-state participant.
- The audited current source does not establish a complete persistent colony environment, inventory, expedition, location-resource or temporary-world result model.

These findings describe the current code paths audited on work; they must not be generalized to future Cassandra systems that have not yet been implemented or audited.

## 4. Version dimensions must remain separate

Do not overload one version number for unrelated compatibility contracts.

| Version | Owner | What it versions |
|---|---|---|
| Outer fileFormatVersion | File adapter/application boundary | .cass envelope, encoding and outer structural contract |
| Inner metadata.formatVersion | Engine Persistence contract as configured by host | Generic save-data envelope/metadata/snapshot map contract |
| schemas[participantId] | Each participant | The participant's own snapshot structure |
| Cassandra campaign schema/version | Cassandra application | Domain model: colony, environment, locations, resources, expedition sessions, return packages and campaign state |
| Content/definition version | Cassandra content/database system | Definition identities and compatibility of referenced content |

A participant schema migration must not be used to hide a breaking outer file-envelope change. A Cassandra campaign migration must not be delegated to Engine Core.

## 5. Proposed migration boundary

### 5.1 Application-owned preflight migration

**Proposed default:** Cassandra introduces an application-owned save preflight/migration layer between file decoding and Engine Persistence restore.

Conceptually:

1. Read and decode the original .cass file.
2. Validate the outer envelope and classify its application identity/state ID.
3. Refuse files belonging to another application or workspace unless the caller explicitly invokes a separately supported import workflow. No cross-save conversion is implied.
4. Inspect inner metadata, participant IDs and schema versions.
5. Apply sequential, versioned Cassandra/application migrations to a detached copy.
6. Supply any newly required application snapshot only when the migration can derive it from authoritative legacy data and validate the result.
7. Validate the complete migrated save, including every required participant and all cross-participant references.
8. Pass the normalized save to Engine Persistence for its own participant-level migrations, preparation and transactional restore.
9. Keep the original file unchanged throughout the process.

This preflight is the correct place to synthesize a missing new application participant snapshot. It is not a reason to weaken Engine's required-snapshot rule.

Whether the preflight is implemented as a Cassandra adapter wrapper, a dedicated application migration service, or a new explicit Engine import/normalization API remains an implementation choice. It must not silently mutate the generic Engine Persistence contract.

### 5.2 Legacy workspace saves versus future campaign saves

Keep two migration tracks distinct:

**Track A — Current Dev Lab/workspace .cass**
- Recognize the exact current state identity cassandra-dev-lab-workspace and slot/workspace contract.
- Preserve the current workspace behavior independently.
- Do not reinterpret it as a persistent Cassandra colony or expedition save.
- Do not use it as a migration source for campaign environment, inventory, location or expedition data that it never stored.

**Track B — Future Cassandra campaign .cass**
- Define its own stable campaign state identity, application-owned save schema and required participants.
- Define the authoritative legacy campaign format before writing a migration.
- Migrate only from actual saved domain data that exists in that legacy format.
- Preserve campaign identity, entity identity, world/location identity, resources, environment and other durable data exactly according to their domain contracts.
- Do not reuse Dev Lab's slot or state ID merely because both files have a .cass extension.

The two tracks may share low-level Engine mechanisms and file-envelope code, but they do not share save identity or cross-load compatibility.

## 6. Spatial Composition introduction

The new Spatial Composition participant will be required for a grid-backed world once Cassandra relies on it as authoritative occupancy state. Existing saves will not contain that participant.

The migration must not simply insert an empty Spatial Composition snapshot. That would make a structurally valid save while losing the physical meaning of existing placed entities or map contents.

For each legacy save type, Cassandra must define a domain-specific conversion from the existing authoritative map/placement representation to:
- Explicit World Registry grid descriptors.
- Grid anchor and orientation for each grid-backed entity.
- Canonical footprints and occupancy records.
- Cell-associated contents/environment records where the old save format actually contains them.
- Any required relationship to World Context placement under the agreed coordinated placement contract.

### 6.1 Legacy World Context placements

Current World Context positions are finite world-space coordinates and may be fractional (the current Unit System movement path permits fractional positions). The future grid contract uses discrete integer cell coordinates.

Therefore migration must not silently round every coordinate.

For each legacy source:
- Determine whether its coordinates already represent tile anchors, tile centers or continuous positions.
- Apply one explicitly defined conversion rule for that source schema.
- Validate world bounds and all resulting footprints.
- Reject ambiguous or out-of-bounds placements with a diagnostic migration error.
- Preserve the original save; do not partially commit a converted world.

The proposed grid anchor → world-space position conversion in the placement integration contract is still a technical proposal and must be reconciled with actual legacy coordinate semantics before implementation.

### 6.2 Legacy environment and map state

The current audited runtime does not register a persistent environment/map participant, so there is no current .cass environment snapshot to migrate from the audited workspace format.

For future or separately discovered Cassandra legacy formats:
- Audit the actual environment/map persistence source before defining a converter.
- Preserve tested environment simulation rules; migration transforms saved data, not the simulation algorithm.
- Map every persisted terrain/environment/resource/object datum to its agreed new authoritative owner.
- Do not treat missing data as vacuum, empty terrain, zero resources or a blank map unless the old format's semantics prove that interpretation.
- If the source format cannot reconstruct a required spatial/environment fact, reject migration or require an explicit user-visible recovery path. Never fabricate a plausible but false colony.

## 7. Safe upgrade and source-file preservation

**Proposed default:** A successful migration first produces a validated in-memory state and then a new save file/copy. The original legacy file remains untouched until the migrated copy has been successfully written and verified.

The exact UI flow is open, but it must support:
- Clear indication that the selected save is legacy and will be migrated.
- No automatic overwrite of the only original file during the first migration.
- A new output file or explicit backup-preserving upgrade path.
- Verification by reopening/validating the newly written save.
- Retention of the original until the new save is confirmed usable.

For an in-place future upgrade, the storage adapter must provide a genuinely atomic replace/backup guarantee for the target platform. A successful JSON serialization alone is not proof that the save is durable.

## 8. Failure behavior

- Invalid outer envelope or wrong application identity: reject before runtime mutation.
- Unsupported future version: reject without rewriting the file.
- Missing required legacy data that cannot be derived: reject; never synthesize empty state.
- Participant migration failure: reject before any participant commit.
- Cross-reference or spatial validation failure: reject the entire migrated save.
- Restore commit failure: use the existing participant rollback model; if rollback itself fails, keep the runtime stopped and report a critical restore failure.
- New-file write failure: keep the original legacy file intact and report that migration did not complete.
- Verification failure after writing: do not declare migration complete; preserve the original and the diagnostic copy for recovery.

A migration failure must never lead to a partially restored colony or a rewritten legacy save that has lost data.

## 9. Required compatibility fixtures and acceptance scenarios

The current repository audit found unit tests for the outer adapter and Engine Persistence behavior, but did not identify a checked-in representative golden .cass file fixture. Before implementation, create sanitized, real fixtures from actual supported save outputs; do not invent fixture structures from memory.

Minimum fixture set:
1. Current Dev Lab/workspace .cass outer envelope v1.
2. Current workspace save with Entity Registry schema v1.
3. Current workspace save with World Registry schema v1.
4. Current workspace save with current Entity Registry v2 and World Registry v2.
5. Save with missing required participant.
6. Save with unknown participant/schema version.
7. Malformed JSON and invalid outer envelope.
8. A future Cassandra campaign legacy fixture for each actually supported legacy campaign format, once such a format is identified.
9. A future grid-backed save round-trip fixture containing multiple contents and multi-cell occupancy, after those systems exist.

Minimum acceptance scenarios:
- A current workspace .cass can still be loaded under its own application identity.
- A workspace save cannot be loaded as a Cassandra campaign save or vice versa.
- Outer file version and inner Engine format version are checked independently.
- Entity Registry v1 and World Registry v1 migrations preserve IDs and their documented metadata.
- World Context snapshots are not silently reinterpreted as grid occupancy.
- A missing new required spatial participant invokes the application preflight migration or fails clearly; it is never treated as an empty spatial world by default.
- All participant snapshots and cross-references validate before restore commits.
- A migration failure leaves the source file byte-for-byte unchanged.
- A restore failure does not leave a partially restored runtime; rollback failures are reported as critical and runtime remains stopped.
- New spatial occupancy exactly reconciles with legacy authoritative map/placement data.
- Environment, resources, ownership and all existing domain state survive migration without loss.
- A migrated save can be saved, reopened and validated from its new output file.
- No migration changes the environment simulation rules or Engine/application ownership boundaries.

## 10. Source audit record (2026-11-15)

Audited on branch work:
- src/adapters/storage/local-file-save-adapter.js — outer .cass envelope, strict version-1 parser, workspace-only slot.
- shared/application/file-persistence-controller.js — file selection, save/load/import orchestration and state identity injection.
- cassandra/application/cassandra-application-shell.js — current slot/state ID wiring and current shell composition.
- cassandra/application/cassandra-runtime-host.js — current Cassandra runtime systems and services.
- engine/core/persistence.js — inner format, participant schemas, migration behavior and transactional restore.
- engine/core/core-assembly.js — Core participant registration and persistence boundary.
- engine/core/entity-registry.js — schema v2 and v1 migration.
- engine/core/world-registry.js — schema v2 and v1 migration.
- engine/core/world-context.js — schema v1 placement snapshot, no migration hook.
- src/gameplay/unit/unit-system.js — schema v1 Unit snapshot and definition references.
- src/gameplay/colony/colony-control-system.js — schema v1 Colony Control snapshot.
- tests/unit/local-file-save-adapter.test.js — adapter envelope and file selection behavior.
- tests/unit/workspace-persistence-controller.test.js — workspace slot/state identity behavior.
- tests/unit/workspace-persistence.test.js — workspace round-trip and cross-participant restore.
- tests/persistence-logger.test.js — Engine Persistence schema migration, missing required snapshots, write failure and rollback behavior.

No source/runtime code was changed during this audit.

## 11. Open decisions before implementation

1. Confirm the explicit separation between current Dev Lab/workspace saves and future Cassandra campaign saves (recommended: yes, no cross-save conversion).
2. Define the first authoritative Cassandra campaign save schema and its state identity when the campaign data model is ready.
3. Decide the application preflight migration integration point.
4. Define exact coordinate conversion for each legacy spatial source before deriving grid occupancy.
5. Audit the actual legacy environment/map/resource persistence format before writing any environment migration.
6. Define the golden .cass fixtures and the platform's atomic replacement/backup guarantees.
7. Decide whether legacy saves are upgraded only by creating a new file, or whether a later explicit in-place upgrade is supported.

**Recommended default:** Keep the existing workspace .cass contract isolated; define a distinct campaign save identity/schema; add an application-owned preflight migration that derives every new required snapshot from authoritative legacy data; preserve the source file; and reject any migration that cannot prove data preservation.

## 12. Related contracts

- phase-3-implementation-plan.md
- phase-3-brainstorm.md
- cassandra-temporary-world-change-package-contract-proposal.md
- world-lifecycle-contract-proposal.md
- grid-geometry-contract-proposal.md
- spatial-composition-contract-proposal.md
- spatial-placement-integration-contract-proposal.md
