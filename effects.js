// effects.js — post-composite visual effects applied as a final pass over the
// fully-rendered screenshot (background + device + text + elements). Runs in BOTH
// render pipelines: the live main canvas (updateCanvas) and the per-context
// renderer used for side previews and exports, so what you see matches what ships.
//
// Every effect is a 2D-canvas operation (not Three.js post-processing) on purpose:
// the final output is a 2D canvas, so doing the work here means effects cover the
// whole composition and behave identically in 2D and 3D device modes.
//
// The public entry point is applyEffects(context, canvasEl, dims, fx). It reads the
// already-drawn pixels from canvasEl (needed by bloom/colorGrade) and layers each
// enabled effect back onto `context`.

// ---------------------------------------------------------------------------
// Defaults + merge helpers (shared with app.js via the global scope)
// ---------------------------------------------------------------------------
const DEFAULT_EFFECTS = {
    // Bright areas softly glow. threshold = how bright a pixel must be to bloom.
    bloom: { enabled: false, intensity: 55, threshold: 72, radius: 26 },
    // Darkened (or tinted) edges to focus the eye on the device.
    vignette: { enabled: false, amount: 45, softness: 55, color: '#000000' },
    // Color grade: temperature/tint overlay + brightness/contrast/saturation.
    colorGrade: { enabled: false, temperature: 0, tint: 0, saturation: 0, brightness: 0, contrast: 0 },
    // Soft colored light leak blooming in from an edge/corner.
    lightLeak: { enabled: false, intensity: 40, color: '#ff5e62', position: 'top-right' },
    // Gobo (cast) shadows over the scene for depth — blinds, window, palm, dappled.
    gobo: { enabled: false, pattern: 'blinds', intensity: 45, scale: 100, angle: 12, blur: 6, x: 50, y: 50 },
    // Depth of field. Two families of modes:
    //  - 'radial' | 'directional' | 'tilt-shift' | 'lens': mask-based whole-frame
    //    blur (applyDepthOfFieldPass) — sharp around the Focus Position (x/y, %),
    //    blurred beyond it. size = sharp-zone extent, feather = falloff softness,
    //    angle drives directional/tilt-shift. 'lens' adds a bokeh highlight boost.
    //  - 'layers': device ↔ background rack — blurs the background layer and/or
    //    the device layer inside both compositors (dofLayerBlurs callers in app.js);
    //    focus 100 = device sharp, 0 = background sharp. Text stays sharp.
    // maxBlur = strength in px at 1290-wide for every mode. Keyframe x/y (or focus
    // in layers mode) on the timeline for a rack-focus pull.
    depthOfField: { enabled: false, mode: 'radial', focus: 100, maxBlur: 14,
                    x: 50, y: 50, size: 35, feather: 60, angle: 0 },
    // Motion blur is temporal (not part of the applyEffects pass): the live preview
    // accumulates sub-frames across a shutter window when the playhead is parked, so
    // you can see/tune the blur that exports already produce. samples = quality,
    // amount = shutter window as a % of a 30fps frame interval.
    motionBlur: { enabled: false, samples: 6, amount: 100 }
};

function cloneDefaultEffects() {
    return JSON.parse(JSON.stringify(DEFAULT_EFFECTS));
}

// Backfill any missing effect groups/fields on a saved effects object so older
// projects (or templates) pick up newly-added effects without breaking the render.
function withEffectDefaults(fx) {
    const out = cloneDefaultEffects();
    if (fx && typeof fx === 'object') {
        for (const k of Object.keys(out)) {
            if (fx[k] && typeof fx[k] === 'object') out[k] = Object.assign(out[k], fx[k]);
        }
        // Migration: depthOfField objects saved before blur modes existed were
        // always the device↔background rack — keep their look. (Fresh defaults
        // start at 'radial'.)
        if (fx.depthOfField && !fx.depthOfField.mode) out.depthOfField.mode = 'layers';
    }
    return out;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function fxHexToRgb(hex) {
    if (typeof hex !== 'string') return { r: 0, g: 0, b: 0 };
    let h = hex.replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    if (isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Deterministic PRNG so procedural patterns (dappled light, palm fronds) look the
// same every render instead of flickering. (Math.random would re-roll each frame.)
function fxRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let _fxScratch = null;
function fxScratchCanvas(w, h) {
    if (!_fxScratch) _fxScratch = document.createElement('canvas');
    _fxScratch.width = w;
    _fxScratch.height = h;
    return _fxScratch;
}

// ---------------------------------------------------------------------------
// Depth of field (layer blurs)
// ---------------------------------------------------------------------------
// Blur radii for the two composited layers given the DOF settings, in canvas px
// (maxBlur is authored at 1290-wide and scaled, so previews/exports match).
// Returns zeros when the effect is off so callers can branch cheaply.
function dofLayerBlurs(fx, dims) {
    const d = fx && fx.depthOfField;
    if (!d || !d.enabled || (d.mode || 'radial') !== 'layers') return { bgBlur: 0, devBlur: 0 };
    const f = Math.max(0, Math.min(1, (d.focus ?? 100) / 100));
    const px = Math.max(0, d.maxBlur || 0) * ((dims && dims.width || 1290) / 1290);
    // Sub-half-pixel blurs are invisible but still cost a filter pass — clamp to 0.
    const q = (v) => (v < 0.5 ? 0 : v);
    return { bgBlur: q(px * f), devBlur: q(px * (1 - f)) };
}

// Blur a canvas's current contents in place (used on the background layer after
// it's drawn but before the device goes on top). Dedicated scratch — _fxScratch
// belongs to the applyEffects pass.
let _dofScratch = null;
function dofBlurCanvasInPlace(canvasEl, blurPx) {
    if (!blurPx) return;
    const w = canvasEl.width, h = canvasEl.height;
    if (!_dofScratch) _dofScratch = document.createElement('canvas');
    _dofScratch.width = w; _dofScratch.height = h;
    _dofScratch.getContext('2d').drawImage(canvasEl, 0, 0);
    const ctx = canvasEl.getContext('2d');
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(_dofScratch, 0, 0);
    ctx.restore();
    ctx.filter = 'none';
}

// Reusable transparent canvas the compositors render the DEVICE layer into when
// it needs to be blurred before compositing (out-of-focus device).
let _dofDeviceLayer = null;
function dofDeviceLayerCanvas(w, h) {
    if (!_dofDeviceLayer) _dofDeviceLayer = document.createElement('canvas');
    _dofDeviceLayer.width = w;   // resizing clears it
    _dofDeviceLayer.height = h;
    return _dofDeviceLayer;
}

// ---------------------------------------------------------------------------
// Device lens blur (camera depth-of-field on the 3D device)
// ---------------------------------------------------------------------------
// A real focal plane on the device: sharp where the screen sits at the focus
// depth, softening toward the near/far edges — the photographic look ultramock
// gets. The phone's screen face is essentially PLANAR, so its camera-depth varies
// LINEARLY across the frame; that makes a gradient-driven variable blur physically
// correct for the dominant surface (not just an approximation), and it preserves
// the device layer's alpha (unlike a BokehPass, which forces alpha=1 and would
// break compositing over the 2D background).
//
// `plane` (from computeDeviceDepthPlane in three-renderer.js) gives depth as a
// linear function of normalized screen coords: depth ≈ a*u + b*v + c, with the
// device's min/max depth. focus (0-100) slides the sharp plane between them.
let _lensScratchA = null, _lensScratchMask = null, _lensScratchMB = null;
function _lensCanvas(ref, w, h) {
    let c = ref.c;
    if (!c) { c = document.createElement('canvas'); ref.c = c; }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
}
function applyDeviceLensBlur(layerCanvas, dims, opts) {
    const plane = opts && opts.plane;
    if (!plane) return;
    const w = dims.width, h = dims.height;
    const blurPx = Math.max(0, opts.strength || 0) * (w / 1290);
    if (blurPx < 0.5) return;
    const { a, b, c, minD, maxD } = plane;
    const range = maxD - minD;
    if (!(range > 1e-4)) return; // device nearly face-on → uniform depth → stay sharp

    const focusDepth = minD + (Math.max(0, Math.min(100, opts.focus ?? 50)) / 100) * range;
    // Feather: how far (in depth) the blur takes to ramp to full. Smaller = snappier
    // focal plane. Tie to the depth range with a control (0-100 → fraction of range).
    const feather = Math.max(1e-4, range * (Math.max(5, opts.feather ?? 55) / 100));

    // Depth iso-lines are perpendicular to the screen-space gradient (a,b). Build a
    // grayscale mask whose alpha = circle-of-confusion (0 sharp → 1 full blur) using
    // a single linear gradient along (a,b): CoC is |depth-focus|/feather, a V-shape,
    // so we place a 0-alpha stop at the focus iso-line and ramp to 1 at both ends.
    const s = (u, v) => a * u + b * v + c;              // depth at normalized (u,v)
    const corners = [s(0, 0), s(1, 0), s(0, 1), s(1, 1)];
    const sMin = Math.min(...corners), sMax = Math.max(...corners);
    if (sMax - sMin < 1e-4) return;
    // Gradient axis in pixel space: from the min-depth corner to the max-depth corner.
    const glen = Math.hypot(a, b) || 1;
    const dirx = a / glen, diry = b / glen;
    const cx = w / 2, cy = h / 2, half = Math.hypot(w, h);
    // Project canvas center ± along the direction, scaled so the gradient spans the
    // full depth range across the visible device.
    const p0 = { x: cx - dirx * half, y: cy - diry * half };
    const p1 = { x: cx + dirx * half, y: cy + diry * half };
    // Map a depth value to gradient position t in [0,1] along p0→p1. Depth at p0/p1:
    const uOf = (p) => p.x / w, vOf = (p) => p.y / h;
    const d0 = s(uOf(p0), vOf(p0)), d1 = s(uOf(p1), vOf(p1));
    const dRange = d1 - d0 || 1e-4;
    const tOf = (depth) => Math.max(0, Math.min(1, (depth - d0) / dRange));
    const coc = (depth) => Math.max(0, Math.min(1, Math.abs(depth - focusDepth) / feather));

    const maskC = _lensCanvas(_lensScratchMask || (_lensScratchMask = {}), w, h);
    const mctx = maskC.getContext('2d');
    mctx.clearRect(0, 0, w, h);
    const grad = mctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    // Sample stops across the range so both linear ramps + the focus dip are captured.
    for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const depth = d0 + t * dRange;
        grad.addColorStop(t, `rgba(0,0,0,${coc(depth).toFixed(3)})`);
    }
    // Ensure the exact focus iso-line reads fully sharp.
    const tf = tOf(focusDepth);
    if (tf > 0 && tf < 1) grad.addColorStop(tf, 'rgba(0,0,0,0)');
    mctx.fillStyle = grad;
    mctx.fillRect(0, 0, w, h);

    // Blurred copy of the device layer.
    const blurC = _lensCanvas(_lensScratchA || (_lensScratchA = {}), w, h);
    const bctx = blurC.getContext('2d');
    bctx.clearRect(0, 0, w, h);
    bctx.filter = `blur(${blurPx}px)`;
    bctx.drawImage(layerCanvas, 0, 0);
    bctx.filter = 'none';

    // Mask the blurred copy by CoC, then lay it over the sharp layer in place.
    const mbC = _lensCanvas(_lensScratchMB || (_lensScratchMB = {}), w, h);
    const mbx = mbC.getContext('2d');
    mbx.clearRect(0, 0, w, h);
    mbx.drawImage(blurC, 0, 0);
    mbx.globalCompositeOperation = 'destination-in';
    mbx.drawImage(maskC, 0, 0);
    mbx.globalCompositeOperation = 'source-over';

    const lctx = layerCanvas.getContext('2d');
    lctx.drawImage(mbC, 0, 0); // sharp underneath, blurred fades in by CoC
}

// Mask-based DOF (radial / directional / tilt-shift / lens): blur a copy of the
// frame, then composite it back through an alpha mask so the area around the
// Focus Position stays sharp and the blur feathers in beyond it.
function applyDepthOfFieldPass(context, canvasEl, dims, d) {
    const mode = d.mode || 'radial';
    if (mode === 'layers') return;
    const w = dims.width, h = dims.height;
    const blurPx = Math.max(0, d.maxBlur || 0) * (w / 1290);
    if (blurPx < 0.5) return;

    const fxp = w * ((d.x ?? 50) / 100);
    const fyp = h * ((d.y ?? 50) / 100);
    const ref = Math.min(w, h);                       // size/feather scale base
    const sharpR = ref * 0.8 * ((d.size ?? 35) / 100);
    const featherR = Math.max(ref * 0.02, ref * 0.9 * ((d.feather ?? 60) / 100));
    const angleRad = ((d.angle || 0) - 90) * Math.PI / 180; // 0° = blur toward the top

    // Blurred copy of the frame. Edge pixels smear transparent past the canvas
    // border under blur(), so paint the frame first (sharp) as backing, then the
    // blurred pass over it — border stays covered.
    const blurred = document.createElement('canvas');
    blurred.width = w; blurred.height = h;
    const bctx = blurred.getContext('2d');
    bctx.drawImage(canvasEl, 0, 0);
    bctx.filter = `blur(${blurPx}px)`;
    bctx.drawImage(canvasEl, 0, 0);
    bctx.filter = 'none';

    // Lens mode: fake bokeh — lift the blurred copy's bright spots into soft
    // discs of light (threshold at half res, wide blur, additive), so highlights
    // bloom the way defocused lights do.
    if (mode === 'lens') {
        const ds = 0.5;
        const bw = Math.max(1, Math.round(w * ds)), bh = Math.max(1, Math.round(h * ds));
        const bright = document.createElement('canvas');
        bright.width = bw; bright.height = bh;
        const brx = bright.getContext('2d');
        brx.drawImage(canvasEl, 0, 0, bw, bh);
        const id = brx.getImageData(0, 0, bw, bh);
        const px = id.data;
        // High threshold + gentle gain so ONLY genuine near-white highlights bloom —
        // a bright app screen (mostly light) must not turn into a halo around the
        // device. (Earlier this bloomed any light content; 0.92 threshold fixes it.)
        const thr = 0.92 * 255;
        for (let i = 0; i < px.length; i += 4) {
            const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
            px[i + 3] = lum < thr ? 0 : Math.round(255 * Math.min(1, (lum - thr) / (255 - thr)));
        }
        brx.putImageData(id, 0, 0);
        bctx.save();
        bctx.globalCompositeOperation = 'lighter';
        bctx.globalAlpha = 0.28;
        bctx.filter = `blur(${blurPx * 1.4}px)`;
        bctx.drawImage(bright, 0, 0, w, h);
        bctx.restore();
        bctx.filter = 'none';
    }

    // Alpha mask: transparent = stays sharp, opaque = fully blurred.
    const mask = document.createElement('canvas');
    mask.width = w; mask.height = h;
    const mctx = mask.getContext('2d');
    const diag = Math.hypot(w, h);
    if (mode === 'radial' || mode === 'lens') {
        const g = mctx.createRadialGradient(fxp, fyp, sharpR, fxp, fyp, sharpR + featherR);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,1)');
        mctx.fillStyle = g;
        mctx.fillRect(0, 0, w, h);
    } else if (mode === 'tilt-shift') {
        // Sharp band through the focus point, rotated by angle; blur ramps out on
        // both sides. Drawn in a rotated frame so the gradient stays 1D.
        const L = sharpR + featherR;
        mctx.save();
        mctx.translate(fxp, fyp);
        mctx.rotate(angleRad + Math.PI / 2); // band runs along the angle
        const g = mctx.createLinearGradient(0, -L, 0, L);
        const inner = featherR / (2 * L);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(inner, 'rgba(0,0,0,0)');
        g.addColorStop(1 - inner, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,1)');
        mctx.fillStyle = g;
        mctx.fillRect(-diag, -diag, diag * 2, diag * 2);
        mctx.restore();
    } else { // 'directional' — sharp at the focus point, blur ramping toward angle
        const g = mctx.createLinearGradient(
            fxp + Math.cos(angleRad) * sharpR, fyp + Math.sin(angleRad) * sharpR,
            fxp + Math.cos(angleRad) * (sharpR + featherR), fyp + Math.sin(angleRad) * (sharpR + featherR)
        );
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,1)');
        mctx.fillStyle = g;
        mctx.fillRect(0, 0, w, h);
    }

    // Apply the mask to the blurred copy, then lay it over the frame.
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(mask, 0, 0);
    bctx.globalCompositeOperation = 'source-over';
    context.save();
    context.drawImage(blurred, 0, 0);
    context.restore();
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------
// Order matters: color grade adjusts the base image first; gobo shadows are an
// environmental layer; bloom and light-leak are additive "light" on top; the
// vignette darkens the edges last so it frames everything.
function applyEffects(context, canvasEl, dims, fx) {
    if (!fx) return;
    try {
        // DOF first: it's a lens-level defocus of the scene itself, so every other
        // effect (grade, gobo light, bloom, vignette) sits on top of it. The
        // 'layers' mode is handled inside the compositors instead (dofLayerBlurs).
        if (fx.depthOfField && fx.depthOfField.enabled) applyDepthOfFieldPass(context, canvasEl, dims, fx.depthOfField);
        if (fx.colorGrade && fx.colorGrade.enabled) applyColorGrade(context, canvasEl, dims, fx.colorGrade);
        if (fx.gobo && fx.gobo.enabled) applyGobo(context, dims, fx.gobo);
        if (fx.bloom && fx.bloom.enabled) applyBloom(context, canvasEl, dims, fx.bloom);
        if (fx.lightLeak && fx.lightLeak.enabled) applyLightLeak(context, dims, fx.lightLeak);
        if (fx.vignette && fx.vignette.enabled) applyVignette(context, dims, fx.vignette);
    } catch (e) {
        // An effect failing should never blank the whole canvas/export.
        console.warn('applyEffects error:', e);
    } finally {
        context.filter = 'none';
        context.globalAlpha = 1;
        context.globalCompositeOperation = 'source-over';
    }
}

// ---------------------------------------------------------------------------
// Color grade
// ---------------------------------------------------------------------------
function applyColorGrade(context, canvasEl, dims, cg) {
    const w = dims.width, h = dims.height;
    const b = 1 + (cg.brightness || 0) / 100;
    const c = 1 + (cg.contrast || 0) / 100;
    const s = 1 + (cg.saturation || 0) / 100;

    // brightness/contrast/saturation: re-draw the current canvas through a CSS
    // filter (GPU-accelerated) onto itself via a scratch copy.
    if (b !== 1 || c !== 1 || s !== 1) {
        const scratch = fxScratchCanvas(w, h);
        const sctx = scratch.getContext('2d');
        sctx.clearRect(0, 0, w, h);
        sctx.drawImage(canvasEl, 0, 0);
        context.save();
        context.filter = `brightness(${b}) contrast(${c}) saturate(${s})`;
        context.clearRect(0, 0, w, h);
        context.drawImage(scratch, 0, 0);
        context.restore();
        context.filter = 'none';
    }

    // Temperature: warm pushes orange, cool pushes blue. Overlay blend tints the
    // midtones without crushing highlights/shadows.
    const temp = cg.temperature || 0;
    if (temp !== 0) {
        context.save();
        context.globalCompositeOperation = 'overlay';
        context.globalAlpha = Math.min(0.65, (Math.abs(temp) / 100) * 0.65);
        context.fillStyle = temp > 0 ? '#ff7a18' : '#1f7bff';
        context.fillRect(0, 0, w, h);
        context.restore();
    }
    // Tint: green ↔ magenta, same approach.
    const tint = cg.tint || 0;
    if (tint !== 0) {
        context.save();
        context.globalCompositeOperation = 'overlay';
        context.globalAlpha = Math.min(0.65, (Math.abs(tint) / 100) * 0.65);
        context.fillStyle = tint > 0 ? '#ff2bd0' : '#2bff7a';
        context.fillRect(0, 0, w, h);
        context.restore();
    }
}

// ---------------------------------------------------------------------------
// Bloom — threshold bright pixels, blur, screen-blend back over the image
// ---------------------------------------------------------------------------
function applyBloom(context, canvasEl, dims, b) {
    const w = dims.width, h = dims.height;
    // Work at half-res: the result gets blurred + upscaled anyway, so this is a
    // big speedup (esp. on full-res export canvases) with no visible quality loss.
    const ds = 0.5;
    const bw = Math.max(1, Math.round(w * ds));
    const bh = Math.max(1, Math.round(h * ds));
    const t = document.createElement('canvas');
    t.width = bw; t.height = bh;
    const tx = t.getContext('2d');
    tx.drawImage(canvasEl, 0, 0, bw, bh);

    const id = tx.getImageData(0, 0, bw, bh);
    const d = id.data;
    const thr = (b.threshold / 100) * 255;
    const range = Math.max(1, 255 - thr);
    for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum < thr) {
            d[i + 3] = 0; // below threshold contributes nothing
        } else {
            // Soft knee so the bloom ramps in rather than hard-clipping.
            const f = Math.min(1, ((lum - thr) / range) * 1.3);
            d[i + 3] = Math.round(255 * f);
        }
    }
    tx.putImageData(id, 0, 0);

    const radius = Math.max(1, b.radius || 1);
    context.save();
    context.globalCompositeOperation = 'screen';
    context.globalAlpha = Math.min(1, (b.intensity || 0) / 100);
    // Wide soft halo + a tighter inner glow give the bloom some falloff structure.
    context.filter = `blur(${radius}px)`;
    context.drawImage(t, 0, 0, w, h);
    context.filter = `blur(${Math.max(1, radius / 2)}px)`;
    context.drawImage(t, 0, 0, w, h);
    context.restore();
    context.filter = 'none';
}

// ---------------------------------------------------------------------------
// Light leak — colored radial bloom from an edge/corner
// ---------------------------------------------------------------------------
const FX_LEAK_POS = {
    'top-left': [0, 0], 'top': [0.5, 0], 'top-right': [1, 0],
    'left': [0, 0.5], 'right': [1, 0.5],
    'bottom-left': [0, 1], 'bottom': [0.5, 1], 'bottom-right': [1, 1]
};
function applyLightLeak(context, dims, l) {
    const w = dims.width, h = dims.height;
    const pos = FX_LEAK_POS[l.position] || FX_LEAK_POS['top-right'];
    const cx = w * pos[0], cy = h * pos[1];
    const R = Math.max(w, h) * 0.95;
    const a = Math.min(1, (l.intensity || 0) / 100);
    const col = fxHexToRgb(l.color || '#ff5e62');

    context.save();
    context.globalCompositeOperation = 'screen';
    const rg = context.createRadialGradient(cx, cy, 0, cx, cy, R);
    rg.addColorStop(0, `rgba(${col.r},${col.g},${col.b},${0.55 * a})`);
    rg.addColorStop(0.5, `rgba(${col.r},${col.g},${col.b},${0.18 * a})`);
    rg.addColorStop(1, `rgba(${col.r},${col.g},${col.b},0)`);
    context.fillStyle = rg;
    context.fillRect(0, 0, w, h);
    context.restore();
}

// ---------------------------------------------------------------------------
// Vignette — radial darkening (or tint) toward the edges
// ---------------------------------------------------------------------------
function applyVignette(context, dims, v) {
    const w = dims.width, h = dims.height;
    const cx = w / 2, cy = h / 2;
    const outer = Math.sqrt(cx * cx + cy * cy);
    // softness controls how far in from the edge the darkening starts.
    const inner = outer * Math.max(0, 0.95 - (v.softness / 100) * 0.9);
    const a = Math.min(1, (v.amount || 0) / 100);
    const col = fxHexToRgb(v.color || '#000000');

    const rg = context.createRadialGradient(cx, cy, inner, cx, cy, outer);
    rg.addColorStop(0, `rgba(${col.r},${col.g},${col.b},0)`);
    rg.addColorStop(1, `rgba(${col.r},${col.g},${col.b},${a})`);
    context.save();
    context.fillStyle = rg;
    context.fillRect(0, 0, w, h);
    context.restore();
}

// ---------------------------------------------------------------------------
// Gobo shadows — build a dark pattern on transparent, then multiply over the
// scene. Patterns are drawn origin-centered over an oversized region so rotation
// never reveals an uncovered corner.
// ---------------------------------------------------------------------------
function applyGobo(context, dims, g) {
    const w = dims.width, h = dims.height;
    const pat = document.createElement('canvas');
    pat.width = w; pat.height = h;
    const x = pat.getContext('2d');

    const cx = w * ((g.x ?? 50) / 100);
    const cy = h * ((g.y ?? 50) / 100);
    const scale = Math.max(0.1, (g.scale || 100) / 100);
    const diag = Math.sqrt(w * w + h * h);

    x.save();
    x.translate(cx, cy);
    x.rotate((g.angle || 0) * Math.PI / 180);
    x.scale(scale, scale);
    if (g.blur) x.filter = `blur(${g.blur}px)`;
    drawGoboPattern(x, diag, g.pattern || 'blinds');
    x.restore();

    context.save();
    context.globalCompositeOperation = 'multiply';
    context.globalAlpha = Math.min(1, (g.intensity || 0) / 100);
    context.drawImage(pat, 0, 0);
    context.restore();
}

function drawGoboPattern(x, diag, pattern) {
    const dark = 'rgba(0,0,0,0.82)';
    if (pattern === 'blinds') {
        // Horizontal venetian-blind slats.
        const period = (diag * 2) / 16;
        const slat = period * 0.55;
        x.fillStyle = dark;
        for (let yy = -diag; yy <= diag; yy += period) {
            x.fillRect(-diag, yy, diag * 2, slat);
        }
        return;
    }
    if (pattern === 'window') {
        // Window light: bright panes with shadow cast by the frame + muntins.
        const span = diag * 1.5;
        const half = span / 2;
        const cols = 2, rows = 3;
        const bar = span * 0.045;
        x.fillStyle = dark;
        // outer frame
        x.fillRect(-half, -half, span, bar);          // top
        x.fillRect(-half, half - bar, span, bar);      // bottom
        x.fillRect(-half, -half, bar, span);           // left
        x.fillRect(half - bar, -half, bar, span);      // right
        // vertical muntins
        for (let c = 1; c < cols; c++) {
            const xx = -half + (span / cols) * c - bar / 2;
            x.fillRect(xx, -half, bar, span);
        }
        // horizontal muntins
        for (let r = 1; r < rows; r++) {
            const yy = -half + (span / rows) * r - bar / 2;
            x.fillRect(-half, yy, span, bar);
        }
        return;
    }
    if (pattern === 'palm') {
        // Palm fronds fanning out from the placement point.
        const fronds = 7;
        x.fillStyle = dark;
        for (let k = 0; k < fronds; k++) {
            const ang = (-0.35 + 1.0 * (k / (fronds - 1))) * Math.PI;
            x.save();
            x.rotate(ang);
            drawFrond(x, diag * 1.15);
            x.restore();
        }
        return;
    }
    // 'dappled' (default fallback): light filtering through leaves — fill dark,
    // then punch soft transparent holes for the gaps.
    x.fillStyle = dark;
    x.fillRect(-diag, -diag, diag * 2, diag * 2);
    x.globalCompositeOperation = 'destination-out';
    const rnd = fxRng(1337);
    const n = 110;
    for (let i = 0; i < n; i++) {
        const px = (rnd() * 2 - 1) * diag;
        const py = (rnd() * 2 - 1) * diag;
        const r = diag * (0.025 + rnd() * 0.075);
        const hole = x.createRadialGradient(px, py, 0, px, py, r);
        hole.addColorStop(0, 'rgba(0,0,0,1)');
        hole.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = hole;
        x.beginPath();
        x.arc(px, py, r, 0, Math.PI * 2);
        x.fill();
    }
    x.globalCompositeOperation = 'source-over';
}

// A single palm frond: tapered central blade plus leaflets along its length.
function drawFrond(x, len) {
    const width = len * 0.06;
    x.beginPath();
    x.moveTo(0, 0);
    x.quadraticCurveTo(len * 0.5, -width, len, 0);
    x.quadraticCurveTo(len * 0.5, width, 0, 0);
    x.fill();
    const leaflets = 9;
    for (let i = 1; i <= leaflets; i++) {
        const t = i / (leaflets + 1);
        const lx = len * t;
        const ll = len * 0.16 * (1 - t * 0.5);
        const lw = width * 0.5;
        for (const dir of [-1, 1]) {
            x.save();
            x.translate(lx, 0);
            x.rotate(dir * 0.7);
            x.beginPath();
            x.ellipse(ll / 2, 0, ll / 2, lw, 0, 0, Math.PI * 2);
            x.fill();
            x.restore();
        }
    }
}
