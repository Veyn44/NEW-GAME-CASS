# Engine / Cassandra / Dev Lab — Capability and Ownership Review

> **Purpose:** Consolidate the current Engine implementation, Cassandra's agreed and proposed gameplay needs, and Dev Lab's development-tool requirements into one ownership and capability map.
>
> **Status:** Review document — not an implementation approval.
> **Branch:** work
> **Date:** 2026-11-15
> **Inputs:** Current source audit, `engine/core/README.md`, `docs/architecture/application-boundaries.md`, `NEXT_STEPS.md`, `CASSANDRA_VISION.md`, and `docs/architecture/phase-3-brainstorm.md`.
>
> **Decision rule:** “Agreed” records an explicit direction. “Candidate” is not approved. “Open” needs a design decision. This document does not silently promote proposals into requirements.

---

## 1. The three products and their relationship

The repository contains three distinct responsibilities:

1. **Engine** — reusable runtime and technology. It must work without Cassandra and without Dev Lab. It owns generic mechanisms and contracts, not game rules or development UI.
2. **Dev Lab** — an Engine development environment. It creates, edits, inspects, diagnoses and tests Engine worlds and data. It may expose tools that the shipped game never needs.
3. **Cassandra** — a game built on Engine. It owns the universe, colony, expeditions, units, resources, combat, progression, and all player-facing game rules.

Dependency direction:

`Dev Lab → Engine`  
`Cassandra → Engine`

Engine must not import either application. Cassandra and Dev Lab are separate applications; neither is a runtime prerequisite for the other. Dev Lab should test the same Engine capabilities that Cassandra uses, not maintain parallel implementations of game mechanics.

### Important distinction in the current repository

There are currently two ways to reach a screen labelled “Dev Lab”:

- The **Cassandra-hosted Dev Lab workspace** is the current primary workflow. It is mounted inside the Cassandra application and can be supplied with Cassandra content/gameplay adapters.
- The **standalone Engine-only Dev Lab** is a separate, optional application shell that composes Engine without Cassandra gameplay.

These are not the same runtime. The target architecture is real application separation, not simply renaming the existing Cassandra-hosted workspace.

### Save files and persistence boundary

Cassandra saves and Dev Lab workspace files are not intended to be exchanged. Cross-application save compatibility is **not a product requirement**.

The current shared slot/state identifiers and Cassandra-specific `.cass` adapter are a transitional implementation detail and a boundary defect to clean up. The target should be:

- Engine defines generic snapshot/restore and persistence participant contracts.
- Each application supplies its own adapter, file format/envelope, slot identity, state identity, file extension, and user-facing save/load workflow.
- Cassandra save data belongs to Cassandra; Dev Lab workspace/session data belongs to Dev Lab.
- Neither application should accidentally open, overwrite, or claim compatibility with the other's save files.
- Do not build a cross-save converter, shared save namespace, or compatibility protocol unless a future product requirement explicitly asks for it.

The generic Engine persistence contract should remain reusable, but the concrete storage and application identity must be isolated at each composition root.

---

## 2. What Engine already provides

The following are present in the current Core implementation, not future promises.

| Capability | Current Engine state | Assessment |
|---|---|---|
| System composition and lifecycle | System Registry, Bootstrap, dependency ordering, initialize/start/pause/resume/destroy and rollback | Foundation exists |
| Service/context access | Game Context and Core Assembly | Foundation exists |
| Events | Ordered synchronous Event Bus with retained pending events and recovery rules | Foundation exists; preserve tested semantics |
| Simulation time | One configurable Game Clock | Exists, but currently global |
| Fixed-step execution | Synchronous Simulation Scheduler with bounded catch-up and ordered tasks | Exists, but currently global rather than per-world |
| Entity identity | Stable IDs, persistent/scoped lifecycle, metadata, stored/active/removed handling | Exists |
| World registration | Multiple host-defined worlds can be registered; opaque metadata; one `activeWorldId` | Partial: registration exists, active-world semantics are too narrow |
| Entity placement | World Context places an entity at one world/store coordinate and supports atomic transfer between those locations | Basic placement exists; not a physical occupancy system |
| Persistence coordination | Adapter-neutral participant snapshots, schema migrations, prepare/commit/rollback | Foundation exists |
| Host adapters | Host supplies persistence adapter and systems/tasks | Correct boundary |
| Browser rendering / viewport | Shared application presentation code, outside Engine Core | Not Engine capability |
| Cassandra Units and colony control | Cassandra gameplay systems built over Core Entity/World services | Game-owned, not generic Engine |

### Important limits of the existing spatial model

- World Context's “exclusive placement” means one current placement record per entity. It does **not** mean one entity per coordinate.
- Multiple entity IDs can currently be placed at the same coordinate because placement is indexed by entity.
- There is no authoritative cell model or spatial occupancy index.
- There are no multi-cell footprints, overlap validation, passability/collision rules, neighbor/radius queries, or pathfinding in Core.
- The viewport's visual grid and camera geometry are presentation, not authoritative world geometry.
- Entity Registry owns identity; it does not own an entity's gameplay state or physical shape.

These distinctions matter: do not replace working Core contracts just because a new spatial layer is needed.

---

## 3. Consolidated ownership map

| Capability / feature | Engine | Dev Lab | Cassandra |
|---|---|---|---|
| Entity identity and lifecycle | **Owns** generic identity and lifecycle contracts | Creates/inspects test entities through Engine | Defines Unit/Pawn/game entities using Engine identities |
| World registry and generic lifecycle | **Owns** generic world registration and lifecycle mechanisms | World creation, selection, inspection and test controls | Main/temporary world roles and their game lifecycle policy |
| World simulation scheduling | **Owns** generic scheduling primitives; needs a world-aware design if multiple worlds run independently | Starts, pauses, steps and diagnoses worlds for testing | Chooses which worlds run and when; main world pause during an encounter is game policy |
| Grid and physical space | **Owns** reusable square-grid/spatial primitives if approved | Visualizes, edits and stress-tests spatial state | Chooses world content, terrain, rules and gameplay meaning |
| Cells and spatial contents | **Owns** generic cell/occupancy representation, not game categories | Inspect/add/remove/test contents | Defines floors, rock, vacuum, buildings, units, projectiles, resources, etc. |
| Multi-cell footprints | **Owns** generic footprint/occupancy mechanics if approved | Place, rotate, inspect and validate test footprints | Defines which game objects need which shapes and placement rules |
| Spatial queries | **Owns** reusable query/index mechanisms | Exposes query/debug tools and visual overlays | Uses queries for gameplay decisions and supplies game-specific filters |
| Movement and collision | Candidate: generic spatial movement/collision primitives only where reusable | Test and diagnose movement/collision behavior | Owns Pawn movement, speed, permissions, blocking policy, combat and game-specific response |
| Pathfinding / AI | Not currently required; avoid speculative Engine scope | Could provide test visualization later | Game feature; design when actual gameplay requires it |
| Environment simulation | Existing tested simulation behavior must be preserved; generic reusable mechanisms only | Inspect and test environment state | Owns game-specific environmental meaning, thresholds and consequences |
| Input infrastructure | Owns only domain-neutral input/action routing contracts that are proven reusable | Browser/device input adapters and editor shortcuts | Game action mapping, control eligibility and player-control rules |
| Control Modes | Generic routing primitives may belong in Engine; exact contract remains open | Debug/authoring modes and tool selection | Game modes such as direct Pawn control, interaction and gameplay commands |
| Rendering and viewport | No browser/DOM or app UI in Core; generic renderer abstraction only if a real need appears | Editor viewport, overlays, selection, gizmos and diagnostics | Player-facing game rendering and UI |
| Database / content definitions | Generic package/registry/schema mechanisms only if confirmed reusable | Browse, inspect, validate and test packages | Owns Cassandra definitions, balance and game content |
| Persistence mechanism | **Owns** generic snapshot/restore contracts, migrations and transaction coordination | Owns Dev Lab adapter, workspace format and workspace identity | Owns Cassandra adapter, save format and save identity |
| Cross-world expedition result | At most generic atomic transaction/change-application primitives, if justified | Test generic transfer/rollback mechanisms | Owns expedition creation, participating entities, result rules and commit/abandon decisions |
| Universe map and procedural generation | No Cassandra universe model | Could inspect generated test data | **Owns** galaxy hierarchy, scans, seeds, discoveries and location records |
| Resource economy and mining | No resource types or mining rules | Inspect/test game data where useful | **Owns** deposits, extraction, resource accounting, mine shafts and mining bases |
| Combat and enemies | No combat or enemy rules | Scenario setup and diagnostics only | **Owns** combat, enemy generation, Clear state and encounter outcomes |
| Remote bases | No strategic base model | Could inspect records/tools | **Owns** workforce, production, upkeep, events and logistics |
| Application shell / menus | No application shell | Owns Dev Lab shell and developer workflow | Owns Cassandra shell, menus and player workflow |

---

## 4. What Cassandra needs from the Engine

This section extracts reusable capabilities from Cassandra's design. It does not move Cassandra gameplay rules into Engine.

### 4.1 Multiple worlds with distinct roles

**Agreed Cassandra requirement**
- A persistent Main World contains the colony.
- At most one Temporary World is normally active for an expedition/encounter in Cassandra.
- A common Temporary World size is 128×128; 256×256 must also be supported.
- Main World is normally paused while an encounter is active.

**Reusable Engine requirement**
- More than one world can exist at the same time; Engine must not hard-code a two-world maximum.
- Existence, registration, loading/readiness, simulation, pause, selection/focus, rendering, unloading and disposal must not be collapsed into one `active` flag.
- A world may exist without being loaded, selected, rendered or simulated.
- A host decides which worlds run. Engine does not automatically pause Main World because another world starts.

**Current gap**
- World Registry currently exposes one `activeWorldId`.
- Game Clock and Simulation Scheduler are global.
- Exact world lifecycle states and independent per-world time/scheduling have not been specified.

**Ownership:** Engine mechanisms; Cassandra world roles and pause policy; Dev Lab lifecycle controls and diagnostics.

### 4.2 Square grid and world geometry

**Agreed direction**
- Square grid.
- World dimensions need to be configurable; Cassandra needs at least the cited 128×128 and 256×256 cases.
- Cassandra's colony map is expected to be finite, but exact bounds and edge behavior remain open.
- A world can contain solid rock and natural cavities; map bounds and asteroid geometry are separate ideas.

**Engine capability to design**
- A generic grid/world coordinate contract.
- Bounds and out-of-bounds behavior.
- Cell addressing and neighborhood definitions.
- A way to represent large or sparse spaces without allocating meaningless cell objects everywhere.
- Clear distinction between world geometry and viewport/camera coordinates.

**Still open**
- Whether all Engine worlds must use a grid or can opt into one.
- Exact coordinate type, resize behavior, sparse representation, cell storage and neighborhood API.
- Exact Cassandra world dimensions and edge rules.

### 4.3 Spatial occupancy and composition

**Agreed direction**
- One coordinate can contain multiple independent spatial contents.
- There is no fixed six-layer limit.
- A category/layer may contain multiple entities.
- One entity may occupy multiple cells while retaining one identity and lifecycle.
- Tile-by-tile construction remains possible where appropriate; not every building becomes one large multi-cell entity.
- Empty cell is neutral; vacuum is a separate environmental property/content.

**Engine capability to design**
- Authoritative spatial occupancy/composition, separate from rendering.
- Extensible categories/layers without a hard-coded list of Cassandra concepts.
- Multi-cell footprint support and a stable entity-to-cells relationship.
- Placement validation and overlap queries, with host-supplied policy where needed.
- Efficient representation of default/empty cells.

**Still open**
- Exact distinction between cell, layer, category, entity and component.
- Footprint shape, orientation/rotation and placement rules.
- Which data is stored per cell versus represented by entities, components, fields or regions.
- Which overlaps are allowed and who decides.

### 4.4 Spatial queries

Cassandra needs to ask questions such as:
- What is at this coordinate?
- What occupies this area or footprint?
- Which contents belong to a given category?
- Which neighboring cells or radius are relevant?
- Which positions are empty or eligible?
- Which contents match an environmental property such as vacuum?

**Engine capability to design:** generic query/index primitives and stable query semantics.  
**Cassandra ownership:** meaning of the results for construction, movement, combat, environment and gameplay.  
**Dev Lab ownership:** query inspector, overlays and test tools.

### 4.5 Movement and collision

The current Cassandra Pawn movement is game-specific: Draft state, leader eligibility, WASD meaning, speed, diagonal normalization and gameplay consequences belong to Cassandra.

A reusable Engine layer may eventually provide:
- Atomic spatial move/relocation operations.
- Footprint-aware occupancy checks.
- Generic collision/overlap query primitives.
- A way for the host to provide passability and collision policy.

Do not move Cassandra's current movement rules into Engine. Do not assume that every entity moves, that every overlap is a collision, or that projectiles, debris, structures and Pawns obey the same rules.

**Open scope decision:** whether movement/collision primitives are part of this physical-world phase or a later Engine capability. Pathfinding and AI are not implied by the current requirement.

### 4.6 Temporary-world result and persistence

Cassandra's expedition concept is:

1. Create a temporary encounter representation from the relevant persistent state.
2. Run the encounter and mutate its participating state.
3. At End/Abandon, determine the final consequences.
4. Apply only the relevant changes to the persistent campaign/location records.
5. Dispose of the temporary runtime world.

The conceptual formula is `newState = previousState + changes`, not replacement of the whole Main World.

**Cassandra owns:** expedition workflow, selected entities, shuttle/crew rules, End versus Abandon, Clear/Done, resource and object consequences, and what is committed.

**Engine may own:** generic transaction/batch validation and atomic state application only if these prove reusable beyond Cassandra. The exact transfer protocol is not approved.

**Open:** package shape, identity mapping, stale/conflicting changes, validation, atomicity, rollback and failure recovery.

### 4.7 Location persistence versus runtime worlds

Cassandra distinguishes a location's durable record from a currently instantiated Temporary World. A location may be reconstructed from a seed and persistent changes; transient enemy instances need not be saved.

This is a Cassandra persistence model. Engine provides generic snapshots, participants, schema versioning and restore coordination; it should not know about asteroid seeds, enemies, Clear/Done or mine shafts.

---

## 5. What belongs specifically to Cassandra

These are game systems and data, not Engine foundations:

### Universe and exploration
- Hierarchical galaxy/sector/region/system map (the current concept yields 16,777,216 star systems).
- System, planet and asteroid generation and discovery.
- Scanning and compact scan records.
- Location identity, revisiting, retirement and Done state.
- Mission briefing, destination, crew/supply selection and travel.
- Shuttle identity and encounter representation.

### Expedition and encounter rules
- Main World versus Temporary World roles in the game.
- Pausing Main World during an encounter.
- End Expedition versus Abandon Expedition.
- Requirement that all living assigned Pawns be aboard the shuttle for normal End.
- Encounter Clear state and whether enemies regenerate on a later visit.
- Enemy behavior and consequences for abandoned objects.
- Crew, equipment, shuttle and survivor outcomes.

### Asteroids, mining and resources
- Rock, cavities, excavation and asteroid interior generation.
- Resource inventories, deposits, scan estimates and extraction.
- Deducting only actually extracted resources.
- Mine Shaft generation and its relationship to the parent asteroid.
- Mining devices, remote mining outposts and resource delivery.

### Remote bases
- Strategic/abstract base records.
- Buildings, job slots, workers, robots, managers and staffing.
- Production, consumption, upkeep, resource output and logistics.
- Base events and notifications when staffing or status changes.

Many details in these areas remain **proposed or open** in the brainstorm. Ownership being Cassandra-specific does not mean every feature is approved for implementation.

---

## 6. What belongs specifically to Dev Lab

Dev Lab is not a second implementation of Cassandra gameplay. It is a tool environment for exercising Engine capabilities and inspecting data.

Its intended responsibilities include:
- Standalone application shell and developer navigation.
- World creation, selection, loading, stepping, pausing and lifecycle inspection.
- Visual world/grid editor or preview once the spatial model exists.
- Entity creation, placement, selection, inspection and removal using generic Engine contracts.
- Spatial occupancy/footprint/query inspectors and visual overlays.
- Database/content package browser, schema/definition inspection and validation tools.
- Diagnostics, logs, event/scheduler inspection and controlled test scenarios.
- Test data and sample packages that do not require Cassandra definitions.
- Its own save/workspace format and persistence identity, isolated from Cassandra.

Dev Lab may provide controls for capabilities that players never see. It should not define Cassandra's production rules, and it should not require Cassandra to start.

**Current limitation:** the standalone Engine-only Dev Lab exists as an optional shell, while the Cassandra-hosted workspace remains the primary workflow. The UI and application separation is not yet fully complete.

---

## 7. Engine gap list — proposed work areas, not yet a task order

The gaps below are derived from the current source and the agreed requirements. They are not all approved for one implementation phase.

| ID | Engine capability gap | Why it is needed | Priority signal | Status |
|---|---|---|---|---|
| E1 | World lifecycle model beyond one active ID | Multiple worlds must exist with separate load/simulate/select/render states | Foundational | Required design |
| E2 | World-aware simulation scheduling/time policy | Current clock/scheduler are global; host needs control over which world advances | Foundational if worlds simulate independently | Open contract |
| E3 | Generic square-grid geometry and bounds | Cassandra colony and encounter spaces use square grids | Foundational | Agreed direction; details open |
| E4 | Authoritative cells/spatial composition and occupancy | Multiple contents may coexist at one coordinate | Foundational | Agreed direction; data model open |
| E5 | Multi-cell footprint support | Vehicles, large objects and creatures can occupy multiple cells as one entity | Required capability direction | Shape/rotation/validation open |
| E6 | Spatial query/index service | Gameplay and Dev Lab need efficient queries by position, area, category and footprint | Depends on E4 | Required capability direction |
| E7 | Generic movement/collision primitives | Needed only if shared by multiple hosts/systems; policy remains host-owned | After E4–E6 | Scope open |
| E8 | Generic transactional change application | Could support temporary-world results without replacing unrelated state | Cassandra transfer concept | Reuse not yet proven |
| E9 | Persistence of new spatial/world state | Grid/occupancy/lifecycle data must survive save/restore where applicable | After spatial contracts | Required once data model exists |
| E10 | Input/action/control-mode contracts | Need to separate physical input collection, generic routing and game actions | Cross-cutting | Existing input service exists; broader modes open |
| E11 | Data/package registry and validation contract | Dev Lab must inspect packages without assuming Cassandra content | Cross-cutting | Ownership direction in roadmap; audit exact current implementation |
| E12 | Performance and determinism criteria for spatial systems | Needed before selecting indexes/storage and test expectations | After requirements | Not specified |

### Explicitly not Engine work

- Cassandra Unit/Pawn/Colony Leader, movement speed, combat, inventory, mining, resources or enemy rules.
- Galaxy map, procedural star systems, scanning, expedition lifecycle, Clear/Done or remote-base economy.
- Dev Lab menus, editor panels, browser file pickers, canvas overlays, keyboard shortcuts or workspace format.
- A shared Cassandra/Dev Lab save namespace or cross-save compatibility.
- A fixed two-world limit, fixed six-layer model, or game-specific world types in Core.

---

## 8. Cross-cutting work outside the physical-world feature set

These are architectural/application tasks, not reasons to expand Engine Core:

1. **Finish application separation:** standalone Dev Lab and Cassandra need independent entry points and shells. The current Cassandra-hosted Dev Lab workflow is transitional.
2. **Separate persistence identities:** give Cassandra and Dev Lab their own adapters, file formats/envelopes and slot/state identifiers. No cross-save compatibility is intended.
3. **Keep shared utilities genuinely neutral:** shared viewport/presentation and application controllers may be consumed by both apps, but they are not automatically Engine Core.
4. **Resolve the browser menu issue independently:** a green unit-test suite does not prove browser acceptance. Do not attribute the nonresponsive menu to a specific cause without a browser reproduction.
5. **Keep tested environment behavior stable:** no environment simulation changes as collateral work for the grid/spatial foundation.

---

## 9. Suggested order of design and delivery

This is a dependency-based suggestion, not a commitment to implement every item.

### Stage A — Confirm contracts before coding
- Define world lifecycle and world-aware simulation expectations.
- Define grid/world coordinates, bounds and sparse/default-cell behavior.
- Define spatial composition, occupancy, extensible categories and multi-cell footprint contract.
- Decide which spatial queries are required for the first usable version.
- Decide whether movement/collision primitives belong in the first spatial milestone.
- Decide whether generic change transactions are genuinely reusable or remain a Cassandra application workflow.

### Stage B — Implement the smallest Engine spatial foundation
- Extend existing World Registry/World Context only where required; preserve their tested identity and placement contracts.
- Add grid/occupancy/footprint/query mechanisms in focused modules.
- Add persistence for the new authoritative state.
- Add invariant, integration, migration and performance tests justified by actual use cases.

### Stage C — Make Dev Lab exercise the Engine
- Add generic world/grid/entity/spatial inspection and editing tools.
- Add diagnostics and reproducible test scenarios.
- Confirm it works with test/empty content and without Cassandra imports.

### Stage D — Integrate Cassandra game systems
- Cassandra supplies terrain, environment, Unit, building, movement, combat and resource policies.
- Implement Main/Temporary World and expedition orchestration in Cassandra.
- Implement universe map, scanning, location records, mining and remote bases as game systems.
- Add the temporary-world commit flow only after its data and failure semantics are designed.

---

## 10. Acceptance principles

A future Engine physical-world milestone should not be called complete merely because a grid is visible. At minimum, acceptance should prove:

- More than one world can exist simultaneously without a hard-coded two-world ceiling.
- World existence, loading, simulation, pause, selection and rendering are independently represented.
- A host can decide which worlds advance; Engine does not impose Cassandra pause rules.
- Square-grid coordinates and bounds behave consistently.
- Multiple independent contents can occupy one coordinate.
- One entity can occupy multiple cells while retaining one identity.
- Spatial queries return authoritative data and do not depend on rendered pixels.
- Invalid/out-of-bounds placements and failed moves have defined behavior.
- Persistence restores the agreed authoritative world/spatial state without corrupting unrelated application data.
- Dev Lab can create, inspect and test the generic capabilities without loading Cassandra.
- Cassandra can consume the same Engine capabilities while keeping all game rules in its own layer.
- Existing tested Core and environment behavior remains intact unless an explicit change is approved.

---

## 11. Decisions still needed before implementation

The following are the genuine unresolved Engine design decisions visible in the current documentation:

1. Exact world lifecycle states and whether world simulation uses independent clocks, one shared clock with per-world scheduling, or another contract.
2. Whether grid is mandatory or optional per world; exact coordinate, bounds, resize and sparse-storage rules.
3. Cell/default model and the separation of cells, spatial contents, categories/layers, entities and environment data.
4. Footprint representation, rotation, overlap and placement validation.
5. Required first-version spatial query API and ordering guarantees.
6. Scope of movement/collision primitives and whether pathfinding is explicitly deferred.
7. Whether generic change-set/transaction mechanisms are reusable Engine capabilities or Cassandra-owned expedition workflow.
8. How new spatial state participates in snapshots, restore ordering and migrations.

Cassandra gameplay questions such as mine-shaft nesting, resource allocation, remote-base upkeep, exact landing flow and universe-map presentation remain in Cassandra design; they should not block the generic Engine contract unless a concrete Engine dependency is demonstrated.

---

## 12. Source documents and status

- `engine/core/README.md` — current Core contracts and runtime semantics.
- `docs/architecture/application-boundaries.md` — current application composition and transitional boundaries.
- `NEXT_STEPS.md` — target dependency direction and long-range roadmap.
- `CASSANDRA_VISION.md` — non-binding Cassandra design memory.
- `docs/architecture/phase-3-brainstorm.md` — detailed working record of Phase 3 decisions, proposals and open questions.

This review consolidates those sources; it does not replace their historical detail or approve every proposal in them. Where this document and implementation disagree, current source behavior must be checked before planning a change. Where brainstorm labels a feature Proposed/Open, this document preserves that status.
