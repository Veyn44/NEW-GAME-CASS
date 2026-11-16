# Project History

> This document records what has actually been built, tested, accepted and merged. It is a historical record, not a promise about future scope. Current work direction and handoff instructions live in [NEXT_STEPS.md](NEXT_STEPS.md); Cassandra game-design ideas live in [CASSANDRA_VISION.md](CASSANDRA_VISION.md).

## Project origin and Core foundation

The project began by extracting a reusable, domain-neutral runtime foundation for Cassandra and future host games. The existing CASSANDRA3 project served as an architectural reference, not an implementation mandate.

The completed Core provides:
- Game Context, System Registry and System Bootstrap/lifecycle management.
- Event Bus, Game Clock, fixed-step Simulation Scheduler and Logger.
- Entity Registry for generic identity and lifecycle.
- World Registry and World Context for world registration, activation and entity placement.
- Persistence coordination and Core Assembly.

Core deliberately does not own Cassandra-specific gameplay, rendering, browser input, map tiles, movement rules or production storage. The host supplies adapters, gameplay systems and a durable save adapter. Detailed current APIs remain documented in [src/core/README.md](engine/core/README.md).

The Core baseline passed its recorded GitHub Actions regression run with **198/198 tests passing**. The Core-only Phase 1 was closed before the first Cassandra gameplay layer was integrated.

## Phase 2 — First testable Cassandra game layer

Phase 2 was developed on `next-step/phase-2` and merged into `main` on **2026-11-13**.

- Merge commit: [`31c1cd4`](https://github.com/Veyn44/NEW-GAME-CASS/commit/31c1cd4bb5f4e9e85bfbb98b863903f57c1f518f)
- The implementation branch was retained after merge as a historical branch. It is not the base for future work.

Phase 2 proved that the Core could host a real browser-based Cassandra runtime and gameplay layer. The completed scope included:

- Host runtime composition and application shell.
- Core-backed Unit identity, Unit definitions and world placement.
- Dev Lab with a shared Database/catalog, definition inspection, explicit Unit placement and live Unit inspection.
- Colony Leader selection, Draft and fixed-step locomotion.
- Pause/resume and camera/viewport interaction.
- Save, Save As, Load and Reset Lab workflows integrated with persistence.

The Dev Lab starts with an empty world; Units are created only through explicit placement. Gameplay systems are hosted by Dev Lab rather than implemented as Dev Lab-only gameplay logic.

### Phase 2 acceptance

The user manually confirmed the complete browser workflow on 2026-11-13, including:

- Database selection and Unit placement.
- Johny locomotion, Draft/No Draft, pause and resume, and camera reacquisition.
- Save/Save As/Load across multiple named saves and different saved states.
- Stable Unit identity and position restored without duplicates.
- Draft state restored; a save made while running loads paused.
- Camera reset to the restored world's center on Load.
- Corrupted JSON rejected with a visible error while the existing session remained navigable.
- Reset Lab clears the current session without deleting or overwriting saved files.

Automated Core and host tests passed, and the Pages deployment succeeded for the final implementation. The recorded CI runs are [Core + host tests](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43426757709) and [Pages deployment](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43426757277).

One additional restore fault-injection/rollback test was deliberately deferred by the user; it was not marked as passing. Historical detailed checklists were consolidated during the documentation cleanup and should not be mistaken for additional completed test evidence.

## Archived reference snapshot

The separate repository [CassandraCoreRuntimefoundation](https://github.com/Veyn44/CassandraCoreRuntimefoundation) preserves the Core + Phase 2 state corresponding to the Phase 2 merge in the active repository.

- Original archive snapshot commit: [`e94d8b5`](https://github.com/Veyn44/CassandraCoreRuntimefoundation/commit/e94d8b59b7e29599174c260baf1e7d989e61c051)
- Archive documentation/index update: [`893ddc4`](https://github.com/Veyn44/CassandraCoreRuntimefoundation/commit/893ddc400c4794b116e9f8ebd142ddc392873907)

The archive is a preserved reference, not the active development repository. New work belongs in `NEW-GAME-CASS`.

## Repository record at the start of documentation consolidation

The active repository is [Veyn44/NEW-GAME-CASS](https://github.com/Veyn44/NEW-GAME-CASS), branch `main`. The Phase 2 merge commit is the stable historical integration point. Documentation consolidation is being performed separately from source implementation.

No claim in this file should be used as a substitute for checking the current source, tests or Git history when implementation details matter.


## Architecture and application restructuring — PR #6

The Engine/application boundary restructuring was completed and merged into `main` on **2026-11-14**.

- PR: [#6 — Merge engine and application architecture restructuring](https://github.com/Veyn44/NEW-GAME-CASS/pull/6)
- Merge commit on `main`: [`19cc018`](https://github.com/Veyn44/NEW-GAME-CASS/commit/19cc018fedf45b11206a1a390e7ec5e1a2ed3a61)
- The restructuring separated the Engine Core, Cassandra application composition/gameplay, standalone Engine-only Dev Lab composition, and neutral shared application/presentation mechanisms. It did not complete every intended product boundary: Cassandra-hosted Dev Lab remains the primary workflow, while standalone Dev Lab is an optional separate entry point.
- The current Engine capability baseline and remaining ownership gaps are summarized in [Engine / Cassandra / Dev Lab — Capability and Ownership Review](docs/architecture/engine-game-devlab-capability-map.md). That review is a working map, not an approval to implement every listed proposal.
- Cassandra and Dev Lab are separate applications and are not intended to exchange save files. Their persistence adapters, formats/envelopes and slot/state identities must be isolated. Cross-application save compatibility is not a product requirement.

The post-merge `work` branch is the active working baseline for subsequent documentation and design work. Historical Phase 2 records above remain valid for the earlier milestone and should not be read as the current repository status.


## 2026-11-16 — Phase 3 integration merged into main

The completed Cassandra/Engine/Dev Lab Phase 3 implementation history from `work` was integrated into `main` through [PR #7](https://github.com/Veyn44/NEW-GAME-CASS/pull/7).

- Merge commit: [`0a879ed`](https://github.com/Veyn44/NEW-GAME-CASS/commit/0a879ed0ef955110b069b9e89bb420ead4f58737).
- The PR integrated 622 commits, covering 92 changed files, into the stable branch.
- The exact merge-commit Core/Host workflow [43940567950](https://github.com/Veyn44/NEW-GAME-CASS/actions/runs/43940567950) completed successfully.
- Pre-merge refs were preserved as `backup/pre-merge-main-2026-11-16` and `backup/pre-merge-work-2026-11-16`; the owner's verified local bundle and mirror are also retained.
- The original `work` branch remains available as a historical pre-merge line; future work should branch from the then-current `main`.
- PR #4, a separate documentation-only roadmap proposal, was closed without merging. Its useful Cassandra-first product direction is consolidated into `NEXT_STEPS.md`.

### Phase 3 outcome and remaining boundaries

The Engine grid/spatial foundation (Slices 1–6) is implemented and merged. Cassandra integration (Slice 7) provides Unit/grid movement, Main/Temporary World session policy, runtime identity projection, Change Package/Change Buffer foundations, an application-owned Campaign session seam and a candidate IndexedDB compare-and-swap adapter. This is infrastructure, not a complete campaign or player-facing expedition workflow: authoritative campaign aggregate models, production typed domain handlers, full expedition result reconciliation and real-browser durability/recovery acceptance remain future work.

Dev Lab spatial inspection and controlled test workflows use the shared Engine services and have automated host coverage. The user's manual acceptance applies to the currently exposed Pages-hosted Cassandra workflow and its `.cass` save/load path; it does not imply that standalone Dev Lab, every spatial diagnostic, Main/Temporary World edge case, environment regression or performance benchmark has been accepted.

No environment simulation source was changed as part of this Phase 3 integration. Phase 4 is the next planning phase and focuses on browser readiness and direct acceptance of existing functionality, not on inventing gameplay systems.
