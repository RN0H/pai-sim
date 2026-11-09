/** Small MJCF builders for environment props. Pure string building. */

export const f = (n: number): string => {
  const v = Number(n.toFixed(5));
  return Object.is(v, -0) ? "0" : String(v);
};

export const WALL_RGBA = "0.55 0.6 0.68 1";
export const LINE_RGBA = "0.15 0.16 0.18 1";
/** Non-colliding and massless: for markings the robot drives over or through. */
export const VISUAL = `contype="0" conaffinity="0"`;

/** A solid wall standing on the floor, centred at (x, y), half-sizes sx, sy, sz. */
export function wall(name: string, x: number, y: number, sx: number, sy: number, sz: number, rgba = WALL_RGBA): string {
  return `\n    <geom name="${name}" type="box" size="${f(sx)} ${f(sy)} ${f(sz)}" pos="${f(x)} ${f(y)} ${f(sz)}" rgba="${rgba}"/>`;
}

/**
 * A line on the floor through `points` (a closed loop when `closed`): thin,
 * non-colliding strips the downward line probes see as a 4 mm step. Each
 * strip is a little longer than its segment so the joins have no gaps.
 */
export function floorLine(
  prefix: string,
  points: readonly [number, number][],
  width: number,
  closed: boolean,
  rgba = LINE_RGBA,
): string {
  let out = "";
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1e-9) continue;
    const deg = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
    out += `\n    <geom name="${prefix}_${i}" type="box" size="${f(len / 2 + 0.004)} ${f(width / 2)} 0.002" pos="${f((x0 + x1) / 2)} ${f((y0 + y1) / 2)} 0.002" euler="0 0 ${f(deg)}" rgba="${rgba}" ${VISUAL}/>`;
  }
  return out;
}

/** Points around a circle, anticlockwise from angle 0. */
export function circlePoints(cx: number, cy: number, radius: number, segments: number): [number, number][] {
  return Array.from({ length: segments }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / segments;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  });
}

/** A flat coloured disc on the floor (a target zone or a ring), 1 mm thick, non-colliding. */
export function floorDisc(name: string, x: number, y: number, radius: number, rgba: string, z = 0.0005): string {
  return `\n    <geom name="${name}" type="cylinder" size="${f(radius)} 0.0005" pos="${f(x)} ${f(y)} ${f(z)}" rgba="${rgba}" ${VISUAL}/>`;
}

/** A flag on a pole, purely visual, standing at (x, y). */
export function flag(name: string, x: number, y: number, rgba = "0.2 0.7 0.35 1"): string {
  return (
    `\n    <geom name="${name}_pole" type="cylinder" size="0.006 0.15" pos="${f(x)} ${f(y)} 0.15" rgba="0.85 0.86 0.88 1" ${VISUAL}/>` +
    `\n    <geom name="${name}" type="box" size="0.05 0.003 0.035" pos="${f(x + 0.05)} ${f(y)} 0.26" rgba="${rgba}" ${VISUAL}/>`
  );
}
