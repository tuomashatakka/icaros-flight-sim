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
  height: 0.3,
  front: 1.35,
  back: -1.3,
  steer: 0.35,
  force: 625,
  brake: 50,
  maxBrake: 100,
  radius: 0.35,
};

export const wheelInfo = {
  radius: vehicleConfig.radius,
  directionLocal: [0, -1, 0] as [number, number, number],
  suspensionStiffness: 15,
  suspensionRestLength: 0.3,
  maxSuspensionForce: 100000,
  maxSuspensionTravel: 0.3,
  dampingRelaxation: 1.8,
  dampingCompression: 2.5,
  axleLocal: [-1, 0, 0] as [number, number, number],
  chassisConnectionPointLocal: [1, 0, 1] as [number, number, number],
  useCustomSlidingRotationalSpeed: true,
  customSlidingRotationalSpeed: -30,
  frictionSlip: 1.5,
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
