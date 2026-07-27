import * as THREE from 'three';

/**
 * Afterburner — crossed additive beam planes plus a nozzle flare, per engine.
 *
 * Ported from the `armada-forge` prototype's `buildBurner`/`placeFX`. Two facts
 * about that original are worth keeping in mind:
 *
 * 1. The beams are NOT particles in the emitter sense. Two camera-agnostic
 *    quads crossed at 90° around the thrust axis read as a volumetric plume from
 *    any angle for the cost of four triangles, and — unlike a sprite — they stay
 *    correctly foreshortened when you look straight down the nozzle.
 * 2. Everything is `AdditiveBlending` + `depthWrite: false`. Additive is what
 *    makes overlapping beams bloom instead of muddying, and writing depth would
 *    let the transparent quads occlude each other.
 */

function makeGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBeamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Along the beam: hot at the nozzle, fading out to nothing at the tail.
  const along = ctx.createLinearGradient(0, 0, 0, 256);
  // Note the modest peak: the material is ADDITIVE and then goes through bloom,
  // so a near-opaque core saturates to white and blooms into a blob that eats
  // the ship whenever the camera looks down the exhaust.
  along.addColorStop(0, 'rgba(255,255,255,0.7)');
  along.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  along.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = along;
  ctx.fillRect(0, 0, 64, 256);

  // Across the beam: erase the edges so the quad has no visible silhouette.
  // `destination-out` is doing the work here — a plain dark gradient would go
  // grey rather than transparent, and under additive blending grey still adds.
  const across = ctx.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(0,0,0,0.9)');
  across.addColorStop(0.5, 'rgba(0,0,0,0)');
  across.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 64, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Both textures are procedural, identical for every ship, and immutable — so
 * they are module-level singletons rather than per-instance. Deliberately never
 * disposed: an afterburner instance must not free a texture the next one needs.
 * They are two small canvases, created lazily so this module stays importable
 * from a non-DOM context (the vitest geometry suite pulls in the level code).
 */
let sharedFlareTexture: THREE.CanvasTexture | null = null;
let sharedBeamTexture: THREE.CanvasTexture | null = null;

/** Beam quad: a unit plane rebased to span z 0 → -1, with its width along x. */
function beamGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, -0.5, 0);
  // Single-axis rotation on the GEOMETRY, not an Euler on the mesh: the crossed
  // pair below then needs only one more single-axis spin, so there is no
  // rotation-order subtlety to get wrong.
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export interface Nozzle {
  position: THREE.Vector3;
  radius: number;
}

/** Minimum cluster size before a side is considered a real engine. */
const MIN_CLUSTER = 6;

/** Vertices of `mesh` that belong to a material whose name reads as engine glow. */
function glowVertexMask(mesh: THREE.Mesh): Uint8Array | null {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const glowSlots = new Set<number>();
  materials.forEach((material, slot) => {
    if (material && /glow/i.test(material.name)) glowSlots.add(slot);
  });
  if (!glowSlots.size) return null;

  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  const mask = new Uint8Array(position.count);
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: index ? index.count : position.count, materialIndex: 0 }];

  for (const group of groups) {
    if (!glowSlots.has(group.materialIndex ?? 0)) continue;
    const end = group.start + group.count;
    for (let i = group.start; i < end; i++) {
      const vertex = index ? index.getX(i) : i;
      if (vertex < mask.length) mask[vertex] = 1;
    }
  }
  return mask;
}

/**
 * Locate the engine nozzles on an arbitrary hull.
 *
 * The prototype knew where its engines were because it generated them. These
 * hulls are scanned meshes, so the exhausts have to be inferred, and the two
 * obvious geometric reads both fail on this planform:
 *
 * - the tail slab's WIDTH is the wingspan, because a delta's trailing edge is
 *   as far back as its engines — beams end up out on the tips;
 * - the tail slab's THICKNESS peaks on the fuselage, which is deeper than the
 *   pods — beams collapse onto the centreline.
 *
 * So prefer the hull's own annotation: the WipEout scans carry a material
 * literally named `Glow` on the engine intakes and exhausts. Restricted to the
 * tail slab, the centroid of those vertices either side of the axis IS the
 * nozzle. Hulls without that material (the glTF racer, the generated Icaras)
 * fall back to the centroid of all tail vertices, which lands about halfway out
 * along the tail — close enough to correct by eye with `spread`.
 */
export function deriveNozzles(
  object: THREE.Object3D,
  /** Multiplier on the detected pod offset — 1 is "where the hull says they are". */
  spread: number,
  /**
   * Node whose local space the returned nozzles are expressed in — normally the
   * hull's parent, because that is where the burner group gets added. This must
   * be explicit: `object` itself carries the fit scale, so measuring in its
   * local space while comparing against a world-space bounding box silently
   * yields an empty tail slab and collapses every ship to one central engine.
   */
  frame: THREE.Object3D = object.parent ?? object
): Nozzle[] {
  object.updateWorldMatrix(true, true);
  frame.updateWorldMatrix(true, false);
  const inverse = new THREE.Matrix4().copy(frame.matrixWorld).invert();

  const box = new THREE.Box3().setFromObject(object).applyMatrix4(inverse);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  // How deep a slice counts as "the tail". The nose points +z, so that is min z.
  const cutoff = box.min.z + size.z * 0.12;

  const glow: number[] = [];
  const any: number[] = [];
  const vertex = new THREE.Vector3();
  const toLocal = new THREE.Matrix4();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry?.getAttribute('position');
    if (!position) return;
    const mask = glowVertexMask(mesh);
    toLocal.multiplyMatrices(inverse, mesh.matrixWorld);
    for (let i = 0; i < position.count; i++) {
      vertex.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(toLocal);
      if (vertex.z > cutoff) continue;
      any.push(vertex.x, vertex.y);
      if (mask?.[i]) glow.push(vertex.x, vertex.y);
    }
  });

  // Nudge the origin a hair INSIDE the hull so the flare never floats detached
  // behind a nozzle that is itself slightly recessed.
  const z = box.min.z + size.z * 0.02;
  const single = (radius: number): Nozzle[] => [
    { position: new THREE.Vector3(center.x, center.y, z), radius },
  ];

  // Degenerate hull, or a mesh with no readable positions.
  if (!any.length) return single(maxDim * 0.09);

  const source = glow.length >= MIN_CLUSTER * 2 ? glow : any;

  /** Centroid and x-spread of the source points on one side of the axis. */
  function cluster(sign: number) {
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let count = 0;
    for (let i = 0; i < source.length; i += 2) {
      const x = source[i] - center.x;
      if (Math.sign(x) !== sign) continue;
      sumX += x;
      sumY += source[i + 1];
      sumXX += x * x;
      count++;
    }
    if (!count) return null;
    const meanX = sumX / count;
    return {
      count,
      x: meanX,
      y: sumY / count,
      // Standard deviation about the cluster's own centre — a proxy for pod width.
      spreadX: Math.sqrt(Math.max(0, sumXX / count - meanX * meanX)),
    };
  }

  const left = cluster(-1);
  const right = cluster(1);

  // A hull with usable geometry on only one side of the axis has one engine.
  if (!left || !right || left.count < MIN_CLUSTER || right.count < MIN_CLUSTER) {
    return single(maxDim * 0.06);
  }

  const radius = Math.max(maxDim * 0.045, ((left.spreadX + right.spreadX) / 2) * 1.6);

  return [
    { position: new THREE.Vector3(center.x + left.x * spread, left.y, z), radius },
    { position: new THREE.Vector3(center.x + right.x * spread, right.y, z), radius },
  ];
}

export interface BurnerTuning {
  /** Beam brightness/size multiplier. 0 kills the effect entirely. */
  burnIntensity: number;
  /** Beam length as a multiple of the nozzle radius. */
  burnLength: number;
}

export interface Afterburner {
  /** Add this to the ship root — nozzle coordinates are in root-local space. */
  group: THREE.Group;
  /** Re-place the beams, e.g. after a nozzle-spread change. */
  setNozzles(nozzles: Nozzle[]): void;
  setColor(color: THREE.ColorRepresentation): void;
  setTuning(tuning: Partial<BurnerTuning>): void;
  /** Target burn level, 0..1 — throttle in the race, a toggle in the hangar. */
  setThrottle(throttle: number): void;
  /** Call once per rendered frame with the real (not fixed-step) delta. */
  update(delta: number, elapsed: number): void;
  dispose(): void;
}

/** Seconds for the plume to travel most of the way to a new throttle level. */
const SPOOL_HALF_LIFE = 0.09;

export function createAfterburner(
  tuning: BurnerTuning = { burnIntensity: 1, burnLength: 1 },
  color: THREE.ColorRepresentation = '#7a5cff'
): Afterburner {
  sharedFlareTexture ??= makeGlowTexture();
  sharedBeamTexture ??= makeBeamTexture();

  const group = new THREE.Group();
  group.name = 'afterburner';

  const geometry = beamGeometry();
  const beamMaterial = new THREE.MeshBasicMaterial({
    map: sharedBeamTexture,
    color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const flareMaterial = new THREE.SpriteMaterial({
    map: sharedFlareTexture,
    color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  type Emitter = { beam: THREE.Group; flare: THREE.Sprite; light: THREE.PointLight; radius: number };
  let emitters: Emitter[] = [];

  const current = { ...tuning };
  let target = 0;
  let level = 0;

  function clearEmitters() {
    for (const emitter of emitters) {
      emitter.beam.removeFromParent();
      emitter.flare.removeFromParent();
      emitter.light.removeFromParent();
      emitter.light.dispose();
    }
    emitters = [];
  }

  function setNozzles(nozzles: Nozzle[]) {
    clearEmitters();
    for (const nozzle of nozzles) {
      const beam = new THREE.Group();
      for (const roll of [0, Math.PI / 2]) {
        const quad = new THREE.Mesh(geometry, beamMaterial);
        quad.rotation.z = roll; // crossed about the thrust axis
        beam.add(quad);
      }
      beam.position.copy(nozzle.position);

      const flare = new THREE.Sprite(flareMaterial);
      flare.position.copy(nozzle.position);

      // A real light so the plume actually spills onto the hull and the track.
      //
      // Sat BEHIND the nozzle, not on it: with decay 2 a light sitting inside
      // the tail is metres from the hull it is lighting and washes the whole
      // ship white. Distance is capped for the same reason it is kept dim —
      // this is a glow, not a headlight, and an unbounded point light on a ship
      // crossing a 400-unit deck costs shading on geometry it can never reach.
      const light = new THREE.PointLight(color, 0, nozzle.radius * 16, 2);
      light.position.copy(nozzle.position);
      light.position.z -= nozzle.radius * 2.5;

      group.add(beam, flare, light);
      emitters.push({ beam, flare, light, radius: nozzle.radius });
    }
  }

  return {
    group,
    setNozzles,

    setColor(next) {
      beamMaterial.color.set(next);
      flareMaterial.color.set(next);
      for (const emitter of emitters) emitter.light.color.set(next);
    },

    setTuning(next) {
      Object.assign(current, next);
    },

    setThrottle(throttle) {
      target = Math.max(0, Math.min(1, throttle));
    },

    update(delta, elapsed) {
      // Exponential spool toward the target — an instant cut looks like a bug,
      // and a linear ramp overshoots on the stutter of a tapped throttle.
      const k = 1 - Math.pow(0.5, delta / SPOOL_HALF_LIFE);
      level += (target - level) * k;

      // Two detuned sines instead of noise: the flicker has to be deterministic
      // (this scene is seeded and replayable) and cheap enough to run per frame.
      const flicker = 1 + 0.09 * Math.sin(elapsed * 37) + 0.05 * Math.sin(elapsed * 19.3);
      const burn = level * current.burnIntensity * flicker;

      for (const emitter of emitters) {
        const length = emitter.radius * 7 * current.burnLength * (0.55 + level * 0.45);
        emitter.beam.scale.set(emitter.radius * 1.9, emitter.radius * 1.9, length);
        emitter.flare.scale.setScalar(emitter.radius * 2.3 * (0.6 + burn * 0.4) * level);
        emitter.light.intensity = burn * emitter.radius * 3;

        const visible = burn > 0.01;
        emitter.beam.visible = visible;
        emitter.flare.visible = visible;
        emitter.light.visible = visible;
      }

      beamMaterial.opacity = 0.55 * Math.min(1, burn);
      flareMaterial.opacity = 0.6 * Math.min(1, burn);
    },

    dispose() {
      clearEmitters();
      group.removeFromParent();
      geometry.dispose();
      beamMaterial.dispose();
      flareMaterial.dispose();
      // The canvas textures are shared singletons — see the note above.
    },
  };
}
