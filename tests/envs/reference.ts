/**
 * Reference controllers: one program per environment that completes its
 * goal, so we know every environment is solvable with the parts and the
 * robot API a user has. Each one is plain user code (the same JavaScript a
 * user would type into the code panel) for a stock template.
 * PROTECTED like the rest of tests/: see CLAUDE.md.
 */
export interface Reference {
  /** Environment id. */
  env: string;
  /** Template the program is written for. */
  template: string;
  code: string;
}

/** Playground: turn left a little, then drive into the circle and stop. */
const PLAYGROUND = `
function loop() {
  if (robot.time < 0.25) robot.setWheels(-0.1, 0.1);   // aim at the circle
  else if (robot.time < 3) robot.setWheels(0.6, 0.6);   // drive there
  else robot.setWheels(0, 0);
}
`;

/**
 * Maze: drive ahead until a wall is close, then make the next turn of the
 * route (left, left, right, right) on the spot, by time. After the last
 * turn the exit is straight ahead.
 */
const MAZE = `
const TURNS = [1, 1, -1, -1];   // 1 = left, -1 = right
const QUARTER = 0.76;           // seconds of spinning for a 90 degree turn
const SPIN = 0.3;
const CLOSE = 0.2;              // metres
let turn = 0;
let spinUntil = -1;
let dir = 0;

function loop() {
  const d = robot.read("distance");
  if (robot.time < spinUntil) {
    robot.setWheels(-dir * SPIN, dir * SPIN);
  } else if (d >= 0 && d < CLOSE && turn < TURNS.length) {
    dir = TURNS[turn++];
    spinUntil = robot.time + QUARTER;
    robot.setWheels(0, 0);
  } else {
    robot.setWheels(0.5, 0.5);
  }
}
`;

/** Line track: the "Follow a line" example's logic. */
const LINE = `
const SPEED = 0.4;
function loop() {
  const left = robot.read("line_left");
  const right = robot.read("line_right");
  if (left < right - 0.002) robot.setWheels(0.05, SPEED);
  else if (right < left - 0.002) robot.setWheels(SPEED, 0.05);
  else robot.setWheels(SPEED, SPEED);
}
`;

/** Sumo: charge straight at the box, then stop before leaving the ring. */
const SUMO = `
function loop() {
  if (robot.time < 4.2) robot.setWheels(0.8, 0.8);
  else robot.setWheels(0, 0);
}
`;

export const REFERENCES: readonly Reference[] = [
  { env: "playground", template: "scout", code: PLAYGROUND },
  { env: "maze", template: "sensor-bot", code: MAZE },
  { env: "line", template: "sensor-bot", code: LINE },
  { env: "sumo", template: "hauler", code: SUMO },
];
