// ARCA FISH LAB - the core: turns a fish DESIGN (outlines drawn in the app) into what the ARCA plugin needs:
//   the MAP (512 x 256: what every dot of the skin picture is - body, back fin, belly fin, tail - and where it lies in its fin),
//   the species' TABLES (eye, span, hinges, fin lines, brow), and its six body SLICES as game model files (.mwm).
// It runs in the browser and in node (tests). Measures are metres; the nose points to -z, y is up, x is across.
// It follows tools/fishnew17.py build() (the builder the built-in species were made with) in every number the plugin reads.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.FishCore = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const W = 512, H = 256, FR = [0.30, 0.44, 0.58, 0.72, 0.86], OV = 0.035;
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

  // ---- a smooth line through points [[z, y], ...] (z rising): y at any z ----
  function curve(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0]), n = p.length;
    const m = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      m[i] = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) : 0;
    }
    return function (z) {
      if (z <= p[0][0]) return p[0][1];
      if (z >= p[n - 1][0]) return p[n - 1][1];
      let i = 0; while (i < n - 2 && z > p[i + 1][0]) i++;
      const h = p[i + 1][0] - p[i][0], t = (z - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    };
  }
  function insidePoly(poly, z, y) {
    let res = false;
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      if ((a[1] > y) !== (b[1] > y) && z < a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])) res = !res;
    }
    return res;
  }

  // ---- the picture's window for a design: everything must fit, dots are square ----
  function windowOf(d) {
    let z0 = d.body.z0, z1 = d.body.z1, y0 = 1e9, y1 = -1e9;
    const all = [];
    d.body.top.forEach(p => all.push(p)); d.body.bot.forEach(p => all.push(p));
    (d.fins || []).forEach(f => f.pts.forEach(p => all.push(p)));
    if (d.tail) d.tail.pts.forEach(p => all.push(p));
    all.forEach(p => { z0 = Math.min(z0, p[0]); z1 = Math.max(z1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    const len = z1 - z0, pad = 0.012 * len; z0 -= pad; z1 += pad; y0 -= pad; y1 += pad;
    // square dots: ZS = (Y1 - Y0) * 0.94 * W / (0.92 * H) must be at least Z1 - Z0; if the animal is long and low, grow the height
    const need = (z1 - z0) * (0.92 * H) / (0.94 * W);
    if (y1 - y0 < need) { const mid = (y0 + y1) / 2; y0 = mid - need / 2; y1 = mid + need / 2; }
    return { Z0: z0, Z1: z1, Y0: y0, Y1: y1, ZS: (y1 - y0) * 0.94 * W / (0.92 * H) };
  }

  // ---- BUILD: design -> map, tables, slices ----
  function build(d) {
    const win = d.win || windowOf(d), { Z0, Z1, Y0, Y1, ZS } = win;      // (the app keeps one fixed window, so paint stays where it was put)
    const top = curve(d.body.top), bot = curve(d.body.bot), BZ0 = d.body.z0, BZ1 = d.body.z1;
    const toUV = (z, y) => [0.03 + 0.94 * (z - Z0) / ZS, 0.04 + 0.92 * (Y1 - y) / (Y1 - Y0)];
    const zOf = px => Z0 + ((px + 0.5) / W - 0.03) / 0.94 * ZS, yOf = py => Y1 - ((py + 0.5) / H - 0.04) / 0.92 * (Y1 - Y0);
    const colOf = z => (0.03 + 0.94 * (z - Z0) / ZS) * W;
    const N = W * H, cls = new Uint8Array(N), Dm = new Float32Array(N), Rm = new Float32Array(N), body = new Uint8Array(N), own = new Uint8Array(N);
    const zs = new Float64Array(W), ys = new Float64Array(H), tz = new Float64Array(W), bz = new Float64Array(W);
    for (let x = 0; x < W; x++) { zs[x] = zOf(x); tz[x] = top(zs[x]); bz[x] = bot(zs[x]); }
    for (let y = 0; y < H; y++) ys[y] = yOf(y);
    let b0 = W, b1 = -1;
    for (let x = 0; x < W; x++) {
      const z = zs[x]; if (z < BZ0 || z > BZ1 || z < Z0 || z > Z1) continue;
      for (let y = 0; y < H; y++) if (ys[y] <= tz[x] && ys[y] >= bz[x]) { body[y * W + x] = 1; if (x < b0) b0 = x; if (x > b1) b1 = x; }
    }
    if (b1 < 0) throw new Error('the body is empty');
    // fins: an outline whose first and last points sit on the body (its base). Dots are measured along RAYS that leave the base
    // leaning the way the fin leans: Dm = how far along its ray a dot is (0 base .. 1 tip), Rm = which ray (by where it leaves)
    (d.fins || []).forEach((f, finIndex) => {
      const code = f.side === 'back' ? 100 : 140, sign = code === 100 ? 1 : -1, edge = code === 100 ? top : bot, pts = f.pts;
      const a = pts[0], b = pts[pts.length - 1], zs0 = Math.min(a[0], b[0]), ze0 = Math.max(a[0], b[0]), zm = (a[0] + b[0]) / 2, ym = (a[1] + b[1]) / 2;
      let far = 0, tip = pts[0];
      pts.forEach(p => { const dd = Math.hypot(p[0] - zm, p[1] - ym); if (dd > far) { far = dd; tip = p; } });
      const phi = clamp(Math.atan2(tip[0] - zm, sign * (tip[1] - ym)), -1.3, 1.3), tan = Math.tan(phi), cos = Math.cos(phi);
      const BIN = 96, farH = new Float64Array(BIN), nearH = new Float64Array(BIN).fill(1e9), hh = new Float32Array(N), ff = new Float32Array(N), zfA = new Float32Array(N), ok = new Uint8Array(N);
      let minx = W, maxx = 0, miny = H, maxy = 0;
      pts.forEach(p => { const c = colOf(p[0]), r = (0.04 + 0.92 * (Y1 - p[1]) / (Y1 - Y0)) * H; minx = Math.min(minx, c); maxx = Math.max(maxx, c); miny = Math.min(miny, r); maxy = Math.max(maxy, r); });
      const span = Math.max(1e-6, ze0 - zs0), reach = Math.ceil(Math.abs(tan) * (maxy - miny)) + 4;
      const x0 = Math.max(0, Math.floor(minx) - reach), x1 = Math.min(W - 1, Math.ceil(maxx) + reach), yy0 = Math.max(0, Math.floor(Math.min(miny, 0)) ), yy1 = Math.min(H - 1, Math.ceil(maxy) + 2);
      const binOf = f2 => clamp(Math.floor((clamp(f2, -0.2, 1.2) + 0.2) / 1.4 * (BIN - 1)), 0, BIN - 1);
      for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x; if (body[i]) continue;
        const z = zs[x], yv = ys[y]; let zf = z;
        for (let k = 0; k < 4; k++) zf = z - sign * (yv - edge(zf)) * tan;
        const h = sign * (yv - edge(zf)) / cos, f2 = (zf - zs0) / span; hh[i] = h; ff[i] = f2; zfA[i] = zf;
        if (h > 0 && insidePoly(pts, z, yv)) { ok[i] = 1; const bn = binOf(f2); if (h > farH[bn]) farH[bn] = h; if (h < nearH[bn]) nearH[bn] = h; }
      }
      // root fill: the outline's base is a straight line, the body's edge under it curves - carry the fin down to the body
      const near2 = new Float64Array(BIN);
      for (let k = 0; k < BIN; k++) { const v = nearH[k] > 1e8 ? 0 : nearH[k]; near2[k] = v; }
      const near3 = new Float64Array(BIN), far2 = new Float64Array(BIN);
      for (let k = 0; k < BIN; k++) near3[k] = Math.max(near2[k], near2[(k + BIN - 1) % BIN], near2[(k + 1) % BIN]);
      for (let k = 0; k < BIN; k++) { let s = 0; for (let j = -2; j <= 2; j++) { const q = k + j; s += q >= 0 && q < BIN ? Math.max(farH[q], 1e-4 * span) : 0; } far2[k] = Math.max(s / 5, 1e-6); }
      for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x; if (body[i]) continue;
        const bn = binOf(ff[i]); let on = ok[i] === 1;
        if (!on && ff[i] >= 0 && ff[i] <= 1 && hh[i] > 0 && hh[i] <= near3[bn] + 0.008 * span && farH[bn] > 0) on = true;
        if (!on) continue;
        cls[i] = code; own[i] = 2 + finIndex; Dm[i] = clamp(hh[i] / far2[bn], 0, 1); Rm[i] = clamp((colOf(zfA[i]) - b0) / Math.max(1, b1 - b0) * 0.9, 0, 1);
      }
    });
    // the tail: an outline behind the body; its dots are measured from the middle of its root: Dm out along the spoke, Rm round the fan
    if (d.tail && d.tail.pts.length >= 3) {
      const pts = d.tail.pts, PZ = d.tail.hub ? d.tail.hub[0] : BZ1 - 0.02 * (BZ1 - BZ0), PY = d.tail.hub ? d.tail.hub[1] : (top(BZ1) + bot(BZ1)) / 2;
      const BIN = 64, farR = new Float64Array(BIN), r0 = 0.03 * (BZ1 - BZ0), ang = new Float32Array(N), rr = new Float32Array(N), ok = new Uint8Array(N);
      const binOf = a => clamp(Math.floor((a + Math.PI) / (2 * Math.PI) * BIN), 0, BIN - 1);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (body[i]) continue; const z = zs[x], yv = ys[y];
        if (!insidePoly(pts, z, yv)) continue;
        const a = Math.atan2(yv - PY, z - PZ), r = Math.hypot(z - PZ, yv - PY); ang[i] = a; rr[i] = r; ok[i] = 1; const bn = binOf(a); if (r > farR[bn]) farR[bn] = r;
      }
      const far2 = new Float64Array(BIN);
      for (let k = 0; k < BIN; k++) { let s = 0, c = 0; for (let j = -1; j <= 1; j++) { const q = k + j; if (q >= 0 && q < BIN && farR[q] > 0) { s += farR[q]; c++; } } far2[k] = c ? s / c : r0 * 2; }
      for (let i = 0; i < N; i++) if (ok[i]) {
        const R = far2[binOf(ang[i])]; cls[i] = 180; own[i] = 250; Dm[i] = clamp((rr[i] - r0) / Math.max(R - r0, 1e-6), 0, 1); Rm[i] = clamp((-ang[i]) / (Math.PI / 2) * 0.5 + 0.5, 0, 1);
      }
    }
    for (let i = 0; i < N; i++) if (body[i]) { cls[i] = 255; own[i] = 1; }
    const topr = new Float64Array(W), botr = new Float64Array(W);
    for (let c = 0; c < W; c++) {
      const cc = clamp(c, b0, b1); let lo = -1, hi = -1;
      for (let y = 0; y < H; y++) if (body[y * W + cc]) { if (lo < 0) lo = y; hi = y; }
      topr[c] = lo; botr[c] = hi + 1;
    }
    const ex = b0 + 0.13 * (b1 - b0), ci = Math.floor(ex), ey = topr[ci] + 0.40 * (botr[ci] - topr[ci]), er = Math.max(4.0, 0.075 * (botr[ci] - topr[ci]));
    let deep = 1; for (let c = 0; c < W; c++) deep = Math.max(deep, botr[c] - topr[c]);
    if (d.cut) for (let i = 0; i < N; i++) if (d.cut[i] && cls[i] && cls[i] !== 255) cls[i] = 0;      // (v0.4) holes and tears cut into the fins; `own` keeps them, so a cut fin can still be picked
    const blob = new Uint8Array(3 * N + 2 * W);
    blob.set(cls, 0);
    for (let i = 0; i < N; i++) { blob[N + i] = clamp(Math.floor(Dm[i] * 255), 0, 255); blob[2 * N + i] = clamp(Math.floor(Rm[i] * 255), 0, 255); }
    for (let c = 0; c < W; c++) { blob[3 * N + c] = clamp(Math.round(topr[c]), 0, 255); blob[3 * N + W + c] = clamp(Math.round(botr[c]), 0, 255); }
    const r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000, r2 = v => Math.round(v * 100) / 100;
    const tables = { asp: r3((b1 - b0 + 1) / deep), eye: [r2(ex), r2(ey), r2(er)], span: [r4(b0 / W), r4((b1 + 1) / W)], head: d.head || 0.215 };
    // ---- the model: a lofted body (8-sided rings) and one flat sheet in the middle plane (the cut-out mask makes the fins) ----
    const P = [], Nn = [], UV = [], T = [];
    const vert = (p, n, uy) => { P.push(p); Nn.push(n); UV.push(toUV(p[2], uy === undefined ? p[1] : uy)); return P.length - 1; };
    const TEX = (Y1 - Y0) / (0.92 * H);      // one dot of the picture, in metres
    const SS = [0, 0.02, 0.06, 0.13, 0.19, 0.26, 0.34, 0.42, 0.5, 0.58, 0.66, 0.74, 0.82, 0.90, 0.96, 1.0], SIDES = 12, rings = [], wide = d.body.wide || 0.7;
    const widthAt = d.body.width && d.body.width.length >= 2 ? curve(d.body.width) : null;
    const widthAtL = d.body.widthL && d.body.widthL.length >= 2 ? curve(d.body.widthL) : widthAt;      // (v0.3) the other flank (x < 0) may differ      // (v0.2) the body's half-width along its length, sculpted in 3D
    SS.forEach(s => {
      const z = BZ0 + s * (BZ1 - BZ0), yt = top(z), yb = bot(z), h = Math.max((yt - yb) / 2, 0.0006), cy = (yt + yb) / 2, w = (widthAt ? Math.max(0.0004, widthAt(z)) : wide * h) + 0.0002, wl = (widthAtL ? Math.max(0.0004, widthAtL(z)) : wide * h) + 0.0002, ring = [];
      for (let k = 0; k < SIDES; k++) {
        const th = 2 * Math.PI * k / SIDES, cx = Math.cos(th), sy = Math.sin(th), ws = cx >= 0 ? w : wl; let nx = cx / ws, ny = sy / h; const ln = Math.hypot(nx, ny); nx /= ln; ny /= ln;
        ring.push(vert([ws * cx, cy + h * sy, z], [nx, ny, 0], cy + sy * Math.max(0, h - Math.max(0.04 * h, 1.2 * TEX) * Math.abs(sy))));      // (v0.4) the skin is read a little inside the body's edge, so the ridge of the back never reads a dot that belongs to a fin or to nothing
      }
      rings.push(ring);
    });
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < SIDES; k++) { const a = rings[i], b = rings[i + 1], k2 = (k + 1) % SIDES; T.push([a[k], a[k2], b[k]]); T.push([a[k2], b[k2], b[k]]); }
    const GZ = 20, GY = 12, grid = [];
    for (let i = 0; i <= GZ; i++) { grid.push([]); for (let j = 0; j <= GY; j++) grid[i].push(vert([0, Y0 + (Y1 - Y0) * j / GY, Z0 + (Z1 - Z0) * i / GZ], [1, 0, 0])); }
    for (let i = 0; i < GZ; i++) for (let j = 0; j < GY; j++) { T.push([grid[i][j], grid[i + 1][j], grid[i][j + 1]]); T.push([grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]); }
    const L = Z1 - Z0, cuts = FR.map(f => Z0 + f * L), edges = [Z0 - 1].concat(cuts, [Z1 + 1]), slices = [];
    const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    function clipPoly(poly, z, below) {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], ia = below ? a.p[2] <= z : a.p[2] >= z, ib = below ? b.p[2] <= z : b.p[2] >= z;
        if (ia) out.push(a);
        if (ia !== ib) { const t = (z - a.p[2]) / (b.p[2] - a.p[2]); out.push({ p: lerp(a.p, b.p, t), n: lerp(a.n, b.n, t), u: lerp(a.u, b.u, t) }); }
      }
      return out;
    }
    for (let s = 0; s < 6; s++) {
      const lo = edges[s] - (s > 0 ? OV * L : 0), hi = edges[s + 1] + (s < 5 ? OV * L : 0), SP = [], SN = [], SU = [], ST = [];
      T.forEach(t => {
        let poly = t.map(i => ({ p: P[i], n: Nn[i], u: UV[i] })); poly = clipPoly(poly, lo, false);
        if (poly.length >= 3) poly = clipPoly(poly, hi, true);
        if (poly.length < 3) return;
        const base = SP.length;
        poly.forEach(v => { const ln = Math.hypot(v.n[0], v.n[1], v.n[2]); SP.push(v.p); SN.push(ln > 1e-9 ? v.n.map(q => q / ln) : [1, 0, 0]); SU.push(v.u); });
        for (let i = 1; i < poly.length - 1; i++) {
          const pa = SP[base], pb = SP[base + i], pc = SP[base + i + 1];
          const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
          if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) > 1e-13) ST.push([base, base + i, base + i + 1]);
        }
      });
      slices.push({ P: SP, N: SN, UV: SU, T: ST });
    }
    // where each slice's back fin and belly fin meets the body (the line it leans about); 99 = that slice carries none
    const FRE = [0].concat(FR, [1]), fin = [];
    [[100, topr], [140, botr]].forEach(([code, edge]) => {
      for (let s = 0; s < 6; s++) {
        const c0 = Math.floor((0.03 + 0.94 * FRE[s] * L / ZS) * W), c1 = Math.floor((0.03 + 0.94 * FRE[s + 1] * L / ZS) * W); let cnt = 0, sum = 0, cols = 0;
        for (let c = c0; c < c1 && c < W; c++) { let any = false; for (let y = 0; y < H; y++) if (cls[y * W + c] === code) { cnt++; any = true; } if (any) { sum += edge[c]; cols++; } }
        if (cnt < 60) { fin.push(99.0); continue; }
        fin.push(r4(Y1 - (sum / cols / H - 0.04) / 0.92 * (Y1 - Y0)));
      }
    });
    const cx = clamp(Math.floor(ex + 1.2 * er), 0, W - 1), v = (topr[cx] + 2.0) / H, zb = Z0 + ((cx + 0.5) / W - 0.03) / 0.94 * ZS, yb = Y1 - (v - 0.04) / 0.92 * (Y1 - Y0), depth = (botr[cx] - topr[cx]) / H / 0.92 * (Y1 - Y0);
    tables.cut = cuts.map(r4); tables.fin = fin; tables.brow = [r4(yb), r4(zb), r4(0.55 * depth)]; tables.len = r4(Z1 - Z0);
    return { W, H, win, blob, cls, Dm, Rm, own, topr, botr, tables, slices, toUV, b0, b1 };
  }

  // ---- the game's model file (.mwm): the skeleton of one of the game's own one-part fish models, with this shape put in ----
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function half(v) {       // IEEE half float, round to nearest even (as Python's struct 'e')
    f32[0] = v; const x = u32[0], sign = (x >>> 16) & 0x8000; let exp = (x >>> 23) & 0xff, man = x & 0x7fffff;
    if (exp === 0xff) return sign | 0x7c00 | (man ? 0x200 : 0);
    let e = exp - 127 + 15;
    if (e >= 31) return sign | 0x7c00;
    if (e <= 0) {
      if (e < -10) return sign;
      man |= 0x800000; const shift = 14 - e; let hm = man >>> shift; const rem = man & ((1 << shift) - 1), halfway = 1 << (shift - 1);
      if (rem > halfway || (rem === halfway && (hm & 1))) hm++;
      return sign | hm;
    }
    let hm = man >>> 13; const rem = man & 0x1fff;
    let out = sign | (e << 10) | hm;
    if (rem > 0x1000 || (rem === 0x1000 && (hm & 1))) out++;
    return out;
  }
  function packn(n) {
    const x = 0.5 * (n[0] + 1), y = 0.5 * (n[1] + 1); let nx = Math.trunc(x * 32767) & 0x7fff; const ny = Math.trunc(y * 32767) & 0xffff;
    if (n[2] > 0) nx |= 0x8000;
    return (nx | (ny << 16)) >>> 0;
  }
  function b64dec(s) { const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
  function b64enc(u8) { if (typeof btoa !== 'function') return Buffer.from(u8).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  function wstr(s) { const out = []; let n = s.length; for (;;) { const c = n & 0x7f; n >>= 7; if (n) out.push(c | 0x80); else { out.push(c); break; } } for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff); return Uint8Array.from(out); }
  class Buf {
    constructor() { this.a = []; }
    u8(b) { for (let i = 0; i < b.length; i++) this.a.push(b[i]); return this; }
    i32(v) { this.a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255); return this; }
    u16(v) { this.a.push(v & 255, (v >> 8) & 255); return this; }
    f(v) { f32[0] = v; return this.i32(u32[0] | 0); }
    out() { return Uint8Array.from(this.a); }
  }
  function writeMwm(pat, mesh) {
    const P = mesh.P, Nn = mesh.N, UV = mesh.UV, T = mesh.T, n = P.length;
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; let w = 1e-3;
    P.forEach(p => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); w = Math.max(w, Math.abs(p[k])); } });
    const tags = {};
    tags.Dummies = new Buf().i32(0).out();
    let b = new Buf().i32(n); P.forEach(p => b.u16(half(p[0] / w)).u16(half(p[1] / w)).u16(half(p[2] / w)).u16(half(w))); tags.Vertices = b.out();
    const Tn = [], Bn = [];
    Nn.forEach(nv => {
      const a = Math.abs(nv[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      let t = [nv[1] * a[2] - nv[2] * a[1], nv[2] * a[0] - nv[0] * a[2], nv[0] * a[1] - nv[1] * a[0]]; const l = Math.hypot(t[0], t[1], t[2]) || 1; t = t.map(q => q / l);
      Tn.push(t); Bn.push([nv[1] * t[2] - nv[2] * t[1], nv[2] * t[0] - nv[0] * t[2], nv[0] * t[1] - nv[1] * t[0]]);
    });
    [['Normals', Nn], ['Binormals', Bn], ['Tangents', Tn]].forEach(([nm, arr]) => {
      const bb = new Buf().i32(n); arr.forEach(x => { const l = Math.hypot(x[0], x[1], x[2]) || 1; bb.i32(packn([x[0] / l, x[1] / l, x[2] / l]) | 0); }); tags[nm] = bb.out();
    });
    b = new Buf().i32(n); UV.forEach(u => b.u16(half(u[0])).u16(half(u[1]))); tags.TexCoords0 = b.out();
    b = new Buf().i32(1).i32(pat.h).i32(T.length * 3); T.forEach(t => b.i32(t[0]).i32(t[1]).i32(t[2])); b.u8(b64dec(pat.mat)); tags.MeshParts = b.out();
    b = new Buf(); lo.forEach(v => b.f(v)); hi.forEach(v => b.f(v)); tags.BoundingBox = b.out();
    const c = lo.map((v, k) => (v + hi[k]) / 2); let rad = 0; P.forEach(p => { rad = Math.max(rad, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])); });
    b = new Buf(); c.forEach(v => b.f(v)); b.f(rad); tags.BoundingSphere = b.out();
    b = new Buf().i32(T.length).i32(n); hi.forEach((v, k) => b.f(v - lo[k])); tags.ModelInfo = b.out();
    tags.Sections = new Buf().i32(0).out(); tags.HavokCollisionGeometry = new Buf().i32(0).out(); tags.LODs = new Buf().i32(0).out();
    const hdr = b64dec(pat.hdr), bodies = pat.order.map(t => { const nm = wstr(t), data = tags[t] || b64dec(pat.kept[t]); const o = new Uint8Array(nm.length + data.length); o.set(nm, 0); o.set(data, nm.length); return [t, o]; });
    let idxlen = 4; pat.idx.forEach(t => { idxlen += wstr(t).length + 4; });
    let at = hdr.length + idxlen; const offs = {}; bodies.forEach(([t, o]) => { offs[t] = at; at += o.length; });
    const out = new Buf().u8(hdr).i32(pat.idx.length); pat.idx.forEach(t => out.u8(wstr(t)).i32(offs[t])); bodies.forEach(([t, o]) => out.u8(o));
    return out.out();
  }
  return { W, H, curve, insidePoly, windowOf, build, writeMwm, half, packn, b64enc, b64dec };
});
