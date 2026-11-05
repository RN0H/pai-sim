/**
 * "Sensor playground": the Sensor bot template in a walled pen with a
 * circular line on the floor. Somewhere to try the controller examples
 * (drive in a square, avoid walls, follow the line) before M5's
 * environments exist.
 *
 * Layout: pen walls at |x|, |y| = PEN_HALF; the line is a circle of radius
 * LINE_RADIUS around the origin; the robot starts on the line at
 * (0, -LINE_RADIUS) facing +x, so following it goes anticlockwise.
 */
import { compile } from "../robot/compile";
import { templateSpec } from "../robot/templates";

/** Inner half-size of the pen, in metres. */
export const PEN_HALF = 1.5;
export const LINE_RADIUS = 0.8;
/** Width of the line. Narrower than the gap between the two line probes. */
export const LINE_WIDTH = 0.03;
const LINE_SEGMENTS = 48;
const WALL_T = 0.05;
const WALL_H = 0.1;

const f = (n: number) => String(Number(n.toFixed(5)));

function walls(): string {
  const s = PEN_HALF + WALL_T;
  const len = PEN_HALF + 2 * WALL_T;
  const wall = (name: string, x: number, y: number, sx: number, sy: number) =>
    `\n    <geom name="${name}" type="box" size="${f(sx)} ${f(sy)} ${f(WALL_H)}" pos="${f(x)} ${f(y)} ${f(WALL_H)}" rgba="0.55 0.6 0.68 1"/>`;
  return (
    wall("wall_north", 0, s, len, WALL_T) +
    wall("wall_south", 0, -s, len, WALL_T) +
    wall("wall_east", s, 0, WALL_T, len) +
    wall("wall_west", -s, 0, WALL_T, len)
  );
}

/** The line: thin, non-colliding strips the downward probes see as a 4 mm step. */
function line(): string {
  let out = "";
  // Each strip is a chord, slightly longer than the arc so they overlap.
  const half = LINE_RADIUS * Math.tan(Math.PI / LINE_SEGMENTS) + 0.004;
  for (let i = 0; i < LINE_SEGMENTS; i++) {
    const a = (2 * Math.PI * (i + 0.5)) / LINE_SEGMENTS;
    const r = LINE_RADIUS * Math.cos(Math.PI / LINE_SEGMENTS);
    const deg = (a * 180) / Math.PI + 90; // strip runs along the tangent
    out += `\n    <geom name="line_${i}" type="box" size="${f(half)} ${f(LINE_WIDTH / 2)} 0.002" pos="${f(r * Math.cos(a))} ${f(r * Math.sin(a))} 0.002" euler="0 0 ${f(deg)}" rgba="0.15 0.16 0.18 1" contype="0" conaffinity="0"/>`;
  }
  return out;
}

export const SENSORS_XML = compile(templateSpec("sensor-bot"), {
  modelName: "Sensor playground",
  pose: { x: 0, y: -LINE_RADIUS, yaw: 0 },
  world: walls() + line(),
});
