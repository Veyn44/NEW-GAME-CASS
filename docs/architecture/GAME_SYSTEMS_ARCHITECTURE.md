# Game Systems Architecture Map

**Status:** Initial map for Phase 2. This is a living map, not a claim that the full game design is known.

## 1. Architectural direction

Cassandra is a host game built on a reusable, domain-neutral Core.

- Core owns shared runtime infrastructure and generic identity/world primitives.
- The host owns application composition, adapters, presentation and storage integration.
- Gameplay systems own game-specific data, rules and public services.
- A system may depend on another system's declared public service, not its private implementation.
- Event Bus events announce facts that have already happened. Commands/requests use the owning system's public service API.
- Rendering and input are adapters at the host boundary; simulation rules remain independent of the browser and renderer.
- New features should be added as new systems or adapters where possible, not as special cases in existing unrelated systems.

The complete future system inventory is intentionally unknown. Add systems when a concrete gameplay requirement appears.

## 2. Existing Core capabilities (do not reimplement in gameplay systems)

The current Core exposes these infrastructure services through Core Assembly:

| Service ID | Responsibility | Must not own |
|---|---|---|
| `core.event-bus` | Synchronous event delivery and subscriptions | Gameplay commands or domain state |
| `core.game-clock` | Authoritative simulation clock and pause/speed state | Pawn-specific timers or domain schedules |
| `core.entity-registry` | Stable entity identity and generic lifecycle | Pawn attributes, inventory or behavior |
| `core.world-registry` | Registration/activation of host-defined worlds | Map tiles, galaxy data or world generation |
| `core.world-context` | Exclusive entity placement and atomic transfers | Movement rules, pathfinding or collision policy |
| `core.scheduler` | Fixed-step execution of declared synchronous simulation tasks | Gameplay rules or a second dependency graph |
| `core.persistence` | Coordinated snapshots, restore transactions and schema migration | Serialization of private domain structures |
| `core.logger` | Structured technical diagnostics | Player-facing game events or domain state |

The Core Assembly also provides the Game Context, System Registry and Bootstrap lifecycle. Their public contracts are documented in `src/core/README.md`.

**Important:** service IDs above are taken from the current Core Assembly. Do not invent alternate IDs or access private Core internals. If an implementation needs a service not listed here, inspect the actual Core API before designing an adapter.

## 3. Initial host/gameplay layers

These are responsibility areas, not a frozen final list of systems.

### A. Host application and adapters

| Responsibility | Owns | Does not own |
|---|---|---|
| Host composition | Core Assembly configuration, system list, simulation task list, lifecycle | Gameplay state |
| Input adapter | Keyboard/mouse/device input and translation into game commands | Direct mutation of Pawn/world state |
| Presentation adapter | Drawing, camera, debug overlays and UI state | Simulation truth or authoritative entity state |
| Storage adapter | Durable host storage implementation for Core persistence | Domain serialization rules of individual systems |

### B. First gameplay slice

| Candidate system | Owns | Likely Core contracts used | Initial scope |
|---|---|---|---|
| World/Scene host definition | Definition/configuration of the one test world and its dimensions | World Registry, World Context | One simple bounded world; no galaxy or world generation |
| Pawn system | Pawn-specific identity references, domain state and public Pawn API | Entity Registry, World Context, Event Bus, Persistence | Create/query/remove a minimal Pawn and preserve its state |
| Locomotion system (or Pawn movement module if still very small) | Movement intent, movement rules and movement state | World Context, Scheduler, Event Bus | Deterministic movement in the test world |
| Optional spatial/collision system | Spatial queries and collision rules if required by the first slice | World Context, Scheduler | Only introduce if movement needs a separate owner; do not prebuild a physics engine |

The final split between Pawn and Locomotion is an explicit design decision for 2.0. Prefer a separate Locomotion system only if it has a genuinely independent responsibility and public contract. Do not split code into empty systems just to look modular.

### C. Possible future domains (not committed to Phase 2)

Potential areas that may emerge as the game develops:

- Pawn Life: needs, health, aging, skills, professions and relationships.
- Inventory and Equipment: item identity, ownership, loadouts and storage.
- Construction and Structures: modules, rooms, walls, doors and structural integrity.
- Environment: atmosphere, pressure, temperature and environmental hazards.
- Power: generation, routing, consumers and electrical faults.
- Colony Operations: jobs, priorities, schedules and automation.
- Combat and Threats: targeting, weapons, damage, hostile behavior and incapacitation.
- Exploration and Mining: locations, resource deposits, extraction and discovery.
- Navigation and Vehicles: travel, shuttle, docking and transitions.
- Galaxy Data: hierarchical address space, procedural generation and discovery.
- UI/UX: screens, commands, information presentation and accessibility.

These are discovery categories, not a promise that every category will exist or that each must become one system.

## 4. Dependency direction

Preferred dependency direction:

```text
Host Application
  ├── Input Adapter ───────────────┐
  ├── Presentation Adapter         │
  ├── Storage Adapter              │
  └── Core Assembly                │
        └── Core Infrastructure    │
                                   ▼
                         Gameplay public APIs
                          ├── Pawn
                          ├── World/Scene definition
                          └── Locomotion (if separate)
                                   │
                                   ▼
                         Core services / placement
```

The diagram expresses responsibility boundaries, not an instruction for systems to call each other in a cycle. Gameplay systems declare service dependencies during registration. A system must not import another system's private source file to reach its internal data.

## 5. Data ownership rules

- Entity Registry owns generic identity and generic lifecycle only.
- World Registry owns world definitions/activation metadata.
- World Context owns exclusive placement and atomic transfer.
- Pawn system owns Pawn-specific domain state.
- Locomotion owns movement rules/state if it is split into its own system.
- A future inventory system owns item records and ownership relations; Pawn stores references/IDs through its public contract rather than copying item objects.
- A future environment system owns environmental state and rules.
- Persistence coordinates participants; each participant owns its own snapshot schema and migrations.
- Presentation may cache derived visual data, but it is never the authority for simulation state.
- Input produces requests/commands; it does not directly change authoritative state.

No universal GameState object should become the owner of all game data.

## 6. Cross-system communication

Use a public service when a caller needs an answer or requests an operation (for example, create a Pawn, query a state, request movement).

Use Event Bus when a system announces a completed fact (for example, Pawn created, Pawn moved, world activated). Event payloads are versioned contracts and must not expose mutable internal objects.

Do not use events as a hidden command queue. Do not make a consumer depend on the private class or storage structure of the publisher.

## 7. Core change gate

Before proposing a Core change, document:

1. Exact current Core contract that is insufficient.
2. Concrete failing test or reproducible host integration scenario.
3. Why an adapter or gameplay-owned implementation cannot solve it.
4. Why the change remains domain-neutral.
5. Compatibility and regression impact.
6. Required archive/version/provenance update if accepted.

Without this evidence, the change belongs in the host/gameplay layer.

## 8. Open decisions to resolve only when needed

- Whether Locomotion is a separate system or initially part of Pawn.
- Whether the first visible test harness uses Canvas, DOM, or a temporary debug renderer.
- The first world's coordinate model and whether it is tile/grid-based or continuous.
- The minimum movement and collision behavior needed for the first slice.
- The host storage adapter used during development and later production.

Do not settle these questions by assumption. Resolve them in the relevant Phase 2 substep and record the decision with its reason and test evidence.
