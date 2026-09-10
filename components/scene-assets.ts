'use client'

import { useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { KERB, ROAD } from '@/components/scene-utils'

/**
 * The CC0 low-poly pack, pulled into this project's palette.
 *
 * Every asset in the pack has the same shape: one mesh, one material, no
 * textures, and colour baked into a COLOR_0 vertex attribute. That last part
 * decides how retinting has to work.
 *
 * The pack's own colours are bright — orange apartment blocks, blue glass,
 * saturated green foliage — and dropping those into a dusk scene built around
 * one warm accent would wreck the palette discipline everything else obeys
 * (design.md section 3). But flattening each asset to a single colour would
 * throw away the vertex shading that separates a tree's trunk from its canopy,
 * or a road's asphalt from its markings.
 *
 * So vertex colours stay on and a tint is multiplied through them. The shading
 * survives; the hue lands in our range.
 */

export const ASSETS = {
  roadStraight: 'road-straight-01',
  roadCorner: 'road-corner-01',
  roadT: 'road-t-01',
  roadIntersection: 'road-intersection-01',
  sidewalk: 'sidewalk-01',
  grassVerge: 'grass-verge-01',
  plazaPaving: 'plaza-paving-01',
  leafLawn: 'autumn-leaf-lawn-tile-01',
  streetTree: 'street-tree-01',
  appleTree: 'apple-tree',
  conifer: 'arborvitae-conifer',
  bareTree: 'bare-tree-01',
  bench: 'bench-01',
  planter: 'flower-planter-01',
  streetLamp: 'street-lamp-01',
  car: 'car-sedan-01',
  apartment: 'apartment-block-01',
  skyscraper: 'glass-skyscraper-01',
  supertall: 'glass-supertall-01',
} as const

export type AssetName = keyof typeof ASSETS

/** Ground tiles in the pack are all exactly 4.00 x 4.00. */
export const TILE = 4

/**
 * How far each ground tile's walking surface sits above y=0.
 *
 * The tiles are not flat and they are not all the same depth — the pack builds
 * its kerbs by making the pavement stand taller than the carriageway. Since
 * every asset is ground-aligned, a tile placed at y=0 puts its *surface* this
 * far up, and anything else placed at y=0 stands below it.
 *
 * Tall things get away with it. Short things do not: the forecourt's gap
 * marker is 0.09 high and vanished completely beneath 0.53 of plaza paving.
 * Measured from the GLB bounding boxes; single source so nothing re-guesses.
 */
export const SURFACE_TOP = {
  road: 0.28,
  sidewalk: 0.48,
  plaza: 0.53,
  grass: 0.84,
} as const

const url = (name: AssetName) => `/models/${ASSETS[name]}.glb`

/**
 * Multiplier applied over each asset's vertex colours.
 *
 * Values below 1 darken. Foliage keeps a little more green than the buildings
 * so the planting still reads as planting at dusk; the skyline is crushed hard
 * because it is meant to be a silhouette, not a place.
 */
const TINT: Record<AssetName, string> = {
  roadStraight: ROAD,
  roadCorner: ROAD,
  roadT: ROAD,
  roadIntersection: ROAD,
  sidewalk: KERB,
  grassVerge: '#33452f',
  plazaPaving: KERB,
  leafLawn: '#3a4436',
  streetTree: '#4f6b48',
  appleTree: '#52704a',
  conifer: '#425c3e',
  bareTree: '#5a5348',
  bench: KERB,
  planter: '#4f6b48',
  streetLamp: KERB,
  // Lifted well above the other street furniture: a parked car sat at the
  // same value as the kerb and simply disappeared into the road.
  car: '#7d8ba6',
  apartment: '#2f3d52',
  skyscraper: '#2b3748',
  supertall: '#293446',
}

/** Cache keyed by asset so the retint runs once per asset, not per placement. */
const retinted = new Map<AssetName, THREE.BufferGeometry>()
const materials = new Map<AssetName, THREE.MeshStandardMaterial>()

function extract(scene: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null
  scene.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) found = child as THREE.Mesh
  })
  return found
}

export interface SceneAsset {
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
}

/**
 * Geometry and a retinted material for one asset, both shared across every
 * placement so instancing has something to instance.
 */
export function useSceneAsset(name: AssetName): SceneAsset | null {
  const gltf = useGLTF(url(name))

  return useMemo(() => {
    const cachedGeometry = retinted.get(name)
    const cachedMaterial = materials.get(name)
    if (cachedGeometry && cachedMaterial) {
      return { geometry: cachedGeometry, material: cachedMaterial }
    }

    const mesh = extract(gltf.scene)
    if (!mesh) return null

    // Bake the node transform in once so callers can position by the grid
    // rather than by trial.
    const geometry = mesh.geometry.clone()
    mesh.updateWorldMatrix(true, false)
    geometry.applyMatrix4(mesh.matrixWorld)

    // Then sit the asset on the ground.
    //
    // Every node in this pack is translated by exactly minus half its own
    // height, which centres the mesh on the origin. Baking that transform and
    // placing at y=0 therefore buried half of everything: the cars and benches
    // were entirely under the road, the street lamps lost half their poles, and
    // the food bank sat 3.8 units into the ground. Dropping the bounding box to
    // zero makes "position at y=0" mean "resting on the ground", which is what
    // every caller already assumed.
    geometry.computeBoundingBox()
    const minY = geometry.boundingBox?.min.y ?? 0
    if (minY !== 0) geometry.translate(0, -minY, 0)

    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      // Multiplied through the vertex colours, so the tint sets the hue while
      // the pack's own shading still separates trunk from canopy, asphalt from
      // markings. 1.35 keeps it dark enough for dusk without going muddy.
      color: new THREE.Color(TINT[name]).multiplyScalar(1.35),
      roughness: 1,
      metalness: 0,
      flatShading: true,
    })

    retinted.set(name, geometry)
    materials.set(name, material)
    return { geometry, material }
  }, [gltf, name])
}

/** Warm every asset before first paint so nothing pops in mid-demo. */
export function preloadSceneAssets(): void {
  for (const name of Object.keys(ASSETS) as AssetName[]) useGLTF.preload(url(name))
}
