import {
  generateMaze,
  isWall,
  isGoal,
  cellSizeForViewport,
  manhattanToGoal,
} from "./maze.js";
import { AudioController } from "./audio.js";

const root = document.getElementById("game-root");
const mazeCanvas = document.getElementById("maze-debug");
const hotspot = document.getElementById("start-hotspot");
const startDot = document.getElementById("start-dot");

/** @type {'idle' | 'playing' | 'won'} */
let state = "idle";
let maze = generateMaze();
const audio = new AudioController();

/** 按 M 切换：迷宫调试叠加层是否显示 */
let mazeOverlayVisible = false;

function metrics() {
  const rect = root.getBoundingClientRect();
  const cell = cellSizeForViewport(
    maze.tileCols,
    maze.tileRows,
    rect.width,
    rect.height
  );
  const ox = rect.left + (rect.width - maze.tileCols * cell) / 2;
  const oy = rect.top + (rect.height - maze.tileRows * cell) / 2;
  return { rect, cell, ox, oy };
}

function layoutHotspot() {
  const { cell, ox, oy } = metrics();
  const cx = ox + (maze.startTileC + 0.5) * cell;
  const cy = oy + (maze.startTileR + 0.5) * cell;
  root.style.setProperty("--dot-x", `${cx}px`);
  root.style.setProperty("--dot-y", `${cy}px`);
}

/** 与碰撞检测对齐的迷宫画布；关闭时仅清空画布 */
function redrawMazeCanvas() {
  const rect = root.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width));
  const h = Math.max(1, Math.floor(rect.height));
  mazeCanvas.width = w * dpr;
  mazeCanvas.height = h * dpr;
  mazeCanvas.style.width = `${w}px`;
  mazeCanvas.style.height = `${h}px`;

  const c = mazeCanvas.getContext("2d");
  if (!c) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);

  if (!mazeOverlayVisible) return;

  const { cell, ox, oy } = metrics();
  const oxRel = ox - rect.left;
  const oyRel = oy - rect.top;

  for (let ty = 0; ty < maze.tileRows; ty++) {
    for (let tx = 0; tx < maze.tileCols; tx++) {
      const wall = maze.grid[ty][tx] === 1;
      c.fillStyle = wall ? "#3d4451" : "#1a2332";
      c.fillRect(oxRel + tx * cell, oyRel + ty * cell, cell + 0.51, cell + 0.51);
    }
  }

  const rDot = Math.max(4, cell * 0.38);
  c.fillStyle = "rgba(229, 57, 53, 0.45)";
  c.beginPath();
  c.arc(
    oxRel + (maze.startTileC + 0.5) * cell,
    oyRel + (maze.startTileR + 0.5) * cell,
    rDot,
    0,
    Math.PI * 2
  );
  c.fill();

  c.fillStyle = "rgba(76, 175, 80, 0.5)";
  c.beginPath();
  c.arc(
    oxRel + (maze.goalTileC + 0.5) * cell,
    oyRel + (maze.goalTileR + 0.5) * cell,
    rDot,
    0,
    Math.PI * 2
  );
  c.fill();

  c.fillStyle = "rgba(255, 255, 255, 0.35)";
  c.font = "11px system-ui, sans-serif";
  c.textBaseline = "bottom";
  c.fillText("M · hide maze overlay", 10, h - 10);
}

function layout() {
  layoutHotspot();
  redrawMazeCanvas();
}

function clientToTile(clientX, clientY) {
  const { cell, ox, oy } = metrics();
  const tx = Math.floor((clientX - ox) / cell);
  const ty = Math.floor((clientY - oy) / cell);
  return { tx, ty };
}

async function beginGame() {
  if (state !== "idle") return;
  await audio.ensureRunning();
  audio.startPathAmbience(
    maze.seed,
    maze.cols * maze.rows,
    maze.tileCols + maze.tileRows - 2
  );
  hotspot.classList.add("is-hidden");
  state = "playing";
}

function onPointerMove(e) {
  if (state !== "playing") return;
  if (document.visibilityState === "hidden") return;

  const { tx, ty } = clientToTile(e.clientX, e.clientY);

  if (isGoal(maze, tx, ty)) {
    state = "won";
    audio.playVictory();
    return;
  }

  if (isWall(maze, tx, ty)) {
    audio.setSurface("wall");
    audio.triggerWallHit();
  } else {
    audio.setSurface("path");
    audio.updateDistanceCue(manhattanToGoal(maze, tx, ty));
  }
}

function resetGame() {
  audio.stopAll();
  maze = generateMaze();
  state = "idle";
  hotspot.classList.remove("is-hidden");
  layout();
}

function onVisibilityChange() {
  if (!audio.ctx) return;
  if (document.visibilityState === "hidden") {
    audio.ctx.suspend().catch(() => {});
  } else {
    audio.ctx.resume().catch(() => {});
  }
}

startDot.addEventListener("pointerenter", (e) => {
  if (state !== "idle") return;
  e.preventDefault();
  beginGame().catch(() => {});
});

window.addEventListener("pointermove", onPointerMove);

window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    if (e.repeat) return;
    resetGame();
    return;
  }
  if (e.key === "m" || e.key === "M") {
    if (e.repeat) return;
    e.preventDefault();
    mazeOverlayVisible = !mazeOverlayVisible;
    redrawMazeCanvas();
  }
});

let resizeRaf = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    layout();
  });
});

document.addEventListener("visibilitychange", onVisibilityChange);

layout();
