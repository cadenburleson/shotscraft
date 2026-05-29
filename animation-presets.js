// animation-presets.js
// ---------------------------------------------------------------------------
// One-click "marketing reel" device animations. Each preset is a small list of
// device poses + tour timing; applying one populates entry.animation.poses /
// .tour and calls rebuildTour() (in animation.js) to generate the keyframes —
// no manual keying. Poses are expressed RELATIVE to the screenshot's current
// look ({ d: delta } from the current value, or { v: absolute }) so a preset
// composes with whatever template/position the device already has.
//
// Depends on globals from animation.js: getAnimation, captureTourPose, animGet,
// rebuildTour, propMeta, TOUR_DEFAULTS — and from app.js: getCurrentScreenshot,
// updateCanvas. Loaded after animation.js, before app.js wires the UI.
// ---------------------------------------------------------------------------

(function () {
    window.ANIMATION_PRESETS = [
        {
            id: 'hero-reveal',
            name: 'Hero Reveal',
            description: 'Turns in from an angle and settles straight — a confident product reveal.',
            tour: { hold: 0.6, transition: 0.7, easing: 'easeOut' },
            poses: [
                { 'screenshot.rotation3D.y': { d: 26 }, 'screenshot.rotation3D.x': { d: 8 }, 'screenshot.scale': { d: -6 } },
                { 'screenshot.rotation3D.y': { d: 0 }, 'screenshot.rotation3D.x': { d: 0 }, 'screenshot.scale': { d: 0 } }
            ]
        },
        {
            id: 'slow-orbit',
            name: 'Slow Orbit',
            description: 'A gentle left-to-right turn that shows the device has real depth.',
            tour: { hold: 0.25, transition: 1.2, easing: 'easeInOut' },
            poses: [
                { 'screenshot.rotation3D.y': { d: -24 } },
                { 'screenshot.rotation3D.y': { d: 24 } }
            ]
        },
        {
            id: 'tilt-pan',
            name: 'Tilt & Pan',
            description: 'Tilts back and pans across — energetic, great for feature highlights.',
            tour: { hold: 0.4, transition: 0.85, easing: 'easeInOut' },
            poses: [
                { 'screenshot.rotation3D.y': { d: -18 }, 'screenshot.rotation3D.x': { d: 6 }, 'screenshot.x': { d: -4 } },
                { 'screenshot.rotation3D.y': { d: 18 }, 'screenshot.rotation3D.x': { d: 6 }, 'screenshot.x': { d: 4 } }
            ]
        },
        {
            id: 'push-in',
            name: 'Push In',
            description: 'Slowly pushes in for emphasis — a classic promo move.',
            tour: { hold: 0.2, transition: 1.5, easing: 'easeInOut' },
            poses: [
                { 'screenshot.scale': { d: -12 } },
                { 'screenshot.scale': { d: 6 } }
            ]
        },
        {
            id: 'float-up',
            name: 'Float Up',
            description: 'Drifts upward with a soft zoom — calm and premium.',
            tour: { hold: 0.3, transition: 1.2, easing: 'easeInOut' },
            poses: [
                { 'screenshot.y': { d: 6 }, 'screenshot.scale': { d: -4 } },
                { 'screenshot.y': { d: -3 }, 'screenshot.scale': { d: 2 } }
            ]
        },
        {
            id: 'showcase',
            name: 'Showcase',
            kind: 'reel',
            description: 'Three-beat: angle in, hold center, angle out — a complete mini story.',
            tour: { hold: 0.7, transition: 0.6, easing: 'easeOut' },
            poses: [
                { 'screenshot.rotation3D.y': { d: 22 }, 'screenshot.scale': { d: -6 } },
                { 'screenshot.rotation3D.y': { d: 0 }, 'screenshot.scale': { d: 0 } },
                { 'screenshot.rotation3D.y': { d: -22 }, 'screenshot.scale': { d: -6 } }
            ]
        },

        // ---- Building blocks: single, composable moves to drop into a custom
        // animation (apply one, then tweak poses/keyframes by hand). ----
        {
            id: 'drop-in',
            name: 'Drop In',
            kind: 'block',
            description: 'Device drops in from above and scales up into place.',
            tour: { hold: 0.5, transition: 0.6, easing: 'easeOut' },
            poses: [
                { 'screenshot.y': { d: -10 }, 'screenshot.scale': { d: -24 } },
                { 'screenshot.y': { d: 0 }, 'screenshot.scale': { d: 0 } }
            ]
        },
        {
            id: 'spin',
            name: 'Spin',
            kind: 'block',
            description: 'A full 360° turn of the device.',
            tour: { hold: 0.2, transition: 1.3, easing: 'easeInOut' },
            poses: [
                { 'screenshot.rotation3D.y': { d: 0 } },
                { 'screenshot.rotation3D.y': { d: 360 } }
            ]
        },
        {
            id: 'slide-in',
            name: 'Slide In',
            kind: 'block',
            description: 'Slides in from off the left edge into place.',
            tour: { hold: 0.5, transition: 0.6, easing: 'easeOut' },
            poses: [
                { 'screenshot.x': { v: -20 } },
                { 'screenshot.x': { d: 0 } }
            ]
        },
        {
            id: 'fade-in-text',
            name: 'Fade In Text',
            kind: 'block',
            description: 'Headline and subheadline fade up from transparent.',
            tour: { hold: 0.4, transition: 0.7, easing: 'easeOut' },
            poses: [
                { 'text.headlineOpacity': { v: 0 }, 'text.subheadlineOpacity': { v: 0 } },
                { 'text.headlineOpacity': { v: 100 }, 'text.subheadlineOpacity': { v: 100 } }
            ]
        }
    ];

    function findPreset(id) {
        return (window.ANIMATION_PRESETS || []).find(p => p.id === id) || null;
    }

    // Apply a preset's motion to a screenshot entry, relative to its current look.
    // Returns true on success.
    function applyAnimationPreset(entry, presetId) {
        if (!entry || typeof getAnimation !== 'function' || typeof rebuildTour !== 'function') return false;
        const preset = findPreset(presetId);
        if (!preset) return false;

        const anim = getAnimation(entry);
        const base = typeof captureTourPose === 'function' ? captureTourPose(entry) : {};
        const is3D = !!(entry.screenshot && entry.screenshot.use3D);

        // Union of every path any pose step touches.
        const animatedPaths = new Set();
        preset.poses.forEach(step => Object.keys(step).forEach(k => animatedPaths.add(k)));

        const valueAt = (path) => {
            if (typeof base[path] === 'number') return base[path];
            const v = typeof animGet === 'function' ? animGet(entry, path) : undefined;
            return typeof v === 'number' ? v : 0;
        };

        anim.poses = preset.poses.map(step => {
            const pose = {};
            animatedPaths.forEach(path => {
                // Rotation only reads in 3D; skip 3D-rotation paths for flat screenshots.
                if (!is3D && path.indexOf('rotation3D') !== -1) return;
                const baseVal = valueAt(path);
                const spec = step[path];
                let v = baseVal;
                if (spec && typeof spec.v === 'number') v = spec.v;
                else if (spec && typeof spec.d === 'number') v = baseVal + spec.d;
                // Note: no slider-range clamping here — entrance moves intentionally
                // go out of range (a Spin exceeds ±180°, a Slide starts off-frame).
                pose[path] = v;
            });
            return pose;
        });

        const defaults = (typeof TOUR_DEFAULTS !== 'undefined') ? TOUR_DEFAULTS : { hold: 0.8, transition: 0.35, easing: 'easeOut' };
        anim.tour = Object.assign({}, defaults, preset.tour || {});
        rebuildTour(entry);
        return true;
    }

    // Apply to the current screenshot from the toolbar picker.
    function applyAnimationPresetToCurrent(presetId) {
        const entry = typeof getCurrentScreenshot === 'function' ? getCurrentScreenshot() : null;
        if (!entry) return;
        if (typeof pushAnimHistory === 'function') pushAnimHistory();
        if (!applyAnimationPreset(entry, presetId)) return;
        if (typeof renderTimelineTracks === 'function') renderTimelineTracks();
        if (typeof updateTourUI === 'function') updateTourUI();
        if (typeof syncTimelineDurationUI === 'function') syncTimelineDurationUI();
        if (typeof updateCanvas === 'function') updateCanvas();
        if (typeof saveIfPossible === 'function') saveIfPossible();
    }

    // Apply to ALL screenshots (used by the gallery's "apply to all" toggle).
    function applyAnimationPresetToAll(presetId) {
        if (typeof state === 'undefined' || !state.screenshots || !state.screenshots.length) return;
        if (typeof pushAnimHistory === 'function') pushAnimHistory();
        let any = false;
        state.screenshots.forEach(s => { if (applyAnimationPreset(s, presetId)) any = true; });
        if (!any) return;
        if (typeof renderTimelineTracks === 'function') renderTimelineTracks();
        if (typeof updateTourUI === 'function') updateTourUI();
        if (typeof syncTimelineDurationUI === 'function') syncTimelineDurationUI();
        if (typeof updateCanvas === 'function') updateCanvas();
        if (typeof saveIfPossible === 'function') saveIfPossible();
    }

    // ---- Animations gallery (visual picker with looping motion previews) ----

    // Map a preset's poses into CSS transform/opacity keyframes for a looping
    // preview. Values are treated as offsets from a neutral device (deltas applied
    // directly; absolutes mapped relative to center).
    function previewKeyframes(preset) {
        const n = preset.poses.length || 1;
        return preset.poses.map((step, i) => {
            let ry = 0, rx = 0, sc = 1, tx = 0, ty = 0, op = 1;
            Object.keys(step).forEach(path => {
                const spec = step[path] || {};
                const d = typeof spec.d === 'number' ? spec.d : null;
                const v = typeof spec.v === 'number' ? spec.v : null;
                if (path === 'screenshot.rotation3D.y') ry = d != null ? d : (v || 0);
                else if (path === 'screenshot.rotation3D.x') rx = d != null ? d : (v || 0);
                else if (path === 'screenshot.scale') sc = 1 + (d != null ? d : 0) / 100;
                else if (path === 'screenshot.x') { const xv = v != null ? v : (50 + (d || 0)); tx = (xv - 50) * 1.7; }
                else if (path === 'screenshot.y') { const yv = v != null ? v : (50 + (d || 0)); ty = (yv - 50) * 1.3; }
                else if (path === 'text.headlineOpacity') op = (v != null ? v : 100) / 100;
            });
            return {
                offset: n > 1 ? i / (n - 1) : 0,
                transform: `perspective(520px) translate(${tx}%, ${ty}%) rotateY(${ry}deg) rotateX(${rx}deg) scale(${sc.toFixed(3)})`,
                opacity: op
            };
        });
    }

    function buildAnimationPreviewDevice(preset) {
        const stage = document.createElement('div');
        stage.className = 'anim-prev-stage';
        const device = document.createElement('div');
        device.className = 'anim-prev-device';
        const screen = document.createElement('div');
        screen.className = 'anim-prev-screen';
        const notch = document.createElement('div');
        notch.className = 'anim-prev-notch';
        screen.appendChild(notch);
        device.appendChild(screen);
        stage.appendChild(device);

        const frames = previewKeyframes(preset);
        const n = preset.poses.length || 1;
        const durMs = Math.max(1300, 700 + n * 700);
        // A full-spin loops seamlessly forward; settling reels look best ping-ponging.
        const continuous = preset.id === 'spin';
        // element.animate runs once attached; loops regardless of modal visibility.
        try {
            device.animate(frames, {
                duration: durMs,
                iterations: Infinity,
                direction: continuous ? 'normal' : 'alternate',
                easing: 'ease-in-out'
            });
        } catch (e) { /* WAAPI unsupported: static preview is fine */ }
        return stage;
    }

    function applyFromGallery(presetId) {
        const all = document.getElementById('anim-apply-all');
        if (all && all.checked) applyAnimationPresetToAll(presetId);
        else {
            const entry = typeof getCurrentScreenshot === 'function' ? getCurrentScreenshot() : null;
            if (!entry) {
                if (typeof showAppAlert === 'function') showAppAlert('Add or select a screenshot first, then apply a motion.', 'info');
                return;
            }
            applyAnimationPresetToCurrent(presetId);
        }
        closeAnimationsModal();
    }

    function renderAnimationsGallery() {
        const gallery = document.getElementById('anim-gallery');
        if (!gallery) return;
        gallery.replaceChildren();
        const groups = [
            { kind: 'reel', label: 'Marketing reels', hint: 'Finished, ready-to-export motions' },
            { kind: 'block', label: 'Building blocks', hint: 'Single moves to start a custom animation' }
        ];
        groups.forEach(g => {
            const items = (window.ANIMATION_PRESETS || []).filter(p => (p.kind || 'reel') === g.kind);
            if (!items.length) return;
            const section = document.createElement('div');
            section.className = 'anim-section';
            const h = document.createElement('div');
            h.className = 'anim-section-title';
            h.appendChild(document.createTextNode(g.label + ' '));
            const hintSpan = document.createElement('span');
            hintSpan.className = 'anim-section-hint';
            hintSpan.textContent = g.hint;
            h.appendChild(hintSpan);
            section.appendChild(h);
            const grid = document.createElement('div');
            grid.className = 'anim-grid';
            items.forEach(p => {
                const card = document.createElement('div');
                card.className = 'anim-card';
                card.title = p.description || '';
                card.appendChild(buildAnimationPreviewDevice(p));
                const meta = document.createElement('div');
                meta.className = 'anim-card-meta';
                const name = document.createElement('div');
                name.className = 'anim-card-name';
                name.textContent = p.name;
                const desc = document.createElement('div');
                desc.className = 'anim-card-desc';
                desc.textContent = p.description || '';
                meta.appendChild(name);
                meta.appendChild(desc);
                card.appendChild(meta);
                card.addEventListener('click', () => applyFromGallery(p.id));
                grid.appendChild(card);
            });
            section.appendChild(grid);
            gallery.appendChild(section);
        });
    }

    function openAnimationsModal() {
        renderAnimationsGallery();
        const m = document.getElementById('animations-modal');
        if (m) m.classList.add('visible');
    }
    function closeAnimationsModal() {
        const m = document.getElementById('animations-modal');
        if (m) m.classList.remove('visible');
    }

    // Populate the toolbar <select>, wire it + the Animations gallery modal.
    function initAnimationPresets() {
        const sel = document.getElementById('tl-anim-preset');
        if (sel) {
            sel.replaceChildren();
            const placeholder = document.createElement('option');
            placeholder.value = '';
            placeholder.textContent = '✨ Animate…';
            sel.appendChild(placeholder);
            const groups = [
                { kind: 'reel', label: 'Marketing reels' },
                { kind: 'block', label: 'Building blocks' }
            ];
            groups.forEach(g => {
                const items = (window.ANIMATION_PRESETS || []).filter(p => (p.kind || 'reel') === g.kind);
                if (!items.length) return;
                const og = document.createElement('optgroup');
                og.label = g.label;
                items.forEach(p => {
                    const o = document.createElement('option');
                    o.value = p.id;
                    o.textContent = p.name;
                    o.title = p.description;
                    og.appendChild(o);
                });
                sel.appendChild(og);
            });
            sel.addEventListener('change', () => {
                const id = sel.value;
                sel.value = ''; // reset to placeholder after applying
                if (id) applyAnimationPresetToCurrent(id);
            });
        }

        // Gallery modal wiring
        const openBtn = document.getElementById('animations-btn');
        if (openBtn) openBtn.addEventListener('click', openAnimationsModal);
        const closeBtn = document.getElementById('animations-modal-close');
        if (closeBtn) closeBtn.addEventListener('click', closeAnimationsModal);
        const overlay = document.getElementById('animations-modal');
        if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAnimationsModal(); });
    }

    // Expose for app.js init + programmatic use (e.g. animated templates).
    window.applyAnimationPreset = applyAnimationPreset;
    window.applyAnimationPresetToCurrent = applyAnimationPresetToCurrent;
    window.applyAnimationPresetToAll = applyAnimationPresetToAll;
    window.openAnimationsModal = openAnimationsModal;
    window.initAnimationPresets = initAnimationPresets;
})();
