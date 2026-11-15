# Phase 3 Cross-Contract Integration Audit

**Status:** Documentation audit completed; implementation specification still requires focused closure  
**Branch:** `work`  
**Audit date:** 2026-11-15  
**Scope:** Cross-contract consistency, integrated acceptance coverage and dependency-ordered implementation plan  
**Authority:** This audit records consistency findings and implementation recommendations. It does not authorize source/runtime changes, PR creation/merge or changes to `main`.

## 1. Audit result

The current Phase 3 contracts are **architecturally compatible at the responsibility-boundary level**. No fundamental contradiction was found between optional grid geometry, spatial composition, read-only spatial queries, movement, coordinated placement, world lifecycle, expedition change packages and save persistence.

Several details remain implementation-level proposals rather than approved API specifications. They are called out explicitly below; this audit does not silently promote them to decisions.

One documentation conflict was found and corrected during this audit: older wording required preserving arbitrary existing `.cass` compatibility. The agreed policy is now that Cassandra makes **no general backward-compatibility promise** for saves from older game versions. Unsupported versions may be rejected safely. Selected migrations remain optional and version-scoped.

## 2. Cross-contract invariant matrix

| Area | Authoritative owner | Required invariant | Audit result |
|---|---|---|---|
| World identity/lifecycle | World Registry + lifecycle runtime | Existence, loaded/readiness, simulation, pause, focus and rendering are independent dimensions | Consistent |
| Grid capability | World Registry descriptor | Grid is explicit, optional and immutable for the initial World lifetime; dimensions alone do not imply grid | Consistent |
| Grid geometry | Grid Geometry | Integer cell coordinates, top-left origin, half-open bounds, deterministic conversion | Consistent |
| Entity identity | Entity Registry | One stable identity/lifecycle per entity; spatial references do not duplicate identity | Consistent |
| World/storage placement | World Context | Owns world association and storage placement under its existing contract | Consistent |
| Grid placement detail | Spatial Composition | Owns anchor, footprint, orientation and occupied-cell index | Consistent when coordinated |
| Cross-service placement | Placement Coordinator/integration boundary | World Context and Spatial Composition commit or roll back together; no observer sees an intermediate state | Consistent; API/transaction mechanics open |
| Cell composition | Spatial Composition | Sparse contents; multiple independent contents/entities per cell; empty is neutral; vacuum is explicit | Consistent |
| Spatial queries | Spatial Composition query surface | Read-only, deterministic, bounded, no hidden activation/materialization/mutation | Consistent |
| Movement | Spatial Movement + host policy | Engine commits geometry only; Cassandra decides passability, speed and consequences | Consistent |
| Simulation time | GameClock/Scheduler + world-local time | One global time base; only successful world steps advance that world's local time; paused worlds do not age | Consistent |
| Expedition projection | Cassandra | Persistent campaign identity is distinct from temporary runtime entity identity; explicit mapping | Consistent |
| Expedition result | Cassandra Change Package | Immutable, durable package; explicit disposition/reconciliation; no whole-Main-World replacement | Consistent |
| Campaign promotion | Cassandra Major State + Change Buffer | Build isolated Candidate; validate all; atomically promote Major State + Applied ledger | Consistent |
| Save restore | Engine Persistence + application preflight | Prepare/validate before commit; reject missing/invalid required state; rollback where supported | Consistent |
| Save-version policy | Cassandra application | No general backward compatibility promise; unsupported old versions may be rejected without mutation | Updated and consistent |

## 3. Important integration findings

### 3.1 Placement has two complementary authorities, not two competing authorities

The original Spatial Composition proposal describes World Context as the existing placement authority. The later approved placement decision refines this for grid worlds:

- World Context owns the entity's world association and storage/world placement lifecycle.
- Spatial Composition owns grid anchor, canonical footprint, orientation and occupied cells.
- A grid-backed placement operation is one coordinated transaction.
- Non-grid placement and storage continue to use World Context alone.

This is not a contradiction once the integration contract is read as the refinement of the earlier standalone proposal. All grid placement mutation paths must be routed through the coordinator; direct one-sided updates are forbidden.

### 3.2 Coordinate conversion is approved; fractional movement integration remains open

**Approved direction (2026-11-15):** Grid anchor `(x,y)` maps to World Context world-space cell center `(x+0.5,y+0.5)`. The integer anchor is the anchor cell, not the center of the complete multi-cell footprint. Non-grid positions remain continuous.

Current Unit movement accepts fractional world-space positions. The approved grid anchor mapping remains fixed; the Cassandra adapter must define how fractional movement progress is represented without storing fractional grid anchors. The current viewport also adds `+0.5` for marker drawing and camera follow, so those offsets must be removed or adjusted for grid-backed World Context cell-center positions to avoid a double offset.

Do not silently round existing fractional positions. Legacy fractional coordinates require a source-specific conversion only if that old save version is deliberately supported; otherwise reject it safely. The placement coordinator and transaction mechanics remain open.

### 3.3 Simulation time and expedition pause agree

The lifecycle contract provides one shared global time base and world-local committed simulated time. Cassandra pauses Main World simulation while the Temporary World participates. Consequently:
- Temporary World local time advances by its successful simulation steps.
- Main World local time remains unchanged while paused.
- Returning from an expedition does not apply elapsed Temporary World time to Main World.
- Rendering/focus changes do not advance either world's simulation.

No independent wall clock or per-world time scaling is introduced by this design.

### 3.4 Temporary World results do not use generic Engine transfer as a shortcut

A persistent campaign object and its Temporary World projection use distinct runtime identities connected by a durable session mapping. The change package addresses campaign identities and explicit result keys, not an indiscriminate copy of the Temporary World snapshot.

The package is immutable after finalization. Its return manifest and conservation reconciliation prevent missing items/resources from being treated as normal cleanup. The Main World is not overwritten by the Temporary World.

### 3.5 Major State + Change Buffer is compatible with Engine persistence, but remains Cassandra-owned

The package contract's staged model is:
1. Preserve the last complete Major State.
2. Durably persist the complete Change Buffer and recovery checkpoint.
3. Build Candidate State in isolation.
4. Validate identity, entitlement, ownership, quantity conservation, preconditions and domain invariants.
5. Atomically promote Candidate State and Applied ledger.
6. Dispose Temporary World only after durable confirmation.

Candidate failure leaves Major State unchanged. Transient storage failure retains the buffer for retry. An integrity violation rejects the package and rolls the expedition back to its start checkpoint. This is a Cassandra campaign transaction, not a generic Engine spatial transaction.

The exact storage transaction/atomic-promotion mechanism must be proven against the target persistence backend; a sequence of unrelated file writes is not sufficient. The package proposal now includes concrete defaults for typed operations, per-aggregate revisions, result-key mapping, canonical digest and one atomic campaign-save promotion.

A source audit of `src/adapters/storage/local-file-save-adapter.js` confirms that the existing adapter supports only the `dev-lab-workspace` slot. With a file handle it writes one complete `.cass` file; without a file handle it exports a download rather than atomically replacing an authoritative campaign save. It is not accepted as campaign storage. A candidate `src/adapters/storage/indexeddb-campaign-save-adapter.js` now stores the complete campaign snapshot as one IndexedDB record and requires a strict-durability readwrite transaction with same-transaction compare-and-swap on a monotonically increasing storage revision. Its tests use a deterministic IndexedDB test double and verify stale-writer rejection. This is a promising single-record atomic promotion boundary, but target-browser strict-durability support and crash/reopen behavior still require verification before production integration.

For Engine placement restore, a focused source audit found that the current Persistence implementation awaits participant commits sequentially. Therefore two separate awaited World Context and Spatial Composition participants would not meet the no-observer-intermediate-state requirement. Section 14 of `spatial-placement-integration-contract-proposal.md` records the source-audited composite participant recommendation and restore ordering.

### 3.6 Save compatibility is a product policy, not a migration project

Agreed direction:
- No general requirement to load saves from older Cassandra versions.
- Unsupported outer envelope, inner format, participant schema or content versions may be rejected.
- No permanent historical migration chain is required.
- Selected migrations may be supported explicitly when worth maintaining.
- Rejection/migration failure must not partially mutate the runtime or rewrite the source save.
- Cassandra and Dev Lab remain separate save identities with no cross-save conversion.

The current audited `.cass` workspace save is not a future campaign save and is not a valid source for campaign environment/inventory/expedition migration.


### 3.7 Cassandra source audit: current prototype versus future physical-world systems

The current `work` tree was inspected directly:

- `src/gameplay/unit/unit-system.js`: Unit creation uses integer tile anchors. Grid-backed Units are placed through Placement Coordinator; fractional movement progress is owned and persisted by Cassandra (Unit snapshot schema 2), while Engine occupancy advances only on cell-boundary crossings. Non-grid placement remains supported. Temporary-World Units receive World-scoped runtime identities; Main-World Units retain persistent identities.
- `src/gameplay/colony/colony-control-system.js`: movement speed remains 4 tiles/second; diagonal input remains normalized; Draft and input eligibility are Cassandra-owned; only the leader in `WorldRegistry.activeWorldId` is moved. Movement consumes Unit progress, not Engine placement coordinates.
- `src/gameplay/world/cassandra-world-session-system.js`: Cassandra now owns the one-Main/one-Temporary session rule, active-world participation, independent world-local clocks and session persistence. The local time delta is committed only after its Core scheduler tick succeeds.
- `cassandra/application/cassandra-runtime-host.js`: the runtime composes Input, Unit, Colony Control and World Session; its simulation task passes the actual scheduler tick into the world-session clock commit.
- `cassandra/application/cassandra-application-shell.js`: registers 64×64, 128×128 and 256×256 grid-backed Main World choices, selects the Main World through the session policy and exposes the session API to the application. Temporary World creation is available through the runtime API, but no encounter UI/workflow exists yet.
- `shared/presentation/world-viewport.js`: marker and camera-follow APIs now consume world-space positions directly; cell-center offsets are applied once by callers, avoiding the previous double-offset.
- `src/gameplay/expedition/cassandra-change-package-system.js`: a Cassandra-owned first protocol/coordinator foundation now implements canonical SHA-256 packages, immutable envelopes, per-aggregate baselines, typed dependency ordering, explicit manifest dispositions, durable pending Change Buffer staging, isolated Candidate State, durable result-key identity checkpointing, conflict detection, Applied ledger and idempotent retry. It requires an explicit domain reconciliation callback and a whole-campaign-snapshot atomic storage adapter; it is deliberately not wired to the Dev Lab workspace adapter.\n- `src/gameplay/expedition/cassandra-expedition-projection.js`: a session-scoped one-to-one mapping now validates persistent campaign IDs against distinct scoped Temporary World Engine IDs, supports snapshot restore and enforces one explicit manifest disposition per mapped entity. It records identity/provenance only and does not duplicate Engine placement or inventory state.\n- `src/gameplay/expedition/cassandra-unit-expedition-projection.js`: a real adapter now creates Temporary World Units through the existing Unit API, records each campaign/runtime identity mapping and retires partially created temporary Units if batch projection fails. It copies only the current Unit model's definition and grid-cell position; full pawn state and shuttle projection remain future domain work.\n- `src/gameplay/expedition/cassandra-expedition-projection-system.js`: the projection map is now a required Cassandra persistence participant (order 30) and is composed into the runtime after Unit and World Session. Restore revalidates mappings only after authoritative Engine identities and world-session state are restored.\n- Test coverage has been added/updated for Unit movement, grid occupancy, temporary identities, Main/Temporary session timing, scheduler-fault behavior and Change Package staging/promotion/retry/conflict behavior. Automated execution is now permitted during implementation; user-led acceptance remains deferred until Phase 3 completion. The latest confirmed GitHub Actions run `43764154151` passed 205/205 Core tests and 247/247 host tests, including package-gated Temporary World disposal, standalone Dev Lab vs Cassandra-hosted Engine spatial acceptance, Change Package checkpoint/result identity integrity, cross-writer CAS retries, IndexedDB adapter, projection mapping, Unit projection persistence, region filters and movement history coverage.

**Still not present or not complete in the current branch tree:** Cassandra environment simulation, world generation, persistent location records, expedition workflow, full Unit state/shuttle projection and restore integration, authoritative aggregate models/domain operation handlers, verified production campaign-save integration and full expedition workflow and real Change Package coordinator/runtime wiring. The Change Package/Change Buffer and Applied ledger protocol foundation exists, along with a candidate IndexedDB backend, but neither is yet integrated with authoritative gameplay data or verified in target browsers. These missing domain systems must be audited/implemented when their authoritative models and storage contract are available; their behavior must not be invented from the workspace save.

**Integration consequence:** Grid occupancy is discrete; Cassandra now owns continuous Unit progress and visual interpolation between committed grid anchors. Engine owns only discrete placement/occupancy transactions. The World Session system selects one active Main or Temporary World and advances its local clock after a successful simulation tick. Every future Cassandra simulation task must still respect this participation policy; the current prototype has only one gameplay simulation task and no environment/world-generation systems to gate.

## 4. Remaining implementation-level closure

These items are not contradictions; they must be resolved before the dependent implementation slice:

1. **Placement integration:** exact coordinator location/API, prepared-state transaction mechanism, mutation encapsulation, observer/persistence safe boundary and rollback implementation. The coordinate mapping is now approved.
2. **Legacy coordinate migration:** define a source-specific conversion only for any old save version Cassandra deliberately chooses to support; otherwise reject it safely. Never round fractional positions implicitly.
3. **Persistence registration:** finalize the composite placement participant ID/schema, dependency order, cross-service validation, fatal rollback behavior and restore tests.
4. **Save support matrix:** declare which current outer/inner/participant/content versions are accepted; reject everything else clearly. Golden fixtures must be generated from actual supported outputs.
5. **Campaign save model:** identify the future campaign save identity and authoritative campaign/location/environment participants; do not infer them from the current workspace save.
6. **Change package:** review the proposed package envelope, typed operation families, per-aggregate revision model, canonical digest and result-key mapping; verify durable Change Buffer/ledger and idempotent retry semantics.
7. **Campaign recovery:** choose the actual campaign storage backend, define the frozen Temporary World checkpoint and prove atomic Major State + Applied ledger promotion/recovery.
8. **Future physical-world source audit:** current Unit/Colony Control and viewport paths have been inspected. Environment simulation, world generation, expedition flow, Temporary World runtime and their tests are not present in the current branch tree and must be audited when available.
9. **World lifecycle runtime details:** the initial Main/Temporary session and local-clock system now exists. Final review remains for world-failure/global-clock policy, restore readiness sequencing, and participation gating as additional simulation systems are introduced.

The generic Engine spatial and coordinated-persistence boundaries are implemented. The Main/Temporary session and first Change Package protocol foundations are implemented in Cassandra. The remaining critical gap is authoritative campaign data/domain integration and production verification of the candidate IndexedDB backend's strict-durability atomic Major State + Applied ledger promotion, plus connecting the projection map to actual encounter entity construction and recovery.

## 5. Integrated acceptance matrix (Step 9)

Every scenario below must be covered by an automated test or a clearly identified manual acceptance test. Existing tested environment behavior is a protected regression area.

### A. Geometry and world capability
- A non-grid World remains valid even with generic dimensions.
- Grid capability is explicit in the World descriptor and dimensions are positive safe integers.
- Integer cell coordinates use top-left origin and half-open bounds.
- Fractional cell coordinates are rejected; world-space-to-cell conversion uses the defined floor rule.
- 128×128 and 256×256 Cassandra worlds are supported without Engine hard-coded size limits.
- Viewport/camera/rendering changes never mutate grid geometry.

### B. Composition and identity
- An untouched in-bounds cell returns neutral empty composition without materialization.
- Vacuum/environment content is independent from empty-cell default.
- Multiple entities and cell-associated contents coexist at one coordinate.
- One multi-cell entity retains one Entity Registry identity and one canonical footprint.
- Non-rectangular footprints and supported quarter-turn orientations derive deterministic occupied-cell sets.
- Duplicate IDs, invalid references, invalid orientations and out-of-bounds footprints are rejected.
- Derived reverse indexes rebuild from canonical records and reconcile exactly.

### C. Queries
- Cell, explicit cell-set, bounded region, entity occupancy, footprint, neighbor and radius queries return deterministic results.
- Entity-oriented queries deduplicate multi-cell entities.
- Region queries distinguish anchor inclusion from footprint intersection.
- Queries do not create cells, activate worlds, simulate, mutate state or repair snapshots.
- Inactive-world queries are allowed only when the required spatial snapshot is already available.
- Out-of-bounds, non-grid, unknown-world and unavailable-snapshot results remain distinguishable.

### D. Placement and movement
- Non-grid placement and storage continue to work through World Context alone.
- Grid placement/move/rotation/footprint replacement update World Context and Spatial Composition together.
- No query, event, renderer, simulation system or persistence capture observes cross-service intermediate state.
- Failure in either commit restores both services exactly.
- Rejected host policy leaves old occupancy unchanged.
- Engine reports geometric facts; Cassandra decides passability, blocking, speed, costs and consequences.
- Existing 4 tiles/second speed and diagonal normalization remain Cassandra-owned.
- Fractional movement progress is never silently rounded into a grid anchor; the Cassandra movement adapter owns progress/interpolation while Engine occupancy remains discrete.
- Grid-backed marker drawing and camera follow apply the cell-center offset exactly once.
- No movement operation advances simulation time or changes health/inventory by itself.

### E. World lifecycle and time
- Main and Temporary Worlds coexist.
- Registration, loading/readiness, simulation participation, pause, focus and rendering are independently testable.
- A selected/active World identifier is not used as a proxy for simulation participation; the current single-active-world prototype behavior does not constrain the future lifecycle model.
- Only participating worlds receive steps.
- Only successful steps advance the relevant world-local simulated time.
- Paused Main World time remains unchanged during an expedition.
- Rendering/focus/selection do not advance simulation.
- A world-local failure is isolated; a shared infrastructure failure may stop the runtime.
- A world that fails after partial synchronous mutation is not resumed without restore/rebuild or an explicitly added transactional mechanism.

### F. Persistence and restore
- World Registry grid descriptors restore before dependent spatial data.
- Entity identities and World Context/Spatial Composition records are cross-validated before commit.
- Spatial snapshots persist canonical content/anchor/footprint data, not rebuildable duplicate indexes.
- Missing required spatial data is rejected unless a specifically supported migration proves the correct result.
- Unsupported historical save versions are rejected cleanly without runtime mutation or source-file modification.
- Current supported save round-trips preserve identity and authoritative state.
- Restore preparation is side-effect-free; commit/rollback failure behavior is tested.
- Environment simulation rules are unchanged by spatial persistence integration.

### G. Expedition and campaign change package
- Expedition creates a Temporary World projection with unique runtime identities and stable campaign mappings.
- Main World simulation remains paused and its local time does not advance.
- Every relevant item/entity/resource/reward has an explicit final disposition.
- Conservation/reconciliation detects missing, duplicated or unexplained quantities.
- Finalized package is immutable and durably retained before Temporary World disposal.
- Candidate State is built from Major State + complete Change Buffer without exposing partial changes.
- Candidate validation failure leaves Major State unchanged.
- Transient commit failure retains the same buffer for retry without duplication.
- Identity/entitlement/conservation integrity failure rejects the entire result and restores the expedition-start checkpoint.
- Atomic promotion commits new Major State and Applied ledger together.
- Temporary World is disposed and Main World resumed only after durable successful application.

### H. Application boundary and regression
- Engine contains no Cassandra-specific entity, environment, expedition or save-domain rules.
- Cassandra owns generation, environment, pawn movement and campaign semantics.
- Dev Lab consumes shared Engine spatial APIs and does not create a parallel occupancy model.
- Existing tested environment simulation and unrelated UI/input behavior remain unchanged unless a separately approved dependency requires a minimal change.
- No cross-save compatibility between Cassandra and Dev Lab is introduced.

## 6. Dependency-ordered implementation sequence (Step 10)

The proposed sequence below is the recommended dependency order, not authorization to begin implementation.

| Order | Slice | Depends on | Main deliverable / exit gate |
|---:|---|---|---|
| 0 | Design closure + baseline | None | Close required design details; locate actual source paths; record current supported save formats/fixtures; baseline tests |
| 1 | Grid Geometry | 0 | World Registry optional grid descriptor, geometry primitives and boundary tests |
| 2 | Spatial Composition | 1 | Sparse contents, canonical footprints, occupancy, deterministic indexes and atomic local updates |
| 3 | Spatial Queries | 2 | Read-only query surface and deterministic/lifecycle-aware results |
| 4 | Movement | 2, 3, placement decision | Generic footprint move transaction with host policy boundary |
| 5 | Persistence | 1, 2, placement decision | Versioned snapshots, dependency-safe restore, cross-service validation, supported-version rejection and rollback |
| 6 | Core assembly | 1–5 | Service registration, participant ordering, non-grid regression and Core integration |
| 7 | Cassandra integration | 6 + package/recovery design | Cassandra grid adoption, movement/environment/worldgen integration, expedition package protocol |
| 8 | Dev Lab integration | 6 | Inspection/test UI using the same Engine spatial services |
| 9 | End-to-end acceptance | 7, 8 | Full regression, integrated matrix, manual acceptance where automation is unsuitable, explicit release review |

### Dependency constraints
- Slice 1 does not depend on Cassandra gameplay rules.
- Slice 2 depends on grid descriptors and Entity Registry identity.
- Slice 3 depends on authoritative Spatial Composition data; it does not create a second store.
- Slice 4 depends on composition and host policy; it must use the coordinated placement boundary for grid-backed entities.
- Slice 5 depends on canonical spatial records and placement ownership; do not persist two conflicting placement authorities.
- Slice 6 follows successful unit/integration behavior of slices 1–5.
- Slices 7 and 8 both depend on the same Engine API; neither may fork occupancy/movement semantics.
- Cassandra expedition change-package work is not interchangeable with Engine cross-world spatial relocation.
- Slice 9 is a gate, not a catch-all implementation phase.

## 7. Explicit non-goals retained

- No source/runtime changes are authorized by this audit.
- No PR merge or `main` update is implied.
- No cross-save compatibility or converter between Cassandra and Dev Lab.
- No requirement to load arbitrary older Cassandra saves.
- No pathfinding, continuous physics framework, universal passability or game-specific movement rules in Engine.
- No changes to tested environment simulation without a concrete dependency and separate approval.
- No hard-coded Engine limit of two Worlds.
- No automatic off-screen simulation of inactive locations unless separately designed for a Cassandra feature.

## 8. Source and related contract references

- `world-lifecycle-contract-proposal.md`
- `grid-geometry-contract-proposal.md`
- `spatial-composition-contract-proposal.md`
- `spatial-query-contract-proposal.md`
- `movement-collision-contract-proposal.md`
- `spatial-placement-integration-contract-proposal.md`

- `cassandra-temporary-world-change-package-contract-proposal.md`
- `cass-save-compatibility-migration-proposal.md`
- `phase-3-implementation-plan.md`
- `phase-3-brainstorm.md`


Manual release checks are prepared but intentionally not executed during implementation:
- `docs/architecture/phase-3-manual-acceptance-checklist.md` covers browser UI, strict IndexedDB durability/CAS, interrupted promotion recovery, target-size performance and regression checks for the previously validated environment simulation.


## 2026-11-15 — Change Package handler isolation

The coordinator no longer gives typed operation handlers a mutable reference to Candidate State. Validation receives a frozen detached snapshot; application receives that same read-only view plus a detached mutable copy of the target aggregate. After the handler returns, the coordinator validates the aggregate revision and clones the result back into Candidate State. A handler retaining its working-copy reference cannot mutate Candidate State after return. Regression coverage verifies attempted cross-aggregate mutation is ineffective and retained references cannot alter the committed campaign snapshot. GitHub Actions run `43762111707` passed Core 205/205 and host 245/245.


## 2026-11-15 — Durable input snapshots and IndexedDB abort regression

Change Package staging now clones and freezes both the package envelope and expedition-start checkpoint before its first asynchronous boundary. Verification, baseline checks, checkpoint hashing, persistence and reopen verification all use those immutable snapshots, preventing caller mutation during staging from changing what is durably recorded. Tests mutate both original inputs immediately after calling `stage()` and verify the originally verified package/checkpoint are retained. The IndexedDB fake transaction now stages writes and applies them only on successful transaction completion; a regression test verifies an aborted write preserves an already durable prior snapshot. GitHub Actions run `43762503871` passed Core 205/205 and host 242/242. Real-browser strict-durability and interruption checks remain manual acceptance items.

The handler-isolation regression additionally mutates a retained working-aggregate reference during the final manifest-reconciliation callback, before promotion; the resulting durable candidate remains unchanged. Verified in run `43762503871` (Core 205/205, host 242/242).


## 2026-11-15 — Temporary World disposal integrity preflight

Before retiring any Unit or scoped Entity, Temporary World disposal now validates the complete WorldContext-placement ↔ Spatial Composition occupancy relationship for the target World: every placement must have a matching occupancy with the expected anchor, every occupancy must resolve to a matching placement, every record must belong to the Temporary World scope, and the collection cardinalities must agree. This prevents a pre-existing spatial mismatch from being discovered only after earlier Units have already been removed. A regression test places a valid scoped Unit before an invalid persistent Entity in the Temporary World and verifies that disposal rejects the entire preflight while preserving the Unit, placement and World. GitHub Actions run `43762809572` passed Core 205/205 and host 245/245.

The Applied-ledger disposal gate also has a negative-path regression: the verifier receives the exact package ID and digest, and a negative result leaves the Temporary World and its contents intact. Verified in run `43763156762` (Core 205/205, host 245/245).

Successful-path disposal is now covered end to end at the current infrastructure level: after exact Applied-ledger verification, the Temporary Unit is retired, its Engine placement/occupancy is cleared, the Temporary World is unregistered, and the projection map is cleared only after World cleanup. The persistent campaign Unit remains intact. Verified in run `43763156762` (Core 205/205, host 245/245).


## 2026-11-15 — IndexedDB concurrent-writer and corruption safeguards

The deterministic IndexedDB test double now serializes transactions against the same database/store, matching the relevant readwrite transaction ordering instead of allowing two fake writers to read the same old revision concurrently. A new concurrent-writer test launches two writes with the same expected revision and verifies exactly one succeeds while the durable record contains only the winning complete snapshot. The adapter also now applies one shared campaign-snapshot shape validator during both load and write preflight; a corrupt existing snapshot is rejected and preserved rather than silently overwritten by a writer with the matching revision. GitHub Actions run `43764154151` passed Core 205/205 and host 247/247. These are deterministic contract tests, not a substitute for browser-specific strict-durability and crash/reopen verification.
