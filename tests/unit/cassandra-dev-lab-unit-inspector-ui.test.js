import test from "node:test";
import assert from "node:assert/strict";
import { createCassandraDevLabUnitInspectorUi } from "../../cassandra/application/dev-lab-unit-inspector-ui.js";

class FakeElement {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  click() { this.listeners.get("click")?.(); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  removeAttribute(name) { delete this.attributes[name]; if (name === "src") this.src = ""; }
  get childElementCount() { return this.children.length; }
}

const roles = [
  "quickSelect", "quickSelectKind", "quickSelectArtwork", "quickSelectArtworkEmpty",
  "quickSelectName", "quickSelectSummary", "quickSelectInfo", "quickSelectDetails",
  "unitProfile", "unitProfileClose", "unitProfileName", "unitProfileArtwork",
  "unitProfileArtworkEmpty", "unitProfileCategory", "unitProfileDescription",
  "unitProfileAttributes", "unitProfileInstance", "unitProfileLocation"
];

function createHarness({ drafted = false, leaderId = "unit-1" } = {}) {
  const elements = Object.fromEntries(roles.map((role) => [role, new FakeElement()]));
  elements.unitProfile.hidden = true;
  elements.quickSelectDetails.hidden = true;
  const units = new Map([
    ["unit-1", { id: "unit-1", definitionId: "pawn.test", placement: { worldId: "world-a", position: { x: 4, y: 7 } } }],
    ["unit-2", { id: "unit-2", definitionId: "pawn.test", placement: { worldId: "world-a", position: { x: 8, y: 9 } } }]
  ]);
  const gameplayApi = {
    getControlState: () => ({ drafted, leaderId }),
    getUnit: (id) => units.get(id) ?? null
  };
  const definition = {
    name: "Test Pawn",
    category: "PERSONNEL",
    description: "A test unit.",
    artwork: "pawn.png",
    entityType: "unit",
    attributes: { health: 100, skills: { repair: 2 } }
  };
  const documentRef = { createElement: () => new FakeElement() };
  const ui = createCassandraDevLabUnitInspectorUi({
    root: {},
    gameplayApi,
    documentRef,
    definitionLookup: () => definition,
    elements
  });
  return { ui, elements, units };
}

test("Cassandra Unit inspector renders selection and toggles the personnel profile", () => {
  const { ui, elements } = createHarness();
  const unit = ui.inspectUnit("unit-1");

  assert.equal(unit.id, "unit-1");
  assert.equal(ui.getSelectedUnitId(), "unit-1");
  assert.equal(elements.quickSelect.hidden, false);
  assert.equal(elements.quickSelectName.textContent, "Test Pawn");
  assert.equal(elements.quickSelectInfo.disabled, false);

  elements.quickSelectInfo.click();
  assert.equal(ui.isProfileOpen(), true);
  assert.equal(elements.unitProfileName.textContent, "Test Pawn");
  assert.equal(elements.unitProfileLocation.textContent, "LOCATION · 4, 7");
  assert.ok(elements.unitProfileAttributes.childElementCount > 0);

  ui.setPaused(false);
  assert.equal(elements.quickSelectInfo.disabled, true);
  ui.closeProfile();
  assert.equal(ui.isProfileOpen(), false);
  ui.setPaused(true);
  elements.quickSelectInfo.click();
  assert.equal(ui.isProfileOpen(), true);
  elements.unitProfileClose.click();
  assert.equal(ui.isProfileOpen(), false);
});

test("Cassandra Unit inspector follows the Draft leader and clears stale selections", () => {
  const { ui, elements } = createHarness({ drafted: true, leaderId: "unit-2" });
  const selected = ui.inspectUnit("unit-1");

  assert.equal(selected.id, "unit-2");
  assert.equal(ui.getSelectedUnitId(), "unit-2");

  assert.equal(ui.inspectUnit("missing"), null);
  assert.equal(ui.getSelectedUnitId(), null);
  assert.equal(elements.quickSelect.hidden, true);
  assert.equal(elements.quickSelectInfo.disabled, true);
});
