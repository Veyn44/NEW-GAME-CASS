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
