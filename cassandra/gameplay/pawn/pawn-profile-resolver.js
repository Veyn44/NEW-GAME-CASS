function requireDefinition(definitionLookup, id, label) {
  const definition = definitionLookup(id);
  if (!definition || definition.id !== id) {
    throw new Error(`Pawn profile cannot resolve ${label} "${id}".`);
  }
  return definition;
}

function requireNonNegativeNumber(value, path) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`Pawn base stat "${path}" must be a finite non-negative number.`);
  }
  return value;
}

/**
 * Resolves immutable Cassandra Pawn defaults through Pawn definition -> family -> base stats.
 * This is Cassandra domain logic; the universal Engine only receives the resulting runtime data.
 */
export function resolvePawnProfile({ definitionId, definitionLookup } = {}) {
  if (typeof definitionId !== "string" || !definitionId.trim()) {
    throw new TypeError("Pawn profile requires a non-empty definitionId.");
  }
  if (typeof definitionLookup !== "function") {
    throw new TypeError("Pawn profile requires a definitionLookup(id) function.");
  }

  const pawnDefinition = requireDefinition(definitionLookup, definitionId, "Pawn definition");
  if (!pawnDefinition.familyId) {
    throw new Error(`Definition "${definitionId}" does not reference a Pawn family.`);
  }
  const family = requireDefinition(definitionLookup, pawnDefinition.familyId, "Pawn family");
  if (family.category !== "Families" || !family.attributes?.baseStatsId) {
    throw new Error(`Family "${family.id}" has no valid baseStatsId reference.`);
  }
  const baseStats = requireDefinition(definitionLookup, family.attributes.baseStatsId, "base stats profile");
  const values = baseStats.attributes ?? {};
  const movement = values.movement ?? {};
  const perception = values.perception ?? {};
  const endurance = values.endurance ?? {};
  const noise = values.noise ?? {};
  const physical = values.physical ?? {};

  const visionAngle = requireNonNegativeNumber(perception.visionAngle, "perception.visionAngle");
  if (visionAngle > 360) throw new RangeError("Pawn visionAngle must not exceed 360 degrees.");
  const carryCapacityUnit = physical.carryCapacityUnit;
  if (typeof carryCapacityUnit !== "string" || !carryCapacityUnit.trim()) {
    throw new TypeError('Pawn base stat "physical.carryCapacityUnit" must be a non-empty string.');
  }

  return Object.freeze({
    definitionId: pawnDefinition.id,
    familyId: family.id,
    baseStatsId: baseStats.id,
    progression: family.attributes.progression ?? null,
    movement: Object.freeze({
      movementSpeed: requireNonNegativeNumber(movement.movementSpeed, "movement.movementSpeed"),
      dodgeDistance: requireNonNegativeNumber(movement.dodgeDistance, "movement.dodgeDistance")
    }),
    perception: Object.freeze({
      visionRange: requireNonNegativeNumber(perception.visionRange, "perception.visionRange"),
      visionAngle,
      soundDetectionRange: requireNonNegativeNumber(perception.soundDetectionRange, "perception.soundDetectionRange")
    }),
    endurance: Object.freeze({
      maxHealth: requireNonNegativeNumber(endurance.maxHealth, "endurance.maxHealth"),
      maxStamina: requireNonNegativeNumber(endurance.maxStamina, "endurance.maxStamina")
    }),
    noise: Object.freeze({
      movementNoise: requireNonNegativeNumber(noise.movementNoise, "noise.movementNoise")
    }),
    physical: Object.freeze({
      carryCapacity: requireNonNegativeNumber(physical.carryCapacity, "physical.carryCapacity"),
      carryCapacityUnit
    })
  });
}
