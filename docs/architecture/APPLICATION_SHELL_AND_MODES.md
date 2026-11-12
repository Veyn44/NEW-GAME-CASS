# Application Shell and Mode Architecture

**Status:** Approved architecture; implementation pending.  
**Decision record:** `/WHATANDWHY.md` — “Application shell and isolated development/game modes”, “Dev Lab is a development host for real gameplay systems” and “Future player-accessible Dev Lab compatibility”.

## 1. Purpose

Cassandra is an application that can host multiple distinct operating modes. The application shell is responsible for entering and leaving modes. Dev Lab and New Game are separate mode compositions, not variations of one shared screen layout.

This boundary is established before the first authoritative World/Pawn implementation so that development-only presentation and test content do not become accidental gameplay dependencies.

## 2. Initial application shell

The main menu is owned by the application shell and initially presents:

| Entry | Initial state | Intended responsibility |
|---|---|---|
| New Game | Visible, disabled | New-game setup and eventual game creation |
| Dev Lab | Visible, enabled | Development/test environment |
| Settings | Visible, disabled | Application/game settings |
| Save / Load | Visible, disabled | Saved game management |
| Database | Visible, disabled | Player-facing information/reference database |
| Archive | Visible, disabled | Future archive/browsing feature |

Only Dev Lab is interactive in the initial shell milestone. The other entries are intentional placeholders, not partially implemented actions. Their future behavior must be specified before activation.

The application shell remains distinct from both Dev Lab UI and in-game UI. Leaving Dev Lab returns to the main menu.

## 3. Mode boundaries

### Application shell

Owns application-level navigation, main menu presentation and mode entry/exit coordination. It does not own gameplay rules or a world.

### Dev Lab

Owns development-only presentation and tools, plus its own test setup/environment. It composes real gameplay systems so new features can be exercised immediately.

The initial development toolset includes a **Spawn Unit** action/menu. Further tools may be added when useful for testing systems under development.

Dev Lab's panels, layout, debug controls and test-world content are not automatically included in New Game or player-facing gameplay.

### New Game

Will own the player-facing new-game setup flow. Its planned responsibilities include configuring/generating a starting asteroid and presenting a map preview before a game session is created.

New Game does not need to be playable in the first application-shell milestone. Its menu entry remains disabled until its own flow is implemented.

### Gameplay/runtime systems

Own reusable game rules and state. They must not require Dev Lab UI, Dev Lab tools or Dev Lab mode to exist.

A gameplay feature implemented for testing in Dev Lab must remain composable by New Game and normal game sessions. Dev Lab may provide a convenient way to invoke or inspect a system, but it must not contain the only implementation of the actual gameplay behavior.

## 4. Composition and dependency direction

The intended dependency direction is:

```text
Application Shell
  ├── Dev Lab mode
  │     ├── Dev Lab UI and development tools
  │     ├── Dev Lab test setup/world
  │     └── shared gameplay/runtime systems
  │
  └── New Game mode
        ├── New Game setup/generator/preview UI
        ├── game-world/session setup
        └── shared gameplay/runtime systems

Shared Core and technical infrastructure support the compositions above.
```

The dependency direction must not be reversed:

- Gameplay/runtime systems must not import or require Dev Lab.
- New Game must not inherit Dev Lab panels, layout, spawn controls or test-world assumptions.
- Dev Lab may call public gameplay/runtime APIs and provide development-only orchestration around them.
- Core remains domain-neutral and protected; this decision does not authorize Core changes.

Mode-specific UI is presentation and tooling. It is not a second implementation of gameplay state or rules.

## 5. Testing principle

Dev Lab is the default early integration/test host for gameplay development.

When a new gameplay system is created:
1. Its authoritative logic and state belong to the appropriate gameplay/runtime owner.
2. It is composed into Dev Lab as early as practical.
3. Dev Lab exposes the controls or observations needed to test it.
4. Tests verify the system's behavior independently of Dev Lab UI where practical.
5. The same gameplay system remains usable by New Game/normal game composition without importing Dev Lab.

This avoids requiring a complete New Game flow just to reach and test a newly implemented mechanic.

## 6. Future player access

Dev Lab may later be exposed to players, potentially through a developer-mode setting. This is a future compatibility requirement only.

The initial implementation does not add a setting toggle, unlock condition, permission model or player-facing access flow. Those details require a separate decision when the feature is scheduled.

## 7. Initial implementation scope

The first shell milestone should:
- render the main menu with all six entries;
- visually distinguish the enabled Dev Lab entry from disabled placeholders;
- allow entry into Dev Lab;
- provide a clear route back to the main menu;
- keep New Game, Settings, Save/Load, Database and Archive non-interactive;
- keep the application shell separate from Dev Lab presentation.

It should not implement the New Game generator, save/load behavior, database/archive content or developer-mode setting.

## 8. Relationship to World/Pawn work

The first 128 × 128 test world and early Pawn systems belong to the Dev Lab test composition. They are development fixtures, not the permanent game world or the generated New Game asteroid.

World/Pawn gameplay logic must be reusable outside Dev Lab. The test-world layout, spawn tools and development UI must remain mode-specific.
