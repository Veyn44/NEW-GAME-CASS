# Phase 2.4 — Persistence and Dev Lab Workspace Plan

**Status:** COMPLETE — implementation, CI and user manual acceptance finished on 2026-11-13. See the final acceptance record at the end of this document.  
**Historical implementation branch:** `next-step/phase-2` (Phase 2 was merged into `main` on 2026-11-13; this branch reference records where the work was developed).  
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

The current application is browser-hosted. The implemented first host adapter lives at `src/adapters/storage/local-file-save-adapter.js` and uses the browser's user-mediated File System Access API where supported.

**Chosen folder/file layout:** the user selects a folder (for example, a folder named `1`); Cassandra reads/writes one file named `save.cass` inside it. The application does not create numbered folders or choose a destination on the user's behalf.

- **Save As:** opens the folder picker, selects the target folder and writes `save.cass`.
- **Save:** writes to the currently selected folder.
- **Load:** opens the folder picker and reads `save.cass` from that folder.
- The selected folder handle exists only in the current application session; after a reload, the user selects the folder again.
- If direct folder access is unavailable, Load uses a `.cass` file input and Save/Save As exports a `save.cass` download. This fallback does not silently pretend to overwrite a selected folder.

The adapter uses `createWritable({ keepExistingData: false })`, writes the complete replacement and commits on `close()`; a failed write attempts `abort()`. The File System Access API stages writable changes and commits them on close. The adapter is host-side only; Core and gameplay remain unaware of browser APIs.

### On-disk file envelope

A `.cass` file is Cassandra's own application save format, not a pre-existing third-party format. Version 1 is UTF-8 JSON with this envelope:

```json
{
  "format": "cassandra.save",
  "fileFormatVersion": 1,
  "data": {
    "metadata": {},
    "schemas": {},
    "snapshots": {}
  }
}
```

The `data` property is the unchanged save payload produced by Core Persistence. The adapter validates the file envelope, then returns `data` to Persistence. Core continues to validate its own save format, participant schemas and snapshots. The file envelope version is separate from `metadata.formatVersion` managed by Core Persistence.

The first adapter deliberately supports one Dev Lab workspace slot per selected folder: `dev-lab-workspace` maps to `save.cass`. This keeps the user-facing folder workflow explicit. A future general player-save adapter may introduce a multi-slot filename policy without changing gameplay participants.

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

### Step 1 — Audit current contracts

- [x] Inspect Core Persistence coordinator and adapter interface.
- [x] Inspect Core Assembly safe-boundary and participant registration.
- [x] Inspect Entity Registry, World Registry and World Context snapshots.
- [x] Inspect Unit and Colony Control participants.
- [x] Identify current application adapter wiring.
- [x] Identify currently missing gameplay-owned world-object persistence.
- [x] Record findings and agreed plan in this document.
- [x] Check that canonical definition loading is synchronous and completes before the user can initiate a restore.

### Step 2 — Finalize a persistence/file contract

- [x] Define the logical workspace slot and folder-to-file mapping.
- [x] Define the `.cass` envelope and independent file format version.
- [x] Define named file save/open pickers and import/export fallback behavior.
- [x] Define safe write replacement and failed-write abort behavior.
- [x] Confirm canonical definitions are loaded before interactive restore.

### Step 3 — Complete platform-neutral snapshot/restore integration

- [x] Add an end-to-end MemorySaveAdapter round-trip test for World + Entity + placement + Unit + Colony Leader.
- [x] Verify stable identity restoration, removal of post-save entities and absence of duplicate Unit instances in that integration test.
- [ ] Add explicit end-to-end rollback/fault-injection coverage for a later participant failure.
- [x] Keep MemorySaveAdapter for deterministic automated tests.

### Step 4 — Implement local file adapter

- [x] Implement under `src/adapters/storage/`; no browser APIs in Core/gameplay.
- [x] Support user-selected named `.cass` files and same-session Save/Load against the selected file.
- [x] Provide explicit file import/export fallback.
- [x] Use staged writable replacement and abort on failure.
- [x] Add adapter tests with injected/mock file handles.
- [x] Run adapter tests in the full automated suite (GitHub Actions success on commit `342b6b1`).
- [ ] Verify actual browser file picker behavior manually.

### Step 5 — Add Dev Lab controls

- [x] Add Save, Save As and Load controls to the Dev Lab ESC pause menu; keep the world HUD/toolbar free of persistence actions.
- [x] Connect them to the shared `core.persistence` service.
- [x] Show current file status and operation failures in the pause menu.
- [x] Do not add Dev Lab-specific authoritative data models.
- [ ] Manually verify the workflow in the target browser.

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

> **Historical note:** This handoff checklist was written before Phase 2 was accepted and merged. Its instructions to stay on `next-step/phase-2` and avoid modifying `main` are superseded by the completion record at the end of this document. The checklist is retained only as historical context for the original work session.


When continuing this work in a new conversation:

1. Read this file first.
2. Confirm the current branch is `next-step/phase-2` and inspect its latest commit; do not assume the audit baseline is still HEAD.
3. Read `src/core/persistence.js`, `src/core/core-assembly.js`, `src/core/entity-registry.js`, `src/core/world-registry.js`, `src/core/world-context.js`, `src/gameplay/unit/unit-system.js`, `src/gameplay/colony/colony-control-system.js`, `src/host/create-game-runtime.js` and the current application composition before editing.
4. Continue with Step 3 (round-trip integration tests) after checking whether code/contracts changed since the recorded audit.
5. Keep all changes on `next-step/phase-2`; never modify `main` without explicit approval.
6. Do not claim tests or browser checks passed unless they were actually run.
7. Preserve the governing rule: Dev Lab and normal game consume the same gameplay/runtime mechanics; only host composition and presentation differ.

**Last confirmed implementation result:** Core/Unit/Colony Control persistence participants remain the authoritative snapshot owners. The browser Dev Lab injects `LocalFileSaveAdapter`; Save As chooses a named `.cass` file, Save overwrites that selected file, and Load chooses an existing `.cass` file. Browsers without file picker support use explicit import/export fallback. Save / Save As / Load controls live in the ESC pause menu and call the shared `core.persistence` service. The adapter and integrated workspace round-trip tests passed in GitHub Actions (`npm run test:all` and browser entry-point syntax check succeeded on commit `e4b77e9`). Real-browser file picker and reload acceptance remains outstanding.


## Follow-up correction — named save files and pause-menu placement

The first manual browser pass exposed a UX mismatch: the folder-based single-file workflow made Save As equivalent to Save and offered no named save slots. The host adapter now uses `showSaveFilePicker` for Save As and `showOpenFilePicker` for Load. The chosen file handle becomes the current Save target, so Save overwrites that file while another Save As can create a separate named save. Browsers without these APIs retain the import/export fallback, with a user-provided filename for Save As. Save, Save As and Load have been moved out of the Dev Lab toolbar and into the ESC pause menu.

The previous folder-picker acceptance steps are superseded. Verify: create two differently named saves using Save As; change the world between them; Load each file and confirm the corresponding state; then use Save to overwrite only the currently selected file. Repeat after a page reload by choosing the desired file through Load. The `.cass` extension is explicitly offered by the browser picker and validated by the adapter; it is not used as a folder lookup key.


## Manual acceptance evidence — named save/load

The user manually confirmed that Save and Load work in the browser, including saves made in different runtime/control combinations (running without Draft and paused with Draft). A save created while running is restored paused; this is now an explicit restore contract, not an incidental behavior.

A further presentation-state issue was observed: after loading a different workspace, the camera retained its previous position. Camera position/zoom remain excluded from authoritative saves. The host now explicitly clears camera-follow state and resets the camera to the center/default zoom of the restored active world. Restore also clears transient held input and selection state, pauses the Game Clock/input, and refreshes the UI in the paused state. Manual browser verification of this final camera-reset adjustment is still pending.


## 9. Final acceptance — 2026-11-13

**Status: COMPLETE and user-accepted.** This final record supersedes earlier pending/manual-verification notes in the historical sections above.

### User-confirmed browser acceptance

- Save, Save As and Load work with multiple separately named `.cass` files.
- Different saved worlds can be loaded; Units are restored at their saved positions with stable identities and without duplicate instances.
- Draft and No Draft states are restored correctly.
- A save made while the simulation was running is restored paused. This is an intentional safe-load contract.
- The camera resets to the center/default view of the restored world rather than retaining a stale position from another session.
- A malformed JSON save is rejected and the Pause Menu displays a clear `LOAD FAILED · INVALID_SAVE_FILE` message. The existing world remains available; ESC/Main Menu navigation remains usable.
- Reset Lab clears the current Dev Lab session, including live Units, Colony Leader, Draft, selection and transient placement/input state, and leaves the lab paused.
- Reset Lab does not delete or overwrite saved `.cass` files. The user explicitly confirmed that a save remains loadable after Reset Lab.
- The browser workflow was tested repeatedly with different save files and state combinations.

### Automated evidence

Final implementation commit: `e700d22968b1978d9b5e07d7343c8d3439bc26ae`.

- Core and host tests: [GitHub Actions run 43426757709](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43426757709) — success.
- GitHub Pages deployment: [run 43426757277](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43426757277) — success.

### Explicitly deferred

- A separate fault-injection test that forces a later persistence participant to fail during restore was not required for this milestone by user decision. The existing Core Persistence staged-restore/rollback implementation was not changed.
- Full validation of every possible semantically malformed but syntactically valid save is not claimed. The tested corrupted-JSON case is rejected by the existing adapter validation; system snapshot validators continue to own semantic validation.
- Autosave, cloud sync, production player-facing save UI and native desktop storage remain out of scope.

**Acceptance result:** Phase 2.4 is complete and user-accepted. The complete Phase 2 result was reviewed and merged into `main` on 2026-11-13 at commit `31c1cd4bb5f4e9e85bfbb98b863903f57c1f518f`. The earlier handoff instructions in this historical plan that say not to modify `main` applied before acceptance and are superseded by the merge record.
