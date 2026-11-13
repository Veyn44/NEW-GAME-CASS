# Phase 2.4 — Persistence and Dev Lab Workspace Plan

**Status:** Step 1 audit complete; implementation not started.  
**Working branch:** `next-step/phase-2`  
**Repository:** `Veyn44/NEW-GAME-CASS`  
**Audit baseline:** branch head `a3337c10cb9dc97665f78d9fb71e06e3b82a66ef`  
**Purpose:** Record the agreed architecture, current implementation facts, decisions, risks and ordered work so a later session can continue without relying on chat history.

## 1. Accepted architectural decision

Dev Lab is a development host for the same reusable gameplay/runtime systems that the normal game will use. It is not a separate game implementation and must not own parallel copies of gameplay mechanics or authoritative game data.

Persistence follows the same rule:

- Persistence is a general runtime capability.
- Gameplay systems own and serialize their own domain state through the shared Persistence contract.
- Core serializes only Core-owned state.
- Storage location and file-picker interaction belong to host/application adapters, never to gameplay systems or Core.
- Dev Lab provides development-only Save / Save As / Load controls for exercising the shared persistence pipeline.
- The normal game will later use the same persistence services and adapters/contracts with player-facing UI and game-session flow of its own.
- Do not implement a Dev-Lab-only save database or duplicate world/entity/unit data.
- No automatic Johny spawn. An empty world remains empty until the developer creates content. If a Unit is saved, its stable identity and state must be restored, not recreated as a second instance.

This is an explicit continuation of the existing Dev Lab/gameplay separation decision in `WHATANDWHY.md`.

## 2. Current implementation audit

### 2.1 Existing Persistence coordinator

File: `src/core/persistence.js`

The shared `Persistence` service already exists. Its current adapter contract is:

- `read(slotId)`
- `writeAtomic(slotId, saveData)`

The coordinator already provides:

- participant registration with stable IDs and per-participant schema versions;
- deterministic participant ordering;
- detached serializable snapshots and metadata;
- required/optional participant handling;
- validation and migration hooks;
- safe-boundary execution supplied by Core Assembly;
- serialized overlapping persistence operations;
- atomic-write expectation at the adapter boundary;
- staged restore transactions with `commit()` and `rollback()`;
- rollback of participants already committed if a later commit fails;
- format/application metadata and save kind (manual/autosave).

`MemorySaveAdapter` is currently implemented in the same file and is explicitly described as the deterministic adapter for tests and early integration.

### 2.2 Core-owned participants already registered

File: `src/core/core-assembly.js`

Core Assembly registers these participants automatically:

| Participant | Order | Owned data |
|---|---:|---|
| `core.entity-registry` | -100 | Stable entity identities and generic lifecycle records |
| `core.world-registry` | -90 | World descriptors, dimensions, status and active-world identity |
| `core.world-context` | -80 | Entity placements in worlds/stores |

These participants keep identity, world descriptors and placement separate. This is the correct ownership model; do not combine them into a second save-specific world database.

### 2.3 Gameplay participants already implemented

| Participant | Order | Owned data |
|---|---:|---|
| `game.unit` | 0 | Unit instance records and canonical definition IDs |
| `game.colony-control` | 10 | Colony Leader Unit ID and Draft state |

The Unit participant validates that restored Unit records refer to active Core identities, valid world placements and available canonical definitions. Consequently, canonical definitions must be loaded/registered before the Unit restore commits. The existing application loads canonical definitions during startup; the exact startup/restore ordering must be verified when integrating file-backed load.

Colony Control restores only after Unit state due to participant order and validates its Leader reference against restored Units.

### 2.4 Current storage wiring

File: `src/application/application-shell.js`

The current browser application imports and instantiates `MemorySaveAdapter`. It passes this adapter into the host runtime. This means saves currently exist only in memory and do not survive a page reload or new application session.

File: `src/host/create-game-runtime.js`

The host accepts a `saveAdapter` and forwards it to Core Assembly. This is already a useful seam: the host selects the adapter, while Core and gameplay systems consume the shared Persistence service.

### 2.5 Current world/content coverage and gaps

Already covered by persistence:
- world dimensions/descriptors and active-world identity;
- Core Entity identity records;
- entity placements;
- Unit records and canonical Unit Definition references;
- Colony Leader identity and Draft state.

Not yet represented by a concrete gameplay owner/system in the current slice:
- wall, door and general placed-structure instances;
- object durability/damage state;
- other future world-object/domain state.

Those must be added as their actual gameplay systems are implemented. Do not put future structures into a generic Dev Lab-only object list. Each owning gameplay system must register its own persistence participant when it has authoritative domain state.

Presentation-only state such as camera position/zoom may be considered optional later. Selection, open panels, pointer/key state and other transient UI/input state are not part of the authoritative world save.

## 3. Storage direction

### Accepted direction

The user's preference is physical local disk storage with an explicit choice of destination. Do not use browser localStorage/sessionStorage or an in-memory cache as the primary user save location.

### First host implementation target

The current application is browser-hosted. Implement the disk adapter at the host/adapter boundary using the browser's user-mediated file access capability where supported:

- Save As: ask the user to choose a destination and filename.
- Load: ask the user to choose an existing Cassandra save file.
- Save: write to the currently selected file when its handle/permission is available.
- If the browser cannot provide persistent direct file access, provide an explicit export/download and import/upload fallback rather than silently changing the storage model.

Browser file access is permission-based and browser-dependent. A previously selected file handle/permission may need to be reacquired after reload. The UI must communicate this honestly and must not assume a remembered file handle always survives a new browser session.

The file extension will be `.cass`. The exact on-disk envelope must be designed against the existing Persistence metadata/snapshot format; avoid duplicating or transforming participant-owned snapshots unnecessarily.

### Future native host compatibility

Keep the adapter boundary platform-neutral. If Cassandra later ships as an installed desktop application, a native filesystem adapter can implement the same storage contract without changing gameplay systems or Core persistence participants.

Do not decide or implement a native desktop runtime in this task. Do not make the browser API a dependency of Core or gameplay code.

### Important adapter design question to resolve before coding

The current adapter contract is keyed by logical `slotId`, while the user's workflow selects physical files. Design a small host-side mapping between a selected file handle and a logical persistence slot, or propose a carefully justified adapter-contract refinement if the current contract cannot express this cleanly.

For Load, the file picker should select a file and associate it with a logical slot before calling `Persistence.load(slotId)`. For Save As, choose/create a file, associate it with a slot, then call `Persistence.save(slotId, ...)`. Save should target the currently selected file. The file adapter must meet the existing atomic-write safety expectation or document and test a safe replacement strategy; do not merely rename a non-atomic write as atomic.

## 4. Intended user workflow

Dev Lab will eventually expose:

- **Save** — save the current world to the currently selected save file.
- **Save As** — choose a new destination/name and save the current world there.
- **Load** — select an existing `.cass` file and restore it.

A newly opened application must not assume it has permission to overwrite a file selected in an earlier session. Load/Save As should re-establish access as needed. The exact UI placement is a later implementation detail; do not redesign the Dev Lab layout during the persistence audit.

## 5. Data and restore invariants

1. One authoritative world state; no Dev Lab mirror database.
2. No automatic Unit/Pawn/Johny creation during startup or load.
3. Stable Entity IDs are restored exactly; they are not regenerated.
4. Core identity and placement remain owned by Core participants.
5. Unit/domain records remain owned by their gameplay systems.
6. Canonical definitions are content assets/registry entries, not copied into save files as a second source of truth. A save with a missing required definition must fail clearly or use a deliberate migration; never invent a replacement.
7. Every stateful gameplay system adds its own versioned participant.
8. Restore must validate/stage before mutating live state. A corrupt/incompatible save must not leave a partially restored world.
9. Saving must occur at the existing Core safe boundary, with simulation pause/serialization semantics preserved.
10. Transient presentation/input state is excluded unless a later explicit decision adds optional presentation metadata.
11. Environment simulation rules are out of scope and must not be changed by this work.
12. Do not modify `main`; all work remains on `next-step/phase-2`.

## 6. Ordered implementation plan

### Step 1 — Audit current contracts (this step)

- [x] Inspect Core Persistence coordinator and adapter interface.
- [x] Inspect Core Assembly safe-boundary and participant registration.
- [x] Inspect Entity Registry, World Registry and World Context snapshots.
- [x] Inspect Unit and Colony Control participants.
- [x] Identify current application adapter wiring.
- [x] Identify currently missing gameplay-owned world-object persistence.
- [x] Record findings and agreed plan in this document.
- [ ] Complete any additional code-level checks needed before adapter implementation (especially browser file access support and atomic replacement semantics).

### Step 2 — Finalize a persistence/file contract

- Define the logical-slot-to-selected-file mapping.
- Define the `.cass` envelope, metadata and compatibility/version policy.
- Define Load/Save As permission and fallback behavior.
- Define safe handling for invalid files, missing definitions and failed writes.
- Confirm canonical definition loading happens before domain restore.
- Add/update architecture documentation before implementation if any contract changes.

### Step 3 — Complete platform-neutral snapshot/restore integration

- Verify all currently registered participants round-trip together.
- Add end-to-end tests for World + Entity + placement + Unit + Colony Control.
- Verify stable identity restoration and absence of duplicate/autospawned Johny.
- Verify rollback when a later participant fails.
- Keep MemorySaveAdapter for deterministic automated tests.

### Step 4 — Implement local file adapter

- Implement under `src/adapters/` or the approved host adapter location; no browser APIs in Core/gameplay.
- Support user-selected `.cass` files and same-session Save.
- Provide explicit browser-compatible import/export fallback where needed.
- Verify the adapter's write/replace behavior against the Persistence atomic-write contract.
- Add adapter tests with injected/mock file handles where practical.

### Step 5 — Add Dev Lab controls

- Add Save, Save As and Load as development-host controls.
- Connect them to the same `core.persistence` service used by the normal game.
- Show clear success/failure and current save-file status.
- Do not add Dev Lab-specific authoritative data models.

### Step 6 — Acceptance and Phase 2.4 evidence

- Save a manually created Johny and world state, reload the page, choose the file and restore the same identity and position.
- Save multiple Units and verify all stable IDs and placements.
- Overwrite the selected file and verify previous data remains valid if a write fails.
- Load a different save file and verify world replacement is coherent.
- Reject malformed, truncated, unsupported-version and incompatible saves without partial mutation.
- Verify missing canonical definitions fail clearly.
- Verify failed restore rolls back committed participants.
- Verify repeated Save → Load → Save → Load cycles.
- Run `npm run test:all` and record actual results.
- Perform manual browser verification and record browser/version/permission behavior.
- Keep production player save UI, autosave policy, cloud saves and native desktop packaging out of scope unless separately approved.

## 7. Non-goals

- No player-facing Save/Load menu in the normal game yet.
- No autosave policy or cloud synchronization.
- No separate Dev Lab persistence model.
- No automatic test-world population or Johny spawn.
- No new generic structure/object registry merely to save future walls and doors.
- No change to environment simulation.
- No Core redesign unless a concrete domain-neutral limitation is demonstrated.

## 8. Handoff / resume instructions

When continuing this work in a new conversation:

1. Read this file first.
2. Confirm the current branch is `next-step/phase-2` and inspect its latest commit; do not assume the audit baseline is still HEAD.
3. Read `src/core/persistence.js`, `src/core/core-assembly.js`, `src/core/entity-registry.js`, `src/core/world-registry.js`, `src/core/world-context.js`, `src/gameplay/unit/unit-system.js`, `src/gameplay/colony/colony-control-system.js`, `src/host/create-game-runtime.js` and the current application composition before editing.
4. Continue with Step 2 only after checking whether code/contracts changed since the recorded audit.
5. Keep all changes on `next-step/phase-2`; never modify `main` without explicit approval.
6. Do not claim tests or browser checks passed unless they were actually run.
7. Preserve the governing rule: Dev Lab and normal game consume the same gameplay/runtime mechanics; only host composition and presentation differ.

**Last confirmed audit result:** Persistence foundations and Core/Unit/Colony Control participants exist; the browser application still injects `MemorySaveAdapter`; no local-file save adapter or Dev Lab Save/Load UI has been implemented by this plan.
