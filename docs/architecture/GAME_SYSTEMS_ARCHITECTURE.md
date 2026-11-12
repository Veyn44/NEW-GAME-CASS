# Game Systems Architecture Map

**Status:** Living architecture map for Phase 2.  
**Authority:** Accepted decisions in `WHATANDWHY.md`, current Core source and the system development standard.

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

| Service ID | Responsibility | Must not own |
|---|---|---|
| `core.event-bus` | Synchronous ordered event delivery | Gameplay commands or domain state |
| `core.game-clock` | Authoritative simulation clock and pause reasons | Unit-specific timers or domain schedules |
| `core.entity-registry` | Stable generic identity and lifecycle | Unit/Pawn attributes, inventory or behavior |
| `core.world-registry` | World descriptors and one active-world pointer | Tile data, galaxy data or world generation |
| `core.world-context` | Exclusive entity placement and atomic transfers | Movement rules, pathfinding or collision policy |
| `core.scheduler` | Fixed-step synchronous task execution | Gameplay rules or a second dependency graph |
| `core.persistence` | Coordinated snapshots, migrations and restore transactions | Private domain serialization |
| `core.logger` | Structured technical diagnostics | Player-facing events or domain state |

Core Assembly also provides System Registry, System Bootstrap and Game Context. Their contracts are defined by the actual implementation and `src/core/README.md`.

**Core protection:** do not add game-specific fields, concepts or behavior to Core. Before proposing a Core change, document the exact limitation, a reproducible failing host/gameplay scenario, why a gameplay-owned solution cannot solve it, and the domain-neutral benefit. Without that evidence and explicit approval, solve the requirement outside Core.

## 3. Domain vocabulary and identity layers

The terms below describe different layers and must not be used interchangeably.

### Entity (Core concept)

An Entity is a generic identity registered in Core Entity Registry. Core owns:
- stable ID;
- generic `kind`;
- generic scope and lifecycle status;
- generic metadata.

Core Entity is not a complete game object. It does not own gameplay attributes, behavior, relationships, visual appearance, inventory, world position or tile occupancy.

For the first Unit implementation, the proposed Core identity kind is `unit`. The Core record is an identity anchor only; it is not the Unit data record.

### Unit (Cassandra gameplay concept)

A Unit is a gameplay-domain instance owned by the Unit gameplay layer. It is backed by exactly one Core Entity identity and may have a placement managed by Core World Context.

The Unit layer owns:
- the Unit's domain record and schema;
- the relationship between its Unit ID (the Core Entity ID) and its gameplay definition;
- Unit-specific lifecycle rules that are not generic Core lifecycle;
- validation and public operations for Unit instances.

A Unit record must not copy Core-owned identity lifecycle fields or Core-owned placement coordinates. It refers to those services through their public APIs.

The initial Unit contract must remain deliberately small. Do not invent health, age, needs, skills, jobs, inventory, equipment, personality, combat statistics or appearance fields until a concrete gameplay requirement defines them.

### Pawn (gameplay specialization; not a Core primitive)

Pawn is a gameplay-level specialization/role within the Unit domain, not a second identity registry and not a replacement for Unit.

A Pawn:
- uses the Unit's stable identity;
- uses the Unit system's canonical instance record and lifecycle;
- may expose additional Pawn-specific behavior or data only when a concrete requirement needs it;
- does not receive a second Core Entity identity merely because it is a Pawn.

The precise player-facing meaning and distinguishing attributes of Pawn remain open game-design decisions. Profession/skill-like values (for example mining or research ratings) may become data-driven Unit/Pawn attributes, but their ownership, progression and modifier rules remain open until designed. Until they are decided, Pawn must not become a separate Core kind, a parallel identity model, or a premature independent system.

### Definition versus instance

A **Unit Definition** is immutable canonical content describing what kind of Unit can be created. It has a stable definition ID and is owned by the gameplay system responsible for that content. Definitions are not runtime entities and are not registered in Core Entity Registry.

A **Unit Instance** is one actual Unit in a running/saved game. It references one canonical Unit Definition and has its own Core Entity ID plus Unit-owned mutable runtime state. The definition may supply canonical/default values; the instance owns mutable values and progression. Effective values after modifiers are derived at runtime and must not overwrite the canonical definition.

The Database inspector is a reusable presentation surface for both canonical definitions and live Unit/Pawn instances. In definition context it displays canonical content values. In live-instance context it displays current instance/effective values, and may show base values plus modifier contributions when the relevant gameplay APIs provide them. The Database does not own runtime state or calculate gameplay values; it renders data supplied by the owning gameplay systems. This allows an in-game Pawn information action to reuse the same inspector instead of introducing a separate Pawn-only information UI.

The Database catalog reads canonical definitions from their owning gameplay systems. It must not become a second source of definitions or contain copied mutable instance state. The same inspector can also render a live Unit/Pawn instance using data supplied by gameplay APIs; it shows current/effective values rather than mutating or replacing canonical definition values.

Database is a single shared experience with two contextual modes:
- **Browse mode** presents the full catalog for inspection. It does not expose an active selection action.
- **Selection mode** reuses the same catalog, search, hierarchy and inspector, but the caller supplies an eligibility scope and receives a stable definition ID after confirmation. For Dev Lab Spawn Unit, only Unit-instantiable definitions may be confirmed.

Selection controls belong to the caller context, not to individual catalog entries. Normal Database may hide the reserved Select area or render it as a non-interactive informational imprint. Dev Lab selection mode exposes the active Select control in a reserved bottom-right area. Database never creates runtime instances; the caller invokes the appropriate gameplay API.

The catalog should support lazy detail loading: a lightweight index exposes stable IDs and navigation metadata; full definition details load when an entry is selected, and artwork loads only when that entry's detail is opened. The Database must still show all available information for the selected definition. This is a loading strategy, not permission to omit canonical attributes or details.

## 4. Ownership and boundaries

| Responsibility | Owner | Must not own |
|---|---|---|
| Generic identity and generic lifecycle | Core Entity Registry | Unit/Pawn domain state |
| World identity, dimensions and active-world pointer | Core World Registry | Map tiles or Unit placement |
| Exclusive placement and coordinates | Core World Context | Movement/collision rules |
| Unit definitions and Unit instance domain state | Unit gameplay system | Generic identity or placement |
| Pawn-specific data/behavior | Unit domain, or a later justified Pawn module | A parallel identity registry |
| Movement intent and movement rules | Initially a small Unit-owned module; split only if independently justified | Input devices or rendering |
| Tile/map contents and tile queries | Cassandra world/map gameplay owner when implemented | Core World Registry/Context |
| Input capture and translation | Host input adapter | Direct authoritative state mutation |
| Drawing, camera and UI | Presentation adapter | Simulation truth |
| Save coordination | Core Persistence | Private Unit schema |
| Unit snapshot schema and migration | Unit gameplay system | Core identity/placement snapshots |
| Canonical definition catalog presentation | Application Database UI | Ownership or mutation of gameplay definitions |

No universal GameState object should become the owner of all game data.

## 5. Initial host/gameplay slice

These are responsibility areas, not a frozen final system inventory.

### A. Host application and adapters

| Responsibility | Owns | Does not own |
|---|---|---|
| Host composition | Core Assembly configuration, systems and simulation tasks | Gameplay state |
| Input adapter | Device/browser input and translation into public game requests | Direct mutation of Unit/world state |
| Presentation adapter | Drawing, camera, debug overlays and UI state | Simulation truth |
| Storage adapter | Durable host storage implementation | Domain serialization rules |

### B. First gameplay foundation

| Candidate | Owns | Core integration | Initial scope |
|---|---|---|---|
| World bootstrap / world definition | Configuration of the first test world | World Registry | Register and activate one bounded test world |
| World/map model (when tile content is introduced) | Authoritative tile/cell data and tile-specific queries | May refer to world ID | No premature generic map framework |
| Unit system | Unit definitions/instances as implementation scope requires, Unit domain records and public API | Entity Registry, World Context, Event Bus, Persistence | Create/query/list/remove minimal Unit instances and preserve Unit-owned state |
| Unit movement module | Movement intent and movement rules if needed by first playable slice | World Context, Scheduler, Event Bus | Minimal deterministic movement |
| Optional spatial/collision owner | Spatial queries and collision policy only if a concrete requirement justifies it | World Context and scheduler as needed | No prebuilt physics/pathfinding engine |

Do not create empty systems merely to appear modular. Begin movement as a small Unit-owned module. Extract a separate `game.locomotion` system only when it has a genuinely independent data model, lifecycle or public contract.

### C. Future domains (not committed to Phase 2)

Potential areas include:
- Unit Life: needs, health, aging, skills, professions and relationships.
- Inventory and Equipment.
- Construction and Structures.
- Environment: atmosphere, pressure, temperature and hazards.
- Power: generation, routing, consumers and faults.
- Colony Operations: jobs, priorities, schedules and automation.
- Combat and Threats.
- Exploration and Mining.
- Navigation and Vehicles.
- Galaxy Data and procedural generation.
- UI/UX.

These are discovery categories, not a promise that each will exist or become a separate system.

## 6. Dependency direction and communication

Preferred direction:

```text
Host Application
  ├── Input Adapter
  ├── Presentation Adapter
  ├── Storage Adapter
  └── Core Assembly
        └── Core Infrastructure
              ▲
              │ public service contracts
        Gameplay Systems
          ├── World / Map
          ├── Unit (Unit + possible Pawn specialization)
          └── Other gameplay domains
```

A gameplay system declares service dependencies and uses public APIs. It must not import another system's private source files or mutate its internal state.

Use a public service when a caller needs information or requests an operation. Use Event Bus to announce a completed fact. Events are not commands or a hidden work queue. Payloads must be versioned, detached and immutable according to the Core contract.

## 7. Persistence and lifecycle

- Core Entity Registry snapshots generic identity.
- Core World Registry snapshots world descriptors and active-world status.
- Core World Context snapshots placements.
- Unit system snapshots only Unit-owned domain records and definition references/IDs required to restore them.
- Unit restore must prepare detached data without mutating live state, validate cross-references after earlier Core participants have committed, and support rollback.
- Do not duplicate Core identity or placement data inside Unit snapshots.
- A Core Entity status of `active` is not the same as a world being active or a Unit being present in an active simulation.
- Core Scheduler runs tasks globally; active-world selection does not automatically filter world-scoped work. Cassandra must gate world-scoped simulation centrally.

## 8. Open game-design decisions

Resolve these only when the relevant implementation requires them:
- The precise player-facing meaning and differentiating traits of Pawn.
- Which Unit types are required for the first playable slice.
- Unit display/identity fields and definition attributes.
- Movement feel and whether movement is tile-step or continuous.
- The first test environment's content and visual representation.
- The eventual split, if any, between Unit and dedicated Locomotion systems.

Do not settle these by assumption. Record accepted decisions in `WHATANDWHY.md`.

## 9. Implementation gate

Before Unit implementation:
1. Confirm the smallest useful Unit Definition shape from actual content needs.
2. Confirm the smallest Unit Instance shape without speculative gameplay fields.
3. Specify the public service contract and Core dependencies.
4. Specify creation/removal failure handling and identity/placement consistency.
5. Specify Unit persistence prepare/commit/rollback behavior.
6. Add unit, contract, integration and persistence tests.
7. Keep Dev Lab controls and test-world assumptions outside reusable gameplay logic.

**Current status:** Unit foundation is implemented and automated tests pass. Contextual Database selection and Dev Lab Spawn Unit integration are the next planned slice.
