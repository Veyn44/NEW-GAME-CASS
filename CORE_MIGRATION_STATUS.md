# Core Migration Status

## Current scope

This repository is the domain-neutral Core runtime for the next Cassandra host game. The first development phase is the shared engine foundation only. Gameplay systems such as Pawn Life, construction, environment, combat, mining, economy, galaxy generation, navigation and expedition rules are intentionally outside this phase.

CASSANDRA3 is an architectural reference, not an implementation mandate. The Core modules in this repository are independently maintained and generalized for future host applications.

## Verified baseline

- Repository: `Veyn44/NEW-GAME-CASS`
- Branch: `main`
- Verified commit: `7295c2e28d0b67dc085d560c6977ebfd659e5681`
- CI workflow: `Core tests`
- Runtime: Node.js 20.20.2
- Result: **180/180 passed; 0 failed**
- Suites: Clock + Scheduler (22), Core Registry (13), Entity Registry (23), Event Bus (18), Lifecycle + Bootstrap (13), Persistence + Logger (19), World Registry (27), World Context (23), Core Integration (22).

This is a real GitHub Actions execution, not a count inferred from test files. The HTML/browser test pages are separate harnesses and were not exercised by this CI run.

## Core inventory

The current `src/core` contains the shared runtime modules:

- Game Context and System Registry
- System Bootstrap and lifecycle
- Event Bus
- Game Clock and fixed-step Simulation Scheduler
- Logger
- Entity Registry
- World Registry and World Context
- Persistence
- Core Assembly, composing the services through public contracts

The assembly requires an explicit save adapter. The in-memory adapter is for tests/development only; durable storage belongs to the host application.

The Core source has no gameplay implementation for Cassandra-specific systems. The Entity Registry retains a narrow legacy migration path for old encounter-scoped identity records; new records use generic scoped identities.

## Intentional adaptation from CASSANDRA3

The original Phase 1 plan mentioned an adapter preserving the old prototype UI and controls. That adapter is not being copied into this repository: NEW-GAME-CASS is being established as a clean, reusable engine foundation, and the old prototype UI is not part of the Core runtime. Host UI and input integration should be implemented by the host layer when it exists, without introducing presentation dependencies into Core.

## Remaining Phase 1 work

1. Complete a module-by-module contract review against the CASSANDRA3 Core integration reference, treating it as a reference rather than a law.
2. Review compatibility and migration behavior for legacy entity/world/save metadata.
3. Review failure and recovery paths across Event Bus, Scheduler, Bootstrap and Persistence as one runtime.
4. Finish public API and host-integration documentation, including a minimal host example.
5. Re-run the complete CI suite after any code changes and inspect the final commit/check result.

Phase 1 is not declared complete until this review is finished and the final integrated test run passes. No gameplay systems should be added as a substitute for finishing the Core foundation.
