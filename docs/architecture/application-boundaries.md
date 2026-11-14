# Application boundaries

## Cassandra

Cassandra is the game application and owns its composition root, content package,
gameplay systems, game-specific input policy, and game-specific presentation.
Its browser entry is `index.html` -> `application-entry.js` ->
`cassandra/application/cassandra-application-shell.js`.

The Cassandra shell composes the Cassandra runtime and adapts its services to the
Dev Lab host contract. Cassandra-specific gameplay and Unit inspection UI stay
under `cassandra/application/`.

## Dev Lab

Dev Lab is an independent development tool. Its browser entry is
`dev-lab.html` -> `dev-lab/application/standalone-entry.js` ->
`dev-lab/application/application-shell.js`.

The standalone entry calls `startDevLab()` without a Cassandra content package,
runtime factory, gameplay API, or Cassandra service resolver. It therefore uses
the generic Engine runtime and starts with no game-owned gameplay systems.

When Cassandra embeds the Dev Lab viewport, Cassandra injects its runtime factory
and application-facing gameplay services. The Dev Lab host shell consumes those
through its existing runtime and service contracts; it does not import Cassandra.

## Engine

Engine remains the shared, application-neutral runtime and service layer.
Neither the standalone Dev Lab entry nor Engine imports Cassandra application
code.

## Current limits

- The Dev Lab shell now delegates viewport rendering and camera interaction to
  `dev-lab/presentation/dev-lab-viewport.js`, initialized with explicit DOM
  dependencies. The workspace save/load orchestration lives in
  `dev-lab/application/workspace-persistence-controller.js`; Engine persistence
  and the existing `.cass` file adapter remain separate dependencies.
- The shell still owns navigation, catalog UI, pause state, and application-level
  coordination. The viewport service still owns its DOM event bindings and
  rendering loop; it is isolated from the shell but is not yet a headless renderer.
- The existing workspace save adapter retains the established `.cass` file
  envelope and format for compatibility.
- Cassandra currently hosts the Dev Lab viewport as its development workspace;
  this change adds a genuinely independent Dev Lab entry point rather than
  replacing Cassandra's current development workflow.
- The known menu-button responsiveness issue is not addressed by this change.
