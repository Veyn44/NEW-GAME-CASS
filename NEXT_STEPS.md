# Next Steps and Development Roadmap

> **Canonical roadmap status:** 2026-11-16, post-merge. `main` is the integrated baseline; future implementation branches must start from the then-current `main`. Source code and tests remain authoritative; exact implementation status and CI evidence are summarized in [Current implementation status](docs/architecture/current-implementation-status.md).

**Product direction:** Cassandra is the primary project. The reusable Engine is developed from concrete Cassandra needs, while remaining technically independent of Cassandra-specific rules, content and presentation. Dev Lab is a development/verification tool that exercises the real shared runtime; it must not become a shipped-game dependency or a parallel implementation.

## Project shape — agreed direction

One repository, one project and one Pages deployment, with three distinct responsibilities:

- **Engine** is the reusable technology foundation. It must work without Cassandra or Dev Lab and must not import either application.
- **Dev Lab** is the Engine development workspace. It uses the same Engine runtime and spatial services as Cassandra; it is not a parallel gameplay implementation.
- **Cassandra** is a separate game built on Engine. It owns game rules, game-specific data, campaign state, player-facing UI, presentation and audio.

Dependency direction:

`Dev Lab → Engine`  
`Cassandra → Engine`

Neither application is a runtime prerequisite for the other. The removal tests in the architecture documentation remain the intended boundary checks.

## Repository and safety rules

- Repository: `Veyn44/NEW-GAME-CASS`.
- Stable integrated branch: `main` (merge commit `0a879ed0ef955110b069b9e89bb420ead4f58737`).
- `work` is retained as the pre-merge development branch and was 3 commits behind `main`, with no unique commits ahead at the time of the merge review. Do not assume it is the active branch for new work.
- Start future implementation/documentation work from the then-current `main` on a dedicated branch and PR.
- Do not merge, cherry-pick into, force-update or otherwise change `main` without the user's explicit approval.
- Do not create or delete branches without explaining why and obtaining permission.
- Do not claim browser/manual acceptance from Node/CI tests or syntax checks.
- Do not alter the previously tested environment simulation as an incidental part of spatial, lifecycle or persistence work.
- Discuss and validate new gameplay rules, public Engine contracts and significant architecture changes before implementing them.

## Ownership boundaries

### Engine
Engine owns generic entity identity, world registration/runtime lifecycle, deterministic simulation scheduling, generic spatial geometry/composition/queries/movement primitives, persistence coordination and other reusable mechanisms. It reports geometry and runtime facts; it does not decide Cassandra gameplay meaning.

### Cassandra
Cassandra owns Unit/Pawn meaning and state, movement speed and input rules, passability and collision policy, Main/Temporary World roles, expedition rules, campaign aggregates, resources, environment meaning, generation, outcomes and player-facing workflow.

### Dev Lab
Dev Lab owns editor/test UI, spatial inspection and controlled test scenarios. It must use the authoritative Engine services and must not maintain a second occupancy or movement implementation.

### Persistence
Engine owns generic snapshot/restore contracts. Cassandra and Dev Lab own separate storage adapters, formats and save identities. Cross-application save compatibility is not required. Unsupported old formats may be rejected safely; do not invent a migration chain.

## Roadmap status

### Phase 0 — Baseline and repository protection
**Completed for the current working branch.** The branch split and current CI evidence are recorded in the implementation-status document. Re-check the live branch and test state before each new implementation slice.

### Phase 1 — Architecture and ownership
**Agreed at the current conceptual level.** Engine/Dev Lab/Cassandra ownership and dependency direction are established. Individual new public contracts still require focused design and approval where marked open.

### Phase 2 — Repository restructuring
**Completed and merged to `main` through PR #6 on 2026-11-14.** Do not restart the mechanical restructuring. Remaining boundary cleanup is follow-up work only when a concrete dependency requires it.

### Phase 3 — Engine physical-world foundation and application integration
**Phase 3 infrastructure and integration have been merged into `main`; current Pages workflow is manually accepted, with separate later-scope checks explicitly deferred.**

- **Slices 1–6 — implemented:** Grid Geometry, Spatial Composition, Spatial Queries, Movement, coordinated spatial persistence and Core Assembly integration.
- **Slice 7 — partially implemented:** Cassandra grid-backed Unit movement, Main/Temporary World session policy, runtime identity projection and persistence, Change Package/Change Buffer protocol foundations, and a candidate IndexedDB compare-and-swap backend exist. Authoritative campaign aggregate/domain handlers, full expedition workflow, complete reconciliation/disposition rules and real-browser backend verification remain open.
- **Slice 8 — implemented at the automated integration level:** Dev Lab spatial inspection and controlled test workflows use the shared Engine services. Actual browser interaction/layout acceptance remains open.
- **Slice 9 — pending final acceptance:** automated CI coverage exists, but the manual/browser acceptance checklist has not been executed.

Do not interpret “Slice 7 foundations implemented” as “Cassandra expedition gameplay is complete”. Do not invent missing campaign or environment rules to close a checklist.

### Phase 4 — Direct testing readiness for Cassandra and Dev Lab
**Next planned phase after the completed merge.** The agreed goal is to prepare the existing Cassandra and Dev Lab implementations for direct browser testing of what already exists. Scope should focus on reliable entry points, host composition, accessible test workflows, diagnostics, and save/load interaction. It is not a gameplay feature phase and must not invent campaign, inventory, health, equipment, resource, crew, disposition or expedition rules. Define the exact Phase 4 slices together after the merge.

### Phase 5 — Cassandra as an independent game host
**Not complete.** The current branch contains a Cassandra application/runtime prototype and infrastructure integrations, not the complete campaign/gameplay experience. Continue only through jointly designed, bounded gameplay slices.

### Phase 6 — Single Pages deployment and acceptance
**Pending owner-led browser verification.** Verify actual Pages source/configuration, direct entry points, refresh/deep links, assets, browser console, save/load and both application workflows. Do not infer successful deployment from workflow syntax checks.

### Phase 7 — Architecture audit and stable milestone
**Pending.** Run after the implementation scope and acceptance gates are complete. Audit dependency boundaries, duplication, dead code, runtime/browser behavior, persistence, test quality and measured performance. Fix findings in small separately verifiable changes.

## Immediate next step

The pre-merge audit is complete and `work` has been merged into `main` through PR #7. The merge commit is `0a879ed0ef955110b069b9e89bb420ead4f58737`. The exact merge-commit Core/Host workflow [43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950) completed successfully.

The immediate documentation task is to reconcile the canonical roadmap, implementation index, work log and architecture contracts with the merged repository state. After that documentation PR is reviewed and merged, plan Phase 4 together. Phase 4 is a browser-readiness/acceptance phase for the existing Cassandra and Dev Lab implementations—not a gameplay feature phase.

Phase 4 planning should cover reliable entry points, host composition, repeatable browser test workflows, diagnostics, save/load interaction and explicit manual acceptance gates. Do not invent campaign, inventory, health, equipment, resource, crew, disposition or expedition rules to make a checklist appear complete.

The full current status, verified CI evidence and outstanding manual gates are maintained in [Current implementation status](docs/architecture/current-implementation-status.md).

## Protected constraints

- Keep the existing Engine fixed-step ordering, deterministic behavior and persistence boundaries intact unless a separately approved contract requires a change.
- Engine's initial multi-world runtime uses one global Game Clock plus committed per-world simulated time; it is deterministic and sequential, not parallel CPU simulation.
- A simulation task failure still faults/pauses the global scheduler. Per-world failure isolation and rollback are not implemented.
- World lifecycle changes that would tear down a world are rejected during an active simulation round.
- Cassandra's environment simulation is not to be modified without a concrete dependency and separate approval. The current branch audit did not locate an authoritative environment simulation module to integrate.
- No merge to `main` without explicit user approval after the user has reviewed the proposed diff and verification evidence.

## Campaign application lifecycle — current state

The ownership decision is agreed:

1. Cassandra Application Shell owns active Campaign selection and Campaign ID.
2. It creates one separate IndexedDB adapter per explicitly selected Campaign.
3. It injects the active session's exact Applied-ledger verifier into Runtime Host.
4. Engine remains unaware of Campaigns; the existing `.cass` workspace adapter remains separate.

The lifecycle controller now supports explicit create/open/load/close and is exposed from the Pages test entry point as `cassandraApplication.campaignSessionApi`. No default Campaign ID is generated. Campaign creation requires a caller-supplied initial snapshot; opening requires an existing durable record. The controller does not instantiate the Change Package Coordinator because authoritative aggregate models and approved typed operation/manifest handlers are still missing. A runtime-host regression also verifies that Temporary World disposal stays blocked without an active Campaign and becomes eligible only when the exact package ID/digest is present in that Campaign's Applied ledger; it is included in successful Host CI run [43890217044](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43890217044).

**Important product boundary:** the current Pages entry point is still a development/test host. A separate, complete Cassandra game and player-facing Campaign selection UI do not exist yet. Do not describe this lifecycle seam as a finished game integration.

### Next engineering slice

No additional Campaign gameplay slice is authorized as the immediate next step. Complete the post-merge documentation reconciliation, then plan Phase 4 around direct browser testing of the existing implementation. Any later Campaign aggregate or typed Change Package work still requires a separate domain contract and acceptance criteria.
