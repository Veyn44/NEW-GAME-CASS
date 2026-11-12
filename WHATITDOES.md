# What It Does — Cassandra Core

## Purpose
Cassandra Core is a reusable, domain-neutral game runtime foundation. It provides the technical infrastructure needed to build modular simulation games. It is not the Cassandra game itself and does not contain game-specific gameplay rules.

This document describes the completed Core baseline preserved in this repository.

## What It Provides
- **System Registry:** system registration, service contracts, dependency ordering and lookup.
- **System Bootstrap:** controlled initialization, lifecycle management, rollback and cleanup.
- **Game Context:** shared access to public runtime services.
- **Event Bus:** communication through ordered events and controlled handler fault isolation.
- **Game Clock:** configurable simulation time and pause management.
- **Simulation Scheduler:** deterministic fixed-step simulation scheduling and recovery.
- **Entity Registry:** stable entity identities and lifecycle management.
- **World Registry:** registration and activation of host-defined worlds.
- **World Context:** entity placement and atomic transfers between worlds.
- **Persistence:** save/load infrastructure, transactional behavior and schema migration support.
- **Logger:** structured diagnostics.
- **Core Assembly:** composition of runtime infrastructure through public contracts.

## What Can Be Built With It?
The Core is suitable for modular games with interconnected simulation systems, persistent worlds and independently evolving gameplay mechanics. Examples include:
- space and ship simulations;
- colony and settlement management;
- survival and resource-management games;
- strategy, exploration and expedition games;
- factory, logistics and production simulations;
- multi-world simulations.

It is especially useful when many independent systems must cooperate without becoming tightly coupled.

## What It Does Not Provide
Core intentionally does not implement:
- game-specific entities, missions or gameplay rules;
- physics, combat or damage rules;
- atmosphere, temperature or electricity simulation;
- construction, crafting or economy;
- galaxy generation, navigation or expeditions;
- user interface, rendering or input handling.

Those responsibilities belong to the host game and its gameplay systems.

## Design Principle
Core owns shared runtime infrastructure. Gameplay systems own gameplay data and rules. Systems communicate through declared services and events, with explicit ownership and lifecycle contracts. The host application supplies the persistence adapter and decides how the runtime is composed.

## Verification
- **Reference repository:** `Veyn44/NEW-GAME-CASS`
- **Reference commit:** `3d729b6099582acecb3a5bc8d35550e28ee7a033`
- **Final verified CI run:** `43180987564`
- **Verified result:** 198/198 tests passed, 0 failed.
- **Runtime:** Node.js 20.20.2
- **Test command:** `npm run test:core`

The browser HTML harnesses are retained as manual diagnostics. The final automated verification was performed by the Node.js Core test workflow.

## Preservation Rule
This repository is a preserved, verified Core baseline. Do not develop new gameplay features here. Do not use it as the active working repository. When a future project needs a clean Core foundation, use this archive as the reference and create a separate working copy.

For provenance and exact source state, see [SOURCE_COMMIT.md](SOURCE_COMMIT.md).
