"use client"

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CuboidCollider, type IntersectionEnterPayload } from '@react-three/rapier';
import { useFrame } from '@react-three/fiber';
import { useRaceStore, type Transform } from '@/hooks/use-race-store';

type RaceManagerProps = {
  /** Ordered centerline points; checkpoint 0 is the start/finish line. */
  waypoints: THREE.Vector3[];
  /** Full road width, so gates span the track. */
  width: number;
  /** Lap count (loop tracks). Sprints ignore this and finish on the last checkpoint. */
  laps?: number;
  /** Closed circuit vs. open sprint. */
  loop?: boolean;
};

type Checkpoint = {
  index: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  transform: Transform;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Builds one oriented sensor gate per waypoint and runs the race state machine.
 * Gates are thin along travel and tall/wide enough that the ship can't slip past;
 * crossing one in the expected order advances the lap (see use-race-store).
 */
export function RaceManager({ waypoints, width, laps = 3, loop = true }: RaceManagerProps) {
  const configureRace = useRaceStore((s) => s.configureRace);
  const tick = useRaceStore((s) => s.tick);
  const passCheckpoint = useRaceStore((s) => s.passCheckpoint);

  const checkpoints = useMemo<Checkpoint[]>(() => {
    const n = waypoints.length;
    return waypoints.map((p, i) => {
      const ahead = waypoints[(i + 1) % n];
      const behind = waypoints[(i - 1 + n) % n];
      // Forward = direction of travel through this gate.
      const forward = ahead.clone().sub(loop ? p : behind).normalize();
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
      const right = new THREE.Vector3().crossVectors(WORLD_UP, forward).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      const up = new THREE.Vector3().crossVectors(forward, right).normalize();
      const basis = new THREE.Matrix4().makeBasis(right, up, forward);
      const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
      const position: [number, number, number] = [p.x, p.y + 1.5, p.z];
      const quaternion: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];
      return { index: i, position, quaternion, transform: { position, quaternion } };
    });
  }, [waypoints, loop]);

  useEffect(() => {
    const spawn = checkpoints[0]?.transform ?? {
      position: [1, 2, 4] as [number, number, number],
      quaternion: [0, 1, 0, 0] as [number, number, number, number],
    };
    configureRace({ checkpointCount: checkpoints.length, laps, loop, spawn });
  }, [checkpoints, configureRace, laps, loop]);

  useFrame((_, delta) => {
    // Clamp delta so a long stall (tab blur) can't fast-forward the countdown.
    tick(Math.min(delta, 0.1));
  });

  const handleCross = (cp: Checkpoint) => (payload: IntersectionEnterPayload) => {
    if (!payload.other.rigidBodyObject?.userData?.isVehicle) return;
    passCheckpoint(cp.index, cp.transform);
  };

  return (
    <>
      {checkpoints.map((cp) => (
        <CuboidCollider
          key={cp.index}
          sensor
          position={cp.position}
          quaternion={cp.quaternion}
          args={[width / 2 + 2, 4, 1.5]}
          onIntersectionEnter={handleCross(cp)}
        />
      ))}
    </>
  );
}
