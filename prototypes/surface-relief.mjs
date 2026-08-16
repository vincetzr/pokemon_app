/**
 * Prototype: can a phone tell an embossed surface from a flat print?
 *
 * This is TAG's photometric-stereo idea without the rig. Under a moving light,
 * a Lambertian surface's images live in a 3-dimensional space — the three
 * components of albedo times surface normal. If the surface is FLAT the normal
 * is constant everywhere, every frame is the same picture times a scalar, and
 * that space collapses to ONE dimension. So the question "does this surface
 * have relief" becomes "what is the rank of the stack of frames", which needs
 * no knowledge of where the light was. That is the whole trick, and it is why
 * this needs no counterfeit dataset: it measures physics, not appearance.
 *
 * The test is built so the naive answer fails. Both surfaces carry the SAME
 * albedo, so anything that responds to the picture rather than to the relief
 * scores them identically. Only the height map differs.
 *
 *   node prototypes/surface-relief.mjs [path/to/card-image]
 *
 * Pass a real card image for representative numbers — measured against a real
 * card back, separation after registration runs 12x to 38x across every
 * scenario. The procedural fallback used when no path is given is deliberately
 * smoother, which gives registration less texture to lock onto and roughly
 * halves the separation; it is a smoke test that the maths runs, not a
 * calibration.
 *
 * What the numbers say, in one line: the physics is sound and robust to noise
 * and auto-exposure, and sub-pixel registration is the entire engineering
 * problem — one pixel of hand drift collapses 22x to 2x, and putting the
 * frames back on top of each other restores it.
 */
import sharp from 'sharp';

// Optional: a real card image to use as albedo, so the test carries the same
// picture on both surfaces and nothing can score by responding to the picture.
// Without one a procedural stand-in with comparable structure is generated.
const ALBEDO_PATH = process.argv[2] || null;

const W = 180, H = 251;
const LIGHTS = [                       // 45° elevation, four azimuths
  [Math.cos(0) * 0.707, Math.sin(0) * 0.707, 0.707],
  [Math.cos(Math.PI / 2) * 0.707, Math.sin(Math.PI / 2) * 0.707, 0.707],
  [Math.cos(Math.PI) * 0.707, Math.sin(Math.PI) * 0.707, 0.707],
  [Math.cos(3 * Math.PI / 2) * 0.707, Math.sin(3 * Math.PI / 2) * 0.707, 0.707],
];

/* ---------- the metric, written to port into the page verbatim ---------- */

/** Eigenvalues of a small symmetric matrix, by cyclic Jacobi rotation. */
function symmetricEigenvalues(A, n) {
  const a = A.map((r) => r.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, i) => Math.max(0, a[i][i])).sort((x, y) => y - x);
}

/**
 * Relief score for a stack of aligned, same-size luminance frames.
 *
 * Each frame is normalised to unit length first, so a change in exposure —
 * which is all a flat surface can produce — cannot create structure. What is
 * left in the second and third singular values is surface normal variation.
 */
function reliefScore(frames, mask) {
  const N = frames.length;
  const idx = [];
  for (let i = 0; i < frames[0].length; i++) if (mask[i]) idx.push(i);
  if (idx.length < 64) return null;

  const rows = frames.map((f) => {
    let norm = 0;
    for (const i of idx) norm += f[i] * f[i];
    norm = Math.sqrt(norm) || 1;
    return idx.map((i) => f[i] / norm);
  });

  const G = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let p = 0; p < N; p++) {
    for (let q = p; q < N; q++) {
      let s = 0;
      for (let k = 0; k < rows[p].length; k++) s += rows[p][k] * rows[q][k];
      G[p][q] = G[q][p] = s;
    }
  }
  const ev = symmetricEigenvalues(G, N);          // eigenvalues = squared singulars
  const sv = ev.map(Math.sqrt);
  const total = sv.reduce((a, b) => a + b, 0) || 1;
  return (sv[1] + (sv[2] || 0)) / total;
}

/**
 * Sub-pixel registration, which the numbers below show is the whole ballgame.
 *
 * A hand-held capture cannot hold the card to the pixel, and one pixel of
 * drift turns a 22x separation into 2x — the drift itself looks like surface
 * variation. So each frame is shifted onto the first before anything is
 * measured: integer search for the correlation peak, then a parabolic fit
 * through the peak and its neighbours for the fraction, then a bilinear
 * resample. The frames legitimately differ in shading, but they share the
 * albedo texture, and that is what the correlation locks onto.
 */
function bestShift(frame, ref, radius) {
  const edge = radius + 1;
  const score = (dx, dy) => {
    let sum = 0, n = 0;
    for (let y = edge; y < H - edge; y += 2) {
      for (let x = edge; x < W - edge; x += 2) {
        sum += frame[(y + dy) * W + (x + dx)] * ref[y * W + x];
        n++;
      }
    }
    return sum / n;
  };
  let best = { s: -Infinity, dx: 0, dy: 0 };
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const s = score(dx, dy);
      if (s > best.s) best = { s, dx, dy };
    }
  }
  // Parabolic refinement through the peak in each axis.
  const sub = (minus, centre, plus) => {
    const d = minus - 2 * centre + plus;
    return Math.abs(d) < 1e-9 ? 0 : Math.max(-0.5, Math.min(0.5, 0.5 * (minus - plus) / d));
  };
  const fx = sub(score(best.dx - 1, best.dy), best.s, score(best.dx + 1, best.dy));
  const fy = sub(score(best.dx, best.dy - 1), best.s, score(best.dx, best.dy + 1));
  return { dx: best.dx + fx, dy: best.dy + fy };
}

function resample(frame, dx, dy) {
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 2, Math.max(0, x + dx)), sy = Math.min(H - 2, Math.max(0, y + dy));
      const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
      const a = frame[y0 * W + x0], b = frame[y0 * W + x0 + 1];
      const c = frame[(y0 + 1) * W + x0], d = frame[(y0 + 1) * W + x0 + 1];
      out[y * W + x] = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
    }
  }
  return out;
}

function registerStack(frames) {
  const ref = frames[0];
  return frames.map((f, i) => {
    if (i === 0) return f;
    const { dx, dy } = bestShift(f, ref, 3);
    return resample(f, dx, dy);
  });
}

/* ---------- synthetic capture ---------- */

function normalsFromHeight(height, amp) {
  const nx = new Float64Array(W * H), ny = new Float64Array(W * H), nz = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xm = height[y * W + Math.max(0, x - 1)], xp = height[y * W + Math.min(W - 1, x + 1)];
      const ym = height[Math.max(0, y - 1) * W + x], yp = height[Math.min(H - 1, y + 1) * W + x];
      const dx = (xp - xm) * amp, dy = (yp - ym) * amp;
      const len = Math.hypot(dx, dy, 1);
      nx[i] = -dx / len; ny[i] = -dy / len; nz[i] = 1 / len;
    }
  }
  return { nx, ny, nz };
}

// Deterministic pseudo-random, so runs are comparable.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function render(albedo, n, light, exposure, noise, shiftX, shiftY) {
  const out = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x + shiftX));
      const sy = Math.min(H - 1, Math.max(0, y + shiftY));
      const j = sy * W + sx, i = y * W + x;
      const dot = Math.max(0, n.nx[j] * light[0] + n.ny[j] * light[1] + n.nz[j] * light[2]);
      const v = albedo[j] * (0.25 + 0.75 * dot) * exposure + (rnd() - 0.5) * noise;
      out[i] = Math.max(0, Math.min(255, v));
    }
  }
  return out;
}

let albedo;
if (ALBEDO_PATH) {
  albedo = Float64Array.from(
    await sharp(ALBEDO_PATH).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer());
} else {
  albedo = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const swirl = Math.sin(Math.hypot(x - W / 2, y - H / 2) * 0.09 + Math.atan2(y - H / 2, x - W / 2) * 2);
      const panel = (x > W * 0.18 && x < W * 0.82 && y > H * 0.12 && y < H * 0.3) ? 90 : 0;
      albedo[y * W + x] = Math.max(12, Math.min(243, 120 + swirl * 55 + panel));
    }
  }
}

const flat = new Float64Array(W * H);                     // a printed card: no relief
const holo = new Float64Array(W * H);                     // embossed: ridges + micro-roughness
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    holo[y * W + x] = Math.sin((x + y) * 0.9) * 0.6 + Math.sin(x * 0.35) * 0.3 + (rnd() - 0.5) * 0.5;
  }
}

const scenarios = [
  ['ideal capture', { noise: 0, jitter: 0, exposure: [1, 1, 1, 1] }],
  ['camera noise', { noise: 6, jitter: 0, exposure: [1, 1, 1, 1] }],
  ['auto-exposure fighting', { noise: 4, jitter: 0, exposure: [1, 0.82, 1.15, 0.93] }],
  ['1px misregistration', { noise: 4, jitter: 1, exposure: [1, 0.9, 1.1, 1] }],
  ['2px misregistration', { noise: 4, jitter: 2, exposure: [1, 0.9, 1.1, 1] }],
];

const mask = new Uint8Array(W * H);
for (let i = 0; i < mask.length; i++) mask[i] = albedo[i] > 25 && albedo[i] < 245 ? 1 : 0;

console.log('\n                              -------- as captured --------  |  ------ after registration ------');
console.log('  scenario                    flat print   embossed   ratio  |   flat print   embossed   ratio');
for (const [name, cfg] of scenarios) {
  const shot = (n, amp) => LIGHTS.map((l, k) => {
    const jx = cfg.jitter ? Math.round((rnd() - 0.5) * 2 * cfg.jitter) : 0;
    const jy = cfg.jitter ? Math.round((rnd() - 0.5) * 2 * cfg.jitter) : 0;
    return render(albedo, n, l, cfg.exposure[k], cfg.noise, jx, jy);
  });
  const flatRaw = shot(normalsFromHeight(flat, 0), 0);
  const holoRaw = shot(normalsFromHeight(holo, 6), 6);
  const f0 = reliefScore(flatRaw, mask), h0 = reliefScore(holoRaw, mask);
  const f1 = reliefScore(registerStack(flatRaw), mask), h1 = reliefScore(registerStack(holoRaw), mask);
  console.log('  ' + name.padEnd(26) +
    f0.toFixed(4).padStart(9) + h0.toFixed(4).padStart(11) +
    ('×' + (h0 / f0).toFixed(1)).padStart(8) + '  |' +
    f1.toFixed(4).padStart(9) + h1.toFixed(4).padStart(11) +
    ('×' + (h1 / f1).toFixed(1)).padStart(8));
}
