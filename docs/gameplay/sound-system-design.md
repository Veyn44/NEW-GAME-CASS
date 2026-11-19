# Cassandra Sound and Directional Detection — Design Notes

Status: agreed design direction; implementation pending.

## Player-facing feedback

- The player should receive a red directional sound indicator, inspired by the directional threat indicators in Phoenix Point.
- The indicator communicates bearing/direction only.
- It must not reveal the exact source tile or exact source position.
- The presentation layer should receive a direction/uncertainty result, not the hidden source coordinates.
- Multiple sounds may produce separate or combined directional indications; this presentation decision remains open.

## Sound source model

- Pawns emit movement noise from their Pawn base stats (current baseline: 8).
- Weapons and actions define their own noise values (for example, a loud machine gun may use 30).
- Equipment can modify Pawn-generated movement noise. Example: heavy boots apply a 1.8 multiplier.
- Noise emission and sound detection are separate values:
  - source noise describes how strongly an event emits sound;
  - listener sound detection describes the listener's baseline sensitivity.

## Propagation and obstacles

- Walls, doors and other world elements should expose a noiseBlock value.
- Sound propagation must account for map geometry, including walls and corners.
- A sound should lose propagation strength according to the noiseBlock values it encounters.
- A sufficiently strong source may remain detectable through an obstacle if enough signal remains after attenuation.
- A wall should not automatically be treated as an absolute blocker; its configured noiseBlock determines how much it attenuates.
- The exact propagation algorithm and numeric balance are not yet finalized.

## Initial numeric reference

- Pawn movement noise: 8.
- Pawn sound detection range: 8.
- In open space, the current design target is that a source with noise 8 can first be detected at approximately 15 tiles by a listener with detection 8.
- This is a balancing target, not yet a committed implementation formula.
- A source with noise 30 should be capable of overcoming some obstacles that fully suppress quieter sources.

## Architectural ownership

- Cassandra owns source noise, equipment modifiers, detection rules and the player-facing directional signal.
- The Engine may provide generic grid traversal/spatial query primitives, but should not know about Pawns, weapons or the red indicator.
- A Cassandra sound propagation system should evaluate paths and attenuation against world-provided noiseBlock data.
- The UI receives only the resulting direction and uncertainty, not the exact source location.

## Deferred decisions

- Exact noiseBlock scale and default values for walls, doors, windows and other materials.
- Whether sound attenuation is additive, multiplicative or based on a signal-strength model.
- How multiple sound sources are prioritized and displayed.
- Whether doors being open/closed changes their noiseBlock.
- How vertical floors/levels affect sound.
