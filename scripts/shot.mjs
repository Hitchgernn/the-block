// Screenshot the running app over CDP.
//
//   node scripts/shot.mjs <url> <out.png> [--mobile] [--click "Text"]
//                          [--rotate <deg>] [--zoom <steps>] [--click-at X,Y]
//
// --rotate turns the camera by dragging. OrbitControls scales rotation by the
// canvas HEIGHT, not its width, so the pixel distance per degree is derived
// from the viewport rather than guessed — getting that wrong once made a
// half-turn look like a quarter-turn and sent me hunting a bug that was not
// there. --zoom sends wheel steps; negative zooms out.
//
// The Playwright MCP on this machine looks for Chrome at /opt/google/chrome and
// fails, and Chrome's own --screenshot flag mishandles the app's `position:
// fixed` shell and renders the 3D scene blank. Driving CDP directly avoids
// both. Node 22 has a native WebSocket, so there is no dependency to install.

import { spawn, execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [url, out, ...rest] = process.argv.slice(2)
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [--mobile] [--click "Text"]')
  process.exit(1)
}

const mobile = rest.includes('--mobile')
const clicks = rest.flatMap((arg, i) => (arg === '--click' ? [rest[i + 1]] : []))
const rotateDeg = Number(rest[rest.indexOf('--rotate') + 1] ?? 0) || 0
/**
 * --click-at X,Y clicks a point on the canvas after the camera has moved.
 * Repeatable, so a sequence can be tested — select a house, then click empty
 * ground and see whether the selection clears.
 *
 * --click only finds DOM buttons, so nothing in the 3D scene could be
 * exercised at all: whether clicking a house opens its panel was untestable
 * and therefore untested. This dispatches a real mouse press and release at a
 * pixel, which is what r3f raycasts against.
 */
const clickAts = rest.flatMap((arg, i) => (arg === '--click-at' ? [rest[i + 1]] : []))
const zoomSteps = Number(rest[rest.indexOf('--zoom') + 1] ?? 0) || 0

// Warm the route first. In dev the first request after an edit triggers a
// recompile that can take longer than the wait below, and the screenshot then
// photographs a blank canvas mid-build.
try {
  const started = Date.now()
  await fetch(url).catch(() => {})
  await fetch(new URL('/api/state', url)).catch(() => {})
  console.error(`warmed in ${Date.now() - started}ms`)
} catch {}

const chrome = execSync(
  'ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1',
  { shell: '/bin/bash' },
).toString().trim()

const port = 9400 + Math.floor(Math.random() * 300)
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
const errors = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result)
    pending.delete(message.id)
  }
  if (message.method === 'Runtime.exceptionThrown') {
    errors.push(
      message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text,
    )
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
if (mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  })
}
await send('Page.navigate', { url })
// The scene needs a beat: fonts, the client fetch, the GLB assets, then the
// first r3f frames. Too short a wait photographs a half-loaded scene and makes
// the screenshot lie about what shipped.
await wait(15000)

for (const label of clicks) {
  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button,summary')]
      .find(el => el.textContent.includes(${JSON.stringify(label)}))?.click()`,
  })
  await wait(1500)
}

const viewport = mobile ? { w: 390, h: 844 } : { w: 1400, h: 900 }

if (rotateDeg !== 0) {
  // OrbitControls: rotateLeft(2 * PI * dx / clientHeight * rotateSpeed).
  const rotateSpeed = 0.35
  const dx = (rotateDeg / 360) * (viewport.h / rotateSpeed)
  const steps = 40
  const y = Math.round(viewport.h * 0.5)
  const startX = Math.round(viewport.w * 0.5)
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: startX, y, button: 'left', clickCount: 1, buttons: 1,
  })
  for (let i = 1; i <= steps; i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: startX + (dx * i) / steps, y, button: 'left', buttons: 1,
    })
    await wait(12)
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: startX + dx, y, button: 'left', buttons: 0,
  })
  await wait(900)
}

if (zoomSteps !== 0) {
  const dir = zoomSteps > 0 ? -120 : 120
  for (let i = 0; i < Math.abs(zoomSteps); i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: Math.round(viewport.w * 0.5),
      y: Math.round(viewport.h * 0.45),
      deltaX: 0,
      deltaY: dir,
    })
    await wait(110)
  }
  await wait(800)
}

// Last, so it lands on whatever the camera is finally looking at.
for (const spot of clickAts) {
  const [cx, cy] = spot.split(',').map(Number)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type,
      x: cx,
      y: cy,
      button: 'left',
      clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    })
  }
  await wait(1200)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))

console.log(`${out}${errors.length ? ` — ${errors.length} page errors:\n${errors.slice(0, 3).join('\n')}` : ''}`)
proc.kill()
process.exit(0)
