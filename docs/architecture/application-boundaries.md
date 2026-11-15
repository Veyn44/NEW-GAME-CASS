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
### Persistence isolation — target architecture

- Cassandra and Dev Lab are separate applications with separate save/workspace domains. They are not intended to open or exchange one another's save files; cross-application save compatibility is explicitly out of scope.
- The current shared `LocalFileSaveAdapter`, Cassandra `.cass` envelope, and legacy `dev-lab-workspace` / `cassandra-dev-lab-workspace` identities are transitional implementation debt, not a desired shared-save contract.
- The target is an application-owned persistence adapter, file format/envelope, slot identity, and state identity for each application. Engine continues to provide only the generic persistence coordination and participant contracts.
- Do not add cross-save conversion or compatibility logic. When the split is implemented, verify that each application can only select and write its own save domain and that existing Cassandra saves are preserved as required by the Cassandra migration.

- Both application shells still select the existing
  `LocalFileSaveAdapter` as a compatibility bridge. That adapter owns the
  Cassandra `.cass` envelope and legacy save slot (`dev-lab-workspace`);
  both shells also preserve the state identifier
  (`cassandra-dev-lab-workspace`). The shared controller is format-neutral,
  but the adapter itself is not yet application-neutral. A later persistence
  migration must preserve existing saves.
- The remaining `src/gameplay/unit/unit-system.js` and
  `src/gameplay/colony/colony-control-system.js` are Cassandra gameplay
  systems awaiting a future ownership cleanup. The
  `src/adapters/storage/local-file-save-adapter.js` remains a compatibility
  bridge for Cassandra save files. Their current location is known technical
  debt, not a reason for an unplanned move.
- Simulation currently has one time flow and no user-selectable 1x/2x/3x
  speed control. Camera behavior at accelerated simulation speeds is
  therefore a future acceptance requirement, not a current defect or a reason
  for a speculative timing refactor. When time multipliers are introduced,
  verify that camera movement remains appropriately independent of simulation
  speed.
- The menu-button responsiveness issue remains unresolved. The user reported
  that the menu buttons did not respond in the current Pages build, preventing
  meaningful manual acceptance of the application flow. Do not mark the menu
  interaction or full browser acceptance as verified until it is fixed and retested.
- CI must be evaluated from the latest workflow run for the exact commit.
  A previous run passed 198/198 Core tests and 104/106 host tests; the two
  failures were stale imports in `colony-control-system.test.js` and
  `game-input-system.test.js`. Those test imports have since been corrected
  to `shared/input/viewport-input-controller.js`; the follow-up run is the
  authoritative verification.
