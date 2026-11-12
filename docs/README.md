# Project Documentation

Canonical documentation for the active development phase.

## Current phase

- [Phase 2 plan](phases/PHASE_2.md) — scope, substeps, responsibilities, acceptance criteria and merge procedure.
- [Phase 2 test plan](testing/PHASE_2_TEST_PLAN.md) — automated/manual test layers and evidence rules.

## Architecture

- [Game Systems Architecture](architecture/GAME_SYSTEMS_ARCHITECTURE.md) — ownership, dependencies and communication.
- [Phase 2 System Contracts](architecture/PHASE_2_SYSTEM_CONTRACTS.md) — actual Core integration contracts for host, world, Pawn and locomotion.
- [Repository Structure](architecture/REPOSITORY_STRUCTURE.md) — directory layout and phase-to-main merge map.

## Standards

- [System Development Standard](standards/SYSTEM_DEVELOPMENT_STANDARD.md) — required design, lifecycle, persistence and test checklist for gameplay systems.

## Documentation rules

- Keep one canonical copy of each document.
- Plans describe intended work; implementation reports describe what actually exists.
- Never mark tests as passing unless they have run.
- When implementation changes a contract, update the relevant architecture/specification document in the same phase branch.
- Keep phase decisions and deferred questions traceable; do not silently rewrite history.
