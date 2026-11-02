/**
 * Milestone 0 "hello world" scene: a ground plane, a few primitives that fall
 * and settle, and a simple wheeled rover body. It exists to prove the whole
 * pipeline (MJCF -> MuJoCo WASM -> Three.js -> CI) end to end.
 *
 * Golden expectations for this scene live in tests/unit/hello.test.ts.
 */
export const HELLO_XML = /* xml */ `
<mujoco model="hello">
  <option timestep="0.002" gravity="0 0 -9.81" integrator="implicitfast"/>
  <worldbody>
    <light pos="0 0 4" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="0 0 0.1" rgba="0.9 0.92 0.94 1"/>

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
    </body>

    <body name="rover" pos="0 0 0.12">
      <freejoint/>
      <geom name="chassis" type="box" size="0.18 0.12 0.04" rgba="0.2 0.22 0.28 1" mass="1.5"/>
      <body name="wheel_l" pos="0.05 0.15 -0.02" euler="-90 0 0">
        <joint name="wheel_l" type="hinge" axis="0 0 1" armature="0.005" damping="0.002"/>
        <geom type="cylinder" size="0.06 0.02" rgba="0.1 0.1 0.1 1" mass="0.1" friction="1.2"/>
      </body>
      <body name="wheel_r" pos="0.05 -0.15 -0.02" euler="-90 0 0">
        <joint name="wheel_r" type="hinge" axis="0 0 1" armature="0.005" damping="0.002"/>
        <geom type="cylinder" size="0.06 0.02" rgba="0.1 0.1 0.1 1" mass="0.1" friction="1.2"/>
      </body>
      <geom name="caster" type="sphere" size="0.02" pos="-0.14 0 -0.06" rgba="0.6 0.6 0.6 1" friction="0.05"/>
    </body>
  </worldbody>
  <actuator>
    <velocity name="left" joint="wheel_l" kv="0.5" ctrlrange="-12 12"/>
    <velocity name="right" joint="wheel_r" kv="0.5" ctrlrange="-12 12"/>
  </actuator>
</mujoco>
`;
