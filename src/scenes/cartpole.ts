/**
 * Classic cart-pole: a cart on a rail with a free-swinging pole. The pole
 * starts slightly off vertical so it falls over and swings; a `slide` motor
 * pushes the cart (the classic balancing control problem).
 */
export const CARTPOLE_XML = /* xml */ `
<mujoco model="cart-pole">
  <option timestep="0.002" gravity="0 0 -9.81" integrator="implicitfast"/>
  <worldbody>
    <light pos="0 0 4" dir="0 0 -1"/>
    <geom name="floor" type="plane" size="0 0 0.1" rgba="0.9 0.92 0.94 1"/>
    <geom name="rail" type="box" pos="0 0 0.5" size="1.2 0.02 0.02" rgba="0.62 0.66 0.72 1" contype="0" conaffinity="0"/>
    <geom name="post_l" type="cylinder" fromto="-1.2 0 0 -1.2 0 0.5" size="0.025" rgba="0.62 0.66 0.72 1"/>
    <geom name="post_r" type="cylinder" fromto="1.2 0 0 1.2 0 0.5" size="0.025" rgba="0.62 0.66 0.72 1"/>
    <body name="cart" pos="0 0 0.5">
      <joint name="slider" type="slide" axis="1 0 0" range="-1.05 1.05" limited="true" damping="0.5"/>
      <geom name="cart" type="box" size="0.12 0.08 0.05" rgba="0.2 0.22 0.28 1" mass="1" contype="0" conaffinity="0"/>
      <body name="pole" pos="0 -0.1 0" euler="0 3 0">
        <joint name="hinge" type="hinge" axis="0 1 0" damping="0.01"/>
        <geom name="pole" type="capsule" fromto="0 0 0 0 0 0.6" size="0.02" rgba="0.95 0.55 0.2 1" mass="0.2" contype="0" conaffinity="0"/>
        <geom name="tip" type="sphere" pos="0 0 0.6" size="0.04" rgba="0.25 0.6 0.95 1" mass="0.05" contype="0" conaffinity="0"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <motor name="push" joint="slider" gear="10" ctrlrange="-1 1"/>
  </actuator>
</mujoco>
`;
