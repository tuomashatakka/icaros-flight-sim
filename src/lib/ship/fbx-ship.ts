"use client"

import * as THREE from 'three';

// Faithful port of wipeout-icaras' normalizeImportedScene + buildImportedMaterials.
// The WipEout team scans are FBX with baked absolute Windows texture paths that 404
// at runtime, so we (1) block those fetches with a blank-texture LoadingManager and
// (2) re-skin every hull from our own normalized livery under /ships/<id>/.

const BLANK_GIF =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** Rewrites any image URL an FBX asks for to a 1×1 GIF — embedded textures are unused. */
export const blankTexManager = new THREE.LoadingManager();
blankTexManager.setURLModifier((url) =>
  /\.(jpe?g|png|tga|tif|bmp|gif|webp)$/i.test(url) ? BLANK_GIF : url
);

// Material-name buckets. Base (podium) + Boost (jet-blast) props are intentionally dropped.
type Bucket = 'Body' | 'Cockpit' | 'Glass' | 'Glow';
const KEEP: ReadonlySet<string> = new Set<Bucket>(['Body', 'Cockpit', 'Glass', 'Glow']);

const FBX_FLIP_Y = false; // FBX authored UVs are not V-flipped; three's default would invert them.

function loadTex(url: string, srgb: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.flipY = FBX_FLIP_Y;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.shipManagedTexture = true;
  return t;
}

// Fresh material set per ship object — textures are owned by the object so
// disposeShipObject() can free them without touching another ship's maps.
function buildLiveryMaterials(textureBase: string): Record<Bucket, THREE.Material> {
  const tex = (slot: string, srgb = true) => loadTex(`${textureBase}/${slot}.jpg`, srgb);

  // No scene env map, so keep metalness low or metallic faces read near-black;
  // the livery comes from the diffuse map under direct lights.
  const body = new THREE.MeshPhysicalMaterial({
    map: tex('body'),
    normalMap: loadTex('/tex/norm.webp', false),
    metalness: 0.18,
    roughness: 0.52,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.8,
    side: THREE.DoubleSide,
  });
  const cockpit = new THREE.MeshStandardMaterial({
    map: tex('cockpit'),
    metalness: 0.3,
    roughness: 0.5,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    map: tex('glass'),
    metalness: 0.25,
    roughness: 0.14,
    transmission: 0.12,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.MeshStandardMaterial({
    map: tex('glow'),
    emissiveMap: tex('glow_e'),
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 1.9,
    side: THREE.DoubleSide,
  });

  const mats = { Body: body, Cockpit: cockpit, Glass: glass, Glow: glow };
  // Tag as PBR-textured + keep the bucket name so applyShipConfig() preserves the
  // baked livery (only pulsing Glow) and the boost-glow pulse still finds 'Glow'.
  (Object.entries(mats) as [Bucket, THREE.Material][]).forEach(([name, m]) => {
    m.name = name;
    m.userData.pbrTextured = true;
  });
  return mats;
}

function bucketOf(mesh: THREE.Mesh): Bucket | null {
  const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const name = mat?.name ?? '';
  return KEEP.has(name) ? (name as Bucket) : null;
}

/**
 * Clones a loaded FBX scene, drops the podium/jet props, and re-skins every kept
 * mesh with its bucket's livery material. The result is fed straight into the shared
 * <FittedShip> (recenter + normalize-to-targetSize + applyShipConfig), same as GLTF.
 */
export function buildImportedShipObject(
  fbxScene: THREE.Object3D,
  textureBase: string
): THREE.Object3D {
  const root = fbxScene.clone(true);
  const mats = buildLiveryMaterials(textureBase);
  const drop: THREE.Object3D[] = [];

  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const bucket = bucketOf(mesh);
    if (!bucket) {
      drop.push(mesh); // Base podium / Boost jet-blast
      return;
    }
    mesh.geometry = mesh.geometry.clone();
    mesh.material = mats[bucket];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });

  for (const node of drop) node.parent?.remove(node);
  return root;
}
