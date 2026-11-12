import { getVisibleDimensions, clampCameraPosition, MIN_ZOOM, MAX_ZOOM } from "./world-preview-model.js";

const canvas = document.querySelector("#world-canvas");
const context = canvas.getContext("2d");
const sizeSelect = document.querySelector("#world-size");
const gridToggle = document.querySelector("#grid-visible");
const zoomInput = document.querySelector("#zoom");
const zoomValue = document.querySelector("#zoom-value");
const resetButton = document.querySelector("#reset-camera");
const worldStatus = document.querySelector("#world-status");
const viewStatus = document.querySelector("#view-status");

const state = {
  worldSize: Number(sizeSelect.value),
  gridVisible: gridToggle.checked,
  zoom: Number(zoomInput.value) / 100,
  cameraX: 0,
  cameraY: 0,
  dragging: false,
  pointerX: 0,
  pointerY: 0
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
  return getVisibleDimensions(state.zoom);
}

function clampCamera() {
  const view = visibleDimensions();
  const position = clampCameraPosition(
    { x: state.cameraX, y: state.cameraY },
    state.worldSize,
    view
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
  context.fillStyle = "#090d12";
  context.fillRect(0, 0, width, height);

  // The square world boundary is independent from the optional grid overlay.
  const worldLeft = (0 - left) * cellWidth;
  const worldTop = (0 - top) * cellHeight;
  const worldRight = (state.worldSize - left) * cellWidth;
  const worldBottom = (state.worldSize - top) * cellHeight;

  context.fillStyle = "#111923";
  context.fillRect(
    Math.max(0, worldLeft),
    Math.max(0, worldTop),
    Math.max(0, Math.min(width, worldRight) - Math.max(0, worldLeft)),
    Math.max(0, Math.min(height, worldBottom) - Math.max(0, worldTop))
  );

  if (state.gridVisible) {
    context.beginPath();
    context.strokeStyle = "rgba(160, 180, 202, 0.18)";
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

  context.strokeStyle = "#8195aa";
  context.lineWidth = 2;
  context.strokeRect(worldLeft, worldTop, state.worldSize * cellWidth, state.worldSize * cellHeight);

  const visibleColumns = Math.max(0, Math.min(state.worldSize, right) - Math.max(0, left));
  const visibleRows = Math.max(0, Math.min(state.worldSize, bottom) - Math.max(0, top));
  worldStatus.textContent = `World: ${state.worldSize} × ${state.worldSize}`;
  viewStatus.textContent = `Visible: ${visibleColumns.toFixed(1)} × ${visibleRows.toFixed(1)} fields`;
  zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function updateZoom(value) {
  state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
  zoomInput.value = String(Math.round(state.zoom * 100));
  clampCamera();
  render();
}

sizeSelect.addEventListener("change", () => {
  state.worldSize = Number(sizeSelect.value);
  state.cameraX = state.worldSize / 2;
  state.cameraY = state.worldSize / 2;
  render();
});

gridToggle.addEventListener("change", () => {
  state.gridVisible = gridToggle.checked;
  render();
});

zoomInput.addEventListener("input", () => updateZoom(Number(zoomInput.value) / 100));

resetButton.addEventListener("click", () => {
  state.cameraX = state.worldSize / 2;
  state.cameraY = state.worldSize / 2;
  updateZoom(1);
});

canvas.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  const bounds = canvas.getBoundingClientRect();
  const view = visibleDimensions();
  const cellWidth = bounds.width / view.columns;
  const cellHeight = bounds.height / view.rows;
  state.cameraX -= (event.clientX - state.pointerX) / cellWidth;
  state.cameraY -= (event.clientY - state.pointerY) / cellHeight;
  state.pointerX = event.clientX;
  state.pointerY = event.clientY;
  clampCamera();
  render();
});

function stopDragging() { state.dragging = false; }
canvas.addEventListener("pointerup", stopDragging);
canvas.addEventListener("pointercancel", stopDragging);
canvas.addEventListener("lostpointercapture", stopDragging);

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
