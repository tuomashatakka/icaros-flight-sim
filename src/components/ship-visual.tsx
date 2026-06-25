"use client"

import { forwardRef, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { createGeneratedIcarasShip, disposeShipObject } from '@/lib/ship/icaras-generated';
import {
  SHIP_PRESETS,
  applyShipConfig,
  getFitTransform,
  type ShipConfig,
} from '@/lib/ship/materials';

type ShipVisualProps = {
  config: ShipConfig;
  targetSize: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
};

type FittedShipProps = ShipVisualProps & {
  object: THREE.Object3D;
  modelRotation: [number, number, number];
};

function cloneGltfObject(object: THREE.Object3D): THREE.Object3D {
  const clone = object.clone(true);
  clone.traverse((child) => {
    if ('isMesh' in child && (child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.geometry = mesh.geometry.clone();
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(cloneMaterialWithTextures);
      } else {
        mesh.material = cloneMaterialWithTextures(mesh.material);
      }
    }
  });
  return clone;
}

function cloneMaterialWithTextures<T extends THREE.Material>(material: T): T {
  const clone = material.clone() as T;
  const textureSlots = clone as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(textureSlots)) {
    if (value instanceof THREE.Texture) {
      const texture = value.clone();
      texture.userData.shipManagedTexture = true;
      textureSlots[key] = texture;
    }
  }

  return clone;
}

const FittedShip = forwardRef<THREE.Group, FittedShipProps>(function FittedShip(
  {
    config,
    object,
    targetSize,
    modelRotation,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
  },
  ref
) {
  const fit = useMemo(() => getFitTransform(object, targetSize), [object, targetSize]);

  useEffect(() => {
    applyShipConfig(object, config);
  }, [object, config]);

  return (
    <group ref={ref} position={position} rotation={rotation}>
      <group scale={fit.scale}>
        <primitive
          object={object}
          position={[-fit.center[0], -fit.center[1], -fit.center[2]]}
          rotation={modelRotation}
        />
      </group>
    </group>
  );
});

const GltfShipVisual = forwardRef<THREE.Group, ShipVisualProps>(function GltfShipVisual(
  props,
  ref
) {
  const preset = SHIP_PRESETS[props.config.shipId];
  if (preset.kind !== 'gltf') {
    throw new Error(`Ship ${props.config.shipId} is not gltf-backed`);
  }

  const gltf = useGLTF(preset.path);
  const object = useMemo(() => cloneGltfObject(gltf.scene), [gltf.scene]);

  useEffect(() => () => disposeShipObject(object), [object]);

  return <FittedShip ref={ref} {...props} object={object} modelRotation={preset.modelRotation} />;
});

const GeneratedIcarasVisual = forwardRef<THREE.Group, ShipVisualProps>(
  function GeneratedIcarasVisual(props, ref) {
    const object = useMemo(() => createGeneratedIcarasShip(), []);

    useEffect(() => () => disposeShipObject(object), [object]);

    return (
      <FittedShip
        ref={ref}
        {...props}
        object={object}
        modelRotation={SHIP_PRESETS.icaras.modelRotation}
      />
    );
  }
);

export const ShipVisual = forwardRef<THREE.Group, ShipVisualProps>(function ShipVisual(
  props,
  ref
) {
  const preset = SHIP_PRESETS[props.config.shipId];
  if (preset.kind === 'generated') {
    return <GeneratedIcarasVisual ref={ref} {...props} />;
  }

  return <GltfShipVisual ref={ref} {...props} />;
});

useGLTF.preload(SHIP_PRESETS.cb1.path);
