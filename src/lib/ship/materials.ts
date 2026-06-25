"use client"

import * as THREE from 'three';
import { TextureLoader } from 'three';
import { RectAreaLight } from 'three';

export interface ShipConfig {
  bodyColor: string;
  emissiveColor: string;
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  texturePreset: 'plain' | 'panels' | 'carbon' | 'hazard' | 'city' | 'gallery';
  textureRepeat: number;
  paletteName: 'default' | 'colibri' | 'ion' | 'ember' | 'ink' | 'toxic';
  shipId: 'cb1' | 'icaras';
}

export interface Palette {
  name: string;
  bodyColor: string;
  emissiveColor: string;
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
}

export const SHIP_PRESETS = {
  cb1: {
    path: '/spaceship_-_cb1/scene.gltf',
    name: 'CB1',
  },
  icaras: {
    path: '/icaras/scene.gltf',
    name: 'Icaras',
  },
} as const;

export const PALETTES: Record<string, Palette> = {
  default: {
    name: 'Default',
    bodyColor: '#ffffff',
    emissiveColor: '#000000',
    metalness: 0.5,
    roughness: 0.5,
    emissiveIntensity: 0.0,
  },
  colibri: {
    name: 'Colibri Pink',
    bodyColor: '#ff69b4',
    emissiveColor: '#ff00ff',
    metalness: 0.3,
    roughness: 0.4,
    emissiveIntensity: 0.5,
  },
  ion: {
    name: 'Ion Cyan',
    bodyColor: '#00ffff',
    emissiveColor: '#00ffff',
    metalness: 0.4,
    roughness: 0.3,
    emissiveIntensity: 0.8,
  },
  ember: {
    name: 'Ember Red',
    bodyColor: '#ff4500',
    emissiveColor: '#ff6347',
    metalness: 0.6,
    roughness: 0.7,
    emissiveIntensity: 0.3,
  },
  ink: {
    name: 'Ink Mono',
    bodyColor: '#111111',
    emissiveColor: '#333333',
    metalness: 0.8,
    roughness: 0.2,
    emissiveIntensity: 0.1,
  },
  toxic: {
    name: 'Toxic Green',
    bodyColor: '#00ff00',
    emissiveColor: '#00ff00',
    metalness: 0.2,
    roughness: 0.6,
    emissiveIntensity: 0.9,
  },
};

/**
 * Measures a loaded model and returns the scale + recenter offset needed to make
 * its largest dimension equal `targetSize`. Used to keep cb1 and icaras the same
 * on-screen size despite very different authored scales. Apply as:
 *   <group scale={scale}><primitive object={scene} position={[-cx,-cy,-cz]} /></group>
 */
export function getFitTransform(
  object: THREE.Object3D,
  targetSize: number
): { scale: number; center: [number, number, number] } {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  return { scale: targetSize / maxDim, center: [center.x, center.y, center.z] };
}

const textureLoader = new TextureLoader();

export function drawBaseTexture(config: {
  bodyColor: string;
  texturePreset: ShipConfig['texturePreset'];
  paletteName: ShipConfig['paletteName'];
  textureRepeat: number;
  themeColors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D context');
  }

  const width = 1024;
  const height = 1024;
  canvas.width = width;
  canvas.height = height;

  switch (config.texturePreset) {
    case 'panels':
      drawPanelPattern(ctx, config.bodyColor, config.themeColors);
      break;
    case 'carbon':
      drawCarbonPattern(ctx, config.bodyColor);
      break;
    case 'hazard':
      drawHazardPattern(ctx, config.bodyColor);
      break;
    case 'city':
      drawCityPattern(ctx, config.bodyColor);
      break;
    case 'gallery':
      drawGalleryPattern(ctx, config.bodyColor);
      break;
    default:
      drawPlainPattern(ctx, config.bodyColor);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(config.textureRepeat, config.textureRepeat);
  return texture;
}

function drawPanelPattern(
  ctx: CanvasRenderingContext2D,
  bodyColor: string,
  themeColors: { primary: string; secondary: string; accent: string }
): void {
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = themeColors.accent;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = 60 + i * 120;
      const y = 60 + j * 120;
      const width = 100;
      const height = 100;
      
      if ((i + j) % 2 === 0) {
        ctx.fillRect(x, y, width, height);
      }
    }
  }
}

function drawCarbonPattern(ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 10]);

  for (let i = 0; i < 1024; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i - 20, 1024);
    ctx.stroke();
  }

  ctx.setLineDash([20, 20]);
  for (let i = 0; i < 1024; i += 20) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(1024, i - 10);
    ctx.stroke();
  }
}

function drawHazardPattern(ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = '#ff0000';
  ctx.fillRect(200, 200, 624, 624);

  ctx.fillStyle = '#00ff00';
  ctx.fillRect(100, 100, 824, 824);

  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(512, 512);
  ctx.lineTo(200, 800);
  ctx.lineTo(824, 200);
  ctx.lineTo(512, 512);
  ctx.stroke();
}

function drawCityPattern(ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = '#444444';
  for (let i = 0; i < 20; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const width = Math.random() * 40 + 10;
    const height = Math.random() * 40 + 10;
    ctx.fillRect(x, y, width, height);
  }
}

function drawGalleryPattern(ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 2;

  for (let i = 0; i < 5; i++) {
    const x = 50 + i * 190;
    const y = 50;
    ctx.strokeRect(x, y, 150, 150);
  }

  for (let i = 0; i < 4; i++) {
    const x = 100;
    const y = 50 + i * 190;
    ctx.strokeRect(x, y, 200, 160);
  }
}

function drawPlainPattern(ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor;
  ctx.fillRect(0, 0, 1024, 1024);
}

export function drawEmissiveTexture(config: {
  emissiveColor: string;
  texturePreset: ShipConfig['texturePreset'];
  paletteName: ShipConfig['paletteName'];
  textureRepeat: number;
}): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create 2D context');
  }

  const width = 1024;
  const height = 1024;
  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = config.emissiveColor;

  switch (config.texturePreset) {
    case 'panels':
      drawEmissivePanelPattern(ctx, config.emissiveColor);
      break;
    case 'carbon':
      drawEmissiveCarbonPattern(ctx, config.emissiveColor);
      break;
    case 'hazard':
      drawEmissiveHazardPattern(ctx, config.emissiveColor);
      break;
    case 'city':
      drawEmissiveCityPattern(ctx, config.emissiveColor);
      break;
    case 'gallery':
      drawEmissiveGalleryPattern(ctx, config.emissiveColor);
      break;
    default:
      drawEmissivePlainPattern(ctx, config.emissiveColor);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(config.textureRepeat, config.textureRepeat);
  return texture;
}

function drawEmissivePanelPattern(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if ((i + j) % 2 === 0) {
        const x = 60 + i * 120;
        const y = 60 + j * 120;
        ctx.fillRect(x, y, 100, 100);
      }
    }
  }
  ctx.globalAlpha = 1.0;
}

function drawEmissiveCarbonPattern(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.7;

  for (let i = 0; i < 1024; i += 40) {
    ctx.fillRect(i, 0, 2, 1024);
  }

  for (let i = 0; i < 1024; i += 20) {
    ctx.fillRect(0, i, 1024, 2);
  }
  ctx.globalAlpha = 1.0;
}

function drawEmissiveHazardPattern(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.6;

  ctx.fillRect(200, 200, 624, 624);
  ctx.fillRect(100, 100, 824, 824);

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(512, 512);
  ctx.lineTo(200, 800);
  ctx.lineTo(824, 200);
  ctx.lineTo(512, 512);
  ctx.stroke();
  ctx.globalAlpha = 1.0;
}

function drawEmissiveCityPattern(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.3;

  for (let i = 0; i < 30; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    const radius = Math.random() * 30 + 5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1.0;
}

function drawEmissiveGalleryPattern(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.4;

  for (let i = 0; i < 5; i++) {
    const x = 50 + i * 190;
    const y = 50;
    ctx.fillRect(x, y, 150, 150);
  }

  for (let i = 0; i < 4; i++) {
    const x = 100;
    const y = 50 + i * 190;
    ctx.fillRect(x, y, 200, 160);
  }
  ctx.globalAlpha = 1.0;
}

function drawEmissivePlainPattern(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.globalAlpha = 1.0;
}

export function loadHangarTexture(name: string): THREE.Texture {
  const loader = new TextureLoader();
  const textureMap: Record<string, string> = {
    details: '/textures/hangar/details.png',
    buildings_baseColor: '/textures/hangar/buildings_baseColor.png',
    buildings_clearcoat: '/textures/hangar/buildings_clearcoat.png',
    buildings_emissive: '/textures/hangar/buildings_emissive.png',
    buildings_metallicRoughness: '/textures/hangar/buildings_metallicRoughness.png',
    buildings_normal: '/textures/hangar/buildings_normal.png',
  };

  const path = textureMap[name] || textureMap.details;
  return loader.load(path);
}

export function applyShipConfig(gltfScene: THREE.Object3D, config: ShipConfig): void {
  gltfScene.traverse((child) => {
    if ('isMesh' in child && (child as { isMesh?: boolean }).isMesh) {
      const mesh = child as THREE.Mesh;

      if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
        return;
      }

      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(config.bodyColor);
        material.metalness = config.metalness;
        material.roughness = config.roughness;
        material.emissive.set(config.emissiveColor);
        material.emissiveIntensity = config.emissiveIntensity;

        if (config.texturePreset !== 'plain') {
          const patternTexture = drawBaseTexture({
            ...config,
            themeColors: {
              primary: config.bodyColor,
              secondary: config.emissiveColor,
              accent: config.emissiveColor,
            },
          });
          material.map = patternTexture;

          if (config.emissiveIntensity > 0) {
            const emissivePatternTexture = drawEmissiveTexture(config);
            material.emissiveMap = emissivePatternTexture;
          }

          if (config.texturePreset === 'city' || config.texturePreset === 'gallery') {
            const hangarTexture = loadHangarTexture(config.texturePreset === 'city' ? 'buildings_baseColor' : 'details');
            material.normalMap = hangarTexture;
            material.normalScale = new THREE.Vector2(config.textureRepeat, config.textureRepeat);
          }
        } else {
          material.map = null;
          material.emissiveMap = null;
          material.normalMap = null;
        }

        material.needsUpdate = true;
      }
    }
  });
}

export const SHIP_MATERIALS = {
  drawBaseTexture,
  drawEmissiveTexture,
  loadHangarTexture,
  applyShipConfig,
  PALETTES,
};