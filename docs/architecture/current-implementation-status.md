# Current Implementation Status

**Audit date:** 2026-11-16  
**Repository:** `Veyn44/NEW-GAME-CASS`  
**Working branch:** `work`  
**Audited work HEAD:** `90cf0b6f67155358089f1c007e06a78767746564`  
**Audited main HEAD:** `458ecc52d4267b6b31fb3d59559374533c49fa64`  
**Documentation reconciliation commits:** `bdbf56312f3e5e24ccd5f7da83b4d519a991a928`, `2d52d21bbbe183b7199c6b1d85153f14c6326bb4`

This is the current status index for the implementation described by the Phase 3 plans and architecture reviews. Where older sections of those documents still describe pre-implementation gaps or old test counts, this dated status record supersedes those historical statements. Source code and current tests remain authoritative.

## 1. Branch and change safety

- All work described here is on `work`.
- `main` remains at `458ecc52d4267b6b31fb3d59559374533c49fa64` and is not part of this work.
- The latest audited `work` HEAD is a documentation-only follow-up to the lifecycle implementation.
- No merge or pull request is authorized by this status record.

## 2. Phase 3 implementation summary

| Slice | Current status | Scope boundary |
|---|---|---|
| 1 — Grid Geometry | Implemented | Generic grid descriptor validation, cell/world conversion, bounds, neighbors and distance primitives |
| 2 — Spatial Composition | Implemented | Sparse cell contents, canonical footprints and occupancy/index management |
| 3 — Spatial Queries | Implemented | Deterministic read-only cell, region, neighbor, radius and footprint queries |
| 4 — Movement | Implemented | Generic footprint movement with host-supplied policy; no Cassandra passability rules |
| 5 — Persistence | Implemented | Composite World Context + Spatial Composition persistence and coordinated restore/rollback |
| 6 — Core Assembly | Implemented | Application-neutral service wiring and persistence participant ordering |
| 7 — Cassandra integration | Partially implemented | Unit/grid movement, Main/Temporary session, scoped projection and Change Package infrastructure exist; authoritative campaign gameplay and browser backend verification remain open |
| 8 — Dev Lab integration | Implemented for automated spatial workflow | Shared Engine inspection/test controllers and host parity exist; browser interaction/layout acceptance remains open |
| 9 — End-to-end acceptance | Pending | Automated tests exist; manual/browser and target-platform checks remain outstanding |

“Implemented” for an infrastructure slice does not imply that the full Cassandra game, campaign or player-facing expedition workflow exists.

## 3. Engine multi-world runtime

The initial deterministic multi-world lifecycle contract is implemented on `work`.

### Ownership and behavior now present

- `engine/core/world-runtime-manager.js` provides `WorldRuntimeManager` and `WorldRuntimeError`, published as `core.world-runtime`.
- World Registry continues to own registered world descriptors. World Runtime Manager separately owns runtime readiness/lifecycle, simulation participation, pause reasons, committed local simulated time and completed local steps.
- Multiple worlds may be Ready and may participate in the same global simulation round.
- Simulation tasks support `scope: "global"` and `scope: "world"` within one dependency-ordered task sequence. Existing tasks default to Global.
- World tasks execute in deterministic ascending ordinal world-ID order and receive immutable world context.
- The scheduler takes an immutable participant snapshot for each round. Participation changes apply at the next round; lifecycle transitions that would load/unload/dispose a world are rejected during an active round.
- The global Game Clock remains the shared time base. Each participating world advances its own committed simulated time/step count only after the complete round succeeds.
- If no world participates, no simulation round or simulation task runs and no backlog is accumulated for later replay.
- Runtime state is persisted as a required participant for new saves. A missing participant in an older save is handled by an explicit compatibility restore to registered-but-Unloaded and simulation-disabled worlds.
- Cassandra's current host policy selects Main or Temporary World participation; Dev Lab prepares its editor world before enabling its world-scoped host task.

### Explicit limitations

- Execution is deterministic and sequential. It is not parallel or multithreaded CPU simulation.
- A task failure still faults and globally pauses the scheduler. Arbitrary domain mutations performed earlier in the failed round are not automatically rolled back.
- Per-world fault isolation, arbitrary world rollback and automatic recovery are not implemented.
- This runtime contract does not implement Cassandra encounter/gameplay rules.

## 4. Cassandra integration — what exists and what does not

### Implemented infrastructure

- Main World grid choices include 64×64, 128×128 and 256×256 descriptors.
- Unit placement uses Engine grid occupancy through Placement Coordinator; Cassandra retains continuous movement progress while Engine occupancy advances at discrete cell boundaries.
- Cassandra retains ownership of movement speed, diagonal normalization, Draft/input eligibility and its current movement policy.
- A Main/Temporary World session system enforces Cassandra's one-Main/one-retained-Temporary policy without imposing a two-world limit in Engine.
- Temporary World Units use scoped runtime identities; projection mappings are persisted and restored after their authoritative Engine/Unit dependencies.
- Temporary World disposal requires an exact Applied-ledger verification and performs a full placement/occupancy integrity preflight before destructive cleanup.
- Change Package/Change Buffer foundations include immutable package envelopes, baselines, typed operation coordination, candidate state isolation, explicit return dispositions, identity mapping, Applied ledger and idempotent retry behavior.
- A candidate IndexedDB campaign adapter uses a single-record snapshot and strict-durability readwrite compare-and-swap semantics. Its deterministic adapter tests cover concurrent writers, stale revisions, corrupt snapshots, aborted writes and detached snapshots.

### Not complete / not present in the audited tree

- Authoritative campaign aggregate models and production typed domain operation handlers.
- Full inventory/resource/equipment/health/crew/shuttle state projection and reconciliation.
- Complete conservation and return-disposition rules tied to actual authoritative gameplay models.
- Player-facing expedition creation, End Expedition and Abandon Expedition workflow.
- Complete production campaign persistence integration and real-browser strict-durability/crash-reopen verification.
- Authoritative Cassandra environment simulation and world-generation modules were not located in the audited branch tree. Their rules and regression behavior must not be invented from the current workspace prototype.

The existing infrastructure is a foundation only. The outstanding gameplay/domain contracts require joint design before implementation.

## 5. Dev Lab integration

- Standalone Dev Lab composes shared Engine Core services.
- Spatial inspection reads the authoritative Engine Spatial Composition query surface.
- Test entities are created, moved and retired through Engine Entity Registry, Placement Coordinator and Spatial Movement.
- The Dev Lab test controller supplies a Dev Lab-owned test overlap policy; this does not define Cassandra collision/passability behavior.
- Automated host-parity coverage checks that standalone Dev Lab and Cassandra-hosted Engine spatial behavior use the same authoritative Core contracts.
- Actual browser UI interaction/layout, teardown and Pages acceptance remain outstanding.

## 6. CI evidence and what it proves

### Latest relevant runtime/code CI

- **Commit:** `41c319d5c9ff2ee8626027009d5c24cec364bdb7` — “Guard world lifecycle transitions at simulation boundaries”.
- **Workflow run:** [43832633971](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43832633971)
- **Result:** success.
- **Core tests:** 230/230.
- **Host/Unit tests:** 260/260.
- **Browser entry-point syntax checks:** passed.

This is the latest confirmed CI evidence for the multi-world runtime code. The workflow job confirms both the full test command and browser entry-point syntax check completed successfully.

### Later documentation CI

- **Commit:** `fbef12498d8c17eefe50795ef90fe89b816bf3b1`.
- **Workflow run:** [43832893800](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43832893800).
- **Result:** success.
- This run is a later documentation-only commit and must not be misrepresented as a newer runtime test result.

### Current audited HEAD

- `90cf0b6f67155358089f1c007e06a78767746564` is later than those runs and contains documentation-only changes.
- No separate CI run for this exact HEAD was confirmed during the audit. The subsequent documentation-only reconciliation commits listed above also have no associated workflow run confirmed at the time of this update.

CI and syntax checks do not prove actual browser UI behavior, Pages deployment correctness, IndexedDB durability in target browsers, crash/reopen recovery or performance.

## 7. Manual acceptance — still pending

The checklist at [phase-3-manual-acceptance-checklist.md](phase-3-manual-acceptance-checklist.md) remains **prepared, not executed**. Do not check off items based on automated tests alone.

Outstanding categories include:

- Actual Dev Lab/Cassandra browser interaction, layout, startup and teardown.
- Main/Temporary World behavior through the deployed browser entry points.
- Real-browser IndexedDB strict-durability, cross-tab CAS and interrupted promotion recovery.
- Representative 128×128 and 256×256 performance measurements.
- Pages direct-entry, refresh/deep-link, asset and console verification.
- Environment regression can only be meaningfully checked once the authoritative environment simulation host/module and its baseline are identified. No claim is made that it was tested in this branch.

## 8. Superseded planning material

- `docs/architecture/world-lifecycle-design-proposal.md` is an old, non-binding pre-implementation proposal. It is historical context, not the current lifecycle contract.
- `docs/architecture/world-lifecycle-contract-proposal.md` is the current lifecycle contract and records the implemented initial Engine contract with host/browser verification still pending.
- Older pre-implementation “Current gap” statements in the capability map and older status/test-count paragraphs in the Phase 3 plan are historical snapshots. Use this status index for the current state; do not treat old proposed steps as unimplemented when their implementation is recorded above.

## 9. Next engineering decision

After this documentation reconciliation, select one bounded remaining Slice 7 domain task for joint design and approval. Do not begin inventory, health, equipment, resource, crew/shuttle, disposition, End Expedition or Abandon Expedition rules without an explicit domain contract and acceptance criteria.

No runtime implementation, environment simulation change, Pages configuration change or merge to `main` is authorized by this documentation status update.
