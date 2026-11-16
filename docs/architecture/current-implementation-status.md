# Current Implementation Status

**Audit date:** 2026-11-16  
**Repository:** `Veyn44/NEW-GAME-CASS`  
**Working branch:** `work`  
**Latest verified source/test checkpoint:** `99fe57c824aa4e40d575ec0206e5b2adc2dd77eb`  
**Latest verified docs-only CI checkpoint:** `240a5197507bd9a7de41d7bd91c0f825a7800f2c`  
**Current audit documentation follow-up:** `ec3600ce3f9ad7098f7daa5f4e0da0e100e2ce97` (manual acceptance scope clarification; exact-head CI still to be confirmed)  
**Documentation follow-up series:** `b50bf3f14aedf29fb42aa76271fe17df4b868f54`, `6d05de7c1c9436edd3141efe9670664216727468`, `cb89a02379c9b0f5e5c004649259077253ec1ee2`, `1b7faf15a8cff659fc7a5085f635ad275cfc5f7f`, `57f46f6ac656a51bebf6fafcc9f7ad986328e73c`, `0d01c3530c9c28c1283a05ef2f245a8bf4f475b1`  
**Audited main HEAD:** `458ecc52d4267b6b31fb3d59559374533c49fa64`  
**Documentation reconciliation commits:** `bdbf56312f3e5e24ccd5f7da83b4d519a991a928`, `2d52d21bbbe183b7199c6b1d85153f14c6326bb4`, `b50bf3f14aedf29fb42aa76271fe17df4b868f54`

This is the current status index for the implementation described by the Phase 3 plans and architecture reviews. Where older sections of those documents still describe pre-implementation gaps or old test counts, this dated status record supersedes those historical statements. Source code and current tests remain authoritative.

## 1. Branch and change safety

- All work described here is on `work`.
- `main` remains at `458ecc52d4267b6b31fb3d59559374533c49fa64` and is not part of this work.
- The latest verified source/test checkpoint is `99fe57c824aa4e40d575ec0206e5b2adc2dd77eb`. The later `240a519…` documentation-only checkpoint was also run through Core/Host, development preview and Pages workflows successfully. The audit-only checklist clarification is `ec3600c…`; its exact-head CI must be confirmed before calling it the final verified head. The later `c84b2de…` and `9d4ed2f…` commits refine Temporary World Unit cleanup, and `d2a6f34…` / `99fe57c…` add its unplaced-Unit regression coverage.
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
- World Registry continues to own registered world descriptors. World Runtime Manager separately owns runtime readiness/lifecycle, simulation participation, pause reasons, committed local simulated time and completed local steps. It installs a lifecycle guard so direct registry close/unregister cannot bypass runtime disposal or occur during an active simulation round.
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

### Latest verified source/test checkpoint

- **Source/test commit:** `99fe57c824aa4e40d575ec0206e5b2adc2dd77eb`.
- **Core/host workflow:** [43892955121](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43892955121) — success.
- **Later docs-only checkpoint:** `240a5197507bd9a7de41d7bd91c0f825a7800f2c`; Core/Host [43893376360](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43893376360), development preview [43893376367](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43893376367) and Pages [43893376253](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43893376253) all succeeded. No source code changed after the source/test commit.
- **Core tests:** 233/233.
- **Host/Unit tests:** 294/294.
- **Browser entry-point syntax checks:** passed.
- **Development preview deployment:** [43892955199](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43892955199) — success.
- **GitHub Pages build/deployment:** [43892954608](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43892954608) — success.

The checkpoint includes the Campaign session lifecycle, Applied-ledger host integration, persistence rollback fail-stop, spatial read-only mutation guards, World Registry lifecycle guard, non-grid Entity Registry placement guard, save-target rollback, serialized file operations, and a regression proving that Temporary World disposal retires a scoped Unit even after its placement was already removed.

The documentation reconciliation commits after the earlier `35bab1…` checkpoint updated implementation notes, the manual checklist and the agreed Phase 4 objective. Later code/test commits refined the scoped-Unit disposal path and added its regression coverage; the current checkpoint above includes those changes.

CI and syntax checks do not prove all browser interactions, real IndexedDB strict durability, cross-tab behavior, crash/reopen recovery or performance.

## 7. Manual acceptance — current Pages workflow accepted; other scopes explicitly deferred

The user confirms that the deployed GitHub Pages Cassandra application behaves as expected for the currently exposed game workflow and that its `.cass` save/load path works. This accepts the current Pages-hosted workflow; it does not claim that every diagnostic, edge case or performance check was individually exercised. The checklist at [phase-3-manual-acceptance-checklist.md](phase-3-manual-acceptance-checklist.md) records this distinction.

Remaining validation is classified by the application or feature it actually belongs to:

- Pages-hosted Cassandra: detailed spatial diagnostics, Main/Temporary World edge cases and browser teardown/restart have not been separately recorded as passed.
- Standalone Engine-only Dev Lab: its separate `.dlcass` entry point and UI acceptance are deferred; it is not the Cassandra-hosted Dev Lab workflow the user tested on Pages.
- Campaign: real-browser IndexedDB strict durability, cross-tab CAS and interrupted promotion are deferred until player-facing Campaign workflow, authoritative aggregate models and production handlers exist.
- Environment regression: the authoritative host/baseline was not located in this repository; no environment simulation source was changed and no regression pass is claimed.
- Performance: representative 128×128 and 256×256 measurements have not been taken.

These deferred checks are not being represented as passed. They are also not prerequisites for claiming the currently tested Pages workflow works; they remain acceptance gates for the respective later integration/feature scopes.

## 8. Superseded planning material

- `docs/architecture/world-lifecycle-design-proposal.md` is an old, non-binding pre-implementation proposal. It is historical context, not the current lifecycle contract.
- `docs/architecture/world-lifecycle-contract-proposal.md` is the current lifecycle contract and records the implemented initial Engine contract with host/browser verification still pending.
- `main` contains `docs/architecture/spatial-placement-persistence-integration-proposal.md` as a proposal-only addition after the merge base. The composite World Context + Spatial Composition persistence participant is already implemented and tested on `work`; after merge, that proposal should be marked as implemented/superseded rather than treated as open runtime work.
- Older pre-implementation “Current gap” statements in the capability map and older status/test-count paragraphs in the Phase 3 plan are historical snapshots. Use this status index for the current state; do not treat old proposed steps as unimplemented when their implementation is recorded above.

## 9. Next engineering decision

The immediate objective is to finish the read-only pre-merge audit of `work` against `main`, confirm CI on the exact final documentation/source head, and present a merge-readiness report. No new gameplay features or Phase 4 work are in scope. No merge or pull request is authorized without the user's explicit approval.

After the audit is accepted and `work` is merged, Phase 4 will be planned jointly. Its agreed goal is to prepare the existing Cassandra/Dev Lab implementation for direct browser testing of what already exists — entry points, host composition, test workflows, diagnostics, and persistence interactions — not to invent new gameplay rules.

## 2026-11-16 follow-up — Applied Ledger verifier runtime path

- `createCassandraRuntimeHost({ isPackageApplied })` now forwards the authoritative verifier through the shared host to `createCassandraRuntime` and Cassandra World Session.
- Added an end-to-end host regression covering a real Cassandra runtime, a registered Main/Temporary World pair, return to Main, exact package ID/digest verification, and preservation of the Temporary World when the ledger rejects disposal.
- This closes the missing callback-forwarding path only. The application-owned Campaign identity/storage lifecycle is described in the later follow-up below; production campaign domain handlers and full expedition gameplay remain open.
- This runtime path is included in the later verified source/test checkpoint `35bab1be841e3471be1bb721a7dd0ed5dfe06343`; see CI run [43890217044](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43890217044).
- No environment simulation changes; `main` remains unchanged.

### World Runtime rollback checkpoint precision

- Runtime-only World Runtime checkpoints now preserve the internal disposal target as well as status, participation, pause reasons and local clocks. The ordinary World Runtime state API and persisted save schema remain unchanged.
- Added regression coverage for restoring a world captured during `Disposing` and successfully completing its original unload transition after restore.
- Test commit: `15e5ed8f3eb4f5806b0f2a405e14c4e691582500`; included in the later verified CI checkpoint [43890217044](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43890217044).


## 2026-11-16 follow-up — Application-owned Campaign session lifecycle

- `cassandra/application/cassandra-campaign-session-controller.js` now owns explicit Campaign create/open/close lifecycle and a separate `IndexedDbCampaignSaveAdapter` instance.
- Campaign identity is supplied by the caller; there is no generated/default campaign ID and no implicit switch while another Campaign is open.
- Creation requires an explicit initial Major State / Change Buffer / Applied Ledger snapshot, writes it with revision-0 compare-and-swap, and verifies the reopened durable revision. Opening only accepts an existing durable campaign record.
- The controller's Applied-ledger verifier checks the exact package ID, digest and `applied` status; without an active Campaign it returns false.
- Cassandra Application Shell owns this controller and injects the verifier into Runtime Host. The `.cass` workspace format remains separate from Campaign IndexedDB persistence. Later pre-merge audit work hardened file-target rollback and serialized save/load/import operations without changing the `.cass` envelope.
- `application-entry.js` exports `cassandraApplication` so Pages/manual testing can access `campaignSessionApi`. This is a development/test seam, not a finished game UI; no separate Cassandra game or Campaign selection UI exists yet.
- Focused lifecycle tests were added in `tests/unit/cassandra-campaign-session-controller.test.js` and are included in the later successful Host test suite [43890217044](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43890217044).
- The Change Package Coordinator remains uninstantiated until authoritative campaign aggregate models and approved domain handlers/manifest reconciliation exist.
- Real-browser IndexedDB strict-durability and crash/reopen acceptance remain pending. No environment simulation changes; later narrowly scoped Engine audit corrections are recorded below. `main` remains unchanged.


### Campaign verifier host regression

- Added an end-to-end runtime-host test proving that no active Campaign means Temporary World disposal is rejected, while an explicitly created Campaign with the exact Applied ledger entry allows disposal.
- Test commit: `8ec757cb8881c2ddcd3b40bde398ba3075fb7874`; the regression is included in the later successful Host test suite [43890217044](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43890217044).


## 2026-11-16 pre-merge audit — verified corrections

The following narrowly scoped corrections were made on `work` after source review exposed invariant gaps:

- Persistence now faults and invokes its fatal-integrity callback when a restore rollback itself fails. A regression proves the runtime cannot continue saving from a partially restored state.
- Spatial Composition now enforces the read-only movement-policy guard for content removal and prepared restore commit/rollback.
- World Registry close/unregister now consult the World Runtime lifecycle guard. A world cannot be closed while its runtime is Ready/Loading/Disposing, nor can registry lifecycle mutation occur during an active simulation round.
- Entity Registry store/remove/reactivate operations now reject one-sided lifecycle changes while a World Context placement remains. Non-grid `WorldContext.storeEntity()` uses the internal coordinated lifecycle capability.
- File persistence now restores the previous file target after failed import/load/Save As and serializes save/load/import operations so a concurrent import cannot replace the data source of an active restore.
- Stale test fixtures were updated to provide the required input controller and to inject cleanup failures through the supported Temporary World cleanup hook.

All these corrections are included in the verified source/test checkpoint `35bab1be841e3471be1bb721a7dd0ed5dfe06343` and its successful CI run [43890217044](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43890217044). The development preview and GitHub Pages deployment for that checkpoint also succeeded.

Remaining merge gates are full manual/browser acceptance, real-browser IndexedDB durability and interruption tests, performance measurements, and identifying the authoritative environment simulation host/baseline. No environment simulation source was changed. `main` remains untouched. The latest main-only difference is one documentation proposal for spatial-placement persistence; no runtime code is missing from `work` because of the two commits ahead on `main`.


## 2026-11-16 follow-up — unplaced Temporary World Unit disposal

- A source audit identified that Temporary World cleanup must retire every Unit whose Engine identity belongs to the Temporary World scope, even when the Unit no longer has a World Context placement.
- The implementation was narrowed to the UnitSystem-owned list and exact scoped identity. A follow-up correction derives the scope ID inside the cleanup commit itself, avoiding a reference to the preparation callback's local variable.
- Added a regression that removes a Temporary Unit's placement through PlacementCoordinator, then completes the Temporary World and verifies that the UnitSystem record and Engine identity are both retired.
- Latest verified commit: `99fe57c824aa4e40d575ec0206e5b2adc2dd77eb`; CI [43892955121](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43892955121) passed Core 233/233 and Host 294/294. Browser syntax checks, development preview and Pages deployment also succeeded.
- The first version of the new test had an incorrect expectation for PlacementCoordinator's transaction return value; the test was corrected to assert the returned `current` and `occupancy` fields. No runtime change was needed for that test-only correction.
