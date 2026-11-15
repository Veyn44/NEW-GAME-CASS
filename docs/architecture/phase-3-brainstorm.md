# Phase 3 — Physical World & Grid (Brainstorm)

> **Purpose:** Working document for thinking through and specifying the next Engine capability before implementation.
>
> **Working mode:** Discussion and specification only. Do not implement code during this phase until the complete design is reviewed and explicitly approved.
>
> **Branch:** work
> **Status:** Brainstorm in progress
> **Current focus:** Step 2 — World Geometry and lifecycle semantics

---

## How we use this document

- We work through the sections step by step, in order unless a dependency requires otherwise.
- The **Current focus** marker identifies the one section we are actively discussing.
- When we reach a decision, record it in the appropriate section and mark it as **Agreed**.
- Keep unresolved questions visible as **Open questions**. Do not silently turn assumptions into decisions.
- Record alternatives and the reason for rejecting them when a meaningful architectural choice is made.
- Update earlier sections if a later discussion changes a previous decision.
- This document is the shared source of truth for Phase 3. At the end, it should be sufficiently complete to guide implementation in a fresh conversation without reconstructing the design from chat history.
- No code implementation begins until all required sections have been discussed, the specification has been reviewed as a whole, and the user explicitly approves moving to implementation.

### Decision labels

- **Agreed** — explicitly decided.
- **Proposed** — current candidate, not yet approved.
- **Open** — requires discussion or investigation.
- **Out of scope** — intentionally deferred to another phase.

---

## Phase overview

The goal of this phase is to define a reusable physical-world foundation for Engine, informed by the needs of Cassandra but without embedding Cassandra-specific rules into Engine Core.

The existing Engine already has world registration and entity placement concepts. This phase must first understand those contracts and decide how to extend them without duplicating responsibilities or breaking existing behavior.

The discussion has now established several important architectural directions:

- Engine must be capable of hosting at least one persistent world and one temporary world at the same time. This is a minimum capability, not necessarily a hard maximum imposed by Engine.
- A world can exist without currently being simulated, selected, or rendered. These are separate concerns.
- Cassandra may pause its persistent world while a temporary encounter is running, but pausing is Cassandra/game policy, not an intrinsic Engine rule.
- A coordinate is not limited to one entity. It can contain multiple independent spatial contents, conceptually organized into layers or categories.
- An empty cell is a neutral template. Vacuum and other environmental conditions are data placed on or associated with that base, not the definition of emptiness itself.
- The current geometry preference is a square grid. No alternative topology is being pursued without a concrete reason.

These decisions narrow the design, but do not yet define the exact public APIs, storage structures, lifecycle contracts, or transfer protocol.

### Step 1 — Goals and scope
**Status:** Agreed baseline; remaining boundaries documented

Define what the Physical World & Grid capability must enable, what it explicitly will not do, and which requirements come from Cassandra versus the reusable Engine.

#### Cassandra gameplay requirements

These describe Cassandra's game design. They must not automatically become restrictions inside the reusable Engine.

- Cassandra needs a **main world** containing the colony.
- Cassandra also needs a **secondary world** for expeditions, events, and encounters where the environment can be damaged and combat can take place.
- The expected Cassandra runtime arrangement is one main world plus at most one secondary world at a time. The secondary world will often be around 128×128 cells; 256×256 is also already relevant to the game.
- The main world is the buildable colony. The secondary world is an expedition/encounter space with different gameplay rules.
- Much of the game takes place in space. Space will frequently be represented as vacuum, but vacuum is an environmental/gameplay condition, not a special kind of grid or world geometry.
- When an expedition starts, the relevant entities and state from the main world are represented in a temporary-world context. The temporary encounter can change their state through combat, item acquisition/consumption, damage, death, and other events.
- When the encounter ends, the resulting changes are applied back to the persistent world. The persistent world is normally paused during this process, but this is a Cassandra policy.

#### Engine direction

- The Engine must support a persistent world and a temporary world existing at the same time. It should not encode Cassandra's exact main/expedition roles as mandatory world types.
- Engine should not hard-code a maximum of two worlds merely because Cassandra currently needs one main and one secondary world.
- A world existing, being loaded, being simulated, being paused, being selected/focused, and being rendered are distinct concepts. They must not be represented as one overloaded active/inactive flag.
- Engine should support pausing or not scheduling simulation for a world, but it must not automatically pause one world when another world starts. That policy belongs to the host/game.
- A square grid is the agreed geometry direction for this project.
- A coordinate can contain multiple entities and multiple kinds of spatial content. Single-entity-per-cell assumptions are explicitly disallowed.
- An empty cell is a neutral base/template with no game-specific definition by default. Environmental conditions such as vacuum are represented separately.
- Engine must not hard-code the Cassandra concepts “colony”, “expedition”, “encounter”, or “vacuum” as world types or core spatial rules.

#### Temporary-world transfer concept

The current agreed conceptual model is:

1. The persistent world contains the authoritative ongoing colony state.
2. Starting an expedition creates a temporary-world representation/package from the relevant source state. It is not necessary to duplicate the entire persistent world if only a subset is relevant.
3. The temporary world runs its own simulation and can change the participating entities and encounter-local world state.
4. Ending the encounter produces a set of changes (a delta/change package), rather than blindly replacing the entire persistent world.
5. The changes are validated and applied to the persistent world. The persistent world then resumes according to Cassandra's rules.

Conceptually:

`newState = previousState + changes`

Examples of changes include:
- An entity received damage or a condition.
- An entity died or was removed.
- An entity acquired, dropped, consumed, or lost an item.
- Ammunition or another resource was consumed.
- An entity's position or group membership changed.
- The expedition produced resources or other rewards.

This is a design direction, not yet a defined serialization format or API.

#### Cassandra expedition, encounter, and location persistence model

The following gameplay behavior has been established in the brainstorm. These are Cassandra rules and requirements for Engine capabilities; they must not become hard-coded Engine gameplay rules.

**World and encounter concurrency**
- Cassandra normally has one persistent Main World and at most one active Temporary World encounter at a time.
- Starting an encounter pauses Main World for player-attention/gameplay reasons. This is Cassandra policy, not an Engine restriction.
- The Engine should remain capable of hosting/simulating multiple worlds independently; it must not enforce this one-encounter rule globally.
- Worlds/locations that are not active do not continue simulating and do not advance their local simulation state in the background.

**Location identity and persistence**
- A visited location can outlive its Temporary World simulation instance.
- A persistent location record can retain its identity, generation seed, terrain/world-generation changes, and the persistent state of surviving objects.
- A Temporary World can be reconstructed from its seed and recorded changes instead of serializing every transient runtime entity.
- Locations may have different persistence outcomes: a reusable physical location (for example, an asteroid), a disposable one-off encounter, or a permanently closed/retired location (for example, a mine shaft).
- A location's persistence policy is a Cassandra/game concept. Engine should provide generic persistence and world lifecycle mechanisms.
- A physical location does not change while it is not active. No background simulation or elapsed-time catch-up is currently intended.

**Encounter clear and regenerated entities**
- Clear means the encounter/location is safe: it has been cleared of its hostile encounter threat and is ready for further scavenging, mining, or exploration. Clear does not mean the location is exhausted, completed, retired, or unavailable.
- Not Clear means the location may still be dangerous; enemies may be regenerated on a later visit according to its rules.
- For the current Cassandra design, Clear is a result for the entire encounter/location, not separate rooms or sectors.
- If the encounter is Clear, enemies do not respawn on a later visit.
- If it is Not Clear, enemies may be regenerated on a later visit according to the location's generation rules. Individual enemy instances are not persisted as long-lived entities.
- An encounter that is not Clear is not necessarily a failed expedition: the player may still earn XP, resources, or other partial rewards.
- Future gameplay design must decide spawn points, whether mining/actions are restricted until Clear, enemy archetypes, and exact Clear conditions. These are deliberately not specified here.
- Enemy archetypes/difficulty may determine whether surviving enemies destroy abandoned objects or leave them intact. Such consequences are evaluated when the player ends/abandons the encounter; no off-screen simulation runs afterward.

**End Expedition versus Abandon Expedition**
- Normal End Expedition is only available when every living pawn assigned to the expedition is inside the shuttle. The game must continuously/clearly determine whether this condition is met.
- End Mission/End Expedition is initiated from the shuttle's Control Panel. It represents an orderly return with the shuttle's current onboard contents.
- Abandon Expedition is a separate emergency/forced exit. It can leave pawns and equipment behind while the shuttle returns home. It is not the same as normal evacuation.
- If the entire crew dies, the game should automatically offer the abandon outcome; the abandon action can be the only available action in that situation, and the shuttle begins its return.
- At abandon/end processing, apply the encounter's final consequences (including any enemy destruction rules), update the persistent location record, transfer the appropriate surviving/onboard state, then dispose of the Temporary World.
- The shuttle is expected to be highly resilient and effectively a critical campaign asset; losing it should be exceptionally consequential, though it is not yet decided to be absolutely indestructible.
- The shuttle has a persistent identity across Main World and encounter contexts. During travel it can be represented as an information package on the Main World map; during an encounter it is represented as a physical/rendered object with interaction points.
- If a crew member is stabilized inside a future medical/stasis chamber aboard the shuttle, that pawn should count as safely onboard and survive an abandon. This is a future gameplay feature, not a current implementation requirement.

**Universe map and revisitable locations**
- The universe map is a hierarchical navigation interface, not a rendered simulation of the physical universe.
- Each level is presented as a grid of clickable cells/"tablets" over a level-specific background. Selecting a cell opens the next, more detailed sub-map with its own background. This repeats through the hierarchy (galaxy → sector → region → star system and further navigation as appropriate).
- These cells are informational/navigation states. Their existence does not mean the represented physical locations have been generated as detailed worlds or loaded into runtime.
- The contents of a specific star system are generated/revealed only when the player chooses to go on a mission and scans that system. The scan then determines/reveals what is present there.
- Some systems may be modified by their surroundings or neighboring systems. This is acknowledged as a possible future influence, but its rules are explicitly deferred and should not be designed in this discussion yet.
- When a system is scanned, its generated/revealed contents are recorded persistently. Revisiting or scanning the same system later should use that saved record rather than silently generating a different system.
- The saved system record should be a compact information package: detailed enough to retain the number and arrangement of planets, asteroid counts/locations associated with them, and other useful system information, but much smaller than a fully generated/loaded physical world. The example notation "4.2;12.11;1.1;" was illustrative shorthand for a compact record, not yet a defined serialization format.
- The compact scan record remains available until the player explicitly discards/retires it or marks the location/system Done. After discarding, the detailed record may be removed and replaced with a minimal Done/visited marker, so the map can still indicate that the player has been there without retaining the detailed contents.
- The exact distinction and player-facing meaning of "discard" versus "Done" remain open; the current concept allows the detailed information to be thrown away and the map state to retain only a Done/visited indication.
- The galaxy is conceived as a fixed hierarchy of nested map divisions:
  - Galaxy: 16×16 sectors (256 sectors).
  - Each sector: 16×16 regions (256 regions per sector).
  - Each region: 16×16 star systems (256 systems per region).
  - This gives 16,777,216 star systems across the galaxy.
- Each star system contains a random number of encounters/planetary locations; the illustrative range discussed is 1–8 planets per system.
- Each planet may have 0–4 asteroids. There must nevertheless be at least one asteroid in every star system, even if none of its planets has one. The exact interpretation and placement of this system-level minimum remains to be clarified.
- This hierarchy is a player-facing universe structure. It does not imply that every system, planet, asteroid, or encounter must exist as a fully loaded world at runtime.
- A discovered location remains eligible for another visit unless the player explicitly marks it as Done.
- A discovered location remains eligible for another visit unless the player explicitly marks it as Done.
- Marking a location Done is an optional player decision, not an automatic consequence of visiting or clearing it.
- Done means the player has voluntarily and permanently retired the location from further visits. Once Done, the player cannot return there. It is distinct from Clear: Clear means safe and available for continued work; Done means closed to future expeditions.
- A possible Cassandra gameplay rule is a cap on the number of detailed/open scanned locations the player may retain. If the cap is reached, the player would have to mark one or more existing locations Done before scanning another. This is currently a proposal to explore, not a finalized limit or rule.
- A Done location can no longer be selected for another expedition.
- When marked Done, its detailed encounter/location record may be discarded because the player has explicitly retired that location.
- The universe map may still retain the location's lightweight identity/marker so the universe continues to know that the location exists; this is distinct from retaining its detailed generated world state.
- An earlier rough estimate of approximately 1.6 million locations is superseded or at least inconsistent with the subsequently described universe hierarchy: the hierarchy alone contains 16,777,216 star systems, before counting planets and asteroids. The final total number of encounter locations depends on the per-system planet count and asteroid rules. This scale reinforces the requirement to avoid treating every location as a fully loaded or fully serialized world; most should remain lightweight map-level records until needed.
- Exact map representation, discovery rules, generation/storage strategy, and what minimum metadata survives Done are still open.

**Shuttle mission flow**
- The player selects a destination and crew at a base map/terminal, in a mission-briefing flow, then prepares supplies and launches.
- During travel, the shuttle is represented as an information package on the Main World map. An illustrative travel duration discussed was about four in-game hours; this is not a fixed Engine constant.
- On arrival, the game offers the player the option to start the encounter.
- In the encounter, the shuttle is physically represented and can provide cargo/supply storage, ammunition, oxygen replenishment for suits, and a Control Panel for ending the mission. Additional functions such as medical stabilization chambers are future possibilities.
- The exact landing flow is unresolved. Options include generator-driven automatic landing, or starting the encounter without a placed/rendered shuttle and letting the player select a landing location (similar to RimWorld). The correct choice may depend on the generated asteroid/location geometry.
- It is not yet decided whether landing/placement is always possible, how safe landing sites are found, or whether the shuttle can ever move independently once the encounter starts.

**Illustrative persistence behavior**
- If a crew returns normally, the location retains persistent terrain/resource changes and any objects that remain there; the shuttle and crew return to the Main World.
- If the crew abandons, the shuttle and any pawns/equipment left behind remain at their physical positions unless enemy end-of-encounter consequences destroy them. Surviving objects should be represented in the location's persistent record so they can be reconstructed on a later visit.
- Enemies themselves are transient and are not saved as individual persistent entities. Their later presence is regenerated from encounter rules unless the whole encounter has been marked Clear.

#### Important architecture observation to investigate

The current World Registry implementation exposes a single `activeWorldId`. The desired arrangement requires more precise semantics than one global active-world selection. We must decide whether the Engine should distinguish:
- registered/existing worlds;
- loaded worlds;
- worlds eligible for simulation;
- currently simulating versus paused worlds;
- selected/focused world for tools or player interaction;
- currently rendered world or viewport.

Do not change the existing World Registry contract until this is resolved.

#### Step 1 decisions

- **Agreed:** Cassandra has a persistent main colony world and a temporary expedition/encounter world.
- **Agreed:** Engine must be capable of hosting at least one persistent and one temporary world concurrently.
- **Agreed:** This is not a hard two-world maximum for Engine.
- **Agreed:** Pausing the persistent world during a Cassandra encounter is game policy, not an Engine requirement.
- **Agreed:** World existence, simulation, pause, selection/focus, and rendering must be treated as separate concerns.
- **Agreed:** The temporary-world transfer should conceptually return a change set/delta to the persistent world, not replace its entire state.
- **Agreed:** Square grid is the current geometry direction.
- **Agreed:** One coordinate may contain multiple entities and spatial contents.
- **Agreed:** Empty cell is a neutral template; vacuum is a separate environmental property/content.
- **Open:** Exact definitions of persistent versus temporary world, ownership, lifecycle, and persistence.
- **Open:** Whether the transfer package contains full entity snapshots, selected components, references, or a combination.
- **Open:** Delta validation, conflict handling, atomic application, rollback, and identity/reference rules.
- **Agreed Cassandra policy:** Main World pauses during an active encounter; inactive locations do not simulate or advance in the background.
- **Agreed Cassandra concept:** A location can persist independently of its Temporary World runtime instance, using a seed and recorded changes rather than keeping the whole world alive.
- **Agreed Cassandra concept:** Encounter Clear is whole-location/whole-encounter state; enemy instances are transient and regenerate on revisits only if the encounter was not Clear.
- **Agreed Cassandra concept:** End Expedition requires all living expedition pawns to be inside the shuttle; Abandon is a separate forced-return path that may leave pawns/equipment behind.
- **Agreed Cassandra concept:** Encounter consequences (including enemy destruction of abandoned objects) are evaluated during End/Abandon processing, not by background simulation.
- **Open:** Exact persistent object categories and serialization strategy for shuttle, pawns, corpses, equipment, and other surviving objects.
- **Open:** Exact shuttle durability and failure consequences.
- **Agreed Cassandra concept:** All discovered locations remain revisitable unless the player explicitly marks them Done.
- **Agreed Cassandra concept:** Done is an optional retirement action; a Done location cannot be selected for another expedition and its detailed location record may be discarded.
- **Recorded universe hierarchy:** 16×16 sectors, each with 16×16 regions, each with 16×16 star systems, for 16,777,216 systems. Each system has an illustrative 1–8 planets and at least one asteroid; each planet may have 0–4 asteroids. Location totals beyond the system count remain to be calculated/clarified.
- **Agreed Cassandra map concept:** The galaxy map is a hierarchy of clickable navigation cells over level-specific backgrounds; these are informational UI states, not pre-generated physical worlds.
- **Agreed Cassandra generation trigger:** A star system's detailed contents are generated/revealed when the player chooses a mission and scans that system, not when the galaxy map is first created or opened.
- **Agreed Cassandra scan persistence:** Once scanned, a system's generated contents are saved in a compact information record and remain stable/available on later visits until the player discards the detailed record or marks the system Done.
- **Agreed Cassandra map memory:** After the detailed record is discarded/retired, a lightweight Done/visited marker may remain so the player can still tell that the system was visited.
- **Deferred:** Possible influence of neighboring/nearby systems on a system's generated contents; no rules are specified yet.
- **Open:** Which minimal location identity/metadata remains on the universe map after a location is marked Done.
- **Open:** Exact visual and interaction behavior of each navigation-map level, including how the player drills down/up and what information each cell displays.
- **Open:** Exact compact data format and minimum fields for a scanned system record.
- **Open:** Whether discarding a scan record is a separate action from Done, and exactly what map information remains after each.
- **Open:** Whether to impose a cap on detailed/open scanned locations, what counts toward the cap, and how the player chooses locations to retire.
- **Open:** Whether the system-level minimum of one asteroid is a separate system encounter/location or must be associated with one of the planets.
- **Open:** Exact landing/placement flow and whether it is automatic or player-selected.

### Step 2 — World Geometry and lifecycle semantics
**Status:** In progress

#### Cassandra asteroid interior and resource distribution
- The asteroid's physical interior is a combination of solid rock and naturally occurring cavities. The player can discover existing cavities and excavate solid rock to expand usable interior spaces.
- A Mine Shaft is envisioned as a smaller, separately generated encounter/location inside the parent asteroid. It may serve as an early "Level 0" expedition before the player has built a ship, unless the game grants a ship at the start. This starting progression is a gameplay option, not yet finalized.
- A map/location has an overall resource-information budget or inventory (illustrative example: 500 titanium, 300 uranium, 6,000 aluminium, 430 copper). These totals describe the resources belonging to the parent location, not necessarily resources already instantiated as visible surface deposits.
- Resource quantities may be distributed between the main asteroid map and generated Mine Shaft interiors. A Mine Shaft is randomly generated but must contain resources belonging to its parent asteroid; it is not an unrelated random resource map.
- Exact rules for allocating the parent location's resource totals among surface deposits, mine shafts, and any undiscovered deposits remain open. It is also not yet specified whether the resource summary shows exact totals or estimates to the player.
- A Deep Scan is an information-only operation. It may reveal a deposit and its estimated/known contents (illustrative example: 20 titanium and 3 uranium), but scanning, viewing, ignoring, or discarding the scan information does not consume or remove any resources.
- When a player enters/opens a Mine Shaft encounter and extracts only part of a deposit, only the amount actually extracted is deducted from the parent asteroid's shared resource inventory when the encounter is closed/committed. For example, extracting 50 out of 100 titanium reduces the parent asteroid's remaining total by exactly 50; the other 50 remain available for a later visit.
- Leaving or closing an encounter must not cause unmined resources to disappear merely because the player did not finish the location. The design prioritizes preserving player resources and avoiding unexplained depletion over physically simulating every geological detail of deposit distribution.
- Detailed deposits need not all be instantiated as physical entities before the player visits them. A scan may reveal information first; the physical encounter/deposit representation can be generated when the encounter is opened, while remaining consistent with the parent resource inventory and prior extraction records.
- A Mine Shaft encounter is currently intended to be disposable: when the player leaves it, its detailed generated layout (corridors, rooms, and physical deposit placements) can be discarded. On a later visit, a fresh Mine Shaft layout may be generated rather than restoring the exact previous geometry.
- The parent asteroid's durable resource accounting must survive Mine Shaft disposal. Only resources actually extracted are deducted; unmined resources remain in the parent inventory. A regenerated shaft must draw from that remaining inventory rather than create unlimited new resources.
- This disposable-shaft approach allows a player to abandon an unfavorable layout and generate another on a later visit. This is an acknowledged gameplay reroll/cheat-like effect, not a finalized balance decision; expedition costs or other gameplay consequences may make repeated rerolls costly.
- An asteroid encounter is itself a Temporary World. The idea of opening a Mine Shaft within an asteroid therefore raises an unresolved nested/sub-encounter question: whether the shaft should be another temporary world, a local area/transition within the asteroid encounter, or be represented through a simplified mining mechanic.
- One proposed simplification is to represent some asteroid mining through an installed mining device that produces a fixed amount over time (illustrative example: +2 titanium per defined time interval), avoiding the need to create a nested detailed mine-shaft world for every mining operation.
- A further gameplay possibility is a persistent mining outpost/station on selected asteroids. Such a site could produce resources over time for later collection/transport. This is only a concept at this stage; persistence, time advancement, extraction limits, and whether unattended production is allowed remain open.
- The player may be able to establish a remote automated base/outpost on a suitable asteroid or other location. Establishment requires sending personnel (potentially pawns and/or robots) and spending resources to build an initial habitable/basic module.
- After establishment, the outpost may be managed through an abstract strategic interface rather than a rendered grid map: status, resource stocks, production, consumption, personnel/robot assignments, modules, development options, and problems. The intended feel is closer to city-development/strategy management (Civ-style choices and Stellaris-like statistics) than direct tile-by-tile construction.
- Remote outposts may have statuses/types such as Mining Base. The status can be shown in the universe map/location record and summarize what the site does.
- Personnel assigned to an abstract outpost may be represented as informational/strategic records rather than continuously simulated physical pawn entities. Their assignment and condition still matter to gameplay.
- An established outpost may continue producing and consuming resources while the player is elsewhere. This is an explicit candidate exception to the earlier rule that inactive physical locations do not run full background simulation: the outpost could advance through abstract/economy calculations without simulating its detailed physical world.
- This concept may support a progression from a basic habitable module with life-support/resource automation to a more developed remote colony or industrial site. Exact modules, requirements, risks, personnel needs, and development rules are not yet defined.
- Remote bases are not intended to autonomously choose their own development goals. The player remains in control and assigns the base's purpose/work focus (for example, mining titanium).
- A base's available work is constrained by its installed buildings/modules and their provided job slots/capacity, plus the personnel assigned to it. Personnel can include pawns in management/supervisory roles and robots or other workers in operational roles.
- Example Mining Base: the player assigns one pawn as manager and three robots as miners. The base then performs the assigned mining work and records produced resources for delivery to the main colony's stockpile.
- This is intentionally not a full city simulation. The abstraction should focus on manager/worker assignments, job capacity from buildings, assigned work, output, and operating costs rather than simulating every colonist's individual life.
- Bases have operating costs. One possible convenience rule is to deduct fixed upkeep directly from the main colony's resources/accounting so the player does not have to micromanage routine supply deliveries. This payment model is only a candidate and remains undecided.
- Resource transport/routes and the exact delivery mechanism between remote bases and the main colony are acknowledged as necessary gameplay topics but are deferred for now.
- Remote bases should expose workforce capacity and current staffing in a compact status view (illustrative example: 2/3 positions filled).
- If an event reduces staffing or otherwise affects a remote base, the game should notify the player. The player can inspect a station list/status overview, identify the base with a staffing shortfall, prepare a replacement worker/robot at the main colony, and send it there.
- The exact transfer/logistics mechanism for sending replacement personnel is explicitly deferred; the requirement for now is event notification plus visible base status and staffing needs.

#### Cassandra world-boundary direction
- The home/colony map is expected to be finite, with a maximum distance/extent from the map edge, similar in broad player-facing behavior to RimWorld. It is not intended to be an unbounded or infinitely expanding world.
- Cassandra's home gameplay includes building inside an asteroid, not only on an exposed surface. Therefore, the map boundary and the asteroid's physical shape/interior are separate concepts: a finite map does not imply that all cells inside its bounds are buildable or that the asteroid fills the whole map.
- Exact dimensions, edge behavior, and how asteroid interior/rock geometry relates to the map grid remain open.

**Status:** In progress

Define world dimensions, coordinate representation, boundaries, coordinate systems, and how worlds exist and participate in runtime.

Questions to resolve:
- Are coordinates discrete integer grid coordinates, continuous coordinates, or both?
- Are dimensions finite, unbounded, or configurable per world?
- How are boundaries represented and queried?
- Are world dimensions fixed at creation or can a world resize?
- How are out-of-bounds positions handled?
- Do we need multiple planes, levels, or dimensions within one world, or are these separate world instances?
- What exactly distinguishes persistent and temporary worlds at the Engine level, if anything? Are these host-supplied metadata/lifecycle policies?
- Which lifecycle states are needed: registered, loaded, ready, simulating, paused, unloaded, disposed?
- Can a world be loaded but not simulated? Can it be simulated without being selected or rendered?
- Can multiple worlds be simulated at once, with independent scheduling?
- How should world time behave when a world is paused or not scheduled?
- Which geometry and lifecycle concepts belong in generic Engine versus a host application?

### Step 3 — Grid
**Status:** Partially agreed; details open

Define what a grid is, what a cell is, how cells are addressed, and how neighborhood relationships work.

#### Agreed direction

- Use a square grid for the current project.
- Do not introduce hexagonal, triangular, or other grid topologies without a concrete requirement that justifies the additional complexity.
- A cell is not synonymous with one object, one terrain type, or one environmental state.
- Empty cell should be a neutral/default template rather than a pre-defined “vacuum” or “space” tile.

#### Questions to resolve

- Is the grid mandatory for every world or an optional spatial representation?
- Are cells stored explicitly or derived from coordinates?
- What is the exact cell data contract?
- Is the empty-cell template a shared immutable definition, a default returned by queries, or an actual stored cell instance?
- How are neighbors and distances defined (4-way, 8-way, or configurable)?
- Can different worlds use different grid dimensions/resolutions while sharing square topology?
- How are large or sparse worlds represented efficiently?
- Is the grid itself authoritative state, or is it a spatial index over entities and cell contents?

### Step 4 — Spatial Occupancy and composition
**Status:** Concept agreed; detailed model open

Define how physical entities occupy space, including multiple objects at one coordinate and independent spatial layers.

#### Multi-cell entities (current design direction)
- A single entity may occupy one or multiple grid cells while remaining one entity with one identity and lifecycle.
- Examples include a 2×1 sarcophagus, a larger machine, a vehicle, or a large creature. These are examples of possible use cases, not a commitment that every category will appear in Cassandra.
- Building should retain the freedom of placing individual building elements on a tile-by-tile basis where appropriate. Multi-cell footprints are a capability for objects that need them, not a requirement that all buildings become large indivisible structures.
- The Engine should not equate the number of occupied cells with the number of entities. A multi-cell entity remains one entity and must be queryable/managed as such.
- Exact footprint shape, rotation/orientation, placement validation, and how a multi-cell entity interacts with per-cell contents remain open.

#### Agreed direction: multiple contents per coordinate

A single coordinate may contain many independent spatial contents. The intended mental model is a stack/composition of layers, not one tile object that must represent everything at that position.

Illustrative example of one coordinate:
- Environment: vacuum
- Base/surface: floor
- Surface overlay: carpet
- Furniture: table
- Small object: candleholder
- Projectile: bullet or rocket
- Debris: body fragment after destruction

The example is illustrative, not a fixed schema.

#### Important design constraint

Do not implement a fixed number of six layers merely because the example has six entries. The model should allow the relevant categories/layers to be extended without changing the fundamental cell structure. A layer/category may itself contain multiple entities. The exact distinction between layer, category, component, and entity remains to be designed.

#### Empty cell versus environmental state

- An empty cell is the neutral base/template and has no Cassandra-specific meaning by default.
- Vacuum is not the empty-cell definition. It is an environmental state/content that can be present over an otherwise empty location.
- An asteroid or other physical material can be represented as spatial content with its own properties, including passability and other physical/environmental interactions.
- Floor, carpet, furniture, items, units, projectiles, and debris should not be forced into one mutually exclusive tile type.

#### Questions to resolve

- Which spatial contents are cells/tiles and which are normal registered entities?
- What is the exact meaning of a layer? Is layer ordering meaningful, and if so, how?
- Can multiple entities exist within the same layer/category at one coordinate?
- Can an entity occupy more than one cell?
- How are size, footprint, orientation, and multi-cell placement represented?
- How do entities overlap, attach to, cover, or contain other entities?
- Is there a dedicated spatial composition/occupancy service or does World Context own this?
- How does occupancy relate to Entity Registry identity and World Context placement?
- Are environment properties stored per cell, as entities/components, as a field/region, or by a combination?
- How are empty/default cells represented without allocating a large number of meaningless objects?

### Step 5 — Spatial Queries
**Status:** Open

Define the read/query API for spatial data.

Questions to resolve:
- Query all entities and contents at a position.
- Query entities by layer/category/type.
- Query neighboring cells or a radius/area.
- Find empty or eligible positions.
- Query intersecting footprints.
- Query by environmental properties (for example, vacuum), without making those properties special Engine concepts.
- Query behavior for inactive, unloaded, or out-of-bounds regions.
- Query ordering and whether layer order is guaranteed.
- Performance expectations and indexing requirements.

### Step 6 — Movement and Collision
**Status:** Open

Decide how much movement and collision belong in this phase versus a later phase.

Questions to resolve:
- Does this phase only provide spatial placement and queries?
- Is movement a separate system built on top of occupancy?
- What does collision mean for different layers and entity types?
- Are blocking/passability rules generic capabilities or host-defined policies?
- How do projectiles, debris, units, and structures participate in collision differently?
- How are atomic moves and failed moves handled?
- Can an entity move between worlds, and is that separate from temporary-world transfer?
- Is pathfinding explicitly deferred?

### Step 7 — Entity, world, transfer, and application boundaries
**Status:** Open — working proposal drafted for the Cassandra Temporary World result/change-package protocol; review and remaining decisions pending

Define ownership and contracts between Engine Core, reusable spatial capabilities, Cassandra gameplay systems, and presentation.

**Working proposal:** `cassandra-temporary-world-change-package-contract-proposal.md`

The proposal does not close Step 7. The questions below remain open until the protocol and its remaining implementation choices are reviewed.

Questions to resolve:
- What remains the responsibility of Entity Registry?
- What remains the responsibility of World Registry and World Context?
- Which new service/API is needed, if any, for spatial composition?
- Which world lifecycle controls belong to Engine and which are host policy?
- How can a host create, select, pause, resume, unload, and dispose worlds?
- What is the formal contract for exporting a temporary-world result as a change package?
- How are entity identities and references preserved across world representations?
- How are changes validated before applying them to the persistent world?
- Must applying a change package be atomic? What happens if one operation fails?
- How are conflicting or stale changes detected?
- Which rules must be supplied by the host application?
- How can presentation/rendering consume spatial data without owning it?
- How do we avoid Engine importing Cassandra concepts?

### Step 8 — Persistence and compatibility
**Status:** Open; Cassandra location-persistence requirements recorded

Cassandra-specific requirements to account for during this design:
- Distinguish a Temporary World runtime instance from the persistent record of the location it represents.
- Support reconstructing a location from a generation seed plus durable terrain/resource changes and surviving persistent object state.
- Do not persist transient enemy instances. Persist the encounter-level Clear result and regenerate enemies on revisits only when the encounter is not Clear.
- No off-screen/background simulation is currently intended; inactive locations remain unchanged.
- End/Abandon processing must apply final encounter consequences before the Temporary World is disposed.
- Preserve surviving shuttle, pawn, body, equipment, and other object state as appropriate to the chosen outcome and encounter rules.
- A one-off encounter may be discarded entirely, while a reusable location or permanently retired location may retain a different kind of record.


Define persistence of geometry, grid configuration, occupancy, world lifecycle metadata, and spatial state.

Questions to resolve:
- Which component owns the spatial snapshot?
- Are temporary worlds persisted, or can they be discarded/recreated?
- If temporary worlds can be saved, how is their relationship to the persistent source state represented?
- Is a transfer/change package durable until successfully applied?
- How are snapshots and change packages versioned?
- How are restore dependencies ordered and validated?
- How are invalid or conflicting placements handled during restore?
- What migrations are required?
- How do we preserve existing .cass save compatibility?
- What happens to existing worlds and placements when the new capability is introduced?

### Step 9 — Testing and acceptance criteria
**Status:** Open

Define observable conditions that prove the design and implementation are correct.

Include:
- Unit-level invariants and failure cases.
- Integration with Entity Registry, World Registry, World Context, and persistence.
- At least one persistent and one temporary world existing simultaneously.
- Independent world lifecycle: existence, loading, simulation, pause, selection, and rendering.
- Multiple entities at one coordinate and multiple contents/categories at one coordinate.
- Empty-cell defaults and environmental properties such as vacuum being independent.
- Multi-cell footprints if included in the agreed scope.
- Temporary-world changes being returned and applied without overwriting unrelated persistent-world state.
- Atomicity, validation, conflict, and rollback tests for transfer if that protocol is included.
- Boundary and invalid-coordinate behavior.
- Deterministic behavior where required.
- Compatibility tests for existing saves and existing Cassandra workflows.
- Explicitly stated performance expectations only where justified.

### Step 10 — Implementation plan
**Status:** Open

Only after the preceding design is settled, specify:
- Exact modules/files to add or change.
- Public APIs and ownership of each responsibility.
- Data contracts for worlds, cells, spatial contents, layers/categories, and change packages.
- Dependency and initialization order.
- Persistence participants and migrations.
- Test files and test cases.
- Implementation sequence and review checkpoints.
- Explicit list of untouched systems and files.

No implementation starts from this section until the complete specification is approved.

---

## Cross-cutting constraints and guardrails

- Engine remains application- and domain-neutral. Cassandra-specific gameplay rules stay in Cassandra.
- Do not assume a single entity per coordinate.
- Do not assume a tile-only world model.
- Square grid is the agreed current direction; do not add alternative topologies without a concrete requirement.
- Do not conflate an empty cell with vacuum or any other environment.
- Do not impose a fixed number of spatial layers based on examples.
- Do not conflate world existence, loading, simulation, pause, selection/focus, and rendering.
- Do not make pausing the persistent world an automatic Engine side effect of creating or simulating another world.
- Do not make the Engine's world count hard-coded to Cassandra's current one-main-plus-one-temporary arrangement.
- Do not mix rendering/art assets with authoritative spatial state. Presentation may consume spatial data, but visual representation must not become the source of truth for occupancy or world geometry.
- Do not modify tested environment/simulation behavior unless a concrete dependency is demonstrated and separately agreed.
- Preserve .cass save compatibility.
- Prefer the smallest set of clear, stable contracts over speculative abstractions.
- Avoid broad refactors unrelated to the agreed Phase 3 scope.

---

## Current decisions

- **Agreed spatial capability direction:** One entity may occupy multiple grid cells while remaining a single entity (for example, a 2×1 object or a larger vehicle/creature).
- **Agreed Cassandra building direction:** Preserve tile-by-tile building freedom where appropriate; multi-cell footprints are supported for objects that need them, not imposed on every building.
- **Open:** Exact footprint representation, rotation, placement rules, and interactions with other spatial contents.

- **Agreed remote-base information requirement:** The player can inspect station/base status, including workforce capacity and staffing (for example, 2/3 positions filled).
- **Agreed remote-base event requirement:** Events affecting a base, such as loss of workers, notify the player; the player can identify the affected base and arrange replacement personnel from the main colony.
- **Deferred:** How personnel/robots are physically or logistically transferred to remote bases.

- **Proposed remote-base control model:** The player assigns the base's purpose/work focus; the base does not independently choose development goals.
- **Proposed workforce model:** Buildings provide job slots/capacity, and the player assigns pawns (for example, a manager) and robots/workers to those roles. The simulation focuses on staffing, assigned work, output, and costs rather than full city/population life simulation.
- **Proposed Mining Base behavior:** Assigned miners automatically perform the selected mining work and accumulate output for eventual delivery to the main colony's stockpile.
- **Open operating-cost model:** Bases incur upkeep; deducting fixed costs directly from the main colony is a possible way to reduce supply micromanagement, but is not decided.
- **Deferred:** Exact resource transport, routes, and delivery mechanics between bases and the main colony.

- **Proposed Cassandra remote-base model:** The player may establish an automated remote base by sending personnel/robots and spending resources to construct an initial habitable/basic module.
- **Proposed abstract management mode:** Once established, a remote base may be managed without a rendered grid world, using strategic information such as stocks, production, consumption, modules, personnel, robots, and status (for example, Mining Base).
- **Proposed personnel representation:** Pawns assigned to an abstract remote base may be represented as informational/strategic records rather than continuously simulated physical entities.
- **Proposed simulation exception:** Remote bases may advance abstract production/consumption while the player is elsewhere, without running full physical-world simulation. This is a candidate exception to the no-background-simulation rule for inactive locations and needs explicit design.

- **Proposed Cassandra Mine Shaft lifecycle:** Mine Shaft detailed geometry/layout may be discarded when the player leaves and regenerated on the next visit. Parent asteroid resource totals and actual extracted amounts remain persistent.
- **Acknowledged gameplay trade-off:** Regenerating a Mine Shaft can let players reroll unfavorable layouts; whether and how expedition costs balance this remains open.
- **Open Cassandra architecture question:** Since an asteroid is already a Temporary World encounter, it is undecided how a Mine Shaft inside it should be represented (nested Temporary World, local sub-area/transition, or simplified mining mechanic).
- **Proposed gameplay alternatives:** Some asteroids may use time-based mining devices (illustrative +2 titanium per interval), and selected asteroids may become persistent mining outposts from which resources are collected later. Neither is finalized.

- **Agreed Cassandra resource rule:** Deep Scan only reveals information about deposits; it does not consume, reserve, or remove resources. Discarding scan information also does not affect the deposits.
- **Agreed Cassandra resource rule:** On encounter close/commit, deduct only the resources actually extracted. Unmined resources remain available for later visits; leaving an encounter must not silently remove them.
- **Agreed Cassandra generation concept:** Physical deposit details may be instantiated when an encounter is opened, while remaining consistent with the parent asteroid's shared resource inventory and previously extracted amounts.

- **Agreed Cassandra asteroid concept:** Asteroid interiors combine solid rock and natural cavities; players can discover cavities and excavate rock to expand them.
- **Proposed Cassandra progression:** A Mine Shaft may be an early, smaller encounter (potentially Level 0) before ship construction, unless the player is given a ship at game start. Starting progression remains open.
- **Agreed Cassandra resource model concept:** A parent map/location has an overall resource budget/summary, while only some deposits need to be instantiated on the main map; some resources may be held in Mine Shaft encounters.
- **Agreed Cassandra Mine Shaft relationship:** Mine Shafts are randomly generated sub-locations/encounters whose resources must come from the parent asteroid's resource inventory, not arbitrary unrelated resources.

- **Proposed Cassandra world geometry:** The home/colony map is finite, with a maximum extent/edge similar in broad behavior to RimWorld; the colony can be built inside an asteroid, so asteroid geometry/interior is distinct from the overall map boundary. Exact dimensions and edge behavior remain open.

- **Agreed Cassandra meaning:** Clear means safe/cleared and ready for further scavenging, mining, or exploration; it does not retire or exhaust the location.
- **Agreed Cassandra meaning:** Done is a voluntary player decision that permanently prevents returning to that location. Clear and Done are separate states with different meanings.
- **Proposed gameplay rule:** Limit the number of detailed/open scanned locations; when at the cap, the player may need to mark an existing location Done before scanning another. Exact cap and behavior remain undecided.

- **Cassandra world roles — Agreed:** Cassandra has a persistent main colony world and a temporary expedition/encounter world.
- **Concurrent worlds — Agreed:** Engine must support at least one persistent and one temporary world at the same time. This is not a hard maximum of two worlds.
- **World pause — Agreed:** Pausing the persistent world during a temporary encounter is Cassandra/game policy, not an Engine rule.
- **World lifecycle — Agreed principle:** Existence, loading, simulation, pause, selection/focus, and rendering are separate concerns.
- **Temporary-world result — Agreed concept:** The temporary world returns a delta/change package; the persistent world is updated using previous state plus changes rather than being wholly overwritten.
- **Expedition return entitlement — Agreed (2026-11-15):** The player must receive every item, resource, pawn and reward owed by the finalized encounter outcome. Identity remapping, persistence, retries, crashes or Temporary World disposal must never silently lose it. Every relevant result needs an explicit disposition and auditable reconciliation; unresolved mappings block commit rather than dropping the result.
- **Cassandra world scale — Recorded requirement:** 128×128 is a common secondary-world size; 256×256 must remain supported by the game.
- **Grid topology — Agreed direction:** Square grid.
- **Spatial occupancy — Agreed:** One coordinate can contain multiple independent entities and spatial contents.
- **Spatial composition — Agreed concept:** Contents can be organized into extensible layers/categories; no fixed six-layer limit.
- **Empty cell — Agreed:** Neutral base/template without an intrinsic game-specific definition.
- **Vacuum — Agreed:** Environmental state/content separate from the empty-cell template.
- **Engine boundary — Agreed principle:** Engine spatial capabilities must be more universal than Cassandra's world roles and gameplay vocabulary.

## Open questions / investigation notes

- Audit the current uses of World Registry, World Context, Entity Registry, and any existing Cassandra/shared spatial or viewport code before proposing new contracts.
- Resolve the semantics of registered, loaded, simulated, paused, selected/focused, rendered, unloaded, and disposed worlds.
- Decide whether coordinates are discrete integer grid positions, continuous positions, or both, and define world bounds/dimensions.
- Define the exact cell/template model and how sparse or empty regions are represented.
- Define the distinction between layers, categories, entities, components, and environment data.
- Define multi-cell footprints, orientation, overlap, and passability ownership.
- Specify the temporary-world representation and the change-package/commit protocol, including validation, identity mapping, atomicity, and conflict handling.
- Distinguish authoritative world/spatial state from viewport geometry, visual presentation, and input coordinates.
- Preserve current tested simulation behavior and existing .cass compatibility unless a separate, explicit decision authorizes a change.

---

**Working principle:** Define reusable Engine mechanisms from Cassandra's real requirements, but keep Cassandra's game rules and content outside the Engine. Complete and review the design before implementation.
