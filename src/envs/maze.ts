/**
 * Maze: a 4 × 4 grid of corridors with dead ends. The robot starts in the
 * bottom-left cell facing east; the exit is a gap in the east wall of the
 * top-right cell. Win by driving out through it.
 */
import { f, wall } from "./mjcf";
import type { Environment } from "./types";

/** Cell size, wall thickness and height, in metres. */
export const CELL = 0.6;
export const COLS = 4;
export const ROWS = 4;
const T = 0.02; // wall half-thickness
const H = 0.08; // wall half-height
/** Lower-left corner of the maze (it's centred on the origin). */
const X0 = (-COLS * CELL) / 2;
const Y0 = (-ROWS * CELL) / 2;

type Cell = readonly [col: number, row: number];
/** Open passages between neighbouring cells. A spanning tree: every cell is reachable, one way only. */
const PASSAGES: readonly (readonly [Cell, Cell])[] = [
  // The way through.
  [[0, 0], [1, 0]], [[1, 0], [2, 0]], [[2, 0], [3, 0]], [[3, 0], [3, 1]],
  [[3, 1], [2, 1]], [[2, 1], [1, 1]], [[1, 1], [1, 2]], [[1, 2], [1, 3]],
  [[1, 3], [2, 3]], [[2, 3], [3, 3]],
  // Dead ends.
  [[1, 2], [0, 2]], [[0, 2], [0, 3]], [[0, 2], [0, 1]], [[2, 3], [2, 2]], [[2, 2], [3, 2]],
];
/** The exit: a gap in the outer wall on the east side of this cell. */
export const EXIT_CELL: Cell = [3, 3];

export const cellCenter = ([c, r]: Cell): [number, number] => [X0 + (c + 0.5) * CELL, Y0 + (r + 0.5) * CELL];

const open = (a: Cell, b: Cell) =>
  PASSAGES.some(([p, q]) => (p[0] === a[0] && p[1] === a[1] && q[0] === b[0] && q[1] === b[1]) || (p[0] === b[0] && p[1] === b[1] && q[0] === a[0] && q[1] === a[1]));

function walls(): string {
  let out = "";
  let n = 0;
  // Vertical walls: on the west edge of column c (c = 0..COLS), one per row.
  for (let c = 0; c <= COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const inner = c > 0 && c < COLS && open([c - 1, r], [c, r]);
      const exit = c === COLS && r === EXIT_CELL[1];
      if (inner || exit) continue;
      out += wall(`maze_wall_${n++}`, X0 + c * CELL, Y0 + (r + 0.5) * CELL, T, CELL / 2 + T, H);
    }
  }
  // Horizontal walls: on the south edge of row r (r = 0..ROWS), one per column.
  for (let r = 0; r <= ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (r > 0 && r < ROWS && open([c, r - 1], [c, r])) continue;
      out += wall(`maze_wall_${n++}`, X0 + (c + 0.5) * CELL, Y0 + r * CELL, CELL / 2 + T, T, H);
    }
  }
  return out;
}

const EXIT_Y = cellCenter(EXIT_CELL)[1];
/** Past this x (outside the east wall), the robot is out. */
export const EXIT_LINE = X0 + COLS * CELL + 0.15;
const [START_X, START_Y] = cellCenter([0, 0]);

const RUNNING = { state: "running", message: "Find the way out of the maze (the gap in the east wall)." } as const;

export const MAZE: Environment = {
  id: "maze",
  name: "Maze",
  goal: "Find the way out of the maze (the gap in the east wall).",
  timeLimit: 120,
  start: { x: START_X, y: START_Y, yaw: 0 },
  world:
    walls() +
    // A green exit mat just outside the gap.
    `\n    <geom name="maze_exit" type="box" size="0.12 ${f(CELL / 2 - T)} 0.0005" pos="${f(X0 + COLS * CELL + 0.14)} ${f(EXIT_Y)} 0.0005" rgba="0.55 0.85 0.6 1" contype="0" conaffinity="0"/>`,
  needs: ["distance"],
  suggestedTemplate: "sensor-bot",
  createGoal: () => ({
    update(view) {
      const [x, y] = view.body("rover");
      return x > EXIT_LINE && Math.abs(y - EXIT_Y) < CELL
        ? { state: "success", message: "You escaped the maze!" }
        : RUNNING;
    },
  }),
};
