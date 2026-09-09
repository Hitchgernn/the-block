// Frame checks for a rendered screenshot.
//
//   node scripts/check-frame.mjs <shot.png>
//
// Two things the scene must always satisfy, checked by looking at pixels rather
// than by trusting the camera maths:
//
//   clipped   no wall or roof touching a viewport edge — the block is framed
//   warm-sky  no --lamp-coloured pixel in the upper band, where only the
//             unlit skyline lives. Gold there would mean light nobody earned.
//
// The colour tests are deliberately narrow. An earlier version matched any
// brick-ish tone and kept flagging olive foliage as a clipped building, which
// sent me chasing a framing bug that did not exist.

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/check-frame.mjs <shot.png>')
  process.exit(1)
}

// Pillow is already a dependency of the workflow; shelling out beats adding a
// PNG decoder to the project for a check that runs a few times an hour.
const py = `
from PIL import Image
im = Image.open(${JSON.stringify(file)}).convert('RGB')
w, h = im.size

def is_building(p):
    r, g, b = p
    stone = abs(r - 200) < 40 and abs(g - 193) < 40 and abs(b - 180) < 40
    brick = r > 110 and 60 < g < 105 and b < 95 and r - b > 45
    return stone or brick

edges = {
    'left':   [im.getpixel((1, y)) for y in range(h)],
    'right':  [im.getpixel((w - 2, y)) for y in range(h)],
    'top':    [im.getpixel((x, 1)) for x in range(w)],
    'bottom': [im.getpixel((x, h - 2)) for x in range(w)],
}
clipped = {k: sum(1 for p in v if is_building(p)) for k, v in edges.items()}

band = [im.getpixel((x, y)) for y in range(0, int(h * 0.14)) for x in range(0, w, 3)]
warm = sum(1 for p in band if p[0] > 150 and p[0] - p[2] > 55)

total = sum(clipped.values())
print(f"clipped {total}  ({', '.join(f'{k}={v}' for k, v in clipped.items())})")
print(f"warm-in-sky {warm}")
print('PASS' if total == 0 and warm == 0 else 'FAIL')
`

const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' })
process.stdout.write(out)
if (out.includes('FAIL')) process.exit(1)
