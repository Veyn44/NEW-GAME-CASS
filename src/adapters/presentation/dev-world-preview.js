import { getVisibleDimensions, clampCameraPosition, MIN_ZOOM, MAX_ZOOM, CAMERA_OVERSCAN_TILES } from "./world-preview-model.js";

const canvas = document.querySelector("#world-canvas");
const context = canvas.getContext("2d");
const sizeSelect = document.querySelector("#world-size");
const gridToggle = document.querySelector("#grid-visible");
const zoomValue = document.querySelector("#zoom-value");
const resetButton = document.querySelector("#reset-camera");
const worldStatus = document.querySelector("#world-status");
const viewStatus = document.querySelector("#view-status");

let worldMarkers = [];
let selectionEnabled = false;
let onMarkerSelect = null;
let selectedMarkerId = null;

export function setWorldInteraction({ paused = false, onSelect = null } = {}) {
  state.paused = Boolean(paused);
  selectionEnabled = state.paused;
  onMarkerSelect = typeof onSelect === "function" ? onSelect : null;
  render();
}

export function setSelectedWorldMarker(entityId) {
  selectedMarkerId = entityId ?? null;
  render();
}

export function setWorldMarkers(markers) {
  worldMarkers = Array.isArray(markers) ? markers.map((marker) => ({ ...marker })) : [];
  if (selectedMarkerId && !worldMarkers.some((marker) => marker.id === selectedMarkerId)) {
    selectedMarkerId = null;
  }
  render();
}

const state = {
  worldSize: Number(sizeSelect.value),
  gridVisible: gridToggle.checked,
  zoom: 1,
  cameraX: 0,
  cameraY: 0,
  dragging: false,
  pointerX: 0,
  pointerY: 0,
  paused: true
};

function resizeCanvas() {
  const bounds = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.round(bounds.width * pixelRatio);
  canvas.height = Math.round(bounds.height * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  render();
}

function visibleDimensions() {
  const bounds = canvas.getBoundingClientRect();
  const aspectRatio = bounds.width / Math.max(1, bounds.height);
  const baseColumns = 64;
  const baseRows = baseColumns / aspectRatio;
  return {
    columns: baseColumns / state.zoom,
    rows: baseRows / state.zoom
  };
}

function clampCamera() {
  const position = clampCameraPosition(
    { x: state.cameraX, y: state.cameraY },
    state.worldSize,
    visibleDimensions(),
    CAMERA_OVERSCAN_TILES
  );
  state.cameraX = position.x;
  state.cameraY = position.y;
}

function render() {
  if (!canvas.width || !canvas.height) return;
  const bounds = canvas.getBoundingClientRect();
  const width = bounds.width;
  const height = bounds.height;
  const view = visibleDimensions();
  const cellWidth = width / view.columns;
  const cellHeight = height / view.rows;
  clampCamera();

  const left = state.cameraX - view.columns / 2;
  const top = state.cameraY - view.rows / 2;
  const right = left + view.columns;
  const bottom = top + view.rows;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#090f19";
  context.fillRect(0, 0, width, height);

  const worldLeft = (0 - left) * cellWidth;
  const worldTop = (0 - top) * cellHeight;
  const worldRight = (state.worldSize - left) * cellWidth;
  const worldBottom = (state.worldSize - top) * cellHeight;

  context.fillStyle = "#111e2e";
  context.fillRect(
    Math.max(0, worldLeft),
    Math.max(0, worldTop),
    Math.max(0, Math.min(width, worldRight) - Math.max(0, worldLeft)),
    Math.max(0, Math.min(height, worldBottom) - Math.max(0, worldTop))
  );

  if (state.gridVisible) {
    context.beginPath();
    context.strokeStyle = "rgba(160, 190, 210, 0.16)";
    context.lineWidth = 1;

    const firstColumn = Math.max(0, Math.floor(left));
    const lastColumn = Math.min(state.worldSize, Math.ceil(right));
    for (let x = firstColumn; x <= lastColumn; x += 1) {
      const screenX = Math.round((x - left) * cellWidth) + 0.5;
      context.moveTo(screenX, Math.max(0, worldTop));
      context.lineTo(screenX, Math.min(height, worldBottom));
    }

    const firstRow = Math.max(0, Math.floor(top));
    const lastRow = Math.min(state.worldSize, Math.ceil(bottom));
    for (let y = firstRow; y <= lastRow; y += 1) {
      const screenY = Math.round((y - top) * cellHeight) + 0.5;
      context.moveTo(Math.max(0, worldLeft), screenY);
      context.lineTo(Math.min(width, worldRight), screenY);
    }
    context.stroke();
  }

  context.strokeStyle = "#38d6c5";
  context.globalAlpha = 0.5;
  context.lineWidth = 1.5;
  context.strokeRect(worldLeft, worldTop, state.worldSize * cellWidth, state.worldSize * cellHeight);
  context.globalAlpha = 1;

  for (const marker of worldMarkers) {
    const markerX = (marker.x + 0.5 - left) * cellWidth;
    const markerY = (marker.y + 0.5 - top) * cellHeight;
    if (markerX < 0 || markerX > width || markerY < 0 || markerY > height) continue;
    context.beginPath();
    context.fillStyle = marker.id === selectedMarkerId ? "#f3c969" : "#38d6c5";
    context.strokeStyle = marker.id === selectedMarkerId ? "#fff0bd" : "#07131c";
    context.lineWidth = marker.id === selectedMarkerId ? 3 : 2;
    context.arc(markerX, markerY, Math.max(4, Math.min(9, cellWidth * 0.32)), 0, Math.PI * 2);
    context.fill();
    context.stroke();
    if (marker.id === selectedMarkerId) {
      context.beginPath();
      context.strokeStyle = "rgba(243, 201, 105, 0.8)";
      context.lineWidth = 1.5;
      context.arc(markerX, markerY, Math.max(8, Math.min(14, cellWidth * 0.48)), 0, Math.PI * 2);
      context.stroke();
    }
    if (cellWidth >= 12) {
      context.font = "10px sans-serif";
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.fillStyle = "#d7e4ef";
      context.fillText(marker.label, markerX + 9, markerY);
    }
  }

  const visibleColumns = Math.max(0, Math.min(state.worldSize, right) - Math.max(0, left));
  const visibleRows = Math.max(0, Math.min(state.worldSize, bottom) - Math.max(0, top));
  worldStatus.textContent = `World: ${state.worldSize} × ${state.worldSize}`;
  viewStatus.textContent = `Visible: ${visibleColumns.toFixed(1)} × ${visibleRows.toFixed(1)} fields`;
  zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateZoom(value, anchor = { x: 0.5, y: 0.5 }) {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  if (nextZoom === state.zoom) return;

  const oldView = visibleDimensions();
  const offsetX = anchor.x - 0.5;
  const offsetY = anchor.y - 0.5;
  const worldAnchorX = state.cameraX + offsetX * oldView.columns;
  const worldAnchorY = state.cameraY + offsetY * oldView.rows;

  state.zoom = nextZoom;
  const nextView = visibleDimensions();
  state.cameraX = worldAnchorX - offsetX * nextView.columns;
  state.cameraY = worldAnchorY - offsetY * nextView.rows;
  clampCamera();
  render();
}

sizeSelect.addEventListener("change", () => {
  if (!state.paused) return;
  state.worldSize = Number(sizeSelect.value);
  state.cameraX = state.worldSize / 2;
  state.cameraY = state.worldSize / 2;
  render();
});

gridToggle.addEventListener("change", () => {
  if (!state.paused) return;
  state.gridVisible = gridToggle.checked;
  render();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (!state.paused) return;
  const bounds = canvas.getBoundingClientRect();
  const anchor = {
    x: (event.clientX - bounds.left) / bounds.width,
    y: (event.clientY - bounds.top) / bounds.height
  };
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  updateZoom(state.zoom * factor, anchor);
}, { passive: false });

resetButton.addEventListener("click", () => {
  if (!state.paused) return;
  state.cameraX = state.worldSize / 2;
  state.cameraY = state.worldSize / 2;
  updateZoom(1);
  render();
});

canvas.addEventListener("pointerdown", (event) => {
  if (!state.paused) return;
  if (event.button === 0 && selectionEnabled && onMarkerSelect) {
    const bounds = canvas.getBoundingClientRect();
    const view = visibleDimensions();
    const cellWidth = bounds.width / view.columns;
    const cellHeight = bounds.height / view.rows;
    const left = state.cameraX - view.columns / 2;
    const top = state.cameraY - view.rows / 2;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const hit = [...worldMarkers].reverse().find((marker) => {
      const x = (marker.x + 0.5 - left) * cellWidth;
      const y = (marker.y + 0.5 - top) * cellHeight;
      return Math.hypot(pointerX - x, pointerY - y) <= Math.max(9, Math.min(16, cellWidth * 0.55));
    });
    onMarkerSelect(hit?.id ?? null);
    return;
  }
  // Middle mouse remains dedicated to camera panning.
  if (event.button !== 1 || !state.paused) return;
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("auxclick", (event) => {
  if (event.button === 1) event.preventDefault();
});
canvas.addEventListener("pointermove", (event) => {
  if (!state.paused) return;
  if (state.dragging) {
    const bounds = canvas.getBoundingClientRect();
    const view = visibleDimensions();
    const cellWidth = bounds.width / view.columns;
    const cellHeight = bounds.height / view.rows;
    state.cameraX -= (event.clientX - state.pointerX) / cellWidth;
    state.cameraY -= (event.clientY - state.pointerY) / cellHeight;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    clampCamera();
  }
  if (state.dragging) render();
});
function stopDragging() { state.dragging = false; }
canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);
canvas.addEventListener("lostpointercapture", stopDragging);

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
