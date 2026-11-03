/**
 * The "hello world" scene: a ground plane, a few primitives that fall and
 * settle, and a drivable rover. Since M2 the rover is the compiled "Hauler"
 * template, so this scene also proves the parts → MJCF compiler end to end.
 *
 * Golden expectations for this scene live in tests/unit/hello.test.ts.
 */
import { compile } from "../robot/compile";
import { templateSpec } from "../robot/templates";

const PROPS = /* xml */ `
    <body name="box" pos="-0.6 0.4 0.8" euler="20 30 0">
      <freejoint/>
      <geom type="box" size="0.12 0.12 0.12" rgba="0.95 0.45 0.25 1"/>
    </body>
    <body name="ball" pos="0.5 0.5 1.2">
      <freejoint/>
      <geom type="sphere" size="0.1" rgba="0.25 0.6 0.95 1"/>
    </body>
    <body name="capsule" pos="0.1 -0.6 1.0" euler="0 70 0">
      <freejoint/>
      <geom type="capsule" size="0.06 0.15" rgba="0.4 0.8 0.45 1"/>
    </body>`;

export const HELLO_XML = compile(templateSpec("hauler"), { modelName: "hello", world: PROPS });
