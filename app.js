// ARCA FISH LAB v0.7 - the app. The design lives in a fixed drawing frame 1 unit wide (so paint keeps its place when the shape
// changes); "Length in game" scales it to metres when it is built. FishCore (fishcore.js) does the building.
// The skin picture is drawn as the fish's LEFT side (nose to the left). Side A = the left flank, side B = the right flank; with
// "Same skin on both sides" on, B is A.
(function () {
  'use strict';
  const C = FishCore, W = C.W, H = C.H, PAT = JSON.parse(document.getElementById('pattern').textContent);
  const YH = 0.92 * H / (0.94 * W) / 2, WIN = { Z0: -0.5, Z1: 0.5, Y0: -YH, Y1: YH, ZS: 1.0 };
  const $ = id => document.getElementById(id), clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const sm = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const toHex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const pressed = id => $(id).getAttribute('aria-pressed') === 'true', press = (id, v) => $(id).setAttribute('aria-pressed', v ? 'true' : 'false');
  function fresh() {
    return { v: 4, eyes: null, name: 'My First Fish', lenCm: 14, pace: 1.0, wag: 1.0, skinMirror: true,
      palette: ['#ff5a3c', '#ffd24a', '#5cf2ff', '#b06cff', '#ffffff', '#101418'],
      body: { wide: 1.0, widthL: null, width: [[-0.36, 0.004], [-0.27, 0.045], [-0.12, 0.072], [0.05, 0.066], [0.22, 0.03], [0.33, 0.012]],
        top: [[-0.36, 0.006], [-0.27, 0.07], [-0.12, 0.11], [0.05, 0.105], [0.22, 0.052], [0.33, 0.024]],
        bot: [[-0.36, -0.006], [-0.27, -0.064], [-0.12, -0.099], [0.05, -0.087], [0.22, -0.041], [0.33, -0.024]] },
      fins: [{ side: 'back', pts: [[-0.12, 0.1], [-0.03, 0.2], [0.11, 0.235], [0.09, 0.17], [0.17, 0.07]] },
        { side: 'belly', pts: [[-0.09, -0.09], [0.0, -0.2], [0.1, -0.22], [0.07, -0.15], [0.12, -0.07]] }],
      tail: { pts: [[0.31, 0.024], [0.4, 0.12], [0.485, 0.2], [0.45, 0.07], [0.42, 0.0], [0.45, -0.07], [0.485, -0.2], [0.4, -0.12], [0.31, -0.024]] },
      look: { back: '#27485c', flank: '#4f8f9c', belly: '#e6ecdf', fin: '#3d7f8a', tip: '#bfe6df', rays: 0.5, scales: 0.35, eye: '#f2b84b', eyeSize: 1.0, glowLit: true } };
  }
  let D = fresh(), built = null, tab = 'shape', selFin = 0, mode = 'colour', dirtyShape = true, dirtySkin = true, texDirty = true;
  const brushCol = { colour: '#ff5a3c', glow: '#5cf2ff' }, recent = [];
  // per side: paint (colour, RGBA), glow (the glow marks: their own colour + how strongly, RGBA), and what is made from them:
  // skin (what shows in the light) and gimg (the glow marks that are on the fish)
  const mkLayer = () => ({ paint: new Uint8ClampedArray(W * H * 4), glow: new Uint8ClampedArray(W * H * 4), skin: new Uint8ClampedArray(W * H * 4), gimg: new Uint8ClampedArray(W * H * 4) });
  const L = { A: mkLayer(), B: mkLayer() }, cut = new Uint8Array(W * H);      // cut: 1 = fin cut away here (holes and tears)
  let selEye = 0, cutting = false, cutHit = false, paintView = '3d';
  const toPic = p => [(0.03 + 0.94 * (p[0] - WIN.Z0) / WIN.ZS) * W, (0.04 + 0.92 * (WIN.Y1 - p[1]) / (WIN.Y1 - WIN.Y0)) * H];
  const picToDes = (x, y) => [WIN.Z0 + (x / W - 0.03) / 0.94 * WIN.ZS, WIN.Y1 - (y / H - 0.04) / 0.92 * (WIN.Y1 - WIN.Y0)];
  // a curved outline: a smooth line through the handles (6 steps between each two; the handles stay on it)
  function smooth(pts) { const n = pts.length, out = [], g = i => pts[clamp(i, 0, n - 1)]; for (let i = 0; i < n - 1; i++) { const a = g(i - 1), b = g(i), c = g(i + 1), d = g(i + 2); for (let k = 0; k < 6; k++) { const t = k / 6, t2 = t * t, t3 = t2 * t; out.push([0, 1].map(q => 0.5 * (2 * b[q] + (c[q] - a[q]) * t + (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t2 + (3 * b[q] - 3 * c[q] + d[q] - a[q]) * t3))); } } out.push(pts[n - 1].slice()); return out; }
  const curFin = () => selFin < D.fins.length ? D.fins[selFin] : D.tail;
  // ---- FINS OFF THE CENTRE LINE (v0.5): side (pectoral) fins, and back / belly fins moved off the ridge. Each kind has its zone
  // around the body (the user's rule): back and belly fins up to 25 degrees off the ridge, side fins within 18 degrees of the flank's middle.
  // Such a fin is its own flat piece standing out of the skin, fixed to the body section under it. Its look comes from the fin
  // settings, kept in a strip in the picture's unused margin (a "swatch"); up to four of them (a mirrored pair counts once).
  const ZONE = { back: [0, 25], belly: [0, 25], side: [-18, 18] }, SLOTS = [{ x0: 1, y0: 16, x1: 12, y1: 239, vert: true }, { x0: 499, y0: 16, x1: 510, y1: 239, vert: true }, { x0: 16, y0: 1, x1: 495, y1: 7 }, { x0: 16, y0: 248, x1: 495, y1: 254 }];
  const offFin = f => !!f && f !== D.tail && (f.side === 'side' || Math.abs(f.ang || 0) > 0.5);
  let B3 = null, swMap = {};      // B3: the body's curves (made at every rebuild); swMap: fin's owner code -> its swatch strip
  function body3() { const top = C.curve(D.body.top), bot = C.curve(D.body.bot), wr = C.curve(D.body.width), wl = C.curve(D.body.widthL || D.body.width), zs = D.body.top.map(p => p[0]), z0 = Math.min(...zs), z1 = Math.max(...zs), cz = z => clamp(z, z0, z1); return { z0, z1, top: z => top(cz(z)), bot: z => bot(cz(z)), w: (s, z) => Math.max(1e-4, (s > 0 ? wr : wl)(cz(z)) * D.body.wide) }; }
  // how far a fin's point stands out of the skin, and back again (a back fin's points are kept as heights in the side picture, a side fin's as "how far out")
  const hgtOf = (f, p) => f.side === 'back' ? p[1] - B3.top(p[0]) : f.side === 'belly' ? B3.bot(p[0]) - p[1] : p[1];
  const fromHgt = (f, z, h) => f.side === 'back' ? B3.top(z) + h : f.side === 'belly' ? B3.bot(z) - h : h;
  // a point of such a fin in 3D (drawing-frame units): s = which flank (+1 right, -1 left), z = along the body, hgt = how far out of the skin
  function finPt(f, s, z, hgt) {
    const a = (f.ang || 0) * Math.PI / 180, t = f.side === 'back' ? Math.PI / 2 - a : f.side === 'belly' ? -Math.PI / 2 + a : a, cy = (B3.top(z) + B3.bot(z)) / 2, h = Math.max(1e-4, (B3.top(z) - B3.bot(z)) / 2), w = B3.w(s, z), ct = Math.cos(t), st = Math.sin(t);
    let nx = ct / w, ny = st / h; const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const tl = (f.tilt || 0) * Math.PI / 180, dx = nx * Math.cos(tl) - ny * Math.sin(tl), dy = nx * Math.sin(tl) + ny * Math.cos(tl);
    return [s * (w * ct + dx * hgt), cy + h * st + dy * hgt, z];
  }
  const sideShown = f => f.mirror === false ? (f.flank || 1) : (lastMats && lastMats[0].cam < 0 ? -1 : 1);
  const fin3 = (f, p) => offFin(f) && B3 ? finPt(f, sideShown(f), p[0], Math.max(0, hgtOf(f, p))) : [0, p[1], p[0]];
  const dense = pts => { const out = []; for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 4; k++) out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k / 4, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k / 4]); out.push(pts[pts.length - 1].slice()); return out; };
  // the pieces themselves: a fan of triangles from the middle of the fin's root to its outline, added to the body section under the root.
  // In the picture a fin is unrolled like a fan: along the strip = round the fan (so the rays run root to rim), across it = root to tip.
  function addSideFins() {
    const k = built.k, cuts = built.tables.cut;
    D.fins.forEach((f, i) => {
      const sw = swMap[2 + i]; if (!sw || f.pts.length < 3) return;
      const ol = f.curve ? smooth(f.pts) : dense(f.pts), a = f.pts[0], b = f.pts[f.pts.length - 1], zc = (a[0] + b[0]) / 2, Hs = ol.map(p => Math.max(0, hgtOf(f, p)));
      const pol = ol.map((p, n) => [Math.atan2(Hs[n], p[0] - zc), Math.hypot(Hs[n], p[0] - zc)]), rmax = Math.max(1e-6, ...pol.map(q => q[1]));
      const uv = (ang, r) => { const al = clamp(1 - ang / Math.PI, 0, 1), d = clamp(r / rmax, 0, 1); return sw.vert ? [(sw.x0 + 0.5 + d * (sw.x1 - sw.x0)) / W, (sw.y0 + 0.5 + al * (sw.y1 - sw.y0)) / H] : [(sw.x0 + 0.5 + al * (sw.x1 - sw.x0)) / W, (sw.y0 + 0.5 + d * (sw.y1 - sw.y0)) / H]; };
      const S = built.slices[Math.min(built.slices.length - 1, cuts.filter(c => c < zc * k).length)], sc = v => [v[0] * k, v[1] * k, v[2] * k];
      (f.mirror === false ? [f.flank || 1] : [1, -1]).forEach(s => {
        const O = finPt(f, s, zc, -0.012), P = ol.map((p, n) => finPt(f, s, p[0], Hs[n]));
        for (let n = 0; n < ol.length - 1; n++) {
          const A = P[n], Bq = P[n + 1], e1 = [A[0] - O[0], A[1] - O[1], A[2] - O[2]], e2 = [Bq[0] - O[0], Bq[1] - O[1], Bq[2] - O[2]]; let nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const nl = Math.hypot(nr[0], nr[1], nr[2]); if (nl < 1e-12) continue; nr = nr.map(v => v / nl);
          const uo = uv((pol[n][0] + pol[n + 1][0]) / 2, 0), ua = uv(pol[n][0], pol[n][1]), ub = uv(pol[n + 1][0], pol[n + 1][1]);
          [[nr, [0, 1, 2]], [nr.map(v => -v), [0, 2, 1]]].forEach(([nn, order]) => { const i0 = S.P.length; [[O, uo], [A, ua], [Bq, ub]].forEach(([q, u]) => { S.P.push(sc(q)); S.N.push(nn); S.UV.push(u); }); S.T.push(order.map(o => i0 + o)); });      // both faces: the game draws one face of a triangle only
        }
      });
    });
  }
  const lay = k => D.skinMirror ? L.A : L[k];
  function say(t, bad) { const s = $('status'); s.textContent = t; s.className = bad ? 'bad' : ''; }

  // ---- the design in metres, as the core wants it ----
  function metres() {
    let z0 = 1e9, z1 = -1e9; const all = D.body.top.concat(D.body.bot); D.fins.forEach(f => f.pts.forEach(p => all.push(p))); if (D.tail) D.tail.pts.forEach(p => all.push(p));
    all.forEach(p => { z0 = Math.min(z0, p[0]); z1 = Math.max(z1, p[0]); });
    const k = D.lenCm / 100 / Math.max(0.05, z1 - z0), S = pts => pts.map(p => [p[0] * k, p[1] * k]), byZ = a => a.slice().sort((p, q) => p[0] - q[0]);
    const top = byZ(D.body.top), bot = byZ(D.body.bot), bz0 = top[0][0], bz1 = top[top.length - 1][0]; bot[0] = [bz0, bot[0][1]]; bot[bot.length - 1] = [bz1, bot[bot.length - 1][1]];
    const wd = a => byZ(a).map(p => [p[0] * k, p[1] * k * D.body.wide]);
    // the core's +x is the fish's right flank: "width" is the right one, "widthL" the left
    return { k, d: { win: { Z0: WIN.Z0 * k, Z1: WIN.Z1 * k, Y0: WIN.Y0 * k, Y1: WIN.Y1 * k, ZS: WIN.ZS * k },
      body: { z0: bz0 * k, z1: bz1 * k, width: wd(D.body.width), widthL: D.body.widthL ? wd(D.body.widthL) : null, top: S(top), bot: S(bot) }, cut, swatches: Object.keys(swMap).map(o => { const w = swMap[o]; return { x0: w.x0 - 1, y0: w.y0 - 1, x1: w.x1 + 1, y1: w.y1 + 1, own: +o }; }), fins: D.fins.map(f => ({ side: f.side, off: offFin(f), pts: S(f.curve ? smooth(f.pts) : f.pts) })), tail: D.tail ? { pts: S(D.tail.curve ? smooth(D.tail.pts) : D.tail.pts) } : null } };
  }
  function rebuild() {
    try {
      const top = C.curve(D.body.top), bot = C.curve(D.body.bot);
      D.fins.forEach(f => { const e = f.side === 'back' ? top : f.side === 'belly' ? bot : () => 0, a = f.pts[0], b = f.pts[f.pts.length - 1]; a[1] = e(a[0]); b[1] = e(b[0]); });
      B3 = body3(); swMap = {}; let slot = 0; D.fins.forEach((f, i) => { if (offFin(f) && slot < SLOTS.length) swMap[2 + i] = SLOTS[slot++]; });
      const m = metres(); built = C.build(m.d); built.k = m.k; addSideFins(); dirtyShape = false; dirtySkin = true;
      if (!D.eyes) { const e = built.tables.eye; D.eyes = D.look.eyeSize > 0.05 ? [{ p: picToDes(e[0], e[1]), size: D.look.eyeSize, type: 'round', col: D.look.eye }] : []; eyeUI(); }
      const t = built.tables; $('facts').textContent = 'About ' + D.lenCm.toFixed(1) + ' cm long. Back fin on ' + t.fin.slice(0, 6).filter(v => v < 50).length + ' of its 6 body sections, belly fin on ' + t.fin.slice(6).filter(v => v < 50).length + '. ' + built.slices.reduce((s, x) => s + x.T.length, 0) + ' triangles.';
      return true;
    } catch (e) { say('This shape cannot be built (' + e.message + '). Press Undo.', true); return false; }
  }
  // ---- THE SKIN of one side: base colours shaded by the map, then your paint, then the eye. This is what the game will show. ----
  const EYES = [['round', 'Round'], ['slit', 'Slit'], ['bar', 'Bar'], ['ring', 'Ringed'], ['bead', 'Bead'], ['compound', 'Compound'], ['blank', 'Blank']];
  // one dot of an eye: how much ring, iris and pupil there is at (dx, dy) from its middle (in eye radii), and whether the glint is there
  function eyeParts(t, dx, dy, dd) {
    const blank = t === 'blank', ring = blank ? 0 : sm(1.25 - dd, 0, 0.2), iris = sm(1.0 - dd, 0, 0.15), hl = !blank && t !== 'compound' && Math.hypot(dx + 0.3, dy + 0.3) < 0.18; let pup = 0;
    if (t === 'round') pup = sm(0.5 - dd, 0, 0.12);
    else if (t === 'slit') pup = sm(1 - Math.hypot(dx / 0.24, dy / 0.9), 0, 0.3);
    else if (t === 'bar') pup = sm(1 - Math.hypot(dx / 0.85, dy / 0.26), 0, 0.3);
    else if (t === 'ring') pup = Math.max(sm(0.28 - dd, 0, 0.1), sm(0.11 - Math.abs(dd - 0.7), 0, 0.07));
    else if (t === 'bead') pup = 0.88 * sm(0.92 - dd, 0, 0.12);
    else if (t === 'compound') { const v = dy * 3.2 + 100, row = Math.floor(v), u = dx * 3.2 + 100 + (row % 2) * 0.5, fu = u - Math.floor(u) - 0.5, fv = v - row - 0.5; pup = 0.75 * sm(Math.hypot(fu, fv), 0.3, 0.5); }
    return [ring, iris, pup, hl ? 1 : 0];
  }
  // THE FISH IN LAYERS, for the game (v0.6). In the game every feature of a Lab fish is a gene with two versions - as designed here,
  // or plain - so the game must be able to put a fish together feature by feature. While LAB is set, composite() also fills:
  //   A = the colours as picked (no shading), P = the pale colours of a plain fish, M = three shadings per dot (always / scales / rays),
  //   E = the eyes (colour + how much), C = how solid each dot is (see-through fins).
  let LAB = null;
  const pale = (r, g, b) => { const l = 0.3 * r + 0.59 * g + 0.11 * b; return [r, g, b].map(v => { const q = l + (v - l) * 0.25; return q + (238 - q) * 0.5; }); };
  function composite(key) {
    if (!built) return;
    const K = L[key], paint = K.paint, glow = K.glow, skin = K.skin, gimg = K.gimg, Lk = D.look, cb = hex(Lk.back), cf = hex(Lk.flank), cl = hex(Lk.belly), cn = hex(Lk.fin), ct = hex(Lk.tip), cls = built.cls, own = built.own, Dm = built.Dm, Rm = built.Rm, tr = built.topr, br = built.botr;
    const er0 = built.tables.eye[2], eyes = (D.eyes || []).map(e => { const q = toPic(e.p); return { x: q[0], y: q[1], r: Math.max(1.5, er0 * e.size), c: hex(e.col), rc: hex(e.ring || '#14181c'), pc: hex(e.pup || '#000000'), t: e.type }; });
    const fcache = {}, fp = o => { const f = (o === 250 ? D.tail : D.fins[o - 2]) || {}; return { a: 255 * (1 - clamp(f.clear || 0, 0, 0.95)), rays: f.rays == null ? Lk.rays : f.rays, rn: f.rayN || 1 }; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4, c = cls[i]; let r = 0, g = 0, b = 0, a = 0, ar = 0, ag = 0, ab = 0, ks = 1, kr = 1, ksh = 1, ecol = null, ealpha = 0;
      if (c === 255) {
        const rel = clamp((y + 0.5 - tr[x]) / Math.max(1, br[x] - tr[x]), 0, 1), t1 = sm(rel, 0.12, 0.5), t2 = sm(rel, 0.58, 0.92);
        r = cb[0] + (cf[0] - cb[0]) * t1; g = cb[1] + (cf[1] - cb[1]) * t1; b = cb[2] + (cf[2] - cb[2]) * t1;
        r += (cl[0] - r) * t2; g += (cl[1] - g) * t2; b += (cl[2] - b) * t2; ar = r; ag = g; ab = b;
        if (Lk.scales > 0) { const depth = Math.max(8, br[x] - tr[x]), cs = Math.max(4, depth / 9), row = Math.floor((y - tr[x]) / cs), u = (x + (row % 2) * cs / 2) / cs, v = (y - tr[x]) / cs; const du = u - Math.floor(u) - 0.5, dv = v - Math.floor(v) - 0.1, rim = Math.abs(Math.hypot(du, dv * 0.9) - 0.5); const k = 1 - Lk.scales * 0.35 * (1 - sm(rim, 0.0, 0.14)) * (1 - t2 * 0.6); ks = k; r *= k; g *= k; b *= k; }
        const sh = 1 - 0.18 * Math.pow(Math.abs(rel - 0.42) * 1.6, 2); ksh = sh; r *= sh; g *= sh; b *= sh; a = 255;
      } else if ((c === 100 || c === 140 || c === 180) && (LAB || !cut[i])) {
        const F = fcache[own[i]] || (fcache[own[i]] = fp(own[i])), d = Dm[i], t = sm(d, 0.45, 1.0); r = cn[0] + (ct[0] - cn[0]) * t; g = cn[1] + (ct[1] - cn[1]) * t; b = cn[2] + (ct[2] - cn[2]) * t;
        const p = Rm[i] * (c === 180 ? 26 : 60) * F.rn, f = p - Math.floor(p), ray = sm(1 - Math.abs(f - 0.5) / (0.16 + 0.1 * (1 - d)), 0, 1) * F.rays, k = 1 - 0.42 * ray; ar = r; ag = g; ab = b; kr = k; r *= k; g *= k; b *= k;
        a = F.a + (255 - F.a) * ray * 0.5;      // a see-through fin: the rays stay more solid than the skin between them
      } else if (c === 254 && swMap[own[i]]) {
        // a swatch: the look of a fin off the centre line. Along the strip = round the fan (the rays), across it = root to tip.
        const w = swMap[own[i]], F = fcache[own[i]] || (fcache[own[i]] = fp(own[i])), d = clamp(w.vert ? (x - w.x0) / (w.x1 - w.x0) : (y - w.y0) / (w.y1 - w.y0), 0, 1), al = clamp(w.vert ? (y - w.y0) / (w.y1 - w.y0) : (x - w.x0) / (w.x1 - w.x0), 0, 1), t = sm(d, 0.45, 1.0);
        r = cn[0] + (ct[0] - cn[0]) * t; g = cn[1] + (ct[1] - cn[1]) * t; b = cn[2] + (ct[2] - cn[2]) * t;
        const p = al * 14 * F.rn, f = p - Math.floor(p), ray = sm(1 - Math.abs(f - 0.5) / 0.22, 0, 1) * F.rays, k = 1 - 0.42 * ray; ar = r; ag = g; ab = b; kr = k; r *= k; g *= k; b *= k; a = F.a + (255 - F.a) * ray * 0.5;
      }
      if (a && c !== 254) { const pa = paint[o + 3] / 255; r += (paint[o] - r) * pa; g += (paint[o + 1] - g) * pa; b += (paint[o + 2] - b) * pa; }
      if (a && c === 255) for (let n = 0; n < eyes.length; n++) {
        const e = eyes[n], dx = (x + 0.5 - e.x) / e.r, dy = (y + 0.5 - e.y) / e.r, dd = Math.hypot(dx, dy); if (dd >= 1.25) continue;
        const [ring, iris, pup, hl] = eyeParts(e.t, dx, dy, dd);
        r += (e.rc[0] - r) * ring; g += (e.rc[1] - g) * ring; b += (e.rc[2] - b) * ring; r += (e.c[0] - r) * iris; g += (e.c[1] - g) * iris; b += (e.c[2] - b) * iris; r += (e.pc[0] - r) * pup; g += (e.pc[1] - g) * pup; b += (e.pc[2] - b) * pup; if (hl) { r = g = b = 240; }
        if (LAB) { if (!ecol) ecol = [0, 0, 0]; [[e.rc, ring], [e.c, iris], [e.pc, pup], [[240, 240, 240], hl]].forEach(([cc, tt]) => { for (let q = 0; q < 3; q++) ecol[q] = ecol[q] * (1 - tt) + cc[q] * tt; ealpha = ealpha * (1 - tt) + tt; }); }
      }
      if (LAB && a) {
        const q3 = i * 3, pl = pale(ar, ag, ab); LAB.A[q3] = ar; LAB.A[q3 + 1] = ag; LAB.A[q3 + 2] = ab; LAB.P[q3] = pl[0]; LAB.P[q3 + 1] = pl[1]; LAB.P[q3 + 2] = pl[2];
        LAB.M[q3] = ksh * 255; LAB.M[q3 + 1] = ks * 255; LAB.M[q3 + 2] = kr * 255; LAB.C[i] = c === 255 ? 255 : a;
        if (ecol && ealpha > 0.004) { LAB.E[o] = ecol[0] / ealpha; LAB.E[o + 1] = ecol[1] / ealpha; LAB.E[o + 2] = ecol[2] / ealpha; LAB.E[o + 3] = ealpha * 255; }
      }
      skin[o] = r; skin[o + 1] = g; skin[o + 2] = b; skin[o + 3] = a;
      gimg[o] = glow[o]; gimg[o + 1] = glow[o + 1]; gimg[o + 2] = glow[o + 2]; gimg[o + 3] = a && c !== 254 ? glow[o + 3] : 0;
    }
  }
  function compositeAll() { composite('A'); if (!D.skinMirror) composite('B'); dirtySkin = false; texDirty = true; }

  // ---- undo: the design as it was before each change (and the paint layers before each stroke) ----
  const undos = [];
  function remember(withPaint) { undos.push({ d: JSON.stringify(D), p: withPaint ? [L.A.paint.slice(), L.A.glow.slice(), L.B.paint.slice(), L.B.glow.slice(), cut.slice()] : null }); if (undos.length > 16) undos.shift(); }
  function undo() {
    const u = undos.pop(); if (!u) { say('Nothing to undo.'); return; }
    D = JSON.parse(u.d); if (u.p) { L.A.paint.set(u.p[0]); L.A.glow.set(u.p[1]); L.B.paint.set(u.p[2]); L.B.glow.set(u.p[3]); cut.set(u.p[4]); }
    selFin = Math.min(selFin, D.fins.length); selEye = 0; syncAll(); dirtyShape = true; dirtySkin = true; say('Undone.');
  }

  // ---- what is selected, and its handles (shared by the 3D view and the sheets) ----
  const selPart = () => tab === 'shape' ? 'body' : tab === 'fins' ? (selFin < D.fins.length ? D.fins[selFin] : D.tail) : null;
  function handles() {
    const hs = [];
    if (tab === 'shape') {
      D.body.top.forEach(p => hs.push({ p, kind: 'top', arr: D.body.top })); D.body.bot.forEach(p => hs.push({ p, kind: 'bot', arr: D.body.bot }));
      D.body.width.forEach(p => hs.push({ p, kind: 'wid', side: 1, arr: D.body.width }));
      (D.body.widthL || D.body.width).forEach(p => hs.push({ p, kind: 'wid', side: -1, arr: D.body.widthL || D.body.width }));
    }
    if (tab === 'fins' && !cutting) { const f = selPart(); if (f) f.pts.forEach((p, i) => hs.push({ p, kind: 'fin', i, f, arr: f.pts })); }
    if (tab === 'look') (D.eyes || []).forEach((e, i) => hs.push({ p: e.p, kind: 'eye', i }));
    return hs;
  }
  function removeHandle(h) {
    if (h.kind === 'eye') { remember(false); D.eyes.splice(h.i, 1); selEye = 0; if (EP[lookSel]) lookSel = 'back'; eyeUI(); pickLook(); dirtySkin = true; say('Eye removed.'); return; }
    if (h.kind === 'fin') { const last = h.f === D.tail ? -1 : h.f.pts.length - 1; if (h.f.pts.length <= 3 || h.i === 0 || h.i === last) { say('A fin keeps at least three handles, and the two that sit on the body stay.'); return; } remember(false); h.f.pts.splice(h.i, 1); }
    else { const s = h.arr.slice().sort((a, b) => a[0] - b[0]); if (h.arr.length <= 3 || h.p === s[0] || h.p === s[s.length - 1]) { say('The handles at the nose and at the tail end stay, and each line keeps at least three.'); return; } remember(false); h.arr.splice(h.arr.indexOf(h.p), 1); }
    dirtyShape = true; say('Handle removed.');
  }
  function selectOwner(o) {
    if (!o) return false;
    if (o === 1) setTab('shape'); else if (o === 250) { selFin = D.fins.length; setTab('fins'); } else if (o >= 2 && o - 2 < D.fins.length) { selFin = o - 2; setTab('fins'); } else return false;
    finButtons(); return true;
  }
  // a gesture reader for a canvas: one finger or the mouse drags / taps / double-taps; two fingers pinch and slide; the wheel zooms
  function gestures(el, cb) {
    const pts = new Map(); let one = null, pinch = null, lastTap = null;
    const pos = e => { const r = el.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * el.width, (e.clientY - r.top) / r.height * el.height]; };
    el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) { if (one) { cb.cancel && cb.cancel(); one = null; } const a = [...pts.values()]; pinch = { d: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), c: [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2] }; return; }
      if (pts.size === 1) { const [x, y] = pos(e); one = { x0: e.clientX, y0: e.clientY, cx: e.clientX, cy: e.clientY, moved: false, t: performance.now() }; cb.down(x, y, e); }
    });
    el.addEventListener('pointermove', e => {
      const [x, y] = pos(e);
      if (pts.has(e.pointerId)) pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size >= 2) { const a = [...pts.values()], d = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]), c = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2]; cb.pinch && cb.pinch(d / Math.max(1, pinch.d), c[0] - pinch.c[0], c[1] - pinch.c[1], pos({ clientX: c[0], clientY: c[1] })); pinch = { d, c }; return; }
      if (one) { if (Math.hypot(e.clientX - one.x0, e.clientY - one.y0) > 6) one.moved = true; cb.move(x, y, e, e.clientX - one.cx, e.clientY - one.cy, one.moved); one.cx = e.clientX; one.cy = e.clientY; }
      else cb.hover && cb.hover(x, y);
    });
    const up = e => {
      const had = pts.has(e.pointerId); pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!had || !one || pts.size > 0) return;
      const [x, y] = pos(e), o = one; one = null; cb.up && cb.up(x, y);
      if (!o.moved && performance.now() - o.t < 600 && e.type === 'pointerup') {
        const now = performance.now();
        if (lastTap && now - lastTap.t < 380 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) { lastTap = null; cb.dbl && cb.dbl(x, y); }
        else { lastTap = { t: now, x: e.clientX, y: e.clientY }; cb.tap && cb.tap(x, y); }
      }
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => { cb.leave && cb.leave(); }); el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = pos(e); cb.wheel && cb.wheel(e.deltaY, x, y); }, { passive: false });
  }

  // ---- painting: a soft round dab into one side's layer (both, when the skin is mirrored) ----
  function dab(key, px, py) {
    const m = tab === 'fins' ? 'cut' : mode, K = lay(key), R = m === 'cut' ? +$('cutsize').value : +$('bsize').value, str = +$('bstr').value, bc = hex(brushCol[m] || '#ffffff');
    for (let yy = Math.max(0, Math.floor(py - R)); yy <= Math.min(H - 1, Math.ceil(py + R)); yy++) for (let xx = Math.max(0, Math.floor(px - R)); xx <= Math.min(W - 1, Math.ceil(px + R)); xx++) {
      const d = Math.hypot(xx + 0.5 - px, yy + 0.5 - py) / R; if (d > 1) continue; const i = yy * W + xx; if (!built || !built.cls[i] || built.cls[i] === 254) continue;
      if (m === 'cut') { if (built.own[i] >= 2 && !cut[i]) { cut[i] = 1; cutHit = true; } continue; }
      const k = str * (1 - sm(d, 0.5, 1.0)) * 0.5, o = i * 4;
      if (m === 'erase') { K.paint[o + 3] = K.paint[o + 3] * (1 - k); K.glow[o + 3] = K.glow[o + 3] * (1 - k); continue; }
      const T = m === 'glow' ? K.glow : K.paint, a0 = T[o + 3] / 255, a1 = a0 + (1 - a0) * k; for (let c = 0; c < 3; c++) T[o + c] = (T[o + c] * a0 * (1 - k) + bc[c] * k) / Math.max(1e-6, a0 * (1 - k) + k); T[o + 3] = a1 * 255;
    }
    dirtySkin = true;
  }
  function strokeStart() { remember(true); if (tab === 'paint' && mode !== 'erase') { const c = brushCol[mode], i = recent.indexOf(c); if (i >= 0) recent.splice(i, 1); recent.unshift(c); if (recent.length > 10) recent.pop(); drawPalette(); } }
  function strokeTo(st, key, px, py) {
    if (st.last && st.key === key && Math.hypot(px - st.last[0], py - st.last[1]) < 60) { const n = Math.max(1, Math.ceil(Math.hypot(px - st.last[0], py - st.last[1]) / Math.max(1, (tab === 'fins' ? +$('cutsize').value : +$('bsize').value) * 0.3))); for (let k = 1; k <= n; k++) dab(key, st.last[0] + (px - st.last[0]) * k / n, st.last[1] + (py - st.last[1]) * k / n); }
    else dab(key, px, py);
    st.last = [px, py]; st.key = key;
  }

  // the flat views (Paint tab): how far in, and where (in drawing-frame units), shared by both pictures
  const SV = { zoom: 1, px: 0, py: 0 };

  // ---- THE 3D WORKSPACE: the six slices, hinged and waved as the plugin does it, wearing the skin. On the Shape, Fins, Skin and
  // Paint tabs it holds still and is worked on directly. ----
  const tk = $('tank'), hud = $('hud'), hx = hud.getContext('2d'), gl = tk.getContext('webgl', { antialias: true, alpha: false, stencil: true });
  let prog = null, pick = null, fbo = null, fboTex = null, fboDepth = null, bufs = [], tx = {}, yaw = -0.9, pitch = 0.22, zoom = 1, panX = 0, panY = 0, T0 = performance.now();
  let MV = null, lastMats = null, d3 = { drag: null, orbit: false, st: null, hot: null, cur: null, moved: false };
  const VS = 'attribute vec3 p;attribute vec3 n;attribute vec2 u;uniform mat4 mvp;uniform mat4 mdl;varying vec2 vu;varying vec3 vn;varying float vx;void main(){vu=u;vx=p.x;vn=mat3(mdl)*n;gl_Position=mvp*vec4(p,1.0);}';
  // tp: 0 = draw what is solid, 1 = draw what is see-through (after everything solid, so it never hides what is behind it)
  const FS = 'precision mediump float;varying vec2 vu;varying vec3 vn;varying float vx;uniform sampler2D ta;uniform sampler2D tb;uniform sampler2D ga;uniform sampler2D gb;uniform float dark;uniform float gshow;uniform float cam;uniform float unlit;uniform float tp;uniform float nomid;void main(){if(nomid>0.5&&abs(vx)<0.00001)discard;float sd=abs(vx)<0.00001?cam:vx;vec4 c=sd<0.0?texture2D(ta,vu):texture2D(tb,vu);if(c.a<0.04)discard;if(tp<0.5){if(c.a<0.95)discard;}else{if(c.a>=0.95)discard;}vec4 g=sd<0.0?texture2D(ga,vu):texture2D(gb,vu);float gg=g.a*gshow;vec3 nn=normalize(vn);float l=mix(0.42+0.62*abs(dot(nn,normalize(vec3(0.35,0.8,0.5)))),1.0,unlit);vec3 col=mix(c.rgb,g.rgb,gg)*l*(1.0-0.86*dark)+g.rgb*gg*(0.75+1.6*dark);gl_FragColor=vec4(col,c.a);}';
  const FSP = 'precision highp float;varying vec2 vu;varying vec3 vn;varying float vx;uniform sampler2D ta;uniform float cam;uniform float nomid;void main(){if(nomid>0.5&&abs(vx)<0.00001)discard;vec4 c=texture2D(ta,vu);if(c.a<0.04)discard;float sd=abs(vx)<0.00001?cam:vx;float a=clamp(vu.x,0.0,0.9999)*255.0,b=clamp(vu.y,0.0,0.9999)*127.0;gl_FragColor=vec4(floor(a)/255.0,fract(a),(floor(b)+(sd<0.0?0.0:128.0))/255.0,fract(b)*0.996+0.004);}';
  function glInit() {
    if (!gl) { say('This browser cannot show the 3D view (no WebGL). The skin sheets still work.', true); return; }
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const mkp = fs => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.bindAttribLocation(p, 1, 'n'); gl.bindAttribLocation(p, 2, 'u'); gl.linkProgram(p); return p; };
    prog = mkp(FS); pick = mkp(FSP);
    const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    tx = { ta: mk(), tb: mk(), ga: mk(), gb: mk() }; gl.enable(gl.DEPTH_TEST);
  }
  function fit() { const r = $('stage').getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(200, Math.round(r.width * dpr)), h = Math.max(150, Math.round(r.height * dpr)); if (tk.width !== w || tk.height !== h) { tk.width = hud.width = w; tk.height = hud.height = h; fbo = null; } }
  function meshUp() {
    if (!gl || !built) return; bufs.forEach(b => gl.deleteBuffer(b.b)); bufs = [];
    built.slices.forEach(s => { const a = new Float32Array(s.T.length * 3 * 8); let o = 0; s.T.forEach(t => t.forEach(i => { a.set(s.P[i], o); a.set(s.N[i], o + 3); a.set(s.UV[i], o + 6); o += 8; })); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); bufs.push({ b, n: s.T.length * 3 }); });
  }
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
  const ident = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), trans = (x, y, z) => { const m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
  const rotY = a => { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }, rotX = a => { const m = ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
  function persp(f, asp, n, fa) { const m = new Float32Array(16), t = 1 / Math.tan(f / 2); m[0] = t / asp; m[5] = t; m[10] = (fa + n) / (n - fa); m[11] = -1; m[14] = 2 * fa * n / (n - fa); return m; }
  const xf = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14], m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]];
  function inv(m) {
    const a = Array.from(m), o = Array.from(ident());
    for (let c = 0; c < 4; c++) {
      let pv = c; for (let r = c + 1; r < 4; r++) if (Math.abs(a[c * 4 + r]) > Math.abs(a[c * 4 + pv])) pv = r;
      if (Math.abs(a[c * 4 + pv]) < 1e-12) return null;
      if (pv !== c) for (let k = 0; k < 4; k++) { let t = a[k * 4 + c]; a[k * 4 + c] = a[k * 4 + pv]; a[k * 4 + pv] = t; t = o[k * 4 + c]; o[k * 4 + c] = o[k * 4 + pv]; o[k * 4 + pv] = t; }
      const d = a[c * 4 + c]; for (let k = 0; k < 4; k++) { a[k * 4 + c] /= d; o[k * 4 + c] /= d; }
      for (let r = 0; r < 4; r++) if (r !== c) { const f = a[c * 4 + r]; if (f) for (let k = 0; k < 4; k++) { a[k * 4 + r] -= f * a[k * 4 + c]; o[k * 4 + r] -= f * o[k * 4 + c]; } }
    }
    return o;
  }
  const SEG_AMP = [0, 0.5, 0.8, 1.1, 1.5, 2.0], still = () => tab === 'shape' || tab === 'fins' || tab === 'paint' || tab === 'look';
  function drawSlices(p, mats) {
    gl.useProgram(p); const bind = (unit, name, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(gl.getUniformLocation(p, name), unit); };
    bind(0, 'ta', tx.ta); bind(1, 'tb', D.skinMirror ? tx.ta : tx.tb); bind(2, 'ga', tx.ga); bind(3, 'gb', D.skinMirror ? tx.ga : tx.gb);
    for (let j = 0; j < 6 && j < bufs.length; j++) {
      gl.uniformMatrix4fv(gl.getUniformLocation(p, 'mvp'), false, mats[j].mvp); gl.uniformMatrix4fv(gl.getUniformLocation(p, 'mdl'), false, mats[j].mdl); gl.uniform1f(gl.getUniformLocation(p, 'cam'), mats[j].cam);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufs[j].b); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      gl.drawArrays(gl.TRIANGLES, 0, bufs[j].n);
    }
  }
  // what the work window shows: one 3D view, or (Paint tab, a flat mode) two flat pictures one above the other
  let lastViews = [];
  const sheetOn = () => tab === 'paint' && paintView !== '3d';
  function render(p) { gl.enable(gl.SCISSOR_TEST); gl.useProgram(p); lastViews.forEach(v => { gl.viewport(v.x, v.y, v.w, v.h); gl.scissor(v.x, v.y, v.w, v.h); gl.uniform1f(gl.getUniformLocation(p, 'nomid'), v.nomid ? 1 : 0); drawSlices(p, v.mats); }); gl.disable(gl.SCISSOR_TEST); }
  function drawTank(now) {
    if (!gl || !prog || !built) return; fit();
    if (texDirty) { const up = (t, a) => { gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(a.buffer)); }; gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); up(tx.ta, L.A.skin); up(tx.ga, L.A.gimg); if (!D.skinMirror) { up(tx.tb, L.B.skin); up(tx.gb, L.B.gimg); } texDirty = false; }
    // THE GLOW RULE (the user's): "Always glow" on = the marks always show. Off = they show only where there is no light
    // (Motion tab, Lights off) - and while they are being painted (Paint tab, Glow brush).
    const dark = tab === 'move' && pressed('v-dark') ? 1 : 0, gshow = D.look.glowLit || dark || (tab === 'paint' && mode === 'glow') ? 1 : 0;
    const t = (now - T0) / 1000, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, hold = still(), sheet = sheetOn();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, tk.width, tk.height); gl.clearColor(0.02 + 0.03 * (1 - dark), 0.09 * (1 - dark) + 0.02, 0.13 * (1 - dark) + 0.03, 1); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    lastViews = [];
    if (sheet) {
      const h2 = Math.floor(tk.height / 2), k = built.k, defs = paintView === 'lr' ? [[Math.PI / 2, 0, 1, 1, 'Left side'], [-Math.PI / 2, 0, -1, 1, 'Right side']] : [[Math.PI / 2, Math.PI / 2, 1, 1, 'From above'], [Math.PI / 2, -Math.PI / 2, 1, -1, 'From below']];
      defs.forEach((d, i) => {
        const vh = i ? h2 : tk.height - h2, R = mul(rotX(d[1]), rotY(d[0])), hw = 0.52 * k / SV.zoom, hh = hw * vh / tk.width, o = ident(); o[0] = 1 / hw; o[5] = 1 / hh; o[10] = -1 / (2 * k); o[12] = d[2] * SV.px * k / hw; o[13] = d[3] * SV.py * k / hh;
        const m = { mvp: mul(o, R), mdl: ident(), cam: R[2] < 0 ? -1 : 1 }; lastViews.push({ x: 0, y: i ? 0 : h2, w: tk.width, h: vh, mats: [m, m, m, m, m, m], label: d[4], sx: d[2], sy: d[3], nomid: d[1] !== 0 });      // nomid: seen from above or below, the fin sheet is edge-on - leave it out
      });
      MV = null;
    } else {
      if (pressed('v-spin') && !d3.orbit && !reduce && !hold) yaw += 0.004;
      const asp = tk.width / tk.height, len = D.lenCm / 100, dist = len * 1.7 * zoom * Math.max(1, 1.35 / asp), view = mul(trans(panX * len, panY * len, -dist), mul(rotX(pitch), rotY(yaw))), pr = persp(0.7, asp, len * 0.05, len * 30), vp = mul(pr, view);
      const swim = pressed('v-swim') && !reduce && !hold, turn = pressed('v-turn') && !hold ? 0.16 * Math.sin(t * 0.8) : 0, amp = hold ? 0 : (swim ? 0.085 : 0.012) * D.wag, ph = t * 6.283 * 1.5 * D.pace, cuts = built.tables.cut;
      let chain = rotY(-0.35 * amp * Math.sin(ph)); const mats = [];
      for (let j = 0; j < 6; j++) {
        if (j > 0) { const hz = cuts[j - 1], bend = amp * SEG_AMP[j] * Math.sin(ph - 0.9 * j) + turn * (0.4 + 0.2 * j); chain = mul(chain, mul(trans(0, 0, hz), mul(rotY(bend), trans(0, 0, -hz)))); }
        const iv = inv(mul(view, chain)); mats.push({ mvp: mul(vp, chain), mdl: chain, cam: iv && iv[12] < 0 ? -1 : 1 });
      }
      MV = hold ? { m: mats[0].mvp, inv: inv(mats[0].mvp) } : null; lastViews.push({ x: 0, y: 0, w: tk.width, h: tk.height, mats });
    }
    lastMats = lastViews[0].mats;
    gl.useProgram(prog); const U = n => gl.getUniformLocation(prog, n); gl.uniform1f(U('dark'), dark); gl.uniform1f(U('gshow'), gshow); gl.uniform1f(U('unlit'), sheet ? 1 : 0);
    gl.uniform1f(U('tp'), 0); render(prog);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.enable(gl.STENCIL_TEST); gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);      // the stencil: a dot that has had its see-through layer takes no second one
    gl.useProgram(prog); gl.uniform1f(U('tp'), 1); render(prog); gl.disable(gl.STENCIL_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    drawHud();
  }
  // where the pointer touches the fish's skin: the model is drawn once more with every dot coloured by its own place in the picture
  function skinAt(sx, sy) {
    if (!gl || !lastViews.length) return null;
    if (!fbo) { fbo = gl.createFramebuffer(); fboTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fboTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tk.width, tk.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      fboDepth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, fboDepth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, tk.width, tk.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, fboDepth); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, tk.width, tk.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    render(pick); const px = new Uint8Array(4); gl.readPixels(Math.round(sx), Math.round(tk.height - 1 - sy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (px[3] === 0) return null; return { u: (px[0] + px[1] / 255) / 255, v: ((px[2] & 127) + (px[3] / 255 - 0.004) / 0.996) / 127, key: px[2] >= 128 ? 'B' : 'A' };
  }
  const ownAt = s => s ? built.own[clamp(Math.floor(s.v * H), 0, H - 1) * W + clamp(Math.floor(s.u * W), 0, W - 1)] : 0;
  const to3 = p => { const k = built.k, c = xf(MV.m, [p[0] * k, p[1] * k, p[2] * k]); return c[3] <= 0 ? null : [(c[0] / c[3] + 1) / 2 * hud.width, (1 - c[1] / c[3]) / 2 * hud.height]; };
  function rayAt(sx, sy) { const k = built.k, nx = 2 * sx / hud.width - 1, ny = 1 - 2 * sy / hud.height, a = xf(MV.inv, [nx, ny, -1]), b = xf(MV.inv, [nx, ny, 1]), o = [a[0] / a[3] / k, a[1] / a[3] / k, a[2] / a[3] / k], e = [b[0] / b[3] / k, b[1] / b[3] / k, b[2] / b[3] / k]; return { o, d: [e[0] - o[0], e[1] - o[1], e[2] - o[2]] }; }
  const pos3 = h => {
    if (h.kind === 'eye') { const tp = C.curve(D.body.top), bt = C.curve(D.body.bot), z = h.p[0], cy = (tp(z) + bt(z)) / 2, hh = Math.max(1e-4, (tp(z) - bt(z)) / 2), side = lastMats && lastMats[0].cam < 0 ? -1 : 1, w = C.curve(side > 0 || !D.body.widthL ? D.body.width : D.body.widthL)(z) * D.body.wide; return [side * w * Math.sqrt(Math.max(0, 1 - Math.pow((h.p[1] - cy) / hh, 2))), h.p[1], z]; }
    if (h.kind === 'fin') return fin3(h.f, h.p);
    if (h.kind !== 'wid') return [0, h.p[1], h.p[0]]; const top = C.curve(D.body.top), bot = C.curve(D.body.bot); return [h.side * h.p[1] * D.body.wide, (top(h.p[0]) + bot(h.p[0])) / 2, h.p[0]]; };
  const hpx = () => hud.width / $('stage').getBoundingClientRect().width;
  function near3(x, y) { if (!MV || !MV.inv) return null; let best = null, bd = 18 * hpx(); handles().forEach(h => { const q = to3(pos3(h)); if (!q) return; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = h; } }); return best; }
  function lines3() {      // the highlighted lines of what is selected, in 3D: [points, how to add a handle at one of them]
    const out = [], top = C.curve(D.body.top), bot = C.curve(D.body.bot);
    if (tab === 'shape') {
      const z0 = Math.min(...D.body.top.map(p => p[0])), z1 = Math.max(...D.body.top.map(p => p[0])), wr = C.curve(D.body.width), wl = C.curve(D.body.widthL || D.body.width), a = [], b = [], r = [], l = [];
      for (let i = 0; i <= 60; i++) { const z = z0 + (z1 - z0) * i / 60, m = (top(z) + bot(z)) / 2; a.push([0, top(z), z]); b.push([0, bot(z), z]); r.push([wr(z) * D.body.wide, m, z]); l.push([-wl(z) * D.body.wide, m, z]); }
      out.push({ pts: a, col: '#ffb347', add: p => D.body.top.push([p[2], p[1]]) }); out.push({ pts: b, col: '#ffb347', add: p => D.body.bot.push([p[2], p[1]]) });
      out.push({ pts: r, col: '#48d1c4', add: p => D.body.width.push([p[2], Math.abs(p[0]) / D.body.wide]) }); out.push({ pts: l, col: '#48d1c4', add: p => (D.body.widthL || D.body.width).push([p[2], Math.abs(p[0]) / D.body.wide]) });
    }
    if (tab === 'fins') { const f = selPart(); if (f) {
      const n = f.pts.length, cnt = f === D.tail ? n : n - 1, sp = f.curve ? smooth(f.pts) : null, P3 = q => { const v = fin3(f, q); v.des = [q[0], q[1]]; return v; };
      for (let i = 0; i < cnt; i++) { const p0 = f.pts[i], p1 = f.pts[(i + 1) % n], pts = []; if (sp && i < n - 1) sp.slice(i * 6, i * 6 + 7).forEach(q => pts.push(P3(q))); else for (let k = 0; k <= 10; k++) pts.push(P3([p0[0] + (p1[0] - p0[0]) * k / 10, p0[1] + (p1[1] - p0[1]) * k / 10])); out.push({ pts, col: '#ffb347', add: p => f.pts.splice(i + 1, 0, p.des) }); }
    } }
    return out;
  }
  function drawHud() {
    hx.clearRect(0, 0, hud.width, hud.height); const sc = hpx(), sheet = sheetOn();
    $('stagehint').textContent = sheet ? 'Paint on either picture. Drag empty space, right-drag or use two fingers to slide it; scroll or pinch to zoom.' : (!still() ? 'Swimming preview. Drag to turn it.' : tab === 'paint' ? 'Paint on the fish. Drag empty water to turn it.' : tab === 'look' ? 'Drag an eye to move it. Double-tap the body to add one.' : tab === 'fins' ? (cutting ? 'Drag across a fin to cut it away. Press Cut again to turn the fish.' : 'Drag a fin to slide it; drag a handle to reshape it.') : 'Tap a part to select it. Drag a handle to reshape.') + ' Right-drag or two fingers to slide.';
    $('viewbtns').hidden = sheet;
    const brush = r => { if (!d3.cur) return; hx.strokeStyle = '#ffffff'; hx.lineWidth = sc; hx.beginPath(); hx.arc(d3.cur[0], d3.cur[1], Math.max(3, r), 0, 6.3); hx.stroke(); };
    if (sheet) {
      hx.fillStyle = '#86a9b3'; hx.font = Math.round(12 * sc) + 'px sans-serif'; lastViews.forEach(v => hx.fillText(v.label, 10 * sc, hud.height - v.y - v.h + 18 * sc));
      const my = hud.height - lastViews[0].y; hx.strokeStyle = '#24424d'; hx.lineWidth = sc; hx.beginPath(); hx.moveTo(0, my); hx.lineTo(hud.width, my); hx.stroke();
      brush(+$('bsize').value / (0.94 * W) * SV.zoom / 0.52 * hud.width / 2); return;
    }
    if (tab === 'paint') brush(+$('bsize').value * sc * 1.2 / zoom);
    if (tab === 'fins' && cutting) brush(+$('cutsize').value * sc * 1.2 / zoom);
    if (!MV || !MV.inv) return;
    const poly = (pts, col, close) => { hx.strokeStyle = col; hx.lineWidth = 1.5 * sc; hx.beginPath(); let go = false; pts.forEach(p => { const q = to3(p); if (!q) return; go ? hx.lineTo(q[0], q[1]) : hx.moveTo(q[0], q[1]); go = true; }); if (close) hx.closePath(); hx.stroke(); };
    const rim = f => (f.curve ? smooth(f.pts) : f.pts).map(p => fin3(f, p));
    if (tab === 'shape') lines3().forEach(l => poly(l.pts, l.col));
    if (tab === 'fins') { D.fins.forEach((f, i) => poly(rim(f), i === selFin ? '#ffb347' : '#2f8f88', true)); if (D.tail) poly(rim(D.tail), selFin >= D.fins.length ? '#ffb347' : '#2f8f88', true); }
    handles().forEach(h => {
      const q = to3(pos3(h)); if (!q) return; const r = 7 * sc; hx.strokeStyle = '#06161b'; hx.lineWidth = 2 * sc; hx.beginPath();
      if (h.kind === 'eye') { hx.arc(q[0], q[1], 11 * sc, 0, 6.3); hx.strokeStyle = h.i === selEye ? '#ffffff' : '#ffb347'; hx.setLineDash([4 * sc, 3 * sc]); hx.stroke(); hx.setLineDash([]); return; }
      hx.fillStyle = d3.hot === h.p ? '#ffffff' : h.kind === 'wid' ? '#48d1c4' : '#ffb347'; if (h.kind === 'fin') hx.rect(q[0] - r, q[1] - r, 2 * r, 2 * r); else hx.arc(q[0], q[1], r, 0, 6.3); hx.fill(); hx.stroke();
    });
  }
  // sliding the view sideways / up and down: the fish follows the pointer (pan is kept in fish lengths)
  function pan3(dx, dy) { const r = hud.getBoundingClientRect(), dist = 1.7 * zoom * Math.max(1, 1.35 / (r.width / r.height)), f = 2 * dist * Math.tan(0.35) / r.height; panX = clamp(panX + dx * f, -1.5, 1.5); panY = clamp(panY - dy * f, -1.5, 1.5); }
  function paint3(x, y) { const s = skinAt(x, y); if (!s) { d3.st.last = null; return false; } strokeTo(d3.st, s.key, s.u * W, s.v * H); return true; }
  const viewAt = y => lastViews.length > 1 && y >= hud.height - lastViews[0].y ? lastViews[1] : lastViews[0];
  function panSheet(dx, dy, v) { const f = 2 * 0.52 / SV.zoom / hud.getBoundingClientRect().width, lim = 0.6 * (1 - 1 / SV.zoom); SV.px = clamp(SV.px + (v ? v.sx : 1) * dx * f, -lim, lim); SV.py = clamp(SV.py - (v ? v.sy : 1) * dy * f, -lim, lim); }
  function zoomBy(f) { if (sheetOn()) { SV.zoom = clamp(SV.zoom * f, 1, 8); panSheet(0, 0); } else zoom = clamp(zoom / f, 0.35, 3); }
  // where the pointer is on a fin's own plane: z along the body, and (a fin off the centre line) how far out of the skin, or (a centre fin) the height
  function finRay(f, x, y) {
    const r = rayAt(x, y), ln = Math.hypot(r.d[0], r.d[1], r.d[2]);
    if (!offFin(f)) { if (Math.abs(r.d[0]) / ln < 1e-6) return null; const t = -r.o[0] / r.d[0]; return { z: r.o[2] + t * r.d[2], y: r.o[1] + t * r.d[1], ok: Math.abs(r.d[0]) / ln >= 0.12 }; }
    const a = f.pts[0], b = f.pts[f.pts.length - 1], zc = (a[0] + b[0]) / 2, s = sideShown(f), P0 = finPt(f, s, zc, 0), P1 = finPt(f, s, zc, 1), v = [P1[0] - P0[0], P1[1] - P0[1]], den = -r.d[0] * v[1] + r.d[1] * v[0]; if (Math.abs(den) / ln < 0.1) return { ok: false };
    const t = (-(P0[0] - r.o[0]) * v[1] + (P0[1] - r.o[1]) * v[0]) / den, q = [r.o[0] + t * r.d[0], r.o[1] + t * r.d[1], r.o[2] + t * r.d[2]]; return { z: q[2], hgt: (q[0] - P0[0]) * v[0] + (q[1] - P0[1]) * v[1], ok: true };
  }
  // sliding a fin: it follows the pointer along the body's edge; pulled across the body it goes over to the other edge
  function slideFin(x, y) {
    if (offFin(d3.slide.f)) {      // a fin off the centre line slides along the body and keeps its place around it (that is the "Around the body" slider)
      const f = d3.slide.f, q = finRay(f, x, y); if (!q || !q.ok) { say('Turn the view to face this fin more squarely to slide it.'); return; }
      const a = f.pts[0], b = f.pts[f.pts.length - 1], lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]), dz = clamp(q.z - d3.slide.z0, Math.min(0, B3.z0 + 0.004 - lo), Math.max(0, B3.z1 - 0.004 - hi)), Hs = f.pts.map(p => hgtOf(f, p));
      f.pts.forEach((p, n) => { p[0] += dz; p[1] = fromHgt(f, p[0], Hs[n]); }); d3.slide.z0 += dz; dirtyShape = true; return;
    }
    const r = rayAt(x, y), ln = Math.hypot(r.d[0], r.d[1], r.d[2]); if (Math.abs(r.d[0]) / ln < 0.12) { say('Turn the view to look more from the side to slide a fin.'); return; }
    const t = -r.o[0] / r.d[0], z = r.o[2] + t * r.d[2], yv = r.o[1] + t * r.d[1], f = d3.slide.f, top = C.curve(D.body.top), bot = C.curve(D.body.bot), bz0 = Math.min(...D.body.top.map(p => p[0])), bz1 = Math.max(...D.body.top.map(p => p[0]));
    const a = f.pts[0], b = f.pts[f.pts.length - 1], lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]), edge = f.side === 'back' ? top : bot;
    const dz = clamp(z - d3.slide.z0, Math.min(0, bz0 + 0.004 - lo), Math.max(0, bz1 - 0.004 - hi)), zm = (lo + hi) / 2, dy = edge(zm + dz) - edge(zm);
    f.pts.forEach(p => { p[0] += dz; p[1] += dy; }); d3.slide.z0 += dz;
    const zc = clamp(z, bz0, bz1), mid = (top(zc) + bot(zc)) / 2, half = (top(zc) - bot(zc)) / 2;
    if (f.side === 'back' ? yv < mid - 0.6 * half : yv > mid + 0.6 * half) { const to = f.side === 'back' ? bot : top; f.pts.forEach(p => { p[1] = to(p[0]) - (p[1] - edge(p[0])); }); f.side = f.side === 'back' ? 'belly' : 'back'; finButtons(); }
    dirtyShape = true;
  }
  gestures(hud, {
    down(x, y, e) {
      d3.drag = null; d3.slide = null; d3.st = null; d3.orbit = false; d3.moved = false; d3.pan = false; d3.view = viewAt(y);
      if (e.button === 2 || e.button === 1) { d3.pan = true; hud.style.cursor = 'move'; return; }
      if (e.button === 0 && still()) {
        if (tab === 'fins' && cutting) { remember(true); cutHit = false; d3.st = { cutting: true }; paint3(x, y); return; }      // a tear starts outside the fin: the stroke is a cut wherever it began
        if (tab === 'paint') { strokeStart(); d3.st = {}; if (paint3(x, y)) return; d3.st = null; undos.pop(); }
        else {
          const h = near3(x, y); if (h) { if (h.kind === 'eye') { selEye = h.i; eyeUI(); } remember(false); d3.drag = { h, y0: pos3(h)[1] }; return; }
          if (tab === 'fins' && MV && MV.inv) { const o = ownAt(skinAt(x, y)); if (o >= 2 && o - 2 < D.fins.length) { selFin = o - 2; finButtons(); const q = finRay(D.fins[selFin], x, y); if (q && q.z !== undefined) { remember(false); d3.slide = { f: D.fins[selFin], z0: q.z }; return; } } }
        }
      }
      d3.orbit = true; hud.style.cursor = 'grabbing';
    },
    move(x, y, e, dx, dy, moved) {
      d3.cur = [x, y];
      if (d3.st) { paint3(x, y); return; }
      if (d3.drag && d3.drag.h.kind === 'eye') { if (!moved) return; d3.moved = true; const s = skinAt(x, y); if (s && ownAt(s) === 1) { const q = picToDes(s.u * W, s.v * H); d3.drag.h.p[0] = q[0]; d3.drag.h.p[1] = q[1]; dirtySkin = true; } return; }
      if (d3.slide && MV && MV.inv) { if (!moved) return; d3.moved = true; slideFin(x, y); return; }
      if (d3.drag && MV && MV.inv) {
        if (!moved) return; d3.moved = true; const r = rayAt(x, y), h = d3.drag.h, ln = Math.hypot(r.d[0], r.d[1], r.d[2]);
        if (h.kind === 'fin' && offFin(h.f)) {
          const q = finRay(h.f, x, y); if (!q || !q.ok) { say('Turn the view to face this fin more squarely to drag its handle.'); return; }
          h.p[0] = clamp(q.z, -0.49, 0.49); h.p[1] = fromHgt(h.f, h.p[0], clamp(q.hgt, 0, 0.4));
        } else if (h.kind === 'wid') {
          if (Math.abs(r.d[1]) / ln < 0.12) { say('Turn the view to look more from above to drag a width handle.'); return; } const t = (d3.drag.y0 - r.o[1]) / r.d[1]; if (t <= 0) return;
          const w = clamp(Math.abs(r.o[0] + t * r.d[0]) / D.body.wide, 0.003, 0.24), z = clamp(r.o[2] + t * r.d[2], -0.49, 0.49); h.p[1] = w; h.p[0] = z;
        } else {
          if (Math.abs(r.d[0]) / ln < 0.12) { say('Turn the view to look more from the side to drag this handle.'); return; } const t = -r.o[0] / r.d[0]; if (t <= 0) return;
          h.p[0] = clamp(r.o[2] + t * r.d[2], -0.49, 0.49); h.p[1] = clamp(r.o[1] + t * r.d[1], -YH * 0.96, YH * 0.96); if (h.kind === 'top') h.p[1] = Math.max(h.p[1], 0.002); if (h.kind === 'bot') h.p[1] = Math.min(h.p[1], -0.002);
        }
        dirtyShape = true; return;
      }
      if (d3.pan || (d3.orbit && sheetOn())) { if (sheetOn()) panSheet(dx, dy, d3.view); else pan3(dx, dy); return; }
      if (d3.orbit) { yaw += dx * 0.01; pitch = clamp(pitch + dy * 0.01, -1.5, 1.5); }
    },
    up() { if (((d3.drag || d3.slide) && !d3.moved) || (d3.st && d3.st.cutting && !cutHit)) undos.pop(); d3.drag = null; d3.slide = null; d3.orbit = false; d3.pan = false; d3.st = null; hud.style.cursor = 'grab'; },
    cancel() { if (d3.st || d3.drag || d3.slide) undo(); d3.drag = null; d3.slide = null; d3.st = null; d3.orbit = false; d3.pan = false; },
    hover(x, y) { d3.cur = [x, y]; const h = still() && tab !== 'paint' ? near3(x, y) : null; d3.hot = h ? h.p : null; hud.style.cursor = tab === 'paint' || (tab === 'fins' && cutting) ? 'crosshair' : h ? 'pointer' : 'grab'; },
    leave() { d3.cur = null; d3.hot = null; },
    tap(x, y) { if (!still() || tab === 'paint' || tab === 'look' || (tab === 'fins' && cutting)) return; if (near3(x, y)) return; selectOwner(ownAt(skinAt(x, y))); },
    dbl(x, y) {
      if (!MV || !MV.inv || tab === 'paint') return; const h = near3(x, y); if (h) { removeHandle(h); return; }
      if (tab === 'look') { const s = skinAt(x, y); if (s && ownAt(s) === 1) { remember(false); D.eyes.push({ p: picToDes(s.u * W, s.v * H), size: 1, type: 'round', col: D.look.eye }); selEye = D.eyes.length - 1; eyeUI(); dirtySkin = true; say('Eye added.'); } return; }
      if (tab !== 'shape' && tab !== 'fins') return;
      let best = null, bd = 16 * hpx(); lines3().forEach(l => l.pts.forEach(p => { const q = to3(p); if (!q) return; const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = { l, p }; } }));
      if (!best) { say('Double-tap right on a highlighted line to add a handle there.'); return; } remember(false); best.l.add(best.p); dirtyShape = true; say('Handle added.');
    },
    pinch(ratio, dx, dy, at) { zoomBy(ratio); if (sheetOn()) panSheet(dx, dy, viewAt(at[1])); else pan3(dx, dy); },
    wheel(dy) { zoomBy(Math.exp(-dy * 0.0012)); }
  });

  // ---- THE COLOUR PICKER: one panel that moves to whatever colour is being chosen. It keeps its colour, and it keeps a palette. ----
  const PK = { h: 0, s: 1, v: 1, target: null };
  function rgb2hsv(c) { const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 0) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [h / 6, mx ? d / mx : 0, mx]; }
  function hsv2rgb(h, s, v) { const i = Math.floor(h * 6) % 6, f = h * 6 - Math.floor(h * 6), p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s), r = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i]; return r.map(x => x * 255); }
  function drawPicker() {
    const sv = $('sv'), c = sv.getContext('2d'), img = c.createImageData(sv.width, sv.height);
    for (let y = 0; y < sv.height; y++) for (let x = 0; x < sv.width; x++) { const q = hsv2rgb(PK.h, x / (sv.width - 1), 1 - y / (sv.height - 1)), o = (y * sv.width + x) * 4; img.data[o] = q[0]; img.data[o + 1] = q[1]; img.data[o + 2] = q[2]; img.data[o + 3] = 255; }
    c.putImageData(img, 0, 0); c.strokeStyle = PK.v > 0.5 ? '#000' : '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(PK.s * (sv.width - 1), (1 - PK.v) * (sv.height - 1), 6, 0, 6.3); c.stroke();
    const hu = $('hue'), hc = hu.getContext('2d'); for (let x = 0; x < hu.width; x++) { const q = hsv2rgb(x / hu.width, 1, 1); hc.fillStyle = 'rgb(' + q.map(Math.round).join(',') + ')'; hc.fillRect(x, 0, 1, hu.height); }
    hc.strokeStyle = '#fff'; hc.lineWidth = 2; hc.strokeRect(clamp(PK.h * hu.width - 3, 1, hu.width - 7), 1, 6, hu.height - 2);
  }
  function pickSet(hexv, fromPad) { if (!PK.target) return; if (!fromPad) { const q = rgb2hsv(hex(hexv)); if (q[1] > 0.001 && q[2] > 0.001) PK.h = q[0]; PK.s = q[1]; PK.v = q[2]; } PK.target.set(hexv); $('hex').value = hexv; drawPicker(); swatches(); }
  function pickOpen(home, target) { PK.target = target; const p = $('picker'); $(home).appendChild(p); p.hidden = false; $('pickname').textContent = target.name; const q = rgb2hsv(hex(target.get())); PK.h = q[1] > 0.001 ? q[0] : PK.h; PK.s = q[1]; PK.v = q[2]; $('hex').value = target.get(); drawPicker(); drawPalette(); }
  function padDrag(id, fn) { const el = $(id); let on = false; const go = e => { const r = el.getBoundingClientRect(); fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1)); pickSet(toHex(hsv2rgb(PK.h, PK.s, PK.v)), true); }; el.addEventListener('pointerdown', e => { on = true; el.setPointerCapture(e.pointerId); if (PK.target && PK.target.undo) remember(false); go(e); }); el.addEventListener('pointermove', e => { if (on) go(e); }); el.addEventListener('pointerup', () => { on = false; }); el.addEventListener('pointercancel', () => { on = false; }); }
  function drawPalette() {
    const mk = (c, label) => { const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.setAttribute('aria-label', label + ' ' + c); return b; };
    const pal = $('pal'); pal.textContent = ''; let lastClick = { c: null, t: 0 };
    D.palette.forEach((c, i) => { const b = mk(c, 'Saved colour'); b.addEventListener('click', () => { const now = performance.now(); if (lastClick.c === i && now - lastClick.t < 400) { remember(false); D.palette.splice(i, 1); drawPalette(); say('Colour removed from the palette.'); return; } lastClick = { c: i, t: now }; if (PK.target && PK.target.undo) remember(false); pickSet(c); }); pal.appendChild(b); });
    const plus = document.createElement('button'); plus.className = 'sw'; plus.textContent = '+'; plus.setAttribute('aria-label', 'Save the current colour'); plus.dataset.tip = 'Save the current colour in a new slot.'; plus.addEventListener('click', () => { if (!PK.target) return; const c = PK.target.get(); if (D.palette.includes(c)) { say('That colour is already saved.'); return; } remember(false); D.palette.push(c); drawPalette(); }); pal.appendChild(plus);
    const rc = $('recent'); rc.textContent = ''; recent.forEach(c => { const b = mk(c, 'Recent colour'); b.addEventListener('click', () => pickSet(c)); rc.appendChild(b); });
  }
  const LOOKS = [['back', 'Back'], ['flank', 'Flank'], ['belly', 'Belly'], ['fin', 'Fins'], ['tip', 'Fin tips']]; let lookSel = 'back';
  function swatches() {
    const row = $('lookrow'); row.textContent = ''; LOOKS.forEach(([k, name]) => { const w = document.createElement('div'); w.style.textAlign = 'center'; const b = document.createElement('button'); b.className = 'sw'; b.style.background = D.look[k]; b.setAttribute('aria-pressed', lookSel === k ? 'true' : 'false'); b.setAttribute('aria-label', name + ' colour'); b.addEventListener('click', () => { lookSel = k; pickLook(); }); const s = document.createElement('div'); s.textContent = name; s.style.cssText = 'font-size:11.5px;color:var(--dim)'; w.appendChild(b); w.appendChild(s); row.appendChild(w); });
    eyeCols();
  }
  // an eye's three colours: which field of the eye, its name, and what it is when the eye has none of its own
  const EP = { eye: ['col', 'Iris', '#f2b84b'], eyering: ['ring', 'Ring', '#14181c'], eyepup: ['pup', 'Pupil', '#000000'] };
  function eyeCols() {
    const row = $('eyecols'); row.textContent = ''; const e = (D.eyes || [])[selEye];
    Object.keys(EP).forEach(k => { const f = EP[k], w = document.createElement('div'); w.style.textAlign = 'center'; const b = document.createElement('button'); b.className = 'sw'; b.style.background = e ? e[f[0]] || f[2] : 'transparent'; b.disabled = !e || (e.type === 'blank' && k !== 'eye'); b.setAttribute('aria-pressed', lookSel === k ? 'true' : 'false'); b.setAttribute('aria-label', f[1] + ' colour of the selected eye'); b.addEventListener('click', () => { lookSel = k; pickLook(); }); const t = document.createElement('div'); t.textContent = f[1]; t.style.cssText = 'font-size:11.5px;color:var(--dim)'; w.appendChild(b); w.appendChild(t); row.appendChild(w); });
  }
  function pickLook() {
    const e = D.eyes && D.eyes[selEye]; if (EP[lookSel] && (!e || (e.type === 'blank' && lookSel !== 'eye'))) lookSel = e ? 'eye' : 'back';
    if (EP[lookSel]) { const f = EP[lookSel]; pickOpen('pickhome-eye', { name: 'Eye ' + (selEye + 1) + ': ' + f[1].toLowerCase() + ' colour', undo: true, get: () => (D.eyes[selEye] || {})[f[0]] || f[2], set: v => { if (D.eyes[selEye]) { D.eyes[selEye][f[0]] = v; dirtySkin = true; } } }); }
    else { const name = LOOKS.find(x => x[0] === lookSel)[1]; pickOpen('pickhome-look', { name: name + ' colour', undo: true, get: () => D.look[lookSel], set: v => { D.look[lookSel] = v; dirtySkin = true; } }); }
    swatches();
  }
  // the eyes: any number, each with its own place (dragged on the fish), kind, size and colour
  function eyeUI() {
    const es = D.eyes || []; selEye = clamp(selEye, 0, Math.max(0, es.length - 1)); const box = $('eyelist'); box.textContent = '';
    es.forEach((e, i) => { const b = document.createElement('button'); b.textContent = 'Eye ' + (i + 1); b.setAttribute('aria-pressed', i === selEye ? 'true' : 'false'); b.addEventListener('click', () => { selEye = i; eyeUI(); if (EP[lookSel]) pickLook(); }); box.appendChild(b); });
    const e = es[selEye], ty = $('eyetypes'); ty.textContent = '';
    EYES.forEach(([k, name]) => { const b = document.createElement('button'); b.textContent = name; b.disabled = !e; b.setAttribute('aria-pressed', e && e.type === k ? 'true' : 'false'); b.addEventListener('click', () => { remember(false); e.type = k; dirtySkin = true; eyeUI(); if (EP[lookSel]) pickLook(); }); ty.appendChild(b); });
    eyeCols(); $('deleye').disabled = !e; $('eye').disabled = !e; if (e) { $('eye').value = e.size; $('o-eye').textContent = Math.round(e.size * 100) + '%'; }
  }
  function pickBrush() { if (mode === 'erase') { $('picker').hidden = true; return; } const m = mode; pickOpen('pickhome-paint', { name: m === 'glow' ? 'Glow brush colour' : 'Brush colour', get: () => brushCol[m], set: v => { brushCol[m] = v; } }); }

  // ---- controls ----
  function finButtons() {
    const box = $('finlist'); box.textContent = '';
    const add = (label, idx) => { const b = document.createElement('button'); b.textContent = label; b.setAttribute('aria-pressed', selFin === idx ? 'true' : 'false'); b.addEventListener('click', () => { selFin = idx; finButtons(); }); box.appendChild(b); };
    D.fins.forEach((f, i) => add((f.side === 'back' ? 'Back fin ' : f.side === 'belly' ? 'Belly fin ' : 'Side fin ') + (i + 1), i)); if (D.tail) add('Tail', D.fins.length);
    const f = curFin(), fin = f && f !== D.tail, off = offFin(f); press('f-curve', !!(f && f.curve)); ['f-curve', 'f-clear', 'f-rays', 'f-rayn', 'f-mend'].forEach(id => { $(id).disabled = !f; });
    const zn = ZONE[fin ? f.side : 'back']; $('f-ang').min = zn[0]; $('f-ang').max = zn[1]; $('f-ang').disabled = !fin; $('f-tilt').disabled = !off; $('f-mirror').disabled = !off; press('f-mirror', off && f.mirror !== false); $('f-flip').disabled = !(off && f.mirror === false); $('f-mend').disabled = !f || off; $('f-cut').disabled = false;
    syncs.forEach(fn => fn());
  }
  function setTab(t) {
    tab = t; document.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-pressed', x.dataset.tab === t ? 'true' : 'false')); document.querySelectorAll('#tools .pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
    if (t === 'paint') pickBrush(); else if (t === 'look') pickLook(); else $('picker').hidden = true;
  }
  const syncs = [];
  function bind(id, get, set, fmt, undoable) { const el = $(id), o = $('o-' + id); const show = () => { if (o) o.textContent = fmt ? fmt(+el.value) : el.value; }; el.value = get(); show(); let armed = true; el.addEventListener('input', () => { if (undoable && armed) { remember(false); armed = false; } set(el.type === 'range' ? +el.value : el.value); show(); }); el.addEventListener('change', () => { armed = true; }); syncs.push(() => { el.value = get(); show(); }); }
  function syncAll() { syncs.forEach(f => f()); finButtons(); press('bmirror', !D.body.widthL); press('smirror', D.skinMirror); press('glowlit', D.look.glowLit); eyeUI(); swatches(); drawPalette(); if (PK.target && !$('picker').hidden) { $('hex').value = PK.target.get(); } }
  function confirmBtn(id, ask, fn) { const b = $(id), label = b.textContent; let t = null; b.addEventListener('click', () => { if (t) { clearTimeout(t); t = null; b.textContent = label; b.classList.remove('warn'); fn(); return; } b.textContent = ask; b.classList.add('warn'); t = setTimeout(() => { t = null; b.textContent = label; b.classList.remove('warn'); }, 3500); }); }
  function wire() {
    bind('wide', () => D.body.wide, v => { D.body.wide = v; dirtyShape = true; }, v => Math.round(v * 100) + '%', true);
    bind('len', () => D.lenCm, v => { D.lenCm = v; dirtyShape = true; }, v => v.toFixed(1) + ' cm', true);
    bind('scales', () => D.look.scales, v => { D.look.scales = v; dirtySkin = true; }, v => Math.round(v * 100) + '%', true);
    const pct = v => Math.round(v * 100) + '%', finSet = fn => v => { const f = curFin(); if (f) { fn(f, v); dirtySkin = true; } };
    bind('eye', () => ((D.eyes || [])[selEye] || { size: 1 }).size, v => { const e = (D.eyes || [])[selEye]; if (e) { e.size = v; dirtySkin = true; } }, pct, true);
    bind('f-clear', () => (curFin() || {}).clear || 0, finSet((f, v) => { f.clear = v; }), pct, true);
    bind('f-rays', () => { const f = curFin() || {}; return f.rays == null ? D.look.rays : f.rays; }, finSet((f, v) => { f.rays = v; }), pct, true);
    bind('f-rayn', () => (curFin() || {}).rayN || 1, finSet((f, v) => { f.rayN = v; }), v => v.toFixed(1) + 'x', true);
    bind('cutsize', () => $('cutsize').value, () => { }, v => v + ' dots');
    const finShape = fn => v => { const f = curFin(); if (f && f !== D.tail) { fn(f, v); dirtyShape = true; } };
    bind('f-ang', () => { const f = curFin(); return f && f !== D.tail ? f.ang || 0 : 0; }, finShape((f, v) => {
      if (!offFin(f) && Math.abs(v) > 0.5 && D.fins.filter(offFin).length >= SLOTS.length) { say('A fish can carry four fins off the centre line (a mirrored pair counts as one). Remove one first.', true); $('f-ang').value = 0; return; }
      const was = offFin(f); f.ang = v; if (f.mirror === undefined) f.mirror = true; if (was !== offFin(f)) { finButtons(); say(offFin(f) ? 'This fin now stands off the centre line: it has a twin on the other side, and its look comes from the sliders here (no brush paint or cuts on it yet).' : 'Back on the centre line.'); }
    }), v => { const f = curFin(); return !f || f === D.tail ? '-' : f.side === 'side' ? (v > 0 ? 'up ' : v < 0 ? 'down ' : 'middle ') + Math.abs(v) + '°' : v < 0.5 ? 'centre line' : v + '° off centre'; }, true);
    bind('f-tilt', () => (curFin() || {}).tilt || 0, finShape((f, v) => { f.tilt = v; }), v => (v > 0 ? 'up ' : v < 0 ? 'down ' : '') + Math.abs(v) + '°', true);
    $('f-mirror').addEventListener('click', () => { const f = curFin(); if (!offFin(f)) return; remember(false); f.mirror = f.mirror === false; if (!f.flank) f.flank = 1; finButtons(); dirtyShape = true; say(f.mirror ? 'This fin has a twin on the other side.' : 'This fin is on one side only. "Other side" moves it across.'); });
    $('f-flip').addEventListener('click', () => { const f = curFin(); if (!offFin(f) || f.mirror !== false) return; remember(false); f.flank = -(f.flank || 1); dirtyShape = true; });
    $('addside').addEventListener('click', () => {
      if (D.fins.filter(offFin).length >= SLOTS.length) { say('A fish can carry four fins off the centre line (a mirrored pair counts as one). Remove one first.', true); return; }
      remember(false); const z0 = Math.min(...D.body.top.map(p => p[0])), L = Math.max(...D.body.top.map(p => p[0])) - z0, at = z0 + 0.3 * L;
      D.fins.push({ side: 'side', ang: -6, tilt: -10, mirror: true, flank: 1, curve: true, pts: [[at - 0.03, 0], [at + 0.01, 0.06], [at + 0.1, 0.1], [at + 0.07, 0.04], [at + 0.03, 0]] }); selFin = D.fins.length - 1; finButtons(); dirtyShape = true; say('A pair of side fins. Drag one to slide it along the body; the sliders set its place around the body and its tilt.');
    });
    $('f-curve').addEventListener('click', () => { const f = curFin(); if (!f) return; remember(false); f.curve = !f.curve; press('f-curve', f.curve); dirtyShape = true; });
    $('f-cut').addEventListener('click', () => { cutting = !cutting; press('f-cut', cutting); say(cutting ? 'Cutting is on: drag across a fin. Press Cut again to go back to reshaping.' : 'Cutting is off.'); });
    $('f-mend').addEventListener('click', () => { const f = curFin(); if (!f || !built) return; remember(true); const code = f === D.tail ? 250 : 2 + selFin; for (let i = 0; i < W * H; i++) if (built.own[i] === code) cut[i] = 0; dirtyShape = true; say('Mended.'); });
    $('addeye').addEventListener('click', () => { if (!built) return; remember(false); const prev = D.eyes[D.eyes.length - 1], e0 = picToDes(built.tables.eye[0], built.tables.eye[1]); D.eyes.push({ p: prev ? [prev.p[0] + 0.035, prev.p[1]] : e0, size: prev ? prev.size : 1, type: prev ? prev.type : 'round', col: prev ? prev.col : D.look.eye }); selEye = D.eyes.length - 1; eyeUI(); swatches(); dirtySkin = true; say('Eye added. Drag it on the fish to place it.'); });
    $('deleye').addEventListener('click', () => { if (!D.eyes.length) return; remember(false); D.eyes.splice(selEye, 1); selEye = 0; if (EP[lookSel]) lookSel = 'back'; eyeUI(); pickLook(); dirtySkin = true; });
    ['3d', 'lr', 'tb'].forEach(k => $('pv-' + k).addEventListener('click', () => { paintView = k; ['3d', 'lr', 'tb'].forEach(q => press('pv-' + q, q === k)); }));
    bind('wag', () => D.wag, v => { D.wag = v; }, v => Math.round(v * 100) + '%', true); bind('pace', () => D.pace, v => { D.pace = v; }, v => Math.round(v * 100) + '%', true);
    bind('name', () => D.name, v => { D.name = v; }); bind('bsize', () => $('bsize').value, () => { }, v => v + ' dots'); bind('bstr', () => $('bstr').value, () => { }, v => Math.round(v * 100) + '%');
    document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); pickBrush(); }));
    ['v-swim', 'v-turn', 'v-dark', 'v-spin'].forEach(id => $(id).addEventListener('click', () => press(id, !pressed(id))));
    $('bmirror').addEventListener('click', () => { remember(false); D.body.widthL = D.body.widthL ? null : D.body.width.map(p => [p[0], p[1]]); press('bmirror', !D.body.widthL); dirtyShape = true; say(D.body.widthL ? 'The two flanks can now differ: drag the teal handles on either side.' : 'Both flanks are the same again.'); });
    $('smirror').addEventListener('click', () => { remember(true); D.skinMirror = !D.skinMirror; if (!D.skinMirror) { L.B.paint.set(L.A.paint); L.B.glow.set(L.A.glow); } press('smirror', D.skinMirror); dirtySkin = true; say(D.skinMirror ? 'One skin for both sides (the left side\'s).' : 'The two sides are now painted separately. "Flat: left and right" shows both. In the game both sides still show the left side until an ARCA update.'); });
    $('glowlit').addEventListener('click', () => { remember(false); D.look.glowLit = !D.look.glowLit; press('glowlit', D.look.glowLit); say(D.look.glowLit ? 'Always glow: the glow marks always show.' : 'The glow marks are now hidden in the light. You see them while painting with the Glow brush, and on the Motion tab with Lights off.'); });
    $('mirror').addEventListener('click', () => { remember(false); D.body.bot = D.body.top.map(p => [p[0], -p[1]]); dirtyShape = true; });
    $('addback').addEventListener('click', () => { remember(false); D.fins.push({ side: 'back', pts: [[-0.05, 0.1], [0.0, 0.18], [0.06, 0.1]] }); selFin = D.fins.length - 1; finButtons(); dirtyShape = true; });
    $('addbelly').addEventListener('click', () => { remember(false); D.fins.push({ side: 'belly', pts: [[-0.05, -0.09], [0.0, -0.17], [0.06, -0.09]] }); selFin = D.fins.length - 1; finButtons(); dirtyShape = true; });
    $('addtail').addEventListener('click', () => { if (D.tail) { say('This fish already has a tail. Tap it to reshape it.'); return; } remember(false); const z = Math.max(...D.body.top.map(p => p[0])); D.tail = { pts: [[z - 0.02, 0.02], [z + 0.12, 0.14], [z + 0.08, 0], [z + 0.12, -0.14], [z - 0.02, -0.02]] }; selFin = D.fins.length; finButtons(); dirtyShape = true; });
    $('delfin').addEventListener('click', () => { if (!selPart()) return; remember(false); if (selFin < D.fins.length) D.fins.splice(selFin, 1); else D.tail = null; selFin = 0; finButtons(); dirtyShape = true; });
    confirmBtn('clearpaint', 'Tap again to clear', () => { remember(true); L.A.paint.fill(0); L.B.paint.fill(0); dirtySkin = true; say('Paint cleared. Undo brings it back.'); });
    confirmBtn('clearglow', 'Tap again to clear', () => { remember(true); L.A.glow.fill(0); L.B.glow.fill(0); dirtySkin = true; say('Glow cleared. Undo brings it back.'); });
    confirmBtn('newfish', 'Tap again to start over', () => { remember(true); const pal = D.palette; D = fresh(); D.palette = pal; L.A.paint.fill(0); L.A.glow.fill(0); L.B.paint.fill(0); L.B.glow.fill(0); cut.fill(0); selFin = 0; selEye = 0; syncAll(); dirtyShape = true; say('A new fish. Undo brings the old one back.'); });
    $('undo').addEventListener('click', undo); addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !(e.target && e.target.type === 'text')) { e.preventDefault(); undo(); } });
    const lookFrom = (y, p) => () => { yaw = y; pitch = p; panX = panY = 0; };
    $('v-front').addEventListener('click', lookFrom(Math.PI / 2, 0)); $('v-right').addEventListener('click', lookFrom(-Math.PI / 2, 0)); $('v-top').addEventListener('click', lookFrom(Math.PI / 2, 1.5)); $('v-34').addEventListener('click', lookFrom(-0.9, 0.22));
    $('z-in').addEventListener('click', () => zoomBy(1.25)); $('z-out').addEventListener('click', () => zoomBy(0.8));
    padDrag('sv', (x, y) => { PK.s = x; PK.v = 1 - y; }); padDrag('hue', x => { PK.h = Math.min(0.9999, x); });
    $('hex').addEventListener('change', () => { let v = $('hex').value.trim(); if (v[0] !== '#') v = '#' + v; if (/^#[0-9a-fA-F]{6}$/.test(v)) { if (PK.target && PK.target.undo) remember(false); pickSet(v.toLowerCase()); } else { say('A colour code looks like #3fa9c0.', true); $('hex').value = PK.target ? PK.target.get() : ''; } });
  }
  // ---- tooltips: hover or keyboard focus on a computer, press and hold on a touch screen ----
  function tips() {
    const tip = $('tip'); let timer = null; const hide = () => { clearTimeout(timer); tip.style.display = 'none'; };
    const show = el => { tip.textContent = el.dataset.tip; tip.style.display = 'block'; const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight; let x = clamp(r.left + r.width / 2 - tw / 2, 6, innerWidth - tw - 6), y = r.bottom + 8; if (y + th > innerHeight - 6) y = r.top - th - 8; tip.style.left = x + 'px'; tip.style.top = Math.max(6, y) + 'px'; };
    document.addEventListener('pointerover', e => { const el = e.target.closest && e.target.closest('[data-tip]'); hide(); if (el && e.pointerType === 'mouse') timer = setTimeout(() => show(el), 550); });
    document.addEventListener('pointerdown', e => { const el = e.target.closest && e.target.closest('[data-tip]'); hide(); if (el && e.pointerType !== 'mouse') timer = setTimeout(() => { show(el); setTimeout(hide, 3500); }, 600); });
    document.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse' && tip.style.display !== 'block') clearTimeout(timer); });
    document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el.matches(':focus-visible')) show(el); }); document.addEventListener('focusout', hide); addEventListener('scroll', hide, true);
  }
  // ---- the tutorial: a walk through the app, one highlighted place at a time ----
  // Each step: [what to highlight, which tab to open, title, text]. The words can be rewritten in the app (Tutorial > Edit the text);
  // that is kept in the browser. To change them for everyone, change them HERE.
  const TOUR0 = [      // the words are the user's own (2026-11-25)
    [null, null, 'Welcome to the ARCA Fish Lab.', 'Here you shape a fish, paint it, watch it swim, and save it as a file the aquarium in the game can load. Yes, that does mean you can make monstrosities if you want. I encourage it, for stress testing.'],
    ['#stage', 'shape', 'Fishy Business', 'This is your fish in 3D. Drag the empty space around it to turn it. Hold the right mouse button and drag, or drag with two fingers, to slide the view. Scroll, pinch, or use the Zoom buttons to come closer; Left, Right, Top and Angle centre it again. Tap any part, such as a fin or the tail, to select it.'],
    ['.tabs', 'shape', 'The Fun Part', 'Each tab is fairly self-explanatory: Shape lets you morph the body. Fins lets you mess about with their hair, so to speak. Skin allows you to set their default scale colour, and tweak their eyes. Paint is for adding your fishes unique patterns, details and bioluminescence if  you want your fish to have some. Motion is your preview window, and allows you to alter and check out their swimming behavior somewhat (This part is still rudimentary and in development.) Save is mostly a function for the Developer at the moment, as they use the .txt file generated to spawn the fish in the game.'],
    ['#stage', 'shape', 'Sculpt the Fishy', 'Amber handles on the back and belly allow for back and stomach adjustment, dictating height. Teal handles on both flanks set how wide it is there, allowing for dense fishies or twiggy little noodle fish if you prefer. Drag a handle to move it, which will morph that section of the fish accordingly. Double-tap a spot along the highlighted line to add a handle at that location; double-tapping a handle will remove it.'],
    ['#p-fins', 'fins', 'Extremities', 'Tap a fin to select it. Drag the fin itself to slide it along the body, or across to the other edge; drag its square handles to reshape it. Below are its outline (curved or angled), how see-through it is, its rays, and Cut for holes and tears. You\'ll figure it out as you mess about, I\'m sure.'],
    ['#p-look', 'look', 'Gimme Your Skin', 'Tap a base colour, then choose it in the picker. Under Eyes you are able to add/remove eyes, choose what kind of eye it is, as well as adjust its size and colour; drag an eye on the fish to move it about, and scare people with like twenty eyes or something.'],
    ['#picker', 'paint', 'The Artistic Vision', 'Drag in the square and along the rainbow bar. The picker remembers each brush\'s colour. Tap + to save a colour to the palette, and tap a saved colour to use it again. I\'m sure most people who mess about with microsoft paint get the idea.'],
    ['#p-paint', 'paint', 'Painting', 'Choose Colour, Glow or Erase, then paint on the fish. Each glow stroke glows in its own colour. With Always glow off, glow marks are hidden in the light, as on a real deep-sea fish.'],
    ['#paintviews', 'paint', 'Flat views', 'There is a setting for swapping between a 3D view, as well as a flat 2D view with cross-section for each opposing sides, to help people with more creative flair than I do. I like drawing stick figures, and I would highly discourage drawing a penis on the fish. But you do you.'],
    ['#p-move', 'move', 'Motion', 'This is the test before you save: the fish looks and swims as it will in the tank. Lights off shows what glows in the dark. Get a good look at your fishy before you send him off into the great beyond.'],
    ['#p-save', 'save', 'Saving', 'Name your fish and save the file. Put it in the species folder shown here, then type fish species in the ARCA console. The same file opens here again for more work.'],
    ['#undo', null, 'Nothing is final', 'Undo takes back any change, one step at a time. If you\'re like me, and have the attention span of a squirrel, you can always tap the Tutorial button for a repeat. Now, go nuts.']];
  let TOUR = TOUR0.map(s => s.slice());
  try { const saved = JSON.parse(localStorage.getItem('arcaFishLabTourText') || 'null'); if (Array.isArray(saved)) saved.forEach((q, i) => { if (TOUR[i] && q && typeof q[0] === 'string' && typeof q[1] === 'string') { TOUR[i][2] = q[0]; TOUR[i][3] = q[1]; } }); } catch (e) { }
  const tourAsText = () => TOUR.map(q => q[2] + '\n' + q[3]).join('\n---\n');
  let tourAt = -1;
  function tourShow(i) {
    tourAt = i; const st = TOUR[i], ov = $('tour'), box = $('tourbox'), card = $('tourcard'); if (st[1]) setTab(st[1]); ov.style.display = 'block'; $('tourtitle').textContent = st[2] + '  (' + (i + 1) + ' of ' + TOUR.length + ')'; $('tourtext').textContent = st[3]; $('tourback').disabled = i === 0; $('tournext').textContent = i === TOUR.length - 1 ? 'Done' : 'Next';
    const el = st[0] ? document.querySelector(st[0]) : null; if (el && !el.hidden) { el.scrollIntoView({ block: 'center', behavior: 'auto' }); }
    requestAnimationFrame(() => { const r = el && !el.hidden ? el.getBoundingClientRect() : null; box.style.display = 'block'; if (r && r.width > 0) { box.style.left = r.left - 4 + 'px'; box.style.top = r.top - 4 + 'px'; box.style.width = r.width + 8 + 'px'; box.style.height = r.height + 8 + 'px'; } else { box.style.left = '50%'; box.style.top = '50%'; box.style.width = '0px'; box.style.height = '0px'; }
      const cw = card.offsetWidth, ch = card.offsetHeight; let x = r ? clamp(r.left, 12, innerWidth - cw - 12) : (innerWidth - cw) / 2, y = r ? (r.bottom + 12 + ch < innerHeight ? r.bottom + 12 : r.top - ch - 12 > 0 ? r.top - ch - 12 : innerHeight - ch - 12) : (innerHeight - ch) / 2; card.style.left = Math.max(12, x) + 'px'; card.style.top = Math.max(12, y) + 'px'; if ($('toureditor').hidden) $('tournext').focus(); });
  }
  function tourEnd() { $('tour').style.display = 'none'; tourAt = -1; try { localStorage.setItem('arcaFishLabTour', '1'); } catch (e) { } setTab('shape'); }
  function tourWire() {
    $('tourbtn').addEventListener('click', () => tourShow(0)); $('tournext').addEventListener('click', () => { if (tourAt >= TOUR.length - 1) tourEnd(); else tourShow(tourAt + 1); }); $('tourback').addEventListener('click', () => { if (tourAt > 0) tourShow(tourAt - 1); }); $('tourskip').addEventListener('click', tourEnd); addEventListener('keydown', e => { if (tourAt >= 0 && e.key === 'Escape') tourEnd(); });
    const msg = t => { $('tourmsg').textContent = t; };
    if (window.FISHLAB_MOBILE) { $('touredit').parentElement.style.display = 'none'; $('toureditor').style.display = 'none'; }      // the phone app: the tutorial's words are fixed (the user's wish)
    $('touredit').addEventListener('click', () => { const ed = $('toureditor'); ed.hidden = !ed.hidden; if (!ed.hidden) { $('tourall').value = tourAsText(); msg(''); } tourShow(tourAt); });
    $('tourapply').addEventListener('click', () => {
      const parts = $('tourall').value.replace(/\r/g, '').split(/\n\s*---+\s*\n/); if (parts.length !== TOUR.length) { msg('There must be ' + TOUR.length + ' steps; this text has ' + parts.length + '. Nothing was changed.'); return; }
      parts.forEach((p, i) => { const t = p.trim(), n = t.indexOf('\n'); TOUR[i][2] = (n < 0 ? t : t.slice(0, n)).trim(); TOUR[i][3] = n < 0 ? '' : t.slice(n + 1).trim().replace(/\s*\n\s*/g, ' '); });
      let kept = true; try { localStorage.setItem('arcaFishLabTourText', JSON.stringify(TOUR.map(q => [q[2], q[3]]))); } catch (e) { kept = false; }
      msg(kept ? 'Applied, and kept in this browser.' : 'Applied for now, but this browser would not keep it.'); tourShow(tourAt);
    });
    $('tourreset').addEventListener('click', () => { TOUR = TOUR0.map(q => q.slice()); try { localStorage.removeItem('arcaFishLabTourText'); } catch (e) { } $('tourall').value = tourAsText(); msg('The original text is back.'); tourShow(tourAt); });
    $('tourcopy').addEventListener('click', () => { const ta = $('tourall'); ta.focus(); ta.select(); try { navigator.clipboard.writeText(ta.value).then(() => msg('Copied.'), () => msg('The text is selected: copy it with Ctrl+C or the Copy menu.')); } catch (e) { msg('The text is selected: copy it with Ctrl+C or the Copy menu.'); } });
    let seen = false; try { seen = localStorage.getItem('arcaFishLabTour') === '1'; } catch (e) { } if (!seen && !/[?&#]notour/.test(location.href)) setTimeout(() => tourShow(0), 600);
  }

  // ---- THE FISH FILE: lines of key=value; binary parts are gzip, then base64. The plugin reads it (AqSpeciesLoad). ----
  async function gz(u8) { const cs = new CompressionStream('gzip'), w = cs.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(cs.readable).arrayBuffer()); }
  async function gunz(u8) { const ds = new DecompressionStream('gzip'), w = ds.writable.getWriter(); w.write(u8); w.close(); return new Uint8Array(await new Response(ds.readable).arrayBuffer()); }
  const pack = async u8 => C.b64enc(await gz(u8)), unpack = async s => gunz(C.b64dec(s));
  // what the game gets for one side: r, g, b, how solid (255 = solid, less = a see-through fin, 0 = nothing), how strongly it glows.
  // A glowing dot carries its glow colour (in the game a lit dot shines in its own colour). lit = the skin without the glow marks.
  function overOf(K) {
    const over = new Uint8Array(W * H * 5), lit = new Uint8Array(W * H * 3); let any = false;
    for (let i = 0; i < W * H; i++) { const o = i * 5, q = i * 4, a = K.skin[q + 3], ga = a ? K.gimg[q + 3] / 255 : 0; for (let c = 0; c < 3; c++) { lit[i * 3 + c] = K.skin[q + c]; over[o + c] = K.skin[q + c] + (K.gimg[q + c] - K.skin[q + c]) * ga; } over[o + 3] = a; over[o + 4] = ga * 255; if (ga > 0.02) any = true; }
    return { over, lit, any };
  }
  async function fileText() {
    if (!rebuild()) throw new Error('the shape cannot be built'); compositeAll(); const t = built.tables, lines = ['ARCAFISH 1'], put = (k, v) => lines.push(k + '=' + v), a = overOf(L.A), b = D.skinMirror ? null : overOf(L.B);
    put('name', D.name.replace(/[=\r\n|]/g, ' ').trim() || 'Unnamed'); put('len', (D.lenCm / 100).toFixed(4)); put('pace', D.pace.toFixed(2)); put('wag', D.wag.toFixed(2)); put('glowhue', '0.500'); put('glows', a.any || (b && b.any) ? 1 : 0); put('glowlit', D.look.glowLit ? 1 : 0); put('twoside', b ? 1 : 0);
    put('asp', t.asp); put('eye', t.eye.join(',')); put('span', t.span.join(',')); put('head', t.head); put('cut', t.cut.join(',')); put('fin', t.fin.join(',')); put('brow', t.brow.join(','));
    // the map goes out with the fins WHOLE: in the game the cuts are a feature of their own (the layer lx), which a fish may lack
    const mw = metres(); mw.d.cut = null; const whole = C.build(mw.d); whole.k = built.k;
    put('map', await pack(whole.blob)); put('over', await pack(a.over)); if (b) put('over2', await pack(b.over));
    // (v0.6) THE LAYERS (see LAB above): with them the game makes each feature a gene. "feat" lists what this fish has.
    LAB = { A: new Uint8ClampedArray(W * H * 3), P: new Uint8ClampedArray(W * H * 3), M: new Uint8ClampedArray(W * H * 3), E: new Uint8ClampedArray(W * H * 4), C: new Uint8ClampedArray(W * H) };
    const cutBuild = built; built = whole; composite('A'); built = cutBuild; const lab = LAB; LAB = null; dirtySkin = true; const eyes = D.eyes || [], u8 = x => new Uint8Array(x.buffer, 0, x.length);
    // (v0.7) THE EYES, EIGHT WAYS: the first eye / the further eyes, each in its own form or plain round, in its own colours or plain dark.
    // In the game three genes pick among them: the eyes' colours, their form, and whether the further eyes are there at all.
    const eyeLayer = (list, ownForm, ownCol) => {
      const out = new Uint8ClampedArray(W * H * 4), er0 = whole.tables.eye[2];
      list.forEach(e => {
        const q = toPic(e.p), er = Math.max(1.5, er0 * e.size), t = ownForm ? e.type : 'round', rc = ownCol ? hex(e.ring || '#14181c') : [20, 24, 28], ic = ownCol ? hex(e.col) : [58, 64, 70], pc = ownCol ? hex(e.pup || '#000000') : [0, 0, 0];
        for (let y = Math.max(0, Math.floor(q[1] - er * 1.3)); y <= Math.min(H - 1, Math.ceil(q[1] + er * 1.3)); y++) for (let x = Math.max(0, Math.floor(q[0] - er * 1.3)); x <= Math.min(W - 1, Math.ceil(q[0] + er * 1.3)); x++) {
          const i = y * W + x, o = i * 4; if (whole.cls[i] !== 255) continue; const dx = (x + 0.5 - q[0]) / er, dy = (y + 0.5 - q[1]) / er, dd = Math.hypot(dx, dy); if (dd >= 1.25) continue;
          const [ring, iris, pup, hl] = eyeParts(t, dx, dy, dd); let al = out[o + 3] / 255; const col = [out[o] * al, out[o + 1] * al, out[o + 2] * al];
          [[rc, ring], [ic, iris], [pc, pup], [[240, 240, 240], hl]].forEach(([cc, tt]) => { for (let k = 0; k < 3; k++) col[k] = col[k] * (1 - tt) + cc[k] * tt; al = al * (1 - tt) + tt; });
          if (al > 0.004) { out[o] = col[0] / al; out[o + 1] = col[1] / al; out[o + 2] = col[2] / al; out[o + 3] = al * 255; }
        }
      });
      return out;
    };
    // "feat": what this fish has. Names for the general features; s16.. = fin 1.. is there (s27 the tail), s28.. = that fin's own look (s39 the tail's)
    const anyCut = cut.some(v => v), feat = ['bodycol', 'fincol'], finLook = f => (f.rays == null ? D.look.rays : f.rays) > 0.02 || (f.clear || 0) > 0.01, hasBrush = L.A.paint.some((v, i) => (i & 3) === 3 && v > 8);
    if (D.look.scales > 0.02) feat.push('scales'); if (anyCut) feat.push('cut'); if (hasBrush) feat.push('brush'); if (a.any) feat.push('glow', 'glowlit');
    if (eyes.length) feat.push('eyecol'); if (eyes.some(e => e.type !== 'round')) feat.push('eyekind'); if (eyes.length > 1) feat.push('eyemore');
    D.fins.slice(0, 11).forEach((f, i) => { feat.push('s' + (16 + i)); if (finLook(f)) feat.push('s' + (28 + i)); }); if (D.tail) { feat.push('s27'); if (finLook(D.tail)) feat.push('s39'); }
    put('feat', feat.join(',')); put('la', await pack(u8(lab.A))); put('lp', await pack(u8(lab.P))); put('lm', await pack(u8(lab.M))); put('lc', await pack(u8(lab.C))); put('lo', await pack(whole.own));
    for (const more of [0, 1]) for (const form of [0, 1]) for (const colr of [0, 1]) { const list = more ? eyes.slice(1) : eyes.slice(0, 1); if (list.length) put('e' + (more ? 'x' : 'f') + (form ? 'd' : 'p') + (colr ? 'd' : 'p'), await pack(u8(eyeLayer(list, !!form, !!colr)))); }
    if (hasBrush) put('lb', await pack(u8(L.A.paint))); if (a.any) put('lg', await pack(u8(L.A.gimg))); if (anyCut) put('lx', await pack(cut));
    if (!D.look.glowLit) { put('lit', await pack(a.lit)); if (b) put('lit2', await pack(b.lit)); }
    for (let s = 0; s < 6; s++) put('m' + s, await pack(C.writeMwm(PAT, built.slices[s])));
    D.v = 4; put('design', await pack(new TextEncoder().encode(JSON.stringify(D)))); put('paint', await pack(new Uint8Array(L.A.paint.buffer.slice(0)))); put('glowrgba', await pack(new Uint8Array(L.A.glow.buffer.slice(0))));
    if (b) { put('paint2', await pack(new Uint8Array(L.B.paint.buffer.slice(0)))); put('glowrgba2', await pack(new Uint8Array(L.B.glow.buffer.slice(0)))); }
    if (cut.some(v => v)) put('fincut', await pack(cut));
    return lines.join('\n') + '\n';
  }
  async function openText(txt) {
    const kv = {}; txt.split(/\r?\n/).forEach(l => { const i = l.indexOf('='); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1); });
    if (!txt.startsWith('ARCAFISH') || !kv.design) throw new Error('this is not a fish file from the Fish Lab');
    const d = JSON.parse(new TextDecoder().decode(await unpack(kv.design))); if (!d.body || !d.look) throw new Error('the design inside it is damaged');
    remember(true); const f = fresh(); D = Object.assign(f, d); D.look = Object.assign(fresh().look, d.look); D.body = Object.assign(fresh().body, d.body); if (!Array.isArray(D.palette)) D.palette = fresh().palette; if (typeof D.skinMirror !== 'boolean') D.skinMirror = true; if (!Array.isArray(D.eyes)) D.eyes = null;
    if (!d.body.width) { const t = C.curve(d.body.top), b = C.curve(d.body.bot), w0 = d.body.wide || 0.7; D.body.width = d.body.top.map(p => [p[0], Math.max(0.004, w0 * (t(p[0]) - b(p[0])) / 2)]); D.body.wide = 1.0; D.body.widthL = null; }
    ['A', 'B'].forEach(k => { L[k].paint.fill(0); L[k].glow.fill(0); }); cut.fill(0);
    const load = async (key, arr) => { if (kv[key]) { const p = await unpack(kv[key]); if (p.length === arr.length) arr.set(p); } };
    await load('paint', L.A.paint); await load('paint2', L.B.paint); await load('glowrgba', L.A.glow); await load('glowrgba2', L.B.glow); await load('fincut', cut);
    // a file from before v0.4: its glow was one number per dot. v0.3 kept the glow's colour in the paint; the first version had one glow colour.
    const old = async (key, K) => { if (!kv[key] || kv.glowrgba) return; const g = await unpack(kv[key]); if (g.length !== W * H) return; const gc = d.look.glow && !d.v ? hex(d.look.glow) : null; for (let i = 0; i < W * H; i++) if (g[i]) { const o = i * 4; for (let c = 0; c < 3; c++) K.glow[o + c] = gc ? gc[c] : K.paint[o + c]; K.glow[o + 3] = g[i]; } };
    await old('glowlayer', L.A); await old('glowlayer2', L.B);
    D.v = 4; selFin = 0; selEye = 0; syncAll(); dirtyShape = true;
  }
  let saver = null; if (window.claude && window.claude.use) window.claude.use('downloads').then(d => { saver = d; }).catch(() => { });
  function fileWire() {
    $('savefile').addEventListener('click', async () => {
      try {
        say('Building the file...'); const txt = await fileText(), fn = (D.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fish') + '.arcafish.txt';
        if (saver) { await saver.save({ filename: fn, data: txt }); say('Saved ' + fn + ' (' + Math.round(txt.length / 1024) + ' KB). Put it in the ArcaBridge species folder.'); }
        else {
          // the phone app: hand the file to the phone's share sheet ("Save to Files", send it to the computer...); if the phone will not, download it
          if (window.FISHLAB_MOBILE && matchMedia('(pointer: coarse)').matches && navigator.canShare) { const file = new File([txt], fn, { type: 'text/plain' }); if (navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: D.name }); say('Shared ' + fn + '. Keep it with "Save to Files", or send it to the computer that runs the game.'); return; } catch (e) { if (e && e.name === 'AbortError') { say('Not saved: the share was closed.'); return; } } } }
          const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = fn; document.body.appendChild(a); a.click(); a.remove(); say('Saved ' + fn + ' (' + Math.round(txt.length / 1024) + ' KB), if your browser allowed the download.'); }
      } catch (e) { say(e && e.code === 'declined' ? 'Not saved: the save was declined.' : 'Could not save the file: ' + (e && e.message || e), true); }
    });
    $('openbtn').addEventListener('click', () => $('openfile').click());
    $('openfile').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { await openText(await f.text()); say('Opened ' + f.name + '. Undo brings back what was here before.'); } catch (err) { say('Could not open that file: ' + err.message, true); } e.target.value = ''; });
  }

  // ---- run ----
  wire(); fileWire(); tips(); syncAll(); glInit(); tourWire(); let lastBuild = 0;
  function frame(now) {
    if (dirtyShape && now - lastBuild > 120) { lastBuild = now; if (rebuild()) meshUp(); }
    if (dirtySkin && built) compositeAll();
    drawTank(now); requestAnimationFrame(frame);
  }
  window.FishLab = { fileText, openText, get design() { return D; }, view: () => [yaw, pitch, zoom, panX, panY].map(v => Math.round(v * 100) / 100), sel: () => [tab, selFin, selEye], undo, unpack: s => unpack(s), layers: L, cut, sheet: () => [paintView, SV.zoom, SV.px, SV.py].map(v => typeof v === 'number' ? Math.round(v * 100) / 100 : v), skinAt: (x, y) => skinAt(x, y) };
  requestAnimationFrame(frame);
})();
