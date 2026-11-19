# Cassandra — Game Vision Index

> **Current concept baseline:** [GAME_CONCEPT.md](GAME_CONCEPT.md)  
> Updated: 2026-11-19

Cassandra's current game direction is defined in **GAME_CONCEPT.md**. That document is the authoritative creative baseline for the current premise, planet, biological threat, opening mission, first base, planetary POIs, expedition types, colony progression and open design questions.

This file remains as a short index for older design notes and prototype decisions. Older ideas in this file are not automatically current game requirements.

## Current product direction

Cassandra is a colony simulation with RPG progression, top-down real-time action, direct control of one primary Pawn, autonomous colony inhabitants, exploration, expeditions and restoration of human infrastructure.

The current setting is a long-established human colony on a harsh planet. A rescue cruiser sent in response to a distress signal crashes there. The player survives, reaches a mostly prepared underground human shelter and begins rebuilding while exploring the planet's extensive human-built facilities and wreckage infested by an unknown biological organism.

See [GAME_CONCEPT.md](GAME_CONCEPT.md) for the full concept and for the distinction between agreed direction, provisional mechanics and open questions.

## Engine and application boundary

The universal Engine remains technically separate from Cassandra-specific rules and content. Cassandra owns its game rules, entities, resources, generation, campaign state, UI and presentation. Dev Lab remains a development and verification environment, not a shipped-game dependency.

## Earlier prototype and presentation notes

The following notes describe earlier prototype decisions and may be retained where useful, but they do not override the current game concept:

- Earlier Cassandra presentation used a dark navy / blue-toned foundation, turquoise accent, light text and a dark burgundy-purple accent (#812044). This is a historical visual direction, not a final art-direction lock.
- The world viewport was treated as the primary spatial surface, with floating UI overlays.
- Earlier camera behavior used middle-mouse drag for panning and wheel zoom. In free-camera mode zoom anchored around the pointer; a future camera-follow mode was expected to anchor around its target.
- Earlier camera overscan allowed up to 20 world tiles beyond each boundary as a framing margin, not as additional playable world.
- Earlier vocabulary distinguished generic Core Entity, Cassandra Unit and player-related Pawn concepts. Exact game-domain terminology and schemas may evolve with the actual gameplay.

## Historical design material

- [Project History](PROJECT_HISTORY.md) records completed work and decisions.
- [Phase 3 brainstorm](docs/architecture/phase-3-brainstorm.md) is an archived Engine/gameplay design record. Its old gameplay setting and expedition examples are historical; its technical discussion remains useful as historical context.
- [Current implementation status](docs/architecture/current-implementation-status.md) describes what the code actually implements. The game concept must not be mistaken for implemented functionality.
