# Application boundaries

## Cassandra

Cassandra is the game application and owns its composition root, runtime host,
content package, gameplay systems, game-specific input policy, persistence
adapter selection, navigation, and application presentation.

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
lifecycle, frame scheduling, clock synchronization, and teardown.

## Current limits

- Cassandra no longer launches Dev Lab's application shell. It owns its
  application start-up, runtime-host configuration, navigation, pause handling,
  world selection, viewport coordination, gameplay UI mounting, and input
  policy.
- Cassandra currently reuses the isolated viewport, input controller, catalog,
  navigation, pause-menu, and workspace-persistence utilities originally
  extracted while building Dev Lab. These are utility-level imports; Cassandra
  does not start the Dev Lab application. Moving generally reusable utilities
  into neutral shared packages remains a follow-up boundary cleanup.
- The existing `.cass` envelope, save adapter, persistence participant
  contracts, and workspace state identifier are retained for compatibility.
  Cassandra-specific save-state identity and ownership will be separated in a
  later persistence step.
- Dev Lab retains its own shell, runtime factory, viewport composition,
  workspace orchestration, and standalone entry.
- The known menu-button responsiveness issue has not been independently
  browser-verified or declared fixed by this architectural change.
