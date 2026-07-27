// Headless check of the FULL ported vehicle logic — including the driven-yaw +
// surface-alignment angular velocity, which turns out to be load-bearing for
// stability, not cosmetic: without it, thrust torques the ship onto its back.
import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, Quaternion, Vector3 } from 'three';

await RAPIER.init();

const STEP = 1 / 60;
const cfg = {
  width: 1.0, height: 0.225, front: 1.35, back: -1.3, mass: 120,
  hoverHeight: 0.7, suspensionStiffness: 26, suspensionTravel: 0.5,
  suspensionCompression: 3.2, suspensionRelaxation: 5.5, wheelRadius: 0.35,
  thrust: 950, forwardGrip: 2.2, sideGrip: 3.0, maxSpeed: 55,
  maxYawRate: 2.4, yawResponse: 6, highSpeedYawScale: 0.55, uprightStrength: 8,
  maxBank: 0.5, airYawRate: 1.6, airLevelStrength: 2.5, maxTiltRate: 10,
};

const WORLD_UP = new Vector3(0, 1, 0);
const _fwd = new Vector3(), _up = new Vector3(), _surf = new Vector3();
const _targetUp = new Vector3(), _axis = new Vector3(), _tilt = new Vector3();
const _yawOmega = new Vector3(), _target = new Vector3(), _tmp = new Vector3();
const _q = new Quaternion(), _bank = new Quaternion();

const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = STEP;
const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
world.createCollider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200).setTranslation(0, -0.5, 0), ground);
// Perimeter walls, matching the flats level — without them the ship simply
// drives off the plate at 55 m/s and the contact checks are meaningless.
const WALL = 150;
for (const [hx, hy, hz, x, y, z] of [
  [WALL, 3, 1, 0, 3, WALL], [WALL, 3, 1, 0, 3, -WALL],
  [1, 3, WALL, WALL, 3, 0], [1, 3, WALL, -WALL, 3, 0]])
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z), ground);

const chassis = world.createRigidBody(
  RAPIER.RigidBodyDesc.dynamic().setTranslation(1, 2, 4)
    .setRotation({ x: 0, y: 1, z: 0, w: 0 })
    .setLinearDamping(0.1).setAngularDamping(0.5).setCcdEnabled(true).setCanSleep(false));
world.createCollider(
  RAPIER.ColliderDesc.cuboid(cfg.width / 2, cfg.height / 2, cfg.front).setMass(cfg.mass), chassis);

const c = world.createVehicleController(chassis);
c.indexUpAxis = 1;
c.setIndexForwardAxis = 2;
for (const p of [
  { x: -cfg.width / 2, y: -cfg.height / 2, z: cfg.front },
  { x:  cfg.width / 2, y: -cfg.height / 2, z: cfg.front },
  { x: -cfg.width / 2, y: -cfg.height / 2, z: cfg.back },
  { x:  cfg.width / 2, y: -cfg.height / 2, z: cfg.back }])
  c.addWheel(p, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, cfg.hoverHeight, cfg.wheelRadius);
for (let i = 0; i < 4; i++) {
  c.setWheelSuspensionStiffness(i, cfg.suspensionStiffness);
  c.setWheelMaxSuspensionTravel(i, cfg.suspensionTravel);
  c.setWheelSuspensionCompression(i, cfg.suspensionCompression);
  c.setWheelSuspensionRelaxation(i, cfg.suspensionRelaxation);
  c.setWheelMaxSuspensionForce(i, 100000);
  c.setWheelFrictionSlip(i, cfg.forwardGrip);
  c.setWheelSideFrictionStiffness(i, cfg.sideGrip);
}

let smoothedYawRate = 0;
const rows = [];
const cruise = [];
let minUpDot = 1;

for (let tick = 0; tick < 900; tick++) {
  const racing = tick > 60;
  // Throttle is HELD from "GO" — the ship no longer accelerates on its own.
  const throttle = racing;
  // Steer hard right for the middle third, to exercise yaw + bank. Negated the
  // same way the vehicle module does, so positive input means a right turn.
  const steer = tick > 300 && tick < 600 ? -1 : 0;

  const lv = chassis.linvel();
  const speed = Math.hypot(lv.x, lv.y, lv.z);
  const targetSpeed = cfg.maxSpeed;
  const speedRatio = Math.min(speed / Math.max(targetSpeed, 1), 1);

  const engineForce = racing && throttle && speed < targetSpeed ? cfg.thrust : 0;
  for (let i = 0; i < 4; i++) {
    c.setWheelEngineForce(i, engineForce);
    c.setWheelSteering(i, 0);
    c.setWheelBrake(i, 0);
  }
  c.updateVehicle(STEP);

  _surf.set(0, 0, 0);
  let contacts = 0;
  for (let i = 0; i < 4; i++) {
    if (c.wheelIsInContact(i)) {
      const n = c.wheelContactNormal(i);
      if (n) { _surf.add(_tmp.set(n.x, n.y, n.z)); contacts++; }
    }
  }
  const grounded = contacts > 0;
  if (grounded) _surf.normalize(); else _surf.copy(WORLD_UP);

  const r = chassis.rotation();
  _q.set(r.x, r.y, r.z, r.w);
  _fwd.set(0, 0, 1).applyQuaternion(_q);
  _up.set(0, 1, 0).applyQuaternion(_q);

  const yawScale = MathUtils.lerp(1, cfg.highSpeedYawScale, speedRatio);
  const desiredYaw = grounded ? steer * cfg.maxYawRate * yawScale : steer * cfg.airYawRate;
  smoothedYawRate = MathUtils.lerp(smoothedYawRate, racing ? desiredYaw : 0,
    1 - Math.exp(-cfg.yawResponse * STEP));

  const steerNorm = Math.max(-1, Math.min(1, smoothedYawRate / Math.max(cfg.maxYawRate, 1e-3)));
  const bankAngle = grounded ? steerNorm * cfg.maxBank * speedRatio : 0;
  _bank.setFromAxisAngle(_fwd, -bankAngle);
  _targetUp.copy(_surf).applyQuaternion(_bank).normalize();

  _axis.crossVectors(_up, _targetUp);
  const sinA = _axis.length();
  const cosA = Math.max(-1, Math.min(1, _up.dot(_targetUp)));
  const tiltAngle = Math.atan2(sinA, cosA);
  if (sinA > 1e-5) _axis.multiplyScalar(1 / sinA); else _axis.set(0, 0, 0);
  _tilt.copy(_axis).multiplyScalar(tiltAngle * (grounded ? cfg.uprightStrength : cfg.airLevelStrength));
  if (_tilt.length() > cfg.maxTiltRate) _tilt.setLength(cfg.maxTiltRate);

  _yawOmega.copy(_up).multiplyScalar(smoothedYawRate);
  _target.copy(_yawOmega).add(_tilt);
  chassis.setAngvel({ x: _target.x, y: _target.y, z: _target.z }, true);

  world.step();

  // Sample the clean straight-line cruise (after settle, before the steer input
  // and any wall contact) — that is the window the handling is tuned in.
  if (tick >= 120 && tick <= 290) {
    minUpDot = Math.min(minUpDot, _up.dot(WORLD_UP));
    cruise.push({ y: chassis.translation().y, speed, contacts });
  }
  if (tick % 150 === 0 || tick === 899) {
    const t = chassis.translation();
    rows.push({ tick, y: +t.y.toFixed(3), speed: +speed.toFixed(2), contacts,
      upDot: +_up.dot(WORLD_UP).toFixed(3), yawRate: +smoothedYawRate.toFixed(2) });
  }
}

console.table(rows);
const rideHeights = cruise.map(s => s.y);
const minY = Math.min(...rideHeights);
const maxY = Math.max(...rideHeights);
const topSpeed = Math.max(...cruise.map(s => s.speed));
const alwaysGrounded = cruise.every(s => s.contacts === 4);

console.log(`cruise: ride height ${minY.toFixed(3)}..${maxY.toFixed(3)}, top speed ${topSpeed.toFixed(1)}`);

const checks = [
  ['grounded on all 4 wheels while cruising', alwaysGrounded],
  ['stays upright while cruising', minUpDot > 0.95],
  ['floats at a stable ride height', minY > 0.9 && maxY < 1.3],
  ['reaches the speed cap', topSpeed > 40],
  ['yaw responds to steer input', rows.some(r => Math.abs(r.yawRate) > 0.5)],
  ['wall impact bleeds speed (crash detectable)', rows.some(r => r.speed < 5 && r.tick > 250)],
  ['no divergence', rows.every(r => Number.isFinite(r.y))],
];
let failed = 0;
for (const [label, ok] of checks) { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); }
console.log(`\nmin up-dot after settle: ${minUpDot.toFixed(3)}`);
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
