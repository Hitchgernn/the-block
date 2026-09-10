// Walk the running scene graph and report what does not fit together.
//
//   node scripts/audit-scene.mjs [url]
//
// Every scene bug this project has had came from two places computing the same
// number: a prop placed at pavement height standing on grass, a forecourt laid
// across the road under it, a lawn tile 0.41 shorter than its neighbour. So
// this does not re-derive the layout — it reads the actual three.js scene the
// browser drew, through the __blockScene handle Block.tsx sets, and measures
// what is there.
//
// Three questions, each of which has caught a real defect:
//
//   gaps        is there ground under every cell of the block?
//   footing     does everything stand on the surface beneath it?
//   collisions  is anything inside anything else?
//
// Exits non-zero when it finds something, so it can gate a commit.

import { spawn, execSync } from 'node:child_process'

const url = process.argv[2] ?? 'http://localhost:3000/'
const TOLERANCE = 0.06 // a prop this far off its surface reads as wrong
const OVERLAP = 0.2 // and this much inside another object reads as a clash

await fetch(url).catch(() => {})

const chrome = execSync(
  'ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1',
  { shell: '/bin/bash' },
).toString().trim()

const port = 9700 + Math.floor(Math.random() * 200)
const proc = spawn(chrome, [
  '--headless', '--no-sandbox', '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`, '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await wait(2500)

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))

let id = 0
const pending = new Map()
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result)
    pending.delete(message.id)
  }
})
const send = (method, params = {}) =>
  new Promise((r) => {
    const next = ++id
    pending.set(next, r)
    ws.send(JSON.stringify({ id: next, method, params }))
  })

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url })
await wait(15000)
// Past the entry overlay, so the scene is the thing being measured.
await send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('button')]
    .find(el => el.textContent.includes('Look around'))?.click()`,
})
await wait(2500)

// Everything below runs in the page. THREE is not global there, so the classes
// are reached through constructors of objects that already exist.
const probe = `(() => {
  const scene = window.__blockScene
  if (!scene) return { error: 'no __blockScene handle — is Block.tsx mounted?' }

  const boxes = []
  scene.updateMatrixWorld(true)

  scene.traverse((o) => {
    if (!o.geometry || !o.visible) return
    o.geometry.computeBoundingBox()
    const bb = o.geometry.boundingBox
    if (!bb) return
    const Box3 = bb.constructor
    const Matrix4 = o.matrixWorld.constructor

    const push = (matrix, label) => {
      const box = new Box3().copy(bb).applyMatrix4(matrix)
      boxes.push({
        label,
        group: group || label,
        // Where the thing was actually placed. A street lamp's arm reaches
        // 1.5 to one side, so its bounding box centre hangs over the
        // carriageway while its pole stands on the pavement — asking about the
        // centre reported every lamp on the block as floating.
        at: [matrix.elements[12], matrix.elements[14]],
        instanced: !!o.isInstancedMesh,
        min: [box.min.x, box.min.y, box.min.z],
        max: [box.max.x, box.max.y, box.max.z],
      })
    }

    // The nearest named ancestor is the thing a person would point at: one
    // volunteer's plot, the food bank, a batch of street trees. Two meshes
    // inside the same one are not a collision — a window is meant to be in a
    // wall.
    let group = o.name
    for (let p = o.parent; p && !group; p = p.parent) group = p.name
    const label = o.name || group || o.type
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i += 1) {
        const m = new Matrix4().fromArray(o.instanceMatrix.array, i * 16)
        m.premultiply(o.matrixWorld)
        push(m, label + '#' + i)
      }
    } else if (o.isMesh) {
      push(o.matrixWorld, label)
    }
  })

  // A ground tile is wide and flat. Height off zero is deliberately not part
  // of this: the leaf lawn tile is lifted 0.41 to meet the verge tile, and
  // testing for a low base classed every one of them as a prop floating in
  // mid-air — the check inventing its own bug rather than finding one.
  const isGround = (b) =>
    b.max[0] - b.min[0] > 3.4 &&
    b.max[2] - b.min[2] > 3.4 &&
    b.max[1] - b.min[1] < 1.2

  // The plinth and the ground plane are what everything else stands on; they
  // are not standing on anything themselves.
  const bedrock = (b) => b.group === 'plinth' || b.group === 'ground-plane'
  const ground = boxes.filter((b) => isGround(b) || bedrock(b))
  const props = boxes.filter((b) => !isGround(b) && !bedrock(b))

  const centre = (b) => [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2]

  // --- footing: what is the highest ground under each prop's base?
  //
  // Measured across the whole footprint rather than at the bounding box's
  // centre. A street lamp's arm reaches a metre and a half to one side, so its
  // centre hangs over the carriageway while its pole stands on the pavement —
  // by the centre alone every lamp on the block read as floating 0.61.
  //
  // Ground well above the object is skipped: the food bank's parapet is a wide
  // flat slab and was taken for the ground beneath it, which made the building
  // read as sunk 3.84 into itself. A plot's own pad, though, is exactly what
  // its house stands on, so same-object ground below still counts.
  const footing = []
  // An object stands on the ground; its parts do not. A window is three metres
  // up because it is a window. So each named group is judged once, by its
  // lowest point.
  //
  // An instanced batch is many separate things sharing one name, so each
  // instance is judged on its own. A built object — a plot, the food bank — is
  // one thing made of many meshes, and is judged once.
  const byGroup = new Map()
  for (const p of props) {
    const key = p.instanced ? p.group + '|' + p.at.join(',') : p.group
    const seen = byGroup.get(key)
    if (!seen || p.min[1] < seen.min[1]) byGroup.set(key, p)
  }

  for (const p of byGroup.values()) {
    const [cx, cz] = p.at
    let top = null
    for (const g of ground) {
      // The pack's ground tiles are 3.996 across, not 4, so every seam has a
      // 4mm gap in it. A lamp standing exactly on one fell through and read as
      // having no ground under it at all.
      const seam = 0.05
      if (cx < g.min[0] - seam || cx > g.max[0] + seam) continue
      if (cz < g.min[2] - seam || cz > g.max[2] + seam) continue
      if (g.min[1] > p.min[1] + 0.5) continue
      if (top === null || g.max[1] > top) top = g.max[1]
    }
    if (top === null) {
      footing.push({ label: p.label, at: [cx, cz], issue: 'nothing underneath' })
    } else if (Math.abs(p.min[1] - top) > ${TOLERANCE}) {
      footing.push({
        label: p.label,
        at: [cx, cz],
        base: p.min[1],
        surface: top,
        off: p.min[1] - top,
      })
    }
  }

  // --- collisions between things that stand on the ground
  const clashes = []
  for (let i = 0; i < props.length; i += 1) {
    for (let j = i + 1; j < props.length; j += 1) {
      const a = props[i], b = props[j]
      if (a.group === b.group) continue
      const ox = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0])
      const oy = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1])
      const oz = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2])
      if (ox > ${OVERLAP} && oy > ${OVERLAP} && oz > ${OVERLAP}) {
        clashes.push({ a: a.label, b: b.label, overlap: [ox, oy, oz] })
      }
    }
  }

  // --- gaps: cells inside the ground's own extent with no tile on them
  const extent = ground.reduce(
    (acc, g) => ({
      minX: Math.min(acc.minX, g.min[0]), maxX: Math.max(acc.maxX, g.max[0]),
      minZ: Math.min(acc.minZ, g.min[2]), maxZ: Math.max(acc.maxZ, g.max[2]),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity },
  )
  const gaps = []
  for (let x = extent.minX + 2; x < extent.maxX; x += 4) {
    for (let z = extent.minZ + 2; z < extent.maxZ; z += 4) {
      const covered = ground.some(
        (g) =>
          x >= g.min[0] - 0.05 && x <= g.max[0] + 0.05 &&
          z >= g.min[2] - 0.05 && z <= g.max[2] + 0.05,
      )
      if (!covered) gaps.push([Math.round(x), Math.round(z)])
    }
  }

  return {
    counts: { total: boxes.length, ground: ground.length, props: props.length },
    footing, clashes, gaps,
  }
})()`

// Measure once, and if the scene looks half-built, wait and measure again.
//
// A run during a dev-server recompile reported a defect that did not exist:
// the layers load independently now, so a probe that lands mid-load sees a
// town with some of its scenery missing and duly reports what is "wrong" with
// it. A check that invents findings is worse than no check — the same lesson
// check-frame learned by passing a full-screen crash overlay.
const READY = 300

let result = await send('Runtime.evaluate', {
  expression: probe,
  returnByValue: true,
  awaitPromise: false,
})

if ((result?.result?.value?.counts?.total ?? 0) < READY) {
  console.error('scene looks partly loaded — waiting and measuring again')
  await wait(8000)
  result = await send('Runtime.evaluate', {
    expression: probe,
    returnByValue: true,
    awaitPromise: false,
  })
}

ws.close()
proc.kill()

const report = result?.result?.value
if (!report || report.error) {
  console.error(report?.error ?? 'the probe returned nothing')
  process.exit(2)
}

const { counts, footing, clashes, gaps } = report
if (counts.total < READY) {
  console.error(
    `only ${counts.total} objects in the scene — it never finished loading, so nothing here is worth believing`,
  )
  process.exit(2)
}
console.log(
  `measured ${counts.total} objects — ${counts.ground} ground tiles, ${counts.props} standing on them`,
)

const show = (title, rows, render) => {
  console.log(`\n${title}: ${rows.length}`)
  for (const row of rows.slice(0, 25)) console.log('  ' + render(row))
  if (rows.length > 25) console.log(`  ...and ${rows.length - 25} more`)
}

show('gaps in the ground', gaps, (g) => `no tile at ${g[0]}, ${g[1]}`)
show('standing off its surface', footing, (f) =>
  f.issue
    ? `${f.label} at ${f.at.map((n) => n.toFixed(1))} — ${f.issue}`
    : `${f.label} at ${f.at.map((n) => n.toFixed(1))} — base ${f.base.toFixed(2)} on a surface at ${f.surface.toFixed(2)} (${f.off > 0 ? 'floating' : 'sunk'} ${Math.abs(f.off).toFixed(2)})`,
)
show('inside each other', clashes, (c) =>
  `${c.a} and ${c.b} overlap by ${c.overlap.map((n) => n.toFixed(2)).join(' x ')}`,
)

const total = gaps.length + footing.length + clashes.length
console.log(`\n${total === 0 ? 'CLEAN' : `${total} to fix`}`)
process.exit(total === 0 ? 0 : 1)
