/**
 * DFS recursive-backtracking perfect maze → tile grid (1 = wall, 0 = path).
 * Logical cells: cols × rows. Tile grid: (2*cols+1) × (2*rows+1).
 */

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function createCells(cols, rows) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({ north: true, east: true, south: true, west: true, visited: false });
    }
    cells.push(row);
  }
  return cells;
}

function carveMaze(cells, cols, rows, rng) {
  const stack = [];
  const start = cells[0][0];
  start.visited = true;
  stack.push({ c: 0, r: 0 });

  const dirs = [
    { dc: 0, dr: -1, wall: "north", opp: "south" },
    { dc: 1, dr: 0, wall: "east", opp: "west" },
    { dc: 0, dr: 1, wall: "south", opp: "north" },
    { dc: -1, dr: 0, wall: "west", opp: "east" },
  ];

  while (stack.length) {
    const { c, r } = stack[stack.length - 1];
    const neighbors = [];
    for (const d of dirs) {
      const nc = c + d.dc;
      const nr = r + d.dr;
      if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !cells[nr][nc].visited) {
        neighbors.push({ nc, nr, wall: d.wall, opp: d.opp });
      }
    }
    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }
    shuffle(neighbors, rng);
    const { nc, nr, wall, opp } = neighbors[0];
    cells[r][c][wall] = false;
    cells[nr][nc][opp] = false;
    cells[nr][nc].visited = true;
    stack.push({ c: nc, r: nr });
  }
}

function cellsToTiles(cols, rows, cells) {
  const tw = cols * 2 + 1;
  const th = rows * 2 + 1;
  const grid = Array.from({ length: th }, () => Array(tw).fill(1));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r][c];
      grid[2 * r + 1][2 * c + 1] = 0;
      if (!cell.north) grid[2 * r][2 * c + 1] = 0;
      if (!cell.west) grid[2 * r + 1][2 * c] = 0;
      if (!cell.east) grid[2 * r + 1][2 * c + 2] = 0;
      if (!cell.south) grid[2 * r + 2][2 * c + 1] = 0;
    }
  }

  return { grid, tileCols: tw, tileRows: th };
}

/** Mulberry32 PRNG from seed */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 迷宫固定为 8×8 逻辑格（tile 网格为 17×17）。
 * @param {object} [opts]
 * @param {number} [opts.seed] 整数种子（默认随机）
 */
export function generateMaze(opts = {}) {
  const cols = 8;
  const rows = 8;
  const seed = opts.seed ?? (Date.now() ^ (Math.random() * 0x100000000));
  const rng = mulberry32(seed >>> 0);

  const cells = createCells(cols, rows);
  carveMaze(cells, cols, rows, rng);

  const { grid, tileCols, tileRows } = cellsToTiles(cols, rows, cells);

  const startTileC = 1;
  const startTileR = 1;
  const goalTileC = 2 * (cols - 1) + 1;
  const goalTileR = 2 * (rows - 1) + 1;

  return {
    seed,
    cols,
    rows,
    tileCols,
    tileRows,
    grid,
    startTileC,
    startTileR,
    goalTileC,
    goalTileR,
    /** Max Manhattan distance on tile grid between any path tiles (approx bound for audio) */
    maxManhattan: tileCols + tileRows - 2,
  };
}

export function isWall(maze, tileC, tileR) {
  if (tileC < 0 || tileR < 0 || tileC >= maze.tileCols || tileR >= maze.tileRows) {
    return true;
  }
  return maze.grid[tileR][tileC] === 1;
}

export function isGoal(maze, tileC, tileR) {
  return tileC === maze.goalTileC && tileR === maze.goalTileR;
}

export function manhattanToGoal(maze, tileC, tileR) {
  return Math.abs(tileC - maze.goalTileC) + Math.abs(tileR - maze.goalTileR);
}

/**
 * Uniform cell size (px) to fit tileCols × tileRows in width × height.
 */
export function cellSizeForViewport(tileCols, tileRows, width, height) {
  if (width <= 0 || height <= 0) return 8;
  return Math.min(width / tileCols, height / tileRows);
}
