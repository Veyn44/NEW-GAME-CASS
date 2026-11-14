# Application boundaries

## Cassandra

Cassandra is the game application and owns its composition root, runtime host,
content package, gameplay systems, game-specific input policy, persistence
adapter selection and configuration, and application presentation. It composes
shared navigation, pause-menu, and file-persistence mechanisms with its own
view identifiers, callbacks, save slot, and state identity.

Its browser entry is `index.html` -> `application-entry.js` ->
`cassandra/application/cassandra-application-shell.js`. The Cassandra shell
starts `cassandra/application/cassandra-runtime-host.js` directly and does not
start or import the Dev Lab application shell. The Cassandra runtime host
composes Engine Core with Cassandra Input, Unit, and Colony Control systems and
resolves Cassandra-owned gameplay and Unit Inspector services.

## Dev Lab

Dev Lab is an independent development tool. Its browser entry is
`dev-lab.html` -> `dev-lab/application/standalone-entry.js` ->
`dev-lab/application/application-shell.js`.

The standalone entry calls `startDevLab()` without a Cassandra content package,
runtime factory, gameplay API, or Cassandra service resolver. It therefore uses
the generic Engine runtime and starts with no game-owned gameplay systems.

## Engine

Engine remains the shared, application-neutral runtime and service layer.
Neither the standalone Dev Lab entry nor Engine imports Cassandra application
code. Both applications use `shared/application/runtime-host.js` for runtime
lifecycle, frame scheduling, clock synchronization, and teardown. The shared
application layer also provides view navigation, pause-menu behavior, and file
persistence orchestration. These controllers receive application-specific view
identifiers, lifecycle callbacks, save adapters, slot/state identifiers, and
status/prompt copy through dependency injection.

## Current limits

- Cassandra no longer launches Dev Lab's application shell. It owns its
  application start-up, runtime-host configuration, navigation, pause handling,
  world selection, viewport coordination, gameplay UI mounting, and input
  policy.
- Cassandra and Dev Lab now share application-neutral viewport rendering,
  viewport geometry, physical input-state handling, and definition-catalog
  utilities from shared/. The viewport receives pointer overlay elements from
  the host rather than querying Dev Lab-specific selectors.
- Shared navigation, pause-menu, and file-persistence controllers live in
  `shared/application/`. They contain no imports or hard-coded identifiers for
  either application; each shell supplies its workspace view and callbacks.
- The file-persistence controller does not select or own a file format. Each
  application injects its save adapter, save slot, state identifier, file-picker
  capability, file extension, default filename, filename prompt, and UI status copy.
- The existing `.cass` envelope, local-file adapter, save slot (`dev-lab-workspace`),
  and state identifier (`cassandra-dev-lab-workspace`) are intentionally
  unchanged in this slice. Their historical names are retained for save
  compatibility; a later persistence migration can revise ownership only with
  an explicit compatibility plan.
- Dev Lab retains its own shell, runtime factory, viewport composition,
  workspace orchestration, and standalone entry.
- The known menu-button responsiveness issue has not been independently
  browser-verified or declared fixed by this architectural change.
