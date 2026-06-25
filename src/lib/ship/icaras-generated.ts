"use client"

import * as THREE from 'three';
import partsData from './icaras-parts-data.json';

type IcarasMaterialName = 'Body' | 'Cockpit' | 'Glass' | 'Glow';
type IcarasPartName = 'hull' | 'engineL' | 'engineR' | 'weaponL' | 'weaponR';

type IcarasPartGroup = {
  mtl: IcarasMaterialName;
  start: number;
  count: number;
};

type IcarasPartData = {
  pos: number[];
  uv: number[];
  idx: number[];
  groups: IcarasPartGroup[];
  tris: number;
  origin: [number, number, number];
};

type IcarasPartsData = {
  center: [number, number, number];
  parts: Record<IcarasPartName, IcarasPartData>;
};

type IcarasGeneratedOptions = {
  bodyWidth?: number;
  verticalHeight?: number;
  bodyLength?: number;
};

const DATA = partsData as unknown as IcarasPartsData;
const MATERIAL_ORDER: IcarasMaterialName[] = ['Body', 'Cockpit', 'Glass', 'Glow'];
const PART_KEYS: Exclude<IcarasPartName, 'hull'>[] = ['engineL', 'engineR', 'weaponL', 'weaponR'];

function buildPartGeometry(part: IcarasPartData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(part.uv, 2));
  geometry.setIndex(part.idx);

  for (const group of part.groups) {
    geometry.addGroup(group.start, group.count, MATERIAL_ORDER.indexOf(group.mtl));
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createIcarasMaterials(): THREE.MeshStandardMaterial[] {
  const body = new THREE.MeshStandardMaterial({
    name: 'Body',
    color: '#4a90e2',
    metalness: 0.62,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const cockpit = new THREE.MeshStandardMaterial({
    name: 'Cockpit',
    color: '#1f1b26',
    metalness: 0.8,
    roughness: 0.45,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  const glass = new THREE.MeshStandardMaterial({
    name: 'Glass',
    color: '#6b1538',
    emissive: '#ff3d7a',
    emissiveIntensity: 0.45,
    metalness: 0.4,
    roughness: 0.15,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.MeshStandardMaterial({
    name: 'Glow',
    color: '#05020a',
    emissive: '#ff00ff',
    emissiveIntensity: 1.6,
    side: THREE.DoubleSide,
  });

  return [body, cockpit, glass, glow];
}

export function createGeneratedIcarasShip({
  bodyWidth = 1,
  verticalHeight = 1,
  bodyLength = 1,
}: IcarasGeneratedOptions = {}): THREE.Group {
  const materials = createIcarasMaterials();
  const ship = new THREE.Group();
  ship.name = 'generated-icaras-ship';
  ship.userData.generatedShip = 'icaras';
  ship.userData.source = 'Icaras Foundry real-mesh ship forge';

  const hull = new THREE.Mesh(buildPartGeometry(DATA.parts.hull), materials);
  hull.name = 'icaras-hull';
  hull.castShadow = true;
  hull.receiveShadow = true;
  ship.add(hull);

  for (const name of PART_KEYS) {
    const part = DATA.parts[name];
    const mesh = new THREE.Mesh(buildPartGeometry(part), materials);
    mesh.name = `icaras-${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(part.origin[0], part.origin[1], part.origin[2]);
    hull.add(mesh);
  }

  hull.scale.set(bodyWidth, verticalHeight, bodyLength);
  for (const child of hull.children) {
    child.scale.set(1 / bodyWidth, 1 / verticalHeight, 1 / bodyLength);
  }

  return ship;
}

export function disposeShipObject(object: THREE.Object3D): void {
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  object.traverse((child) => {
    if ('isMesh' in child && (child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (!disposedGeometries.has(mesh.geometry)) {
        disposedGeometries.add(mesh.geometry);
        mesh.geometry.dispose();
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (disposedMaterials.has(material)) {
          continue;
        }
        disposedMaterials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose();
          }
        }
        material.dispose();
      }
    }
  });
}

// perf: cheap geometry factory, 5 meshes / 4 shared materials / no per-frame work.
