'use client'

import { mulberry32 } from 'threejs-scene'
import * as THREE from 'three'
import { TextureLoader } from 'three'

// Ship identity + presets now live in the registry (single source of truth).
// Re-exported here so existing importers of '@/lib/ship/materials' keep working.
import { SHIP_PRESETS } from './registry'
import type { ShipConfig, ShipPreset } from './registry'


export { SHIP_PRESETS }
export type { ShipConfig, ShipPreset }

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
type GetFitTransformReturnType = { scale: number; center: [number, number, number]}

export function getFitTransform (
  object: THREE.Object3D,
  targetSize: number
): GetFitTransformReturnType {
  const box    = new THREE.Box3().setFromObject(object)
  const size   = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)

  const maxDim = Math.max(size.x, size.y, size.z) || 1
  return { scale: targetSize / maxDim, center: [ center.x, center.y, center.z ]}
}

type BaseConfigType = {
  bodyColor:     string;
  texturePreset: ShipConfig['texturePreset'];
  paletteName:   ShipConfig['paletteName'];
  textureRepeat: number;
  patternAngle?: number;
  themeColors: {
    primary:   string;
    secondary: string;
    accent:    string;
  };
}

/** Repeat + rotation, applied identically to the base and emissive maps. */
function orientTexture (texture: THREE.CanvasTexture, repeat: number, angle = 0): void {
  texture.repeat.set(repeat, repeat)
  if (angle !== 0) {
    // Rotation is about the UV ORIGIN unless the centre is moved first, which
    // sends the whole livery sliding off the hull as the slider moves.
    texture.center.set(0.5, 0.5)
    texture.rotation = angle
  }
}

export function drawBaseTexture (config: BaseConfigType): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  const ctx    = canvas.getContext('2d')
  if (!ctx)
    throw new Error('Could not create 2D context')

  const width   = 1024
  const height  = 1024
  canvas.width  = width
  canvas.height = height

  switch (config.texturePreset) {
    case 'panels':
      drawPanelPattern(ctx, config.bodyColor, config.themeColors)
      break
    case 'carbon':
      drawCarbonPattern(ctx, config.bodyColor)
      break
    case 'hazard':
      drawHazardPattern(ctx, config.bodyColor)
      break
    case 'city':
      drawCityPattern(ctx, config.bodyColor)
      break
    case 'gallery':
      drawGalleryPattern(ctx, config.bodyColor)
      break
    case 'racing':
      drawRacingPattern(ctx, config.bodyColor, config.themeColors)
      break
    case 'splinter':
      drawSplinterPattern(ctx, config.bodyColor, config.themeColors)
      break
    case 'circuit':
      drawCircuitPattern(ctx, config.bodyColor, config.themeColors)
      break
    default:
      drawPlainPattern(ctx, config.bodyColor)
  }

  const texture      = new THREE.CanvasTexture(canvas)
  texture.wrapS      = THREE.RepeatWrapping
  texture.wrapT      = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  orientTexture(texture, config.textureRepeat, config.patternAngle)
  return markManagedTexture(texture)
}

type ThemeColorsType = { primary: string; secondary: string; accent: string }

function drawPanelPattern (
  ctx: CanvasRenderingContext2D,
  bodyColor: string,
  themeColors: ThemeColorsType
): void {
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.fillStyle = themeColors.accent
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      const x      = 60 + i * 120
      const y      = 60 + j * 120
      const width  = 100
      const height = 100

      if ((i + j) % 2 === 0)
        ctx.fillRect(x, y, width, height)
    }
}

function drawCarbonPattern (ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.strokeStyle = '#333333'
  ctx.lineWidth   = 2
  ctx.setLineDash([ 10, 10 ])

  for (let i = 0; i < 1024; i += 40) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i - 20, 1024)
    ctx.stroke()
  }

  ctx.setLineDash([ 20, 20 ])
  for (let i = 0; i < 1024; i += 20) {
    ctx.beginPath()
    ctx.moveTo(0, i)
    ctx.lineTo(1024, i - 10)
    ctx.stroke()
  }
}

function drawHazardPattern (ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.fillStyle = '#ff0000'
  ctx.fillRect(200, 200, 624, 624)

  ctx.fillStyle = '#00ff00'
  ctx.fillRect(100, 100, 824, 824)

  ctx.strokeStyle = '#ffff00'
  ctx.lineWidth   = 4
  ctx.beginPath()
  ctx.moveTo(512, 512)
  ctx.lineTo(200, 800)
  ctx.lineTo(824, 200)
  ctx.lineTo(512, 512)
  ctx.stroke()
}

function drawCityPattern (ctx: CanvasRenderingContext2D, bodyColor: string): void {
  const rng     = mulberry32(0x1ca405)
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.fillStyle = '#444444'
  for (let i = 0; i < 20; i++) {
    const x      = rng() * 1024
    const y      = rng() * 1024
    const width  = rng() * 40 + 10
    const height = rng() * 40 + 10
    ctx.fillRect(x, y, width, height)
  }
}

function drawGalleryPattern (ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.strokeStyle = '#666666'
  ctx.lineWidth   = 2

  for (let i = 0; i < 5; i++) {
    const x = 50 + i * 190
    const y = 50
    ctx.strokeRect(x, y, 150, 150)
  }

  for (let i = 0; i < 4; i++) {
    const x = 100
    const y = 50 + i * 190
    ctx.strokeRect(x, y, 200, 160)
  }
}

function drawPlainPattern (ctx: CanvasRenderingContext2D, bodyColor: string): void {
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)
}

/** Twin centre stripes with a thin trim outline — the classic race livery. */
function drawRacingPattern (
  ctx: CanvasRenderingContext2D,
  bodyColor: string,
  theme: ThemeColorsType
): void {
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  for (const x of [ 400, 560 ]) {
    ctx.fillStyle = theme.secondary
    ctx.fillRect(x, 0, 64, 1024)
    ctx.fillStyle = theme.accent
    ctx.fillRect(x - 8, 0, 8, 1024)
    ctx.fillRect(x + 64, 0, 8, 1024)
  }

  // Nose flash: a wedge across the front third.
  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.moveTo(0, 120)
  ctx.lineTo(1024, 40)
  ctx.lineTo(1024, 96)
  ctx.lineTo(0, 176)
  ctx.closePath()
  ctx.fill()
}

/** Angular splinter camo. Deterministic — a livery must not reshuffle on reload. */
function drawSplinterPattern (
  ctx: CanvasRenderingContext2D,
  bodyColor: string,
  theme: ThemeColorsType
): void {
  const rng     = mulberry32(0x5911e4)
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  const tones = [ theme.secondary, theme.accent, '#00000055' ]
  for (let i = 0; i < 46; i++) {
    const x       = rng() * 1024
    const y       = rng() * 1024
    const r       = 60 + rng() * 190
    ctx.fillStyle = tones[Math.floor(rng() * tones.length)]
    ctx.beginPath()
    for (let k = 0; k < 3 + Math.floor(rng() * 3); k++) {
      const a  = k / 5 * Math.PI * 2 + rng() * 0.9
      const rr = r * (0.4 + rng() * 0.6)
      const px = x + Math.cos(a) * rr
      const py = y + Math.sin(a) * rr
      if (k === 0)
        ctx.moveTo(px, py)
      else
        ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
  }
}

/** Circuit traces with solder pads. */
function drawCircuitPattern (
  ctx: CanvasRenderingContext2D,
  bodyColor: string,
  theme: ThemeColorsType
): void {
  const rng     = mulberry32(0xc1c17)
  ctx.fillStyle = bodyColor
  ctx.fillRect(0, 0, 1024, 1024)

  ctx.strokeStyle = theme.accent
  ctx.lineWidth   = 3
  ctx.lineCap     = 'square'

  for (let i = 0; i < 60; i++) {
    let x = Math.floor(rng() * 32) * 32
    let y = Math.floor(rng() * 32) * 32
    ctx.beginPath()
    ctx.moveTo(x, y)
    // Manhattan walk: the right-angle turns are what read as a circuit.
    for (let step = 0; step < 3 + Math.floor(rng() * 4); step++) {
      if (rng() > 0.5)
        x += (rng() > 0.5 ? 1 : -1) * 32 * (1 + Math.floor(rng() * 3))
      else
        y += (rng() > 0.5 ? 1 : -1) * 32 * (1 + Math.floor(rng() * 3))
      ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.fillStyle = theme.secondary
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, Math.PI * 2)
    ctx.fill()
  }
}

type EmissiveConfigType = {
  emissiveColor: string;
  texturePreset: ShipConfig['texturePreset'];
  paletteName:   ShipConfig['paletteName'];
  textureRepeat: number;
  patternAngle?: number;
}

export function drawEmissiveTexture (config: EmissiveConfigType): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  const ctx    = canvas.getContext('2d')
  if (!ctx)
    throw new Error('Could not create 2D context')

  const width   = 1024
  const height  = 1024
  canvas.width  = width
  canvas.height = height

  ctx.fillStyle = config.emissiveColor

  switch (config.texturePreset) {
    case 'panels':
      drawEmissivePanelPattern(ctx, config.emissiveColor)
      break
    case 'carbon':
      drawEmissiveCarbonPattern(ctx, config.emissiveColor)
      break
    case 'hazard':
      drawEmissiveHazardPattern(ctx, config.emissiveColor)
      break
    case 'city':
      drawEmissiveCityPattern(ctx, config.emissiveColor)
      break
    case 'gallery':
      drawEmissiveGalleryPattern(ctx, config.emissiveColor)
      break
    case 'racing':
      drawEmissiveRacingPattern(ctx, config.emissiveColor)
      break
    case 'splinter':
      drawEmissiveSplinterPattern(ctx, config.emissiveColor)
      break
    case 'circuit':
      drawEmissiveCircuitPattern(ctx, config.emissiveColor)
      break
    default:
      drawEmissivePlainPattern(ctx, config.emissiveColor)
  }

  const texture      = new THREE.CanvasTexture(canvas)
  texture.wrapS      = THREE.RepeatWrapping
  texture.wrapT      = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  orientTexture(texture, config.textureRepeat, config.patternAngle)
  return markManagedTexture(texture)
}

function drawEmissivePanelPattern (ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++)
      if ((i + j) % 2 === 0) {
        const x = 60 + i * 120
        const y = 60 + j * 120
        ctx.fillRect(x, y, 100, 100)
      }
  ctx.globalAlpha = 1.0
}

function drawEmissiveCarbonPattern (ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.7

  for (let i = 0; i < 1024; i += 40)
    ctx.fillRect(i, 0, 2, 1024)

  for (let i = 0; i < 1024; i += 20)
    ctx.fillRect(0, i, 1024, 2)
  ctx.globalAlpha = 1.0
}

function drawEmissiveHazardPattern (ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.6

  ctx.fillRect(200, 200, 624, 624)
  ctx.fillRect(100, 100, 824, 824)

  ctx.strokeStyle = color
  ctx.lineWidth   = 4
  ctx.beginPath()
  ctx.moveTo(512, 512)
  ctx.lineTo(200, 800)
  ctx.lineTo(824, 200)
  ctx.lineTo(512, 512)
  ctx.stroke()
  ctx.globalAlpha = 1.0
}

function drawEmissiveCityPattern (ctx: CanvasRenderingContext2D, color: string): void {
  const rng       = mulberry32(0x1ca406)
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.3

  for (let i = 0; i < 30; i++) {
    const x      = rng() * 1024
    const y      = rng() * 1024
    const radius = rng() * 30 + 5
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1.0
}

function drawEmissiveGalleryPattern (ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.4

  for (let i = 0; i < 5; i++) {
    const x = 50 + i * 190
    const y = 50
    ctx.fillRect(x, y, 150, 150)
  }

  for (let i = 0; i < 4; i++) {
    const x = 100
    const y = 50 + i * 190
    ctx.fillRect(x, y, 200, 160)
  }
  ctx.globalAlpha = 1.0
}

function drawEmissiveRacingPattern (ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.85
  for (const x of [ 392, 624 ])
    ctx.fillRect(x, 0, 8, 1024)
  ctx.globalAlpha = 1
}

function drawEmissiveSplinterPattern (ctx: CanvasRenderingContext2D, color: string): void {
  const rng       = mulberry32(0x5911e5)
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.5
  for (let i = 0; i < 22; i++) {
    const x = rng() * 1024
    const y = rng() * 1024
    ctx.fillRect(x, y, 6 + rng() * 40, 6)
  }
  ctx.globalAlpha = 1
}

function drawEmissiveCircuitPattern (ctx: CanvasRenderingContext2D, color: string): void {
  const rng       = mulberry32(0xc1c18)
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.75
  for (let i = 0; i < 120; i++) {
    const x = Math.floor(rng() * 32) * 32
    const y = Math.floor(rng() * 32) * 32
    ctx.beginPath()
    ctx.arc(x, y, 5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawEmissivePlainPattern (ctx: CanvasRenderingContext2D, color: string): void {
  ctx.fillStyle   = color
  ctx.globalAlpha = 0.5
  ctx.fillRect(0, 0, 1024, 1024)
  ctx.globalAlpha = 1.0
}

const HANGAR_TEXTURES: Record<string, string> = {
  details:                     '/textures/hangar/details.png',
  details_baseColor:           '/textures/hangar/details_baseColor.png',
  buildings_baseColor:         '/textures/hangar/buildings_baseColor.png',
  buildings_clearcoat:         '/textures/hangar/buildings_clearcoat.png',
  buildings_emissive:          '/textures/hangar/buildings_emissive.png',
  buildings_metallicRoughness: '/textures/hangar/buildings_metallicRoughness.png',
  buildings_normal:            '/textures/hangar/buildings_normal.png',
  background_buildings_normal: '/textures/hangar/Background_Night_Buildings_normal.png',
}

/** Non-colour maps (normal / roughness / clearcoat) must stay out of sRGB. */
const HANGAR_DATA_MAPS = new Set([
  'buildings_normal',
  'background_buildings_normal',
  'buildings_metallicRoughness',
  'buildings_clearcoat',
])

export function loadHangarTexture (name: string): THREE.Texture {
  const loader  = new TextureLoader()
  const path    = HANGAR_TEXTURES[name] || HANGAR_TEXTURES.details
  const texture = loader.load(path)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  if (!HANGAR_DATA_MAPS.has(name))
    texture.colorSpace = THREE.SRGBColorSpace
  return markManagedTexture(texture)
}

function markManagedTexture<T extends THREE.Texture> (texture: T): T {
  texture.userData.shipManagedTexture = true
  return texture
}


function replaceTexture (
  material: THREE.MeshStandardMaterial,
  slot: 'map' | 'emissiveMap' | 'normalMap',
  texture: THREE.Texture | null
): void {
  const current = material[slot]
  if (current && current !== texture && current.userData.shipManagedTexture)
    current.dispose()
  material[slot] = texture
}

export function applyShipConfig (gltfScene: THREE.Object3D, config: ShipConfig): void {
  const configuredMaterials = new Set<THREE.MeshStandardMaterial>()

  gltfScene.traverse(child => {
    if ('isMesh' in child && (child as { isMesh?: boolean }).isMesh) {
      const mesh = child as THREE.Mesh

      if (!mesh.material || Array.isArray(mesh.material) && mesh.material.length === 0)
        return

      const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]

      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial))
          continue
        if (configuredMaterials.has(material))
          continue
        configuredMaterials.add(material)

        const materialName = material.name.toLowerCase()

        const isGlow  = materialName.includes('glow')
        const isGlass = materialName.includes('glass')

        // Materials carrying real PBR maps (generated Icaras, the WipEout FBX liveries) keep
        // those maps: the sliders MODULATE the baked livery rather than replacing it, so
        // texturePreset/textureRepeat stay no-ops here and Feisar still looks like Feisar.
        if (material.userData.pbrTextured) {
          if (isGlow)
            material.emissiveIntensity = Math.max(1.2, config.emissiveIntensity * 3); else if (!isGlass) {
            // BASE_CONFIG.bodyColor is #ffffff, so the default tint is an identity multiply.
            material.color.set(config.bodyColor)
            // A metalnessMap/roughnessMap multiplies against the scalar, which is why Icaras
            // pins both to 1 — overwriting those would flatten its packed map.
            if (!material.metalnessMap)
              material.metalness = config.metalness
            if (!material.roughnessMap)
              material.roughness = config.roughness
            // Deliberately NOT applying emissiveColor/emissiveIntensity to a textured hull:
            // a full-body emissive wash is what the plain-material path does, but here it
            // floods the baked livery out of existence. The emissive controls drive the glow
            // bucket only — that's the whole point of keeping the livery.
          }
          // Glass keeps its own tuned metalness/roughness, but takes the trim
          // colour: on a baked hull it is the only surface the player can
          // recolour without washing the authored livery away.
          if (isGlass) {
            material.color.set(config.trimColor)
            material.emissive.set(config.trimColor)
          }
          material.envMapIntensity = config.gloss
          material.needsUpdate     = true
          continue
        }

        const receivesPattern = !isGlow && !isGlass

        material.color.set(isGlow ? '#05020a' : isGlass ? config.trimColor : config.bodyColor)
        material.metalness       = isGlass ? 0.4 : config.metalness
        material.roughness       = isGlass ? 0.15 : config.roughness
        material.envMapIntensity = config.gloss
        material.emissive.set(isGlass ? config.trimColor : config.emissiveColor)
        material.emissiveIntensity = isGlow
          ? Math.max(1.2, config.emissiveIntensity * 3)
          : config.emissiveIntensity

        if (config.texturePreset !== 'plain' && receivesPattern) {
          const patternTexture = drawBaseTexture({
            ...config,
            themeColors: {
              primary:   config.bodyColor,
              secondary: config.emissiveColor,
              accent:    config.trimColor,
            },
          })
          replaceTexture(material, 'map', patternTexture)

          if (config.emissiveIntensity > 0) {
            const emissivePatternTexture = drawEmissiveTexture(config)
            replaceTexture(material, 'emissiveMap', emissivePatternTexture)
          }
          else
            replaceTexture(material, 'emissiveMap', null)

          if (config.texturePreset === 'city' || config.texturePreset === 'gallery') {
            // These presets want surface relief, so use the actual tangent-space normal map —
            // the baseColor/details PNGs that used to land here are colour data, not normals.
            const hangarTexture = loadHangarTexture(
              config.texturePreset === 'city' ? 'buildings_normal' : 'background_buildings_normal'
            )
            replaceTexture(material, 'normalMap', hangarTexture)
            material.normalScale.set(config.platingDepth, config.platingDepth)
          }
          else
            replaceTexture(material, 'normalMap', null)
        }
        else {
          replaceTexture(material, 'map', null)
          replaceTexture(material, 'emissiveMap', null)
          replaceTexture(material, 'normalMap', null)
        }

        material.needsUpdate = true
      }
    }
  })
}

export const SHIP_MATERIALS = {
  drawBaseTexture,
  drawEmissiveTexture,
  loadHangarTexture,
  applyShipConfig,
  PALETTES,
}
