# Core Migration Status

## Current scope

This repository is the domain-neutral Core runtime for the next Cassandra host game. The first development phase is the shared engine foundation only. Gameplay systems such as Pawn Life, construction, environment, combat, mining, economy, galaxy generation, navigation and expedition rules are intentionally outside this phase.

CASSANDRA3 is an architectural reference, not an implementation mandate. The Core modules in this repository are independently maintained and generalized for future host applications.

## Verified baseline

- Repository: `Veyn44/NEW-GAME-CASS`
- Branch: `main`
- Latest verified implementation commit: `16b490b7ae39aff358a85b66d803fc3ec731ddcf`
- Final code/test CI run: `43180774563` (head `09c79eac7114089e6c61b52ec5a1edf558d98424`)
- Final documentation CI run: `43180923947` (head `3a81cf6fef15fd6106eea771288b237811611abd`)
- CI workflow: `Core tests`
- Runtime: Node.js 20.20.2
- Result: **198/198 passed; 0 failed**
- Suites: Clock + Scheduler (22), Core Registry (13), Entity Registry (27), Event Bus (19), Lifecycle + Bootstrap (14), Persistence + Logger (21), World Registry (29), World Context (26), Core Integration (27).

This is a real GitHub Actions execution, not a count inferred from test files. The latest run also exercised World Context snapshot hardening, serialized asynchronous persistence, and shutdown during active persistence and lifecycle transactions, direct SystemBootstrap lifecycle serialization, plus revoked-Proxy event payload rejection. The HTML/browser test pages are separate harnesses and were not exercised by this CI run.

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

Entity Registry restore now reconstructs scoped ID counters from all retained identities (including stored or removed records), and rollback restores the exact previous counter state. Regression tests cover both restored high-water marks and failed-restore rollback. Entity Registry metadata cloning and World Registry snapshot cloning also normalize revoked-Proxy inspection failures into their documented stable error codes; regression tests cover both boundaries.

The Core source has no gameplay implementation for Cassandra-specific systems. The Entity Registry retains a narrow legacy migration path for old encounter-scoped identity records; new records use generic scoped identities. World Context now detaches snapshot input before staging, rejects accessors/hostile proxy inspection, and validates the detached state again at commit so caller mutation cannot alter the transaction.

The Core Assembly now serializes overlapping save/load transactions and holds an independent `core.persistence` clock pause until the queue drains. This prevents save-slot/participant races, prevents the host frame loop from advancing simulation during storage work, preserves unrelated pause reasons, and allows later queued operations to continue after an earlier storage failure. Core shutdown now rejects new persistence requests and waits for accepted storage transactions to drain before destroying host systems or Core participants. Lifecycle operations (start, pause, resume and destroy) are serialized both at the Core Assembly boundary and inside the public SystemBootstrap API, so shutdown cannot overtake an in-progress lifecycle hook even when Bootstrap is used directly. Integration tests verify both persistence and lifecycle teardown ordering.

## Intentional adaptation from CASSANDRA3

The original reference specifies `initialize()`, `start()` and `destroy()` as mandatory hooks on every system. This reusable Core accepts these lifecycle hooks as optional and validates their types when supplied. A system that only publishes a prepared service does not need empty no-op methods; Bootstrap still tracks initialized systems and invokes `destroy()` wherever cleanup is implemented. This is an intentional reduction of host-system boilerplate, not an accidental omission.

The original Phase 1 plan mentioned an adapter preserving the old prototype UI and controls. That adapter is not being copied into this repository: NEW-GAME-CASS is being established as a clean, reusable engine foundation, and the old prototype UI is not part of the Core runtime. Host UI and input integration should be implemented by the host layer when it exists, without introducing presentation dependencies into Core.

## Phase 1 closure checklist

1. **Module contract review — complete.** Reviewed System Registry, Game Context, Bootstrap/lifecycle, Event Bus, Game Clock, Scheduler, Logger, Entity Registry, World Registry, World Context, Persistence and Core Assembly against the domain-neutral Core contract and the CASSANDRA3 reference.
2. **Integrated failure/recovery review — complete.** Coverage includes synchronous handler isolation and async Event Bus faulting, scheduler step faults and overload recovery, lifecycle compensation/teardown ordering, serialized persistence and shutdown, participant rollback, and deferred cross-registry reference validation.
3. **Browser harness decision — complete.** The HTML pages call the same JavaScript contract-test modules as Node; they add a convenient manual browser runner, but no distinct browser-only Core execution path. Keep them as manual diagnostics; a separate browser CI layer is not justified for this domain-neutral Core until browser-specific host integration exists.
4. **Final verification — complete.** The final code/test run passed 198/198, and the documentation update also passed 198/198 in GitHub Actions. Both checks completed successfully.

Public API documentation and a minimal host-system example are present in `src/core/README.md`.

Phase 1 closure criteria are met. The shared Core foundation is ready for the next phase, where work can move into host/gameplay systems without expanding the responsibilities of Core.
