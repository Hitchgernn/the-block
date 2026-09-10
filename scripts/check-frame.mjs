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

// Run this on the bare scene, not with a panel open. The digest's text is
// --stone, the same cream as a lit wall, so its bottom line reads as a
// building clipped by the viewport edge — five pixels of false positive that
// no amount of camera margin will move, because it is not the camera.


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

# Gold in the sky would mean something other than a volunteer's window is
# lit. The check only means anything while the top band actually is sky: zoom
# in or swing the camera round and the band fills with houses, whose windows
# are lit for the best of reasons.
band = [im.getpixel((x, y)) for y in range(0, int(h * 0.14)) for x in range(0, w, 3)]
sky = sum(1 for p in band if p[2] >= p[0] and (p[0] + p[1] + p[2]) / 3 < 120)
band_is_sky = sky > len(band) * 0.9
warm = sum(1 for p in band if p[0] > 150 and p[0] - p[2] > 55) if band_is_sky else 0

# The scene is a town at dusk, so the frame is dark. A pale frame means the
# scene never rendered: a Next.js error overlay, a white canvas from a GLB
# loading outside the Suspense boundary, or a blank page. This check passed a
# full-screen "Maximum call stack size exceeded" overlay once, which is exactly
# the failure a screenshot check exists to catch.
sample = [im.getpixel((x, y)) for y in range(0, h, 7) for x in range(0, w, 7)]
pale = sum(1 for p in sample if (p[0] + p[1] + p[2]) / 3 > 170)
not_dusk = pale > len(sample) * 0.5

total = sum(clipped.values())
print(f"clipped {total}  ({', '.join(f'{k}={v}' for k, v in clipped.items())})")
print(f"warm-in-sky {warm}" + ("" if band_is_sky else "  (skipped, town in the top band)"))
print(f"pale {pale}/{len(sample)}" + ("  NOT THE SCENE" if not_dusk else ""))
print('PASS' if total == 0 and warm == 0 and not not_dusk else 'FAIL')
`

const out = execFileSync('python3', ['-c', py], { encoding: 'utf8' })
process.stdout.write(out)
if (out.includes('FAIL')) process.exit(1)
