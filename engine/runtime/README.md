# Host Runtime

The host runtime is the application boundary around the domain-neutral Core.

## Composition

Use `createGameRuntime({ saveAdapter, hostSystems, simulationTasks, eventSources, ...coreOptions })` from `create-game-runtime.js`.

- A real save adapter is mandatory. It must implement `read(slotId)` and atomic `writeAtomic(slotId, data)`.
- Host systems are declared explicitly; importing a system must not register it.
- Simulation tasks are synchronous and reference a declared host system ID.
- Browser input, rendering and storage implementations stay outside Core and outside domain systems.

## Lifecycle

1. Create the runtime with the host's adapters, systems and configuration.
2. Await `start()`; use the returned Game Context or the `context` getter.
3. Call `advance(realDeltaSeconds)` from the host's outer loop. Do not put requestAnimationFrame, DOM or device APIs in simulation systems.
4. Use `pause()` and `resume()` for application lifecycle transitions.
5. Stop the outer loop and call `destroy()` when the host is closing.

The runtime wrapper intentionally does not choose a renderer, input model, world size, movement speed or persistent storage implementation. Those belong to the host/gameplay design and will be added only when needed.

## Ownership

- Core owns its registries, clock, scheduler, Event Bus and Persistence coordinator.
- The host owns composition, application lifecycle, adapters and the storage implementation.
- Each gameplay system owns its domain state and persistence participant.
