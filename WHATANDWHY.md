# WHAT AND WHY — Cassandra Design Decisions

This file is the canonical log for accepted game and presentation decisions. It records the reason and intended behavior so later systems can build on deliberate choices rather than assumptions.

## Decision: Visual identity foundation

- **WHAT:** Keep the original Deep Space foundation: dark navy background, blue-toned panels, turquoise accent and light text. Replace the original bright purple accent with dark burgundy-purple (palette D, `#812044`).
- **WHY:** The original purple felt too conventionally violet. The selected shade is richer and redder while retaining a purple undertone; it gives Cassandra a distinctive accent without competing with the turquoise.
- **BEHAVIOR:** `#812044` is a static base color. No global pulsing, glow or animation is implied by the palette. Individual elements may opt into their own light/emission/pulse behavior when their function calls for it.
- **SCOPE:** Shared presentation design tokens and future game UI/lighting accents. This does not prescribe which gameplay objects emit light or animate.
- **STATUS:** Approved and implemented in the development preview.

## Decision: Full-screen world viewport and overlay UI

- **WHAT:** The world viewport occupies the full available application screen. UI is layered over the world rather than shrinking the world viewport. Reserve a top UI region and allow a floating panel on the left.
- **WHY:** The map should remain the primary continuous spatial surface. UI should not permanently consume map dimensions or introduce browser scrollbars into the main game screen.
- **BEHAVIOR:** The application shell should fit the viewport without page-level scrolling. The world rendering layer sits beneath UI overlay layers. The top region is reserved for persistent controls/status; the left panel is floating and can overlay the world.
- **SCOPE:** Development preview shell and future application presentation layout. Individual panel content, dimensions and interaction remain undecided.
- **STATUS:** Approved and implemented in the development preview shell.

## Decision: Camera zoom anchoring

- **WHAT:** Zoom behavior depends on camera lock state.
- **WHY:** Free navigation should preserve the point of interest under the pointer, while a camera following an entity should preserve that followed entity as the zoom focus.
- **BEHAVIOR:** With no camera lock, mouse-wheel zoom anchors to the cursor's world position. With a camera lock, zoom anchors to the locked target. A drafted Pawn is one example of a locked target, not a special-case camera mode; other entities may be followed later.
- **SCOPE:** Camera/presentation behavior. The camera lock target contract must be reusable for any eligible world entity.
- **STATUS:** Approved design; cursor-anchored wheel zoom can be implemented in the empty preview now. Entity-follow integration waits until world entities/Pawns exist.

## Decision: No universal animation for the accent palette

- **WHAT:** Color tokens define static colors only; motion and emission are explicit per-element behaviors.
- **WHY:** Not every burgundy-colored object should pulse. A static Pawn color, a status light and an illuminated colony gear can have different visual behavior.
- **BEHAVIOR:** Animation, pulse rate, glow intensity and emissive treatment are assigned to individual elements or components, never inferred merely from their color token.
- **SCOPE:** Presentation styling and future visual components.
- **STATUS:** Approved design.


## Decision: Middle-button camera panning

- **WHAT:** Holding the middle mouse button and dragging pans the world camera. Left mouse button is not used for camera panning.
- **WHY:** The left button must remain available for selection, contextual interaction and future gameplay actions such as attacks.
- **BEHAVIOR:** Only a middle-button pointer drag changes camera position. Wheel zoom remains independent. Left-button input is left available to future game interaction handlers.
- **SCOPE:** World preview input and future gameplay camera controls.
- **STATUS:** Approved and implemented in the development preview.

## Decision: Symmetric camera overscan

- **WHAT:** The camera may show up to 20 world tiles beyond each of the four world boundaries.
- **WHY:** Pawns and other important objects at extreme world coordinates should not be forced against any screen edge or obscured by overlay UI. The extra camera travel also provides room for future camera-follow behavior.
- **BEHAVIOR:** Camera bounds extend by at most 20 tiles beyond the left, right, top and bottom edges. If the viewport is too large to preserve both bounds on an axis, the camera centers on that axis.
- **SCOPE:** Camera positioning in the world preview and future follow-camera framing. This is a camera visibility margin, not additional playable world area or new world tiles.
- **STATUS:** Approved and implemented as symmetric bounded camera overscan. Pawn-follow framing still requires a real Pawn and later gameplay integration.


## Decision: First gameplay test-world dimensions

- **WHAT:** The first authoritative gameplay test world uses a square extent of 128 × 128 integer tile coordinates.
- **WHY:** 128 × 128 is large enough to exercise meaningful world space while remaining manageable for the first real World/Pawn integration. It is a practical test configuration, not a commitment that every Cassandra world has this size.
- **BEHAVIOR:** The initial World/Pawn integration creates a 128 × 128 world descriptor and validates tile positions as integer coordinates inside its bounds. The preview's zoom and viewport settings remain independent of world dimensions.
- **SCOPE:** First authoritative gameplay test world only. The permanent home/base world size, future temporary-world sizes and any world-specific shape/content remain separate decisions.
- **STATUS:** Approved; implementation pending.

## Decision: One persistent world and at most one active temporary world

- **WHAT:** Cassandra has one persistent world. The game may enter a temporary world, but no more than one temporary world is active at a time. At any moment, only one world is active for simulation: either the persistent world or the current temporary world.
- **WHY:** The persistent world represents the continuing game state. Temporary worlds provide isolated contexts for activities such as expeditions or encounters without running the persistent simulation in the background. This keeps simulation behavior predictable and avoids unnecessary parallel world updates.
- **BEHAVIOR:** When entering a temporary world, the persistent world remains registered and retains its state but becomes inactive; its world simulation must not advance. The temporary world becomes the sole active world and is the only world whose world-scoped simulation advances. On return, the temporary world is ended or retained according to its later-defined purpose, and the persistent world is reactivated and resumes from its preserved state. World existence, registry activation and simulation execution are distinct concepts.
- **SCOPE:** World lifecycle/session architecture and world-scoped simulation scheduling. This does not yet decide whether multiple inactive temporary-world records may be retained, nor the creation, save, discard or reuse policy for each temporary-world type.
- **STATUS:** Approved architecture; implementation pending.


## Decision: Application shell and isolated development/game modes

- **WHAT:** Cassandra is structured as an application with a main menu and distinct operating modes. The initial main menu includes New Game, Dev Lab, Settings, Save/Load, Database and Archive. In the first implementation, only Dev Lab is enabled; the other entries are visible but disabled placeholders. Dev Lab is a distinct mode, not the application shell and not part of the gameplay runtime.
- **WHY:** The application needs a stable entry point and clear separation between development workflows and player-facing game flows. Establishing this boundary before world and Pawn work prevents test tools, development layout and test-world assumptions from leaking into every game mode.
- **BEHAVIOR:** The application shell owns the main menu and mode selection. Selecting Dev Lab enters a dedicated development environment. New Game will later own its own setup flow, including procedural asteroid generation and a map preview; it does not need to be playable in the first shell milestone. Returning from Dev Lab goes back to the application shell. Disabled menu entries are visible but cannot be activated until their feature is implemented.
- **SCOPE:** Application shell, top-level navigation and future mode boundaries. This does not authorize implementation of the New Game generator, save/load, database, archive or settings functionality now.
- **STATUS:** Approved architecture; implementation pending.

## Decision: Dev Lab is a development host for real gameplay systems

- **WHAT:** Dev Lab has its own development UI, tools and test environment, but it hosts the same underlying gameplay systems intended for the actual game. Development tools and presentation layout are not transferred into New Game or the player-facing game.
- **WHY:** Every gameplay system should be testable as soon as it is created, without requiring the developer to start and navigate a complete new game. At the same time, the final game must not inherit Dev Lab's diagnostic panels, spawn controls, layout or test-world content.
- **BEHAVIOR:** Gameplay logic is owned by reusable gameplay/runtime systems and must not depend on Dev Lab being present. Dev Lab may compose those systems and expose development-only controls, initially including a Spawn Unit menu. New Game and later game modes may compose the same gameplay systems with their own UI, world generation and session setup. A feature tested in Dev Lab is not considered integrated merely because a Dev Lab-only implementation exists; its gameplay logic must remain usable outside Dev Lab.
- **SCOPE:** Ownership boundaries between application shell, mode-specific presentation/tools, gameplay systems and runtime composition. Dev Lab may use a dedicated test world and test setup; neither is implicitly the actual New Game world or its UI.
- **STATUS:** Approved architecture; implementation pending.

## Decision: Future player-accessible Dev Lab compatibility

- **WHAT:** Preserve the option for Dev Lab to be available to players in a future build, potentially controlled by a developer-mode setting. Do not implement activation rules, permissions or the setting now.
- **WHY:** The development environment may later be useful as an optional player-facing sandbox, but this future possibility must not constrain or leak into normal gameplay.
- **BEHAVIOR:** Keep Dev Lab as a separately selectable application mode with a clean boundary. Future access control can decide whether it is exposed to a player; gameplay systems must not rely on Dev Lab access.
- **SCOPE:** Architectural compatibility only. No current settings toggle, unlock flow or player-facing Dev Lab permission system.
- **STATUS:** Approved future direction; implementation deferred.


## Decision: Database is an enabled application-level catalog

- **WHAT:** Database is an enabled application-level catalog from the first main-menu milestone. It displays canonical inspectable definitions registered by gameplay systems, including categories such as Pawns, enemies, structures, materials, weapons and ammunition as those systems are implemented.
- **WHY:** Development and design should be able to inspect actual game attributes through the application without searching source files. A single canonical definition source avoids a manually duplicated catalog drifting away from gameplay behavior.
- **BEHAVIOR:** Gameplay systems own and register immutable definition records containing a stable ID, name, category, description and structured attributes. Database presents those records with search and category filtering. It describes definition/base attributes, not mutable runtime instance state such as current health or damage; runtime inspection is a separate future capability. Dev Lab and normal gameplay may both consume the same definitions without depending on the Database UI.
- **SCOPE:** Application-level catalog presentation and a small definition registry outside Core. This does not authorize fake placeholder game records or move gameplay ownership into the catalog.
- **STATUS:** Approved; initial registry and empty Database UI implemented, gameplay definitions pending.


## Decision: Database as a hierarchical asset browser and inspector

- **WHAT:** The intended Database experience is a searchable hierarchical asset browser. A left-side tree contains categories, nested subcategories and individual game assets, organized to correspond closely to the actual content taxonomy and code/folder ownership. Selecting an asset displays a larger pixel-art representation and its associated attributes/details in a right-side inspector.
- **WHY:** The Database is a navigational map of what exists in Cassandra and a practical way to inspect how implemented assets are built without searching source files. It should also support future in-game reference and balancing work.
- **BEHAVIOR:** Search finds assets across categories. The navigation tree exposes the hierarchy. Selecting an item opens its canonical definition and associated artwork/metadata in the inspector. The catalog describes base definitions; mutable runtime instance state remains separate. Each entry should preserve stable identity and ownership/source traceability. Initial catalog presentation is read-only; any editing or balancing workflow needs a separate decision.
- **SCOPE:** Future Database information architecture and presentation. The first compact registry/search implementation remains a foundation; the hierarchical tree, artwork and full inspector are not claimed as implemented yet.
- **STATUS:** Approved design direction; implementation deferred until the user has tested the initial shell.


## Decision: Entity, Unit and Pawn are separate architectural layers

- **WHAT:** Core Entity is the generic identity/lifecycle anchor. Cassandra Unit is a gameplay-domain instance backed by exactly one Core Entity identity. Pawn is a gameplay specialization/role within the Unit domain, not a separate Core primitive, identity registry or parallel lifecycle. The proposed Core Entity kind for the first Unit foundation is `unit`, not `pawn`.
- **WHY:** Core must remain domain-neutral. Unit needs game-owned attributes, definition references and lifecycle rules that do not belong in Core. Treating Pawn as a separate identity model would duplicate identity and make future Unit categories harder to share.
- **BEHAVIOR:** A Unit instance references a canonical immutable Unit Definition by stable ID and is backed by one Core Entity ID. Core Entity Registry owns generic identity/status; Core World Context owns world placement; the Unit gameplay system owns Unit domain records and Unit-specific rules. Pawn uses the Unit identity and instance record; Pawn-only fields/behavior are added only when a concrete game requirement defines them. Definition records are not runtime Entities and are not stored as mutable instance state. Unit persistence stores only Unit-owned data and references, never duplicate Core identity or placement snapshots.
- **SCOPE:** Cassandra gameplay architecture, Unit foundation, future Pawn specialization, Database definition catalog and persistence boundaries. No Core changes, no Unit/Pawn gameplay implementation, and no speculative health/needs/skills/inventory/appearance schema are authorized by this decision.
- **STATUS:** Approved architecture; documentation updated; implementation pending.

## Decision: First Unit foundation implementation boundary

- **WHAT:** Implement the first narrow Cassandra `game.unit` system. Its public service is `game.unit-api`, with `createUnit({ definitionId, worldId, position })`, `getUnit(entityId)`, `listUnits()` and `removeUnit(entityId)`. Each Unit has exactly one Core Entity of kind `unit`, references an existing canonical definition by stable ID, and uses Core World Context for its world placement. The Unit persistence participant stores only the Unit-to-definition relationship.
- **WHY:** This proves the Entity → Unit ownership model against the real Core APIs before introducing movement, Pawn roles or other gameplay data. It also gives later gameplay systems a small, testable Unit foundation without coupling them to Dev Lab UI.
- **BEHAVIOR:** Creation validates definition, world and non-negative integer tile coordinates before allocating identity. A failed placement retires the newly allocated identity. Queries return immutable records with placement read from Core. Removal clears placement, retires the identity and removes the Unit record. Persistence restores Unit records after Core identity/world/placement participants and validates all references and canonical definitions before committing. The Database continues to use the existing canonical definition registry; no second catalog is introduced.
- **SCOPE:** Unit domain foundation, its Core service dependencies, persistence participant and automated tests. No Core changes, movement, collision/occupancy, Pawn-specific fields, appearance, UI integration or Spawn Unit control activation.
- **STATUS:** Implemented on `next-step/phase-2`; automated verification pending.

## Decision: One Database with context-controlled selection mode

- **WHAT:** Cassandra has one shared Database experience and one canonical definition catalog. Database supports a normal browse mode and a contextual selection mode. The selection action belongs to the caller/context, not to individual catalog entries. In normal Database browsing, the reserved selection control is hidden or shown only as a non-interactive informational imprint. When Dev Lab opens Database for Spawn Unit, the same Database view exposes an active `Select` control in a reserved area at the bottom-right. The selection context filters confirmable entries to definitions eligible to instantiate as Units.
- **WHY:** Reusing one Database avoids duplicated UI, duplicated catalog state and separate implementations that drift. Keeping selection outside individual entries means catalog browsing remains independent of the action that consumes a definition. The same pattern can later serve other contextual pickers without adding action behavior to every Database item.
- **BEHAVIOR:** Database always presents the same search, category hierarchy and selected-definition inspector. Its index is lightweight and contains stable IDs, labels/categories and references to definition details. Full detail data is loaded when an entry is selected; associated artwork is loaded lazily when its detail is opened. In selection mode, the caller supplies the eligible definition scope and receives the selected stable definition ID after confirmation. Normal browse mode does not expose an active Select action. Dev Lab passes the selected ID to `game.unit-api`; Database does not create or spawn runtime entities itself.
- **SCOPE:** Database information architecture, catalog loading strategy, contextual selection contract and Dev Lab Spawn Unit integration. This does not authorize duplicate catalogs, fake definitions, eager loading of all artwork, or placing gameplay creation logic inside Database. The exact loading mechanism and index/detail file format are implementation decisions to be verified against real content.
- **STATUS:** Approved architecture; implementation pending.

## Decision: Shared Database inspector for definitions and live Unit instances

- **WHAT:** The Database's detail inspector is a reusable presentation surface, not a view limited to static catalog records. It must be able to present (1) canonical definition data and (2) a selected live Unit/Pawn instance using the same information layout where appropriate. A live instance view presents current instance values and effective values after applicable modifiers. Where useful, it also exposes the underlying base value and modifier contributions so the displayed result is explainable.
- **WHY:** The same information architecture should serve content authoring/inspection and in-game entity inspection. Reusing the inspector avoids building a separate Pawn information panel with a different schema and presentation. It also makes it possible to inspect how a Pawn's actual values differ from its canonical starting definition.
- **BEHAVIOR:** A canonical definition may provide default/base values for a Unit type. A live Unit instance owns its mutable values/progression. Effective values are derived from the applicable base/instance values and modifiers; they are not silently written back into the canonical definition. For example, profession-related values such as `mining: 0` and `research: 5` can be represented as data-driven attributes when that domain is designed. When a Pawn is selected in-game and the player requests information, the shared inspector receives a live-instance data source and presents its current/effective values rather than the untouched definition values. The inspector should be able to show modifier sources/contributions when those systems expose them.
- **SCOPE:** Future Unit/Pawn attribute data, modifier/effective-value contracts and Database/in-game inspection presentation. This does not decide the final attribute schema, profession rules, skill progression, modifier stacking/order, or which systems own each modifier. Those require concrete gameplay design. The Database remains read-only and does not own runtime instance state or calculate gameplay values itself; it renders data supplied by the owning gameplay APIs.
- **STATUS:** Approved architectural direction; implementation deferred until Unit/Pawn attributes and modifier rules are designed.

## Decision: First Pawn definition and Dev Lab spawn vertical slice

- **WHAT:** Register one minimal canonical definition, `pawn.basic`, in the shared Database with category `Pawns`, a short description, empty attributes, no artwork and `spawnableAs: ["unit"]`. Compose the real Core-backed game runtime and `game.unit` system in Dev Lab, register and activate the approved 128 × 128 test world, and connect the existing Database selection handoff to the real Unit API. Spawned Units are rendered as simple development markers on the world canvas.
- **WHY:** A single deliberately data-light Pawn validates the complete content-to-runtime path without inventing HP, speed, profession or other game rules. It tests that the Database entry is discoverable, the selection context returns its canonical ID, Unit creation uses real Core identity/placement and the presentation reflects the runtime instance.
- **BEHAVIOR:** Selecting Basic Pawn in Dev Lab's Database picker enables Spawn Unit. Each spawn creates one persistent Core Entity-backed Unit using the selected definition and a valid tile in the test world. The canvas displays markers derived from `game.unit-api.listUnits()`; the renderer receives presentation markers and does not own gameplay state. Spawn failures are surfaced in the Dev Lab tool status.
- **SCOPE:** First Pawn definition, Dev Lab runtime composition, initial 128 × 128 test-world registration, Spawn Unit handoff and simple canvas marker rendering. No Pawn-specific data schema, movement, collision, selection/inspection of live instances, artwork, or production save storage. The Dev Lab runtime uses an in-memory save adapter for this test slice.
- **STATUS:** Approved and implemented; automated verification pending.
