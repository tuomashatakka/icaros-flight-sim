
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const COLLISION_GROUPS = {
  GROUND: 1,
  VEHICLE: 2,
};


export const vehicleConfig = {
  width: 1.0,
  height: 0.225,
  front: 1.35,
  back: -1.3,
  steer: 0.58,
  force: 620,
  brake: 15,
  maxBrake: 10,
  radius: 0.35,
  // Hard cap on cruise speed (m/s) — keeps the car controllable; ~200 km/h.
  maxSpeed: 55,
  boostSteerMultiplier: 1.35,
  steeringResponse: 9,
  highSpeedSteerScale: 0.42,
  yawAssist: 70,
  boostForceMultiplier: 2.1,
  boostSpeedMultiplier: 1.55,
  boostDrainRate: 0.45,
  boostRechargeRate: 0.18,
  aftertouchTorque: 950,
  crashDecel: 42,
  crashMinSpeed: 14,
};

export const wheelInfo = {
  radius: vehicleConfig.radius,
  directionLocal: [0, -1, 0] as [number, number, number],
  suspensionStiffness: 10,
  suspensionRestLength: 0.4,
  maxSuspensionForce: 100000,
  maxSuspensionTravel: 0.6,
  dampingRelaxation: 10,
  dampingCompression: 2,
  axleLocal: [-1, 0, 0] as [number, number, number],
  chassisConnectionPointLocal: [1, 0, 1] as [number, number, number],
  useCustomSlidingRotationalSpeed: true,
  customSlidingRotationalSpeed: -10,
  frictionSlip: 1.0,
  isFrontWheel: false,
};

const wheelInfo_fr = {
  ...wheelInfo,
  isFrontWheel: true,
  chassisConnectionPointLocal: [vehicleConfig.width / 2, -vehicleConfig.height / 2, vehicleConfig.front] as [number, number, number],
};
const wheelInfo_fl = {
  ...wheelInfo,
  isFrontWheel: true,
  chassisConnectionPointLocal: [-vehicleConfig.width / 2, -vehicleConfig.height / 2, vehicleConfig.front] as [number, number, number],
};
const wheelInfo_br = {
  ...wheelInfo,
  isFrontWheel: false,
  chassisConnectionPointLocal: [vehicleConfig.width / 2, -vehicleConfig.height / 2, vehicleConfig.back] as [number, number, number],
};
const wheelInfo_bl = {
  ...wheelInfo,
  isFrontWheel: false,
  chassisConnectionPointLocal: [-vehicleConfig.width / 2, -vehicleConfig.height / 2, vehicleConfig.back] as [number, number, number],
};

export const wheelInfos = [wheelInfo_fl, wheelInfo_fr, wheelInfo_bl, wheelInfo_br];
