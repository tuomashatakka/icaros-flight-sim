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

function loadTex (
  url: string,
  srgb: boolean,
  onLoad?: (texture: THREE.Texture) => void
): THREE.Texture {
  const t = new THREE.TextureLoader().load(url, onLoad)
  // No flipY override here: that's the glTF convention (see icaras-generated.ts, whose mesh
  // inherits glTF UVs). FBX authors UVs bottom-left-origin, which three's default handles.
  // These atlases are deliberately tiled — measured UVs run u[-0.399, 2.009], v[-0.058, 2.194],
  // so the default ClampToEdgeWrapping would smear the atlas border across the hull.
  t.wrapS      = THREE.RepeatWrapping
  t.wrapT      = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb)
    t.colorSpace = THREE.SRGBColorSpace
  t.userData.shipManagedTexture = true
  return t
}

/**
 * Builds an alpha mask from a loaded colour atlas so the black regions of the glass and
 * glow sheets cut out instead of rendering as opaque slabs. The per-ship `* glass A.jpg` /
 * `Lights_GLOW A.jpg` companions never made it into the repo, and three samples `alphaMap`
 * from the GREEN channel only — useless for the red canopies (qirex/ag-systems/egx all
 * measure an average green of ~0.1), so we flatten luminance into every channel.
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

// Fresh material set per ship object — textures are owned by the object so
// disposeShipObject() can free them without touching another ship's maps.
function buildLiveryMaterials (textureBase: string): LiverySet {
  const tex = (slot: string, srgb = true) => loadTex(`${textureBase}/${slot}.jpg`, srgb)

  // The hangar mounts an Environment, so clearcoat + envMapIntensity are live here.
  // metalness/roughness are only seed values — applyShipConfig() drives them from the
  // registry defaults (WIPEOUT_LOOK) and then from the hangar sliders.
  const body = new THREE.MeshPhysicalMaterial({
    map:                tex('body'),
    normalMap:          loadTex('/tex/norm.webp', false),
    metalness:          0.45,
    roughness:          0.52,
    clearcoat:          0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity:    0.8,
    side:               THREE.DoubleSide,
  })
  const cockpit = new THREE.MeshStandardMaterial({
    map:       tex('cockpit'),
    metalness: 0.3,
    roughness: 0.5,
    side:      THREE.DoubleSide,
  })
  // Glass + glow get no flat opacity: the derived alpha mask drives per-pixel translucency,
  // so a tinted canopy panel reads as glass while the empty atlas gutters vanish entirely.
  const glass = new THREE.MeshPhysicalMaterial({
    metalness:    0.25,
    roughness:    0.14,
    transmission: 0.12,
    transparent:  true,
    alphaTest:    0.02,
    side:         THREE.DoubleSide,
  })
  glass.map = loadTex(`${textureBase}/glass.jpg`, true, loaded => {
    glass.alphaMap    = deriveAlphaMask(loaded)
    glass.needsUpdate = true
  })

  const glow = new THREE.MeshStandardMaterial({
    emissiveMap:       tex('glow_e'),
    emissive:          new THREE.Color(0xffffff),
    emissiveIntensity: 1.9,
    transparent:       true,
    alphaTest:         0.02,
    side:              THREE.DoubleSide,
  })
  glow.map = loadTex(`${textureBase}/glow.jpg`, true, loaded => {
    glow.alphaMap    = deriveAlphaMask(loaded)
    glow.needsUpdate = true
  })

  // Holds array slots whose source material isn't one of our buckets, so that
  // geometry.groups[].materialIndex keeps resolving to the right entry.
  const hidden = new THREE.MeshBasicMaterial({ visible: false })

  const mats: LiverySet = { Body: body, Cockpit: cockpit, Glass: glass, Glow: glow, Hidden: hidden };
  // Tag as PBR-textured + keep the bucket name so applyShipConfig() preserves the baked
  // livery (modulating only colour/metalness/roughness/emissive, never the maps) and the
  // boost-glow pulse still finds 'Glow'.
  (Object.entries(mats) as [keyof LiverySet, THREE.Material][]).forEach(([ name, m ]) => {
    m.name                 = name
    m.userData.pbrTextured = true
  })
  return mats
}

/**
 * Clones a loaded FBX scene, drops the podium/jet props, and re-skins every kept
 * mesh with its bucket's livery material. The result is fed straight into the shared
 * <FittedShip> (recenter + normalize-to-targetSize + applyShipConfig), same as GLTF.
 */
export function buildImportedShipObject (
  fbxScene: THREE.Object3D,
  textureBase: string
): THREE.Object3D {
  const root                   = fbxScene.clone(true)
  const mats                   = buildLiveryMaterials(textureBase)
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
