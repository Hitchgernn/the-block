import { KERB, MARKING, ROAD } from '@/components/scene-utils'

interface StreetProps {
  width: number
  depth: number
  road: { x: number; z: number }
}

const SURFACE = 1.3
const KERB_WIDTH = 0.14
const DASH = 0.5
const DASH_GAP = 0.62

/** Evenly spaced dashes along a centre line, centred on zero. */
function dashes(span: number): number[] {
  const step = DASH + DASH_GAP
  const count = Math.max(0, Math.floor(span / step))
  const start = -((count - 1) * step) / 2
  return Array.from({ length: count }, (_, i) => start + i * step)
}

/**
 * The roads themselves, plus the detail that makes them read as streets rather
 * than as gaps between lots: kerbs, centre dashes, and lamp posts.
 *
 * The posts are unlit on purpose. design.md section 3 reserves --lamp for one
 * meaning — someone showed up — so street lighting that glowed would make the
 * scene unreadable at exactly the moment it matters.
 */
export default function Street({ width, depth, road }: StreetProps) {
  const alongZ = depth + 14
  const alongX = width + 14
  const kerbOffset = SURFACE / 2 + KERB_WIDTH / 2

  return (
    <group>
      {/* Carriageways */}
      <mesh rotation-x={-Math.PI / 2} position={[road.x, 0.015, 0]}>
        <planeGeometry args={[SURFACE, alongZ]} />
        <meshStandardMaterial color={ROAD} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, road.z]}>
        <planeGeometry args={[alongX, SURFACE]} />
        <meshStandardMaterial color={ROAD} roughness={1} />
      </mesh>

      {/* The avenue in front of the block, running past the food bank. */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0.015, -depth / 2 - 1.5]}
      >
        <planeGeometry args={[alongX, SURFACE]} />
        <meshStandardMaterial color={ROAD} roughness={1} />
      </mesh>

      {/* Kerbs */}
      {[-kerbOffset, kerbOffset].map((offset) => (
        <mesh key={`kx${offset}`} position={[road.x + offset, 0.05, 0]}>
          <boxGeometry args={[KERB_WIDTH, 0.1, alongZ]} />
          <meshStandardMaterial color={KERB} roughness={1} />
        </mesh>
      ))}
      {[-kerbOffset, kerbOffset].map((offset) => (
        <mesh key={`kz${offset}`} position={[0, 0.05, road.z + offset]}>
          <boxGeometry args={[alongX, 0.1, KERB_WIDTH]} />
          <meshStandardMaterial color={KERB} roughness={1} />
        </mesh>
      ))}

      {/* Centre dashes. Skipped near the junction so it stays legible. */}
      {dashes(alongZ)
        .filter((z) => Math.abs(z - road.z) > SURFACE)
        .map((z) => (
          <mesh
            key={`dz${z}`}
            rotation-x={-Math.PI / 2}
            position={[road.x, 0.02, z]}
          >
            <planeGeometry args={[0.09, DASH]} />
            <meshStandardMaterial color={MARKING} roughness={1} />
          </mesh>
        ))}
      {dashes(alongX)
        .filter((x) => Math.abs(x - road.x) > SURFACE)
        .map((x) => (
          <mesh
            key={`dx${x}`}
            rotation-x={-Math.PI / 2}
            position={[x, 0.02, road.z]}
          >
            <planeGeometry args={[DASH, 0.09]} />
            <meshStandardMaterial color={MARKING} roughness={1} />
          </mesh>
        ))}

      {/* Lamp posts at the junction and along the avenue. Never emissive. */}
      {[
        [road.x + 1.1, road.z + 1.1],
        [road.x - 1.1, road.z - 1.1],
        [road.x + 1.1, -depth / 2 - 2.4],
        [road.x - 3.4, -depth / 2 - 2.4],
      ].map(([x, z]) => (
        <group key={`p${x}-${z}`} position={[x, 0, z]}>
          <mesh position={[0, 0.6, 0]}>
            <cylinderGeometry args={[0.035, 0.05, 1.2, 6]} />
            <meshStandardMaterial color={KERB} roughness={1} />
          </mesh>
          <mesh position={[0, 1.24, 0]}>
            <boxGeometry args={[0.2, 0.08, 0.14]} />
            <meshStandardMaterial color={KERB} roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
