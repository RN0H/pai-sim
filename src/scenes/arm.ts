/**
 * A 2-link arm on a tabletop pedestal. Shoulder and elbow are position-
 * controlled, so the arm holds a pose against gravity. The pedestal is a
 * `mesh` geom with inline vertices, so this scene also exercises mesh
 * rendering and materials.
 */
export const ARM_XML = /* xml */ `
<mujoco model="two-link arm">
  <option timestep="0.002" gravity="0 0 -9.81" integrator="implicitfast"/>
  <asset>
    <material name="steel" rgba="0.62 0.66 0.72 1"/>
    <material name="link" rgba="0.95 0.55 0.2 1"/>
    <material name="joint" rgba="0.2 0.22 0.28 1"/>
    <!-- Truncated square pyramid: the base pedestal. MuJoCo builds its convex hull. -->
    <mesh name="pedestal" vertex="
      -0.14 -0.14 0   0.14 -0.14 0   0.14 0.14 0   -0.14 0.14 0
      -0.07 -0.07 0.3 0.07 -0.07 0.3 0.07 0.07 0.3 -0.07 0.07 0.3"/>
  </asset>
  <worldbody>
    <light pos="0 0 4" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="0 0 0.1" rgba="0.9 0.92 0.94 1"/>
    <geom name="pedestal" type="mesh" mesh="pedestal" material="steel"/>
    <body name="upper" pos="0 0 0.34">
      <joint name="shoulder" type="hinge" axis="0 1 0" damping="0.5" armature="0.01"/>
      <geom type="cylinder" size="0.045 0.035" euler="90 0 0" material="joint"/>
      <geom type="capsule" fromto="0 0 0 0.35 0 0" size="0.03" material="link" mass="0.6"/>
      <body name="fore" pos="0.35 0 0">
        <joint name="elbow" type="hinge" axis="0 1 0" damping="0.3" armature="0.01"/>
        <geom type="cylinder" size="0.04 0.03" euler="90 0 0" material="joint"/>
        <geom type="capsule" fromto="0 0 0 0.3 0 0" size="0.025" material="link" mass="0.4"/>
        <geom name="hand" type="sphere" pos="0.3 0 0" size="0.04" rgba="0.25 0.6 0.95 1" mass="0.1"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <position name="shoulder" joint="shoulder" kp="40" kv="2" ctrlrange="-3.14 3.14"/>
    <position name="elbow" joint="elbow" kp="20" kv="1" ctrlrange="-3.14 3.14"/>
  </actuator>
</mujoco>
`;
