# Project Status, Decisions and Open Directions

> **Document status:** 2026-11-16, post-merge. This document records confirmed project direction, completed milestones and current constraints. It is not an approved roadmap or a commitment to a sequence of future phases. `main` is the integrated baseline; future work should start from the then-current `main` on a dedicated branch and PR. Source code and tests remain authoritative; exact implementation status and CI evidence are summarized in [Current implementation status](docs/architecture/current-implementation-status.md).

**Current product concept:** Cassandra's creative direction is now captured in [GAME_CONCEPT.md](GAME_CONCEPT.md). It describes a colony-sim/RPG/action game on a long-established human colony planet, where a rescue cruiser crashes after responding to a distress signal. The player survives, reaches a mostly prepared underground shelter, and explores a large network of human facilities and wreckage infested by an unknown biological organism. This is a concept baseline, not a claim that these gameplay systems have been implemented.

The reusable Engine is developed from concrete Cassandra needs while remaining technically independent of Cassandra-specific rules, content and presentation. Dev Lab is a development/verification tool that exercises the real shared runtime; it must not become a shipped-game dependency or a parallel implementation.

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

## Completed development phases

- **Phase 0 — Baseline and repository protection:** completed for the integrated project baseline. Re-check live branch and test state before future implementation work.
- **Phase 1 — Architecture and ownership:** the Engine / Cassandra / Dev Lab responsibility split and dependency direction are established. New public contracts still require focused design and approval where open.
- **Phase 2 — Repository restructuring:** completed and merged to `main` through PR #6 on 2026-11-14.
- **Phase 3 — Engine physical-world foundation and application integration:** merged to `main` through PR #7 on 2026-11-16. Slices 1–6 are implemented; Slice 7 provides partial Cassandra infrastructure; Slice 8 has automated Dev Lab integration coverage; final manual/browser acceptance and several later-scope checks remain open. See [Current implementation status](docs/architecture/current-implementation-status.md) for exact boundaries.

The phase labels above describe completed historical work and its current implementation status. They do not imply that a subsequent numbered phase has been approved.

## Possible future directions (not approved)

The game concept is now defined at a high level, but no post-Phase-3 implementation phase, feature sequence or acceptance criteria have been approved. Possible next activities include breaking the concept into a playable vertical slice, deciding the first-base and opening-mission scope, evaluating which existing Engine capabilities support the concept, and identifying missing reusable capabilities. These are discussion candidates, not a delivery commitment.

## Current handoff

The pre-merge audit is complete and `work` was merged into `main` through PR #7. The merge commit is `0a879ed0ef955110b069b9e89bb420ead4f58737`. The exact merge-commit Core/Host workflow [43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950) completed successfully.

The documentation reconciliation was merged through PR #8. The current game concept is recorded in [GAME_CONCEPT.md](GAME_CONCEPT.md). Continue design collaboratively and define a small, testable gameplay scope before implementation. No post-Phase-3 implementation phase, slice sequence or immediate gameplay task has been approved.

The full implementation status, verified CI evidence and outstanding manual gates are maintained in [Current implementation status](docs/architecture/current-implementation-status.md).

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

### Next engineering decision

No next implementation slice has been selected. Campaign aggregate models, typed Change Package handlers and further gameplay/domain work require separate joint design and acceptance criteria before implementation.
