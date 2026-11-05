/**
 * Example controller programs shown in the code panel. Tuned for the
 * Sensor bot template in the "Sensor playground" scene; each one's effect
 * is checked in tests/unit/control.test.ts and tests/e2e/code.spec.ts.
 */
export interface Example {
  id: string;
  name: string;
  code: string;
}

const SQUARE = `// Drive in a square: four straight sides and four left turns,
// with a short stop after each move so the robot doesn't drift.
// Times are in seconds. Different robots turn at different speeds,
// so change TURN if the corners aren't square.
const SIDE = 1.5;
const TURN = 0.46;
const PAUSE = 0.3;
const SPEED = 0.5;

function loop() {
  const leg = SIDE + PAUSE + TURN + PAUSE;
  const corner = Math.floor(robot.time / leg); // which side we're on: 0, 1, 2, 3
  const t = robot.time - corner * leg;         // time spent on this side
  if (corner >= 4) {
    robot.setWheels(0, 0);            // all four sides done: stop
  } else if (t < SIDE) {
    robot.setWheels(SPEED, SPEED);    // straight ahead
  } else if (t >= SIDE + PAUSE && t < SIDE + PAUSE + TURN) {
    robot.setWheels(-SPEED, SPEED);   // spin left on the spot
  } else {
    robot.setWheels(0, 0);            // pause
  }
}
`;

const AVOID = `// Avoid obstacles: drive ahead, and turn away when something is close.
// Needs a distance sensor (the Sensor bot has one).
// The sensor looks straight ahead only, so keep turning a little longer
// once the way looks clear: then the robot's corners clear the wall too.
const TOO_CLOSE = 0.4;   // metres
const EXTRA_TURN = 0.2;  // seconds
let turnUntil = -1;

function loop() {
  const d = robot.read("distance"); // metres to what's ahead, or -1 if nothing
  if (d >= 0 && d < TOO_CLOSE) {
    turnUntil = robot.time + EXTRA_TURN;
  }
  if (robot.time < turnUntil) {
    robot.setWheels(-0.4, 0.4);       // turn left
  } else {
    robot.setWheels(0.6, 0.6);        // all clear: forward
  }
}
`;

const FOLLOW = `// Follow a line on the floor with the two line probes under the nose.
// A probe over the line reads a smaller distance (the line is a bit
// raised), so the side that reads less has the line under it.
// Start with the line between the probes (as in the Sensor playground).
const SPEED = 0.4;

function loop() {
  const left = robot.read("line_left");
  const right = robot.read("line_right");
  if (left < right - 0.002) {
    robot.setWheels(0.05, SPEED);     // line under the left probe: turn left
  } else if (right < left - 0.002) {
    robot.setWheels(SPEED, 0.05);     // line under the right probe: turn right
  } else {
    robot.setWheels(SPEED, SPEED);    // line between the probes: straight
  }
}
`;

export const EXAMPLES: readonly Example[] = [
  { id: "square", name: "Drive in a square", code: SQUARE },
  { id: "avoid", name: "Avoid obstacles", code: AVOID },
  { id: "follow", name: "Follow a line", code: FOLLOW },
];

export function findExample(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
