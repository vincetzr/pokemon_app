/**
 * Two fake-camera feeds of a card tilting under a light.
 *
 * Both carry the SAME picture. The only difference is whether the surface has
 * relief: the flat one just brightens and darkens as the card turns, the
 * embossed one changes shading PATTERN because the light catches its ridges
 * differently at each angle. If the check cannot tell these apart end to end,
 * it does not work.
 */
import { createRequire } from 'node:module';
import { y4mWriter } from '../y4m.mjs';
const sharp = createRequire('/home/user/pokemon_app/package.json')('sharp');

const VW = 1280, VH = 720;          // a plausible live track
const CW = 300, CH = 419;           // the card on screen
const FRAMES = 90;

const card = await sharp('/tmp/claude-0/-home-user-pokemon-app/d4cc456f-c6fb-5a73-9f18-5c1ef79fe76b/scratchpad/cardback.jpg')
  .resize(CW, CH, { fit: 'fill' }).raw().toBuffer();

// Relief: ridges plus micro-roughness, as on a foil treatment.
let seed = 99;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const height = new Float64Array(CW * CH);
for (let y = 0; y < CH; y++) {
  for (let x = 0; x < CW; x++) {
    height[y * CW + x] = Math.sin((x + y) * 0.8) * 0.6 + Math.sin(x * 0.3) * 0.3 + (rnd() - 0.5) * 0.5;
  }
}
const normals = (amp) => {
  const n = { x: new Float64Array(CW * CH), y: new Float64Array(CW * CH), z: new Float64Array(CW * CH) };
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const i = y * CW + x;
      const dx = (height[y * CW + Math.min(CW - 1, x + 1)] - height[y * CW + Math.max(0, x - 1)]) * amp;
      const dy = (height[Math.min(CH - 1, y + 1) * CW + x] - height[Math.max(0, y - 1) * CW + x]) * amp;
      const len = Math.hypot(dx, dy, 1);
      n.x[i] = -dx / len; n.y[i] = -dy / len; n.z[i] = 1 / len;
    }
  }
  return n;
};

for (const [name, amp] of [['surface-flat', 0], ['surface-embossed', 6]]) {
  const n = normals(amp);
  const out = y4mWriter(`/tmp/claude-0/-home-user-pokemon-app/d4cc456f-c6fb-5a73-9f18-5c1ef79fe76b/scratchpad/fakes/${name}.y4m`, VW, VH, 15);
  for (let f = 0; f < FRAMES; f++) {
    const rgb = Buffer.alloc(VW * VH * 3, 28);          // dark desk
    // The light swings round as the card is tilted.
    const a = (f / FRAMES) * Math.PI * 2;
    const L = [Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0.69];
    const ox = Math.round((VW - CW) / 2 + Math.sin(f * 0.7) * 1.5);   // a little hand drift
    const oy = Math.round((VH - CH) / 2 + Math.cos(f * 0.6) * 1.5);
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        const i = y * CW + x;
        const dot = Math.max(0, n.x[i] * L[0] + n.y[i] * L[1] + n.z[i] * L[2]);
        const shade = 0.28 + 0.72 * dot;
        const d = ((oy + y) * VW + (ox + x)) * 3;
        for (let c = 0; c < 3; c++) {
          rgb[d + c] = Math.max(0, Math.min(255, card[i * 3 + c] * shade + (rnd() - 0.5) * 5));
        }
      }
    }
    out.frame(rgb);
  }
  await out.close();
  console.log('wrote', name, FRAMES, 'frames');
}
