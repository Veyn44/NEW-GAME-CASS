# Project Documentation

Canonical project documentation and phase records.

## Completed phases

- [Phase 2 plan](phases/PHASE_2.md) — implemented, user-accepted and merged into `main` on 2026-11-13 (merge commit `31c1cd4`).
- [Phase 2.4 Persistence and Dev Lab Workspace Plan](phases/PHASE_2_4_PERSISTENCE_PLAN.md) — final accepted persistence contract, browser verification and deferred items.
- [Phase 2 test plan](testing/PHASE_2_TEST_PLAN.md) — automated/manual test layers and final acceptance evidence.

## Next phase

A Phase 3 working scope has already been accepted: [Phase 3 — Living & Intelligent Units Foundation](phases/PHASE_3.md). It builds on the approved Unit/Pawn architecture and covers universal mobile/stationary Units, optional capabilities, attributes, perception, inventory/equipment, interactions and player control through Dev Lab. The document distinguishes accepted direction from details that still need design. [World Lifecycle](architecture/WORLD_LIFECYCLE.md) remains a separate approved architecture constraint; its implementation is not automatically part of Phase 3.

## Architecture

- [Application Shell and Mode Architecture](architecture/APPLICATION_SHELL_AND_MODES.md) — main menu, Dev Lab/New Game separation, reusable gameplay ownership and canonical Database registry.
- [Core Audit — Phase 2](architecture/CORE_AUDIT_PHASE_2.md) — source-level review of Core ownership, API constraints, test evidence and the proposed World/Pawn integration.
- [World Lifecycle](architecture/WORLD_LIFECYCLE.md) — approved persistent/temporary world model, simulation gating and transition constraints.
- [Game Systems Architecture](architecture/GAME_SYSTEMS_ARCHITECTURE.md) — ownership, dependencies and communication.
- [Phase 2 System Contracts](architecture/PHASE_2_SYSTEM_CONTRACTS.md) — actual Core integration contracts for host, world, Pawn and locomotion.
- [Repository Structure](architecture/REPOSITORY_STRUCTURE.md) — directory layout and phase-to-main merge map.
- [World Geometry](architecture/WORLD_GEOMETRY.md) — approved square world dimensions, coordinate rules and initial camera/viewport test settings.

## Standards

- [System Development Standard](standards/SYSTEM_DEVELOPMENT_STANDARD.md) — required design, lifecycle, persistence and test checklist for gameplay systems.

## Documentation rules

- Keep one canonical copy of each document.
- Plans describe intended work; implementation reports describe what actually exists.
- Never mark tests as passing unless they have run.
- When implementation changes a contract, update the relevant architecture/specification document in the same phase branch.
- Keep phase decisions and deferred questions traceable; do not silently rewrite history.
