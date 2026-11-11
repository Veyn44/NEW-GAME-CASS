# Core runtime

The Core is the domain-neutral runtime foundation for host applications. Cassandra is one host game; its systems, entities, worlds and rules are registered by the host and are not embedded in Core.

## Modules

- `system-registry.js` — validates system IDs, unique service providers, dependencies and deterministic initialization order.
- `system-bootstrap.js` — initializes, starts, pauses, resumes and destroys systems with rollback and cleanup.
- `game-context.js` — public service resolution and infrastructure access.
- `core-assembly.js` — composes the reusable infrastructure services and accepts host systems/tasks.
- `logger.js` — bounded structured diagnostics; logging never owns game state.
- `event-bus.js` — synchronous ordered event delivery with retained pending events and explicit recovery after a drain limit.
- `game-clock.js` — configurable simulation clock and pause/speed state.
- `simulation-scheduler.js` — deterministic fixed-step execution, speed-snapshotted backlog and bounded catch-up.
- `entity-registry.js` — stable entity identity, persistent/scoped lifecycles and metadata, independent of domain behavior and world placement.
- `world-registry.js` — registration and activation of host-defined worlds, with opaque host metadata.
- `world-context.js` — exclusive entity placement and atomic transfer between world and storage locations.
- `persistence.js` — adapter-neutral atomic save contract, schema migration and transactional participant restore.


## Host configuration

`createCoreAssembly` requires an explicit persistence adapter with `read(slotId)` and `writeAtomic(slotId, data)`. It does not choose an in-memory adapter implicitly; the host is responsible for supplying durable storage in production. The host may configure `dayLengthRealSeconds`, `strategicSecondsPerDay`, `initialSpeed`, `minimumSpeed`, `maximumSpeed`, `fixedStepSeconds` and `maxStepsPerFrame`. The Core defaults are neutral; Cassandra's 12-minute day and 0.25×–3× speed range belong to its host fixture.

## Entity and world contracts

- `registerPersistent({ id?, kind, metadata? })` registers a host-defined identity in persistent scope.
- `registerScoped({ scopeId, localId?, kind, metadata? })` registers an identity inside an opaque host scope. Generated IDs use `scope:<scopeId>:<localId>`; numeric local IDs are sequenced without reusing reserved IDs.
- `store(id)` changes an active scoped identity to the stored lifecycle state; `activateStored(id)` reactivates it without changing identity. Domain state is saved by its owning participant.
- World types are host-defined lowercase IDs. `metadata` is opaque, deeply copied and immutable; Core does not interpret location or encounter concepts.
- World Context validates existence, lifecycle and coordinates, but leaves scope-to-world policy to host systems.
- Entity Registry and World Registry snapshots use schema version 2 and migrate their version-one formats. Entity IDs remain unchanged during migration.

## Composition contract

Create the runtime with `createCoreAssembly({ hostSystems, simulationTasks, eventSources, saveAdapter, ... })`. A durable adapter implementing `read()` and `writeAtomic()` is mandatory; Core never silently falls back to volatile in-memory saves.

A host system declares `id`, `provides`, and `requires`, then publishes exactly the service APIs it declared from `initialize(context)`. It may implement lifecycle hooks. Host systems are passed to the central Bootstrap; imports do not register systems.

A simulation task declares `systemId` matching a host system and a synchronous `update(step)` function. Optional `everyTicks` controls task frequency. Tasks execute in host-system order, followed by Core's simulation-step event publication. The scheduler does not maintain a second dependency graph.

`eventSources` declares additional trusted event source IDs where a host needs to publish from an adapter or boundary that is not itself a registered system. Core infrastructure sources are registered automatically.

## Runtime semantics

- Bootstrap resolves dependencies before any lifecycle hook runs.
- Event delivery is synchronous and sequential. Asynchronous handlers fault the bus and require runtime reconstruction. A drain-limit fault retains the queue and blocks new publishes until the source is corrected and `drainPending()` is called.
- Scheduler updates are synchronous fixed steps. Promise-returning updates fault the scheduler; simulation time is committed only after all tasks complete.
- Scaled simulation time uses the configurable Game Clock. Pause reasons are independent and composable.
- Entity Registry and World Registry provide explicit version-one to version-two snapshot migrations for the generalized scope and metadata contracts.
- Persistence calls are rejected immediately when invoked inside a simulation step, during pending Event Bus delivery, or while Scheduler is faulted. There is no deferred safe-boundary queue.
- Persistence uses `read` and `writeAtomic` adapters and participant prepare/commit/rollback. `MemorySaveAdapter` is a test/development adapter, not durable production storage; the test fixture supplies it explicitly.

## Ownership boundaries

Entity Registry owns identity. Domain systems own domain state. World Registry owns world definitions/activation. World Context owns entity placement. Core does not generate galaxies, maps, expeditions, scans, host-specific entities or game rules.
