/** Livery palettes: pure data, shared by the hangar UI and the material painter. */

export interface Palette {
  name:              string;
  bodyColor:         string;
  emissiveColor:     string;
  trimColor:         string;
  metalness:         number;
  roughness:         number;
  emissiveIntensity: number;
}

export const PALETTES: Record<string, Palette> = {
  default: {
    name:              'Default',
    bodyColor:         '#ffffff',
    emissiveColor:     '#000000',
    trimColor:         '#36d6ff',
    metalness:         0.5,
    roughness:         0.5,
    emissiveIntensity: 0.0,
  },
  colibri: {
    name:              'Colibri Pink',
    bodyColor:         '#ff69b4',
    emissiveColor:     '#ff00ff',
    trimColor:         '#ffe6a8',
    metalness:         0.3,
    roughness:         0.4,
    emissiveIntensity: 0.5,
  },
  ion: {
    name:              'Ion Cyan',
    bodyColor:         '#00ffff',
    emissiveColor:     '#00ffff',
    trimColor:         '#0a2a3a',
    metalness:         0.4,
    roughness:         0.3,
    emissiveIntensity: 0.8,
  },
  ember: {
    name:              'Ember Red',
    bodyColor:         '#ff4500',
    emissiveColor:     '#ff6347',
    trimColor:         '#1a1108',
    metalness:         0.6,
    roughness:         0.7,
    emissiveIntensity: 0.3,
  },
  ink: {
    name:              'Ink Mono',
    bodyColor:         '#111111',
    emissiveColor:     '#333333',
    trimColor:         '#d8dbe6',
    metalness:         0.8,
    roughness:         0.2,
    emissiveIntensity: 0.1,
  },
  toxic: {
    name:              'Toxic Green',
    bodyColor:         '#00ff00',
    emissiveColor:     '#00ff00',
    trimColor:         '#08240c',
    metalness:         0.2,
    roughness:         0.6,
    emissiveIntensity: 0.9,
  },
  mercury: {
    name:              'Mercury',
    bodyColor:         '#c9d2e0',
    emissiveColor:     '#7fb3ff',
    trimColor:         '#2b3446',
    metalness:         0.95,
    roughness:         0.12,
    emissiveIntensity: 0.25,
  },
  venom: {
    name:              'Venom',
    bodyColor:         '#2a1b3d',
    emissiveColor:     '#a855f7',
    trimColor:         '#b7f34a',
    metalness:         0.6,
    roughness:         0.35,
    emissiveIntensity: 0.7,
  },
  sunset: {
    name:              'Sunset Strip',
    bodyColor:         '#ff8a3d',
    emissiveColor:     '#ff2d6f',
    trimColor:         '#ffe6a8',
    metalness:         0.45,
    roughness:         0.35,
    emissiveIntensity: 0.55,
  },
  abyss: {
    name:              'Abyss',
    bodyColor:         '#0d2b3e',
    emissiveColor:     '#22d3ee',
    trimColor:         '#0affc2',
    metalness:         0.7,
    roughness:         0.28,
    emissiveIntensity: 0.65,
  },
  bone: {
    name:              'Bone Ceramic',
    bodyColor:         '#efe7d6',
    emissiveColor:     '#ffb347',
    trimColor:         '#3a2f24',
    metalness:         0.15,
    roughness:         0.62,
    emissiveIntensity: 0.2,
  },
  vapor: {
    name:              'Vapor',
    bodyColor:         '#f5c2ff',
    emissiveColor:     '#61e8ff',
    trimColor:         '#5b21b6',
    metalness:         0.35,
    roughness:         0.25,
    emissiveIntensity: 0.6,
  },
}

/**
 * Measures a loaded model and returns the scale + recenter offset needed to make
 * its largest dimension equal `targetSize`. Used to keep cb1 and icaras the same
 * on-screen size despite very different authored scales. Apply as:
 *   <group scale={scale}><primitive object={scene} position={[-cx,-cy,-cz]} /></group>
 */
