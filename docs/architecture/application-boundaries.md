# Application boundaries

## Cassandra game application

Cassandra is the game application and owns its composition root, runtime host,
Cassandra content package, gameplay systems, game-specific input policy,
persistence adapter selection/configuration, and game presentation.

Its primary browser entry is `index.html` ->
`application-entry.js` -> `cassandra/application/cassandra-application-shell.js`.
The Cassandra shell starts the Cassandra runtime directly. It composes Engine
Core with Cassandra Input, Unit, and Colony Control systems and resolves
Cassandra-owned gameplay and Unit Inspector services.

The main menu in `index.html` contains a **DEV LAB** navigation item. Selecting
it does not launch the standalone Dev Lab application. It changes the visible
view inside the already-running Cassandra application shell. That workspace
uses the Dev Lab-originated laboratory UI and shared viewport mechanisms, but
its runtime, content catalog, definitions, gameplay API, and game systems are
supplied by Cassandra. This is the current primary way to use Dev Lab as a
laboratory for Cassandra content.

## Dev Lab as a development workspace

Dev Lab is the development and inspection environment used to work with
Engine-backed worlds and game content. It is useful to distinguish two
execution modes that currently share much of their UI and presentation code.

### Cassandra-hosted Dev Lab workspace (current primary workflow)

- Entry: `index.html` -> `application-entry.js` ->
  `cassandra/application/cassandra-application-shell.js`.
- The visible workspace is the `data-view="dev-lab"` section in
  `index.html`.
- The Cassandra application remains the host. It loads Cassandra's database,
  constructs Cassandra gameplay services, and injects the gameplay API and
  gameplay UI into the laboratory workspace.
- This is the mode that provides Cassandra definitions, Unit placement,
  Colony Leader/Draft behavior, and Cassandra-specific inspection.
- It is not the standalone Dev Lab application, even though the screen is
  labelled "Dev Lab".

### Standalone Engine-only Dev Lab (secondary / optional workflow)

- Entry: `dev-lab.html` ->
  `dev-lab/application/standalone-entry.js` ->
  `dev-lab/application/application-shell.js`.
- The standalone entry calls `startDevLab()` without Cassandra's content
  package, runtime factory, gameplay API, or Cassandra service resolver.
- It starts the generic Engine runtime and has no Cassandra gameplay systems.
- The shared definition-catalog UI can display content registered with the
  Engine, but this entry currently does not load Cassandra's database package.
  Consequently, it cannot be expected to show Cassandra definitions or offer
  Cassandra gameplay operations.
- It can still serve as an Engine-only sandbox for generic runtime, world,
  viewport, and tooling work. It is not currently required to be a complete,
  useful Cassandra development environment.
- Giving this standalone mode its own database/content package is a possible
  future direction, not a current requirement. It may instead remain a small
  Engine test harness, evolve into a generic content-package host, or be
  retired if the Cassandra-hosted workspace fully covers the practical need.

## Engine

Engine is the reusable, application-neutral runtime and service layer.
Engine must not import Cassandra or Dev Lab application code. It owns Core,
runtime mechanisms, registries and general services; applications compose
those mechanisms and supply domain systems, content, policies, and adapters.

## Shared application and presentation mechanisms

`shared/` currently contains mechanisms consumed by both Cassandra and Dev
Lab, including runtime-host orchestration, view navigation, pause-menu
behavior, file-persistence orchestration, viewport rendering/geometry,
physical input-state handling, and definition-catalog utilities.

This is an intentional development-stage boundary. Shared code does not have
to become part of Engine, nor does it have to survive permanently. As the
applications and Engine mature, individual modules may move into Engine,
remain shared, become application-owned, or disappear. Make that decision
when actual usage and stable contracts are clearer; do not refactor solely to
minimize or maximize the number of folders.

Shared controllers receive application-specific view identifiers, callbacks,
save adapters, slot/state identifiers, and status/prompt copy through
dependency injection. The shared modules should not acquire hard-coded
Cassandra or Dev Lab application policy.

## Current limits and migration notes

- Cassandra owns its startup, runtime-host configuration, navigation, pause
  handling, world selection, viewport coordination, gameplay UI mounting,
  and input policy. It does not launch the standalone Dev Lab shell.
- The Cassandra-hosted Dev Lab workspace is the primary laboratory workflow.
  The standalone Engine-only Dev Lab is optional and currently has no
  Cassandra content package. Do not treat its empty game-content catalog as a
  defect in the Cassandra-hosted workflow.
- Cassandra and Dev Lab share application-neutral viewport rendering,
  viewport geometry, physical input-state handling, and definition-catalog
  utilities from `shared/`. The viewport receives pointer overlay elements
  from the host rather than querying Dev Lab-specific selectors.
- Shared navigation, pause-menu, and file-persistence controllers live in
  `shared/application/`. They contain no imports or hard-coded identifiers
  for either application; each shell supplies its workspace view and callbacks.
- The file-persistence controller does not select or own a file format. Each
  application injects its save adapter, save slot, state identifier, file-picker
  capability, file extension, default filename, filename prompt, and UI status
  copy.
### Persistence isolation — current implementation

- Cassandra and standalone Dev Lab have separate save/workspace domains. They are not intended to open or exchange one another's save files; cross-application save compatibility is explicitly out of scope.
- Both shells currently use the same configurable `LocalFileSaveAdapter` implementation, but inject separate application configurations:
  - Cassandra: `cassandra.save` envelope, `.cass` extension, `cassandra-main-world` slot and `cassandra-main-world` state ID.
  - Standalone Dev Lab: `cassandra.dev-lab.save` envelope, `.dlcass` extension, `dev-lab-workspace` slot and `cassandra-dev-lab-workspace` state ID.
- The Cassandra-hosted Dev Lab workspace is part of the Cassandra application and therefore uses Cassandra's `.cass` save domain. The standalone Engine-only Dev Lab entry uses `.dlcass`.
- The adapter validates the configured extension and envelope format. Automated tests verify that Cassandra rejects Dev Lab files and Dev Lab rejects Cassandra files. Failed restore/Save As operations preserve the previously selected save target, and the shared file controller serializes concurrent save/load operations.
- This achieves the required save-domain separation without duplicating the generic adapter implementation. Engine continues to provide only generic persistence coordination and participant contracts. Do not add cross-save conversion or compatibility logic.
- The remaining `src/gameplay/unit/unit-system.js` and
  `src/gameplay/colony/colony-control-system.js` are Cassandra gameplay
  systems awaiting a future ownership cleanup. The
  `src/adapters/storage/local-file-save-adapter.js` remains a shared,
  configurable adapter implementation for the distinct Cassandra and
  standalone Dev Lab save domains. Their current location is known technical
  debt, not a reason for an unplanned move.
- Simulation currently has one time flow and no user-selectable 1x/2x/3x
  speed control. Camera behavior at accelerated simulation speeds is
  therefore a future acceptance requirement, not a current defect or a reason
  for a speculative timing refactor. When time multipliers are introduced,
  verify that camera movement remains appropriately independent of simulation
  speed.
- The earlier menu-button responsiveness problem is no longer the current
  blocker. The user has manually confirmed that the established Cassandra
  behavior remains as it did before Phase 3 and that redundant test buttons
  were removed. This is a limited manual regression check, not full browser
  acceptance; Dev Lab spatial workflows, Main/Temporary World interactions,
  Campaign IndexedDB durability, crash/reopen and performance remain pending.
- Latest verified source/test checkpoint before this documentation update:
  `99fe57c824aa4e40d575ec0206e5b2adc2dd77eb`. GitHub Actions passed 233/233
  Core tests, 294/294 host tests and browser entry-point syntax checks. The
  development preview and GitHub Pages deployments also succeeded. The checkpoint
  includes regression coverage for Temporary World disposal of a scoped Unit
  whose placement has already been removed. See the current status index for
  exact workflow runs and remaining manual acceptance gates.
