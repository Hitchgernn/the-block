// Screenshot the running app over CDP.
//
//   node scripts/shot.mjs <url> <out.png> [--mobile] [--click "Look around"] ...
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
// The scene needs a beat: fonts, the client fetch, then the first r3f frames.
await wait(8000)

for (const label of clicks) {
  await send('Runtime.evaluate', {
    expression: `[...document.querySelectorAll('button,summary')]
      .find(el => el.textContent.includes(${JSON.stringify(label)}))?.click()`,
  })
  await wait(1500)
}

const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(out, Buffer.from(shot.data, 'base64'))

console.log(`${out}${errors.length ? ` — ${errors.length} page errors:\n${errors.slice(0, 3).join('\n')}` : ''}`)
proc.kill()
process.exit(0)
