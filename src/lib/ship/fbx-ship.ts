'use client'

import * as THREE from 'three'

// Faithful port of wipeout-icaras' normalizeImportedScene + buildImportedMaterials.
// The WipEout team scans are FBX with baked absolute Windows texture paths that 404
// at runtime, so we (1) block those fetches with a blank-texture LoadingManager and
// (2) re-skin every hull from our own normalized livery under /ships/<id>/.

const BLANK_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

/** Rewrites any image URL an FBX asks for to a 1×1 GIF — embedded textures are unused. */
export const blankTexManager = new THREE.LoadingManager()
blankTexManager.setURLModifier(url =>
  (/\.(jpe?g|png|tga|tif|bmp|gif|webp)$/i).test(url) ? BLANK_GIF : url
)

// Material-name buckets. Base (podium) + Boost (jet-blast) props are intentionally dropped.
type Bucket = 'Body' | 'Cockpit' | 'Glass' | 'Glow'

const KEEP: ReadonlySet<string> = new Set<Bucket>([ 'Body', 'Cockpit', 'Glass', 'Glow' ])

/** Bucket materials plus the filler that holds unclaimed slots in a multi-material array. */
type LiverySet = Record<Bucket, THREE.Material> & { Hidden: THREE.Material }

async function loadTexAsync (url: string, srgb: boolean): Promise<THREE.Texture> {
  const loader = new THREE.TextureLoader()
  try {
    const t = await loader.loadAsync(url)
    t.wrapS      = THREE.RepeatWrapping
    t.wrapT      = THREE.RepeatWrapping
    t.anisotropy = 8
    if (srgb)
      t.colorSpace = THREE.SRGBColorSpace
    t.userData.shipManagedTexture = true
    return t
  }
  catch (err) {
    console.warn(`[loadTexAsync] failed to load ${url}`, err)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const t = new THREE.CanvasTexture(canvas)
    t.userData.shipManagedTexture = true
    return t
  }
}

/**
 * Builds an alpha mask from a loaded colour atlas so the black regions of the glass and
 * glow sheets cut out instead of rendering as opaque slabs.
 */
function deriveAlphaMask (source: THREE.Texture): THREE.CanvasTexture | null {
  if (typeof document === 'undefined')
    return null

  const image = source.image as HTMLImageElement & { width: number; height: number } | undefined
  if (!image?.width || !image.height)
    return null

  const canvas  = document.createElement('canvas')
  canvas.width  = image.width
  canvas.height = image.height

  const ctx     = canvas.getContext('2d')
  if (!ctx)
    return null

  ctx.drawImage(image, 0, 0)

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data   = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    const luminance = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    data[i]         = data[i + 1] = data[i + 2] = luminance
  }
  ctx.putImageData(pixels, 0, 0)

  const mask                       = new THREE.CanvasTexture(canvas)
  mask.wrapS                       = THREE.RepeatWrapping
  mask.wrapT                       = THREE.RepeatWrapping
  mask.colorSpace                  = THREE.NoColorSpace
  mask.anisotropy                  = 8
  mask.userData.shipManagedTexture = true
  return mask
}

// Fresh material set per ship object — textures are fully loaded asynchronously
// so the initial render is complete and causes zero shader recompilation flashing.
async function buildLiveryMaterials (textureBase: string): Promise<LiverySet> {
  const [ bodyTex, normTex, cockpitTex, glassTex, glowETex, glowTex ] = await Promise.all([
    loadTexAsync(`${textureBase}/body.jpg`, true),
    loadTexAsync('/tex/norm.webp', false),
    loadTexAsync(`${textureBase}/cockpit.jpg`, true),
    loadTexAsync(`${textureBase}/glass.jpg`, true),
    loadTexAsync(`${textureBase}/glow_e.jpg`, true),
    loadTexAsync(`${textureBase}/glow.jpg`, true),
  ])

  const body = new THREE.MeshPhysicalMaterial({
    map:                bodyTex,
    normalMap:          normTex,
    metalness:          0.45,
    roughness:          0.52,
    clearcoat:          0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity:    0.8,
    side:               THREE.DoubleSide,
  })
  const cockpit = new THREE.MeshStandardMaterial({
    map:       cockpitTex,
    metalness: 0.3,
    roughness: 0.5,
    side:      THREE.DoubleSide,
  })

  const glass = new THREE.MeshPhysicalMaterial({
    map:          glassTex,
    alphaMap:     deriveAlphaMask(glassTex) ?? undefined,
    metalness:    0.25,
    roughness:    0.14,
    transmission: 0.12,
    transparent:  true,
    alphaTest:    0.02,
    side:         THREE.DoubleSide,
  })

  const glow = new THREE.MeshStandardMaterial({
    map:               glowTex,
    emissiveMap:       glowETex,
    alphaMap:          deriveAlphaMask(glowTex) ?? undefined,
    emissive:          new THREE.Color(0xffffff),
    emissiveIntensity: 1.9,
    transparent:       true,
    alphaTest:         0.02,
    side:              THREE.DoubleSide,
  })

  const hidden = new THREE.MeshBasicMaterial({ visible: false })

  const mats: LiverySet = { Body: body, Cockpit: cockpit, Glass: glass, Glow: glow, Hidden: hidden };
  (Object.entries(mats) as [keyof LiverySet, THREE.Material][]).forEach(([ name, m ]) => {
    m.name                 = name
    m.userData.pbrTextured = true
  })
  return mats
}

/**
 * Clones a loaded FBX scene, drops the podium/jet props, and re-skins every kept
 * mesh with its bucket's livery material.
 */
export async function buildImportedShipObject (
  fbxScene: THREE.Object3D,
  textureBase: string
): Promise<THREE.Object3D> {
  const root                   = fbxScene.clone(true)
  const mats                   = await buildLiveryMaterials(textureBase)
  const drop: THREE.Object3D[] = []

  root.traverse(child => {
    if (!(child as THREE.Mesh).isMesh)
      return

    const mesh = child as THREE.Mesh

    // Each hull is ONE mesh carrying a 4-material array (order varies per ship: feisar is
    // [Body, Glow, Cockpit, Glass], ag-systems [Glow, Body, ...]) plus 5-29 geometry groups.
    // Remap slot-by-slot so every group keeps hitting its own bucket — collapsing this to a
    // single material paints the whole hull with whatever landed at index 0.
    const source = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
    const mapped = source.map(m => m && KEEP.has(m.name) ? mats[m.name as Bucket] : null)
    if (mapped.every(m => !m)) {
      drop.push(mesh) // Base podium / Boost jet-blast
      return
    }

    mesh.geometry = mesh.geometry.clone()
    mesh.material =
      source.length === 1 ? mapped[0]! : mapped.map(m => m ?? mats.Hidden)
    mesh.castShadow    = true
    mesh.receiveShadow = true
  })

  for (const node of drop)
    node.parent?.remove(node)
  return root
}
