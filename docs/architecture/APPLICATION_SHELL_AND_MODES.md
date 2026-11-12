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

Dev Lab starts with an empty test world. Canonical definitions such as Johny remain available in Database, but no live Unit/Pawn is created implicitly. A runtime instance can exist only after a future explicit creation/placement action.

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


## 9. Database catalog and canonical content

Database is an application-level catalog of canonical gameplay definitions. Version-controlled assets under `src/content/database/definitions` are the source of truth. The runtime definition registry is an immutable in-memory index/cache; it is not the canonical store and must never invent definitions during application startup.

Each asset has a stable ID, schema version, display name, category, description, structured attributes and the instance kinds it can create. A database loader validates and registers canonical assets before gameplay systems are composed. The Database UI reads those same records; it does not maintain a manually duplicated copy of gameplay values.

The catalog describes canonical identities and definitions, not mutable runtime instances. Current health, damage state, inventory, position and other live values belong to runtime entities and their persistence participants.

The first canonical Pawn record is `pawn.johny`: a Human, age 32, with an intentionally unspecified role and origin. Johny is not the player's protagonist. The player will create their own protagonist; a separate robot identity may be introduced later. A runtime Unit/Pawn instance references the canonical definition rather than copying or redefining its identity.

The JSON asset is version-controlled and therefore stable across game launches and installations. The runtime registry may be rebuilt from it at startup without becoming the source of truth. Dev Lab does not instantiate this definition during startup; its test world begins empty.


## 10. Database asset browser and inspector direction

The intended full Database experience is a navigable asset browser, not a flat attribute list or a save-state viewer.

- A search field finds assets across the catalog.
- A left navigation tree mirrors the real content taxonomy and, where useful, the corresponding gameplay/content folder structure: categories, nested subcategories and individual assets.
- Selecting an asset opens a larger detail/inspection area on the right.
- The detail area is intended to show the asset's pixel-art presentation at a useful scale, identity and category, all canonical definition attributes, and associated gameplay behavior/metadata as those become available.
- The hierarchy should reflect the actual implemented content and code ownership rather than a separately invented taxonomy. The UI may present a human-friendly tree, but each entry must retain a stable link to its canonical definition and owning system/source.
- Database is also intended as a future in-game balancing/reference tool. It must distinguish canonical/base definition values from live runtime instance state. Editing/balancing capabilities, if desired, require a separate design and authorization; the initial catalog is read-only.

The initial compact registry/search UI is only a foundation. The tree, nested categories, asset artwork and right-side inspector are future presentation work and should be developed after the user has tested the first shell.


## 11. Viewport pause and input modes

The simulation pause is scoped to the game session displayed by the viewport. The pause indicator is a pulsing amber frame around the map viewport only; it does not surround the application shell.

The viewport has two input modes:

- **Running:** the viewport owns the pointer through Pointer Lock where supported. A centered crosshair is visible, keyboard and mouse input are collected for gameplay, and inspection selection/camera tools are disabled.
- **Paused:** Pointer Lock is released. The pointer is free to move outside the canvas. Left-click selection opens runtime inspection; inspection is read-only and no gameplay commands execute. Camera pan/zoom and view-only controls remain available.

The input controller separates physical input state from permission to apply gameplay input. A plain pause stores the keys/buttons already held. Releasing one while paused removes it from the pending resume snapshot. Resuming without inspection restores only inputs that are still physically held. Entering inspection invalidates the snapshot and suppresses any still-held inputs until their release event, preventing an old movement/fire input from unexpectedly resuming after inspection.

Focus loss clears all held input state and forces the viewport into pause. This prevents stuck movement or firing after switching applications or tabs.

The application composition root injects the viewport controller into the host-side `game.input` system. Gameplay systems consume its read-only `game.input-api` service rather than reaching into DOM events or the application shell.

Pointer Lock is browser-mediated and may be denied. If capture cannot be acquired, the viewport fails safe back into pause instead of allowing active gameplay with an unrestricted pointer. Actual gameplay input must continue to respect the controller's running/paused gate.


## 12. Dev Lab viewport overlays and empty-world startup

Dev Lab starts with registered test-world descriptors for 64 × 64, 128 × 128 and 256 × 256 tiles. The default active descriptor is 128 × 128. Selecting another preset activates its matching World Registry descriptor; the selector is not merely a renderer-side scale setting.

The viewport canvas fills its stable container. HUD and selection panels are DOM overlays positioned above the canvas and must not participate in the layout dimensions of the canvas. Opening or closing an overlay must not resize the canvas, change its camera, or alter its visible world dimensions.

Quick Select is positioned at the upper-left of the viewport below the world-size toolbar. It is a generic selected-object presentation surface: optional sprite, display name, short summary and a read-only INFO disclosure. It is available only while paused. The first adapter presents live Unit instances; future walls and structures must supply the same small presentation contract through their owning systems. No placeholder wall instances or artwork are fabricated.


### Viewport Database and object placement

The Dev Lab DATABASE control reuses the canonical Database view node and its existing catalog/detail rendering. It does not load a second catalog or duplicate definition state. In viewport mode the same view is temporarily presented as a modal DOM overlay above the world canvas and returned to its original application location when closed.

A selectable definition exposes a left-aligned SELECT action only when its canonical `spawnableAs` contract includes the currently supported Unit instance kind. SELECT closes the Database overlay and enters a paused-only placement mode. The presentation adapter renders a grid-snapped, translucent one-tile blueprint at the cursor. A valid in-world tile click calls the existing `game.unit-api.createUnit({ definitionId, worldId, position })` service. Successful placement refreshes world markers and selects the new instance. Escape cancels placement without creating an instance.

The renderer owns only cursor-to-tile projection and blueprint presentation. It does not create entities, validate canonical definitions or mutate world placement. Core identity and placement remain owned by the existing Core services through the Unit system.
