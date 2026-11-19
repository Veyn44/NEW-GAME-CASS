# Cassandra — Game Concept and World Direction

> Status: Current creative baseline, 2026-11-19. This is a game-design document, not an Engine specification or implementation roadmap. It supersedes earlier game-vision notes and old gameplay proposals in archived Phase 3 brainstorming. Historical technical and Engine decisions remain useful and are not invalidated.

## 1. Game identity

Cassandra combines colony simulation, top-down real-time action, RPG progression, exploration, survival, base construction, repair and infrastructure restoration.

The player directly controls one primary Pawn. Other inhabitants are autonomous: they work, build, manufacture, gather and react to the world. The player can issue commands such as Follow, Hold, Hide and Explore. Combat should be readable and responsive, with meaningful direct control rather than highly random hit outcomes.

Cassandra is not intended to be a RimWorld clone. Its identity comes from combining autonomous colony life with a directly controlled protagonist and dangerous expeditions.

## 2. Current premise

A human colony has existed on a harsh planet for a long time. It built extensive underground infrastructure to make the planet habitable and productive.

At some point, the colony sent an emergency distress signal. Humanity dispatched a large rescue cruiser. During the mission, the cruiser suffered a catastrophe and crashed on the planet.

The player survives and reaches a nearby human bunker or small underground complex. The planet is already infested by an unknown biological organism.

The initial story does not require a galaxy-wide war, a defeated humanity, a known alien empire or a complete explanation of the infestation. The immediate story is local: a rescue mission has failed on an inhabited human world, and the survivors must establish themselves, find other people and understand what happened.

The planet need not be the organism's homeworld. It may simply be another world the organism has infested.

## 3. The planet

The planet is a long-established human colony world. Its surface is barren and hostile, while the underground offers more stable conditions.

Current working ideas:
- A cold, dry, rocky or otherwise inhospitable surface.
- Little or no naturally breathable surface atmosphere, or an atmosphere that requires filtration.
- More stable temperatures underground.
- Significant underground water reserves, potentially including aquifers or reservoirs.
- Extensive human-built underground habitats and industrial infrastructure.
- A possible very old, weak or extinguished star; this is an idea, not a settled astronomical fact.

Exact geology, gravity, atmosphere, temperature profile and astronomical history remain open.

### 3.1 Human infrastructure

Humans have built a large network of underground facilities over a long period. Possible facility types include residential complexes, industrial plants, workshops, mines, power facilities, research and medical facilities, hydroponic farms, water reservoirs and treatment plants, warehouses, logistics hubs, transport stations, tunnels and emergency shelters.

Some locations may be intact, abandoned, damaged, sealed, partially operational, unfinished or infested. Existing infrastructure is not merely scenery or loot: it is a major source of materials, equipment, technology and opportunities for restoration.

All established architecture is human. We do not currently need to invent an ancient alien civilization, its anatomy, tools or visual language.

### 3.2 Atmosphere and environmental protection

A working option is that underground habitation areas maintain a breathable atmosphere, while the surface requires protective equipment. A compact filtration mask may be sufficient in some environments; a full independent oxygen supply is not currently a desired default assumption.

Some damaged or contaminated underground sectors may also require filtration or other protection. This is unresolved. Environmental equipment should create meaningful preparation choices without becoming constant busywork.

### 3.3 Water and food

Underground water may be naturally available and accessed through human infrastructure. Water treatment, pumping and recycling can become repairable systems.

Food can be supported by hydroponic farms, controlled agriculture, storage and recycling systems. Restoring these systems gives the player a reason to reclaim facilities rather than manufacture every necessity from raw materials. The precise food and resource economy remains open.

## 4. The biological threat

The enemy is an animalistic biological organism, not a technologically advanced civilization.

Current high-level characteristics:
- Extremely resilient.
- Uses living hosts as incubators in at least one stage of its life cycle.
- Can infest a world without that world being its place of origin.
- Has hive-like or hivemind characteristics.
- Can remain dormant for long periods.
- Is the dominant hostile threat on the planet.

The organism's exact biology, life cycle, reproduction, communication, ecology and method of interplanetary spread are not yet defined. Infection through living hosts is the preferred direction; the details must be original and coherent rather than copying a familiar science-fiction creature lifecycle.

### 4.1 Dormant organisms and light

A key gameplay hypothesis is that organisms can attach themselves to walls, ceilings or other surfaces and remain dormant in darkness.

Exposure to a particular kind of light may stimulate and gradually wake them. A possible mechanic is a biological activity / wake-up meter:
1. The player discovers an apparently inactive organism.
2. A flashlight beam stimulates it.
3. Longer exposure increases its activity.
4. At a threshold, it wakes and becomes dangerous.

Light would be both a visibility tool and an interaction with the ecosystem. The player may need to inspect a dark space without keeping the beam on a dormant organism.

This is provisional, not a universal rule for every organism. The relevant light spectrum, other stimuli (sound, vibration, heat, movement), wake-up times and behavior after awakening all require design.

Day/night should not automatically determine whether every organism is active. Darkness inside buildings and underground spaces remains relevant independently of time of day.

## 5. Opening mission — rescue cruiser disaster

The opening teaches the player through an actual crisis rather than a long exposition sequence.

### 5.1 Aboard the cruiser

The player begins controlling one ordinary human Pawn aboard the rescue cruiser while an infestation is underway.

The player initially has little or no useful equipment. The ship contains emergency lighting, damaged systems, blocked routes, alarms, frightened crew and signs of biological activity. The opening introduces movement, interaction and navigation.

### 5.2 First survivors and group commands

The player encounters a small group of survivors and has an opportunity to rescue some of them.

This introduces the relationship between direct player control and autonomous Pawns. The player learns to draft one Pawn and issue basic orders to the others, such as Follow, Hold, Hide and Explore. The exact command set and AI behavior are not yet specified.

### 5.3 First encounter

The player sees or encounters an organism before having the equipment to fight it effectively. Escape, concealment and use of the environment can be more important than fighting. The first encounter should communicate danger and uncertainty rather than become an easy combat tutorial.

### 5.4 Escape and crash

The survivors reach an escape pod and launch away from the cruiser. The pod contains basic supplies and equipment, and a service robot is present.

The cruiser subsequently crashes on the planet. During descent or from the escape pod, the player sees the large vessel break apart and its wreckage spread across the surface. This establishes a large field of potential expedition locations and gives the player a personal reason to explore the wreckage.

The exact number of survivors, equipment, pod condition and sequence of events remain open.

## 6. The service robot

A service robot accompanies the player from the escape pod. It is a diegetic guide and technical helper, not an omniscient narrator.

Potential roles:
- Tutorial and contextual guidance.
- Diagnostics and system status.
- Access to surviving ship databases.
- Identification of known materials and equipment.
- Basic repairs and technical assistance.
- Explanations of systems the player encounters.

The robot knows only what its sensors, surviving databases and capabilities allow. It does not automatically know the planet's history or the organism's biology.

A possible enemy interaction is that organisms ignore an inert, non-biological machine. The robot may be difficult for them to detect while stationary, but movement, noise or vibration could reveal it. This is a gameplay hypothesis, not yet a fixed biological rule.

## 7. First base

After landing, the player reaches a nearby bunker or small underground human complex. This becomes the first base. It should not be an empty cave where every system must be built from scratch.

The complex may be self-sufficient or close to it, and may have been in the final stage of construction or expansion when the disaster occurred.

It should already contain much of the basic infrastructure:
- A habitable shelter.
- Basic power and utility systems.
- Some storage and service facilities.
- Space for survivors.
- A foundation for repair, production and expansion.
- Potentially a prepared high-tech surface transport vehicle.

The base is functional but incomplete, damaged or under-equipped. The player restores and expands it while also using the remains of the old colony.

The long-term base model is likely a combination of one main colony and smaller outposts or satellite facilities.

## 8. Planetary map and points of interest

The planet has a strategic map with points of interest (POIs). This adapts the earlier ambition for a very large navigable galaxy into a single planetary setting.

A very large number of locations — potentially up to one million — is an ambition to explore, not a committed content count or technical requirement. It does not imply one million hand-authored maps. The eventual system may combine coordinates, procedural placement, templates, generated content and selected handcrafted locations.

Possible POI categories:
- Cruiser wreckage and scattered ship sections.
- Bunkers and emergency shelters.
- Residential complexes.
- Industrial and mining facilities.
- Research centers.
- Power and utility facilities.
- Hydroponic and water infrastructure.
- Transport hubs and underground entrances.
- Other human facilities and unexplored sectors.

A high-tech vehicle (for example, a hover vehicle or small aircraft) may allow the player to travel between distant surface locations. Its exact form, range, energy needs and constraints are undecided.

## 9. Two expedition families

The concept currently has two broad types of expedition. They should have different preparation, environmental constraints and gameplay rhythms.

### 9.1 Exterior expeditions

Examples include the surface, cruiser wreckage and exposed infrastructure.

Characteristics may include hostile surface conditions, protective equipment and filtration, long-distance travel, exposed wreckage and scattered resources, equipment preparation and environmental hazards, and possible encounters with dormant or active organisms.

### 9.2 Interior expeditions

Examples include underground residential, industrial, mining and research complexes.

Characteristics may include human-built rooms, corridors and machinery; potentially breathable or controlled atmosphere; power failures, damaged systems and sealed sectors; valuable machinery, materials, records and supplies; dormant organisms hidden in darkness; and opportunities to restore a facility and make it useful to the colony.

The interior is not automatically safe. Its primary danger is the infestation and the condition of the facility, rather than the planet's surface environment.

These expedition families may share the same underlying encounter/world technology while using different environment and preparation rules.

## 10. Resources, repair and restoration

The player should not depend solely on scavenging the rescue cruiser. The old human complexes are a primary source of useful resources.

Potential activities:
- Salvaging and dismantling equipment.
- Recovering stored materials and supplies.
- Mining and processing.
- Repairing old machines.
- Restarting production lines.
- Restoring power and utility networks.
- Reclaiming water and food-production systems.
- Recovering tools, weapons, technology and information.

The design should reward understanding and restoring existing technology, not only collecting generic raw materials. A functioning facility can be more valuable than the sum of its dismantled components.

## 11. Colony progression

The player starts with a small, mostly prepared shelter and gradually establishes a larger colony.

Likely structure:
- One main base with housing, storage, production, research, utilities and colony management.
- Smaller outposts that support mining, exploration, logistics or strategic locations.
- Reclaimed original facilities that can become useful parts of the colony network.
- Travel and supply connections between the main base, outposts and POIs.

The player can build new structures while also repairing and reusing the planet's existing infrastructure.

## 12. RPG progression and cybernetic upgrades

The player begins as an ordinary biological human. Mechanical body parts are not a starting condition.

Cybernetic or mechanical upgrades remain a possible later RPG progression path. Potential examples include mechanical limbs, replacement organs, sensory systems or other specialized enhancements.

One narrative possibility is that certain biological structures are relevant to the organism's host-infection process, making some mechanical replacements protective. This is only a candidate idea. It is not established that cybernetics provide immunity or that the protagonist must replace their body.

Upgrades should have meaningful costs, maintenance or trade-offs rather than being automatic improvements.

## 13. Core gameplay loop

1. Maintain and expand the main base.
2. Select a POI and prepare an expedition.
3. Choose Pawns, equipment, supplies and transport.
4. Travel to the location.
5. Explore, fight, evade, repair or investigate.
6. Recover materials, equipment, information or survivors.
7. Return and process the expedition's results.
8. Repair, research, manufacture and expand.
9. Unlock or make new locations accessible.
10. Repeat with greater reach and capability.

The player gradually rescues additional colonists, restores infrastructure, improves equipment and explores more dangerous or deeper areas.

## 14. Design principles

- Keep the world human-built and visually legible; do not invent an alien civilization without a strong reason.
- Treat the organism as an original biological system, not a renamed copy of an existing franchise creature.
- Make environmental and biological rules produce meaningful gameplay.
- Let light, darkness and visibility be systemic mechanics where appropriate, not merely visual effects.
- Preserve the distinction between direct control of the protagonist and autonomous colony behavior.
- Reward exploration, repair, salvage and restoration as well as combat.
- Keep the player vulnerable; progression should create options, not erase danger.
- Distinguish established decisions from hypotheses and open questions.
- Do not turn this concept document into an Engine specification. Engine capabilities must be verified against code and designed as reusable mechanisms where appropriate.

## 15. Open design questions

1. Exact planet geology, star, gravity, surface temperature and atmosphere.
2. Whether the surface requires a filtration mask, a more substantial suit or no special equipment in some regions.
3. Exact source and distribution of underground water.
4. Food production and colony resource economy.
5. The organism's detailed life cycle, host requirements and interplanetary spread.
6. Which stimuli awaken organisms and how the wake-up meter behaves.
7. Whether organisms share a literal hivemind, a distributed signaling network or another form of coordination.
8. Why the original colony sent its distress signal and what happened there.
9. The protagonist's original role aboard the cruiser.
10. The exact number and identity of survivors rescued during the opening.
11. The first base's exact layout, state and capabilities.
12. The type and constraints of the surface transport vehicle.
13. Planet map scale, POI density and procedural generation strategy.
14. How locations persist and how interior/exterior encounters are represented.
15. The long-term objective and eventual resolution of the story.
16. The role, availability and trade-offs of cybernetic upgrades.

---

**Current creative baseline:** A rescue cruiser crashes on a harsh, long-colonized human planet after responding to a distress signal. The player survives, reaches a mostly prepared underground human shelter, and begins rebuilding a colony by rescuing people, restoring infrastructure and exploring a vast network of human facilities and wreckage infested by a dormant, host-dependent biological organism.
