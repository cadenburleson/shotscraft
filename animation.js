// ShotsCraft animation engine + timeline editor.
//
// Unified-timeline model: a single playhead is the source of truth. On each frame it
// (1) sets the current video's currentTime, (2) evaluates every keyframe track and writes
// the interpolated values into the live screenshot settings, then (3) re-renders. Tracks
// target a dot-path into the screenshot entry, so any numeric property is animatable
// without per-property engine code.

// ---- Animatable property registry --------------------------------------------------
// path is relative to a screenshot entry: `screenshot.*` = device settings, `text.*` = text,
// `elements.<id>.*` = per-canvas-element (transform / opacity). For elements the registry
// only holds templates; concrete tracks are synthesized per element id at runtime.
const ANIMATABLE_PROPS = [
    { path: 'screenshot.rotation3D.y', label: 'Rotate Y (Turn)', min: -180, max: 180, step: 1 },
    { path: 'screenshot.rotation3D.x', label: 'Rotate X (Tilt)', min: -180, max: 180, step: 1 },
    { path: 'screenshot.rotation3D.z', label: 'Rotate Z (Roll)', min: -180, max: 180, step: 1 },
    { path: 'screenshot.scale',        label: 'Scale / Zoom',    min: 10,   max: 200, step: 1 },
    { path: 'screenshot.x',            label: 'Position X',      min: 0,    max: 100, step: 1 },
    { path: 'screenshot.y',            label: 'Position Y',      min: 0,    max: 100, step: 1 },
    // Text
    { path: 'text.offsetY',            label: 'Text Vertical',   min: -100, max: 100, step: 1 },
    { path: 'text.lineHeight',         label: 'Line Height',     min: 50,   max: 300, step: 1 },
    { path: 'text.headlineSize',       label: 'Headline Size',   min: 10,   max: 300, step: 1 },
    { path: 'text.headlineOpacity',    label: 'Headline Opacity', min: 0,   max: 100, step: 1 },
    { path: 'text.headlineColor',      label: 'Headline Color',  type: 'color' },
    { path: 'text.subheadlineSize',    label: 'Subheadline Size', min: 10,  max: 300, step: 1 },
    { path: 'text.subheadlineOpacity', label: 'Subheadline Opacity', min: 0, max: 100, step: 1 },
    { path: 'text.subheadlineColor',   label: 'Subheadline Color', type: 'color' }
];

// Per-element track templates. A concrete track path is `elements.<id>.<suffix>`.
const ELEMENT_TRACK_PROPS = [
    { suffix: 'x',        label: 'Position X', min: 0,    max: 100, step: 1 },
    { suffix: 'y',        label: 'Position Y', min: 0,    max: 100, step: 1 },
    { suffix: 'width',    label: 'Size',       min: 1,    max: 200, step: 1 },
    { suffix: 'rotation', label: 'Rotation',   min: -180, max: 180, step: 1 },
    { suffix: 'opacity',  label: 'Opacity',    min: 0,    max: 100, step: 1 }
];

// Resolve a per-element track path → a meta {label, min, max, step, type} matching the
// static-prop registry shape, so renderTimelineTracks/box-select/etc. can treat them
// the same. Label includes the element's name so the timeline lane is readable.
function elementPropMeta(path) {
    if (!path || !path.startsWith('elements.')) return null;
    const parts = path.split('.');
    if (parts.length !== 3) return null;
    const tpl = ELEMENT_TRACK_PROPS.find(p => p.suffix === parts[2]);
    if (!tpl) return null;
    let elName = 'Element';
    if (typeof getCurrentScreenshot === 'function') {
        const entry = getCurrentScreenshot();
        const el = (entry && entry.elements || []).find(e => e.id === parts[1]);
        if (el) elName = el.name || el.type || 'Element';
    }
    return { ...tpl, label: `${elName} · ${tpl.label}`, path };
}

function propMeta(path) {
    return ANIMATABLE_PROPS.find(p => p.path === path) || elementPropMeta(path);
}

// ---- Path get/set on a screenshot entry --------------------------------------------
// Resolves `elements.<id>.<prop>` by looking up by id in the elements array (the array
// isn't an object map, so a plain dot-walk wouldn't find it).
function animGet(entry, path) {
    if (entry && path && path.startsWith('elements.')) {
        const parts = path.split('.');
        if (parts.length >= 3) {
            const el = (entry.elements || []).find(e => e.id === parts[1]);
            if (!el) return undefined;
            return parts.slice(2).reduce((o, k) => (o == null ? undefined : o[k]), el);
        }
    }
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), entry);
}
function animSet(entry, path, value) {
    if (entry && path && path.startsWith('elements.')) {
        const parts = path.split('.');
        if (parts.length >= 3) {
            const el = (entry.elements || []).find(e => e.id === parts[1]);
            if (!el) return;
            const rest = parts.slice(2);
            let o = el;
            for (let i = 0; i < rest.length - 1; i++) {
                if (o[rest[i]] == null) o[rest[i]] = {};
                o = o[rest[i]];
            }
            o[rest[rest.length - 1]] = value;
            return;
        }
    }
    const keys = path.split('.');
    let o = entry;
    for (let i = 0; i < keys.length - 1; i++) {
        if (o[keys[i]] == null) o[keys[i]] = {};
        o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
}

// Lerp two #RRGGBB hex colours; tolerates 3-digit shorthand.
function lerpHexColor(a, b, t) {
    const parse = (h) => {
        h = String(h || '').replace('#', '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
    };
    const [r1, g1, b1] = parse(a), [r2, g2, b2] = parse(b);
    const mix = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    return '#' + mix(r1, r2) + mix(g1, g2) + mix(b1, b2);
}

// ---- Easing ------------------------------------------------------------------------
const EASING = {
    linear: t => t,
    easeIn: t => t * t,
    easeOut: t => t * (2 - t),
    easeInOut: t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)
};

// ---- Animation data model on a screenshot entry ------------------------------------
function getAnimation(entry) {
    if (!entry) return null;
    if (!entry.animation) entry.animation = { duration: 6, tracks: [] };
    if (typeof entry.animation.duration !== 'number') entry.animation.duration = 6;
    if (!Array.isArray(entry.animation.tracks)) entry.animation.tracks = [];
    return entry.animation;
}

// Interpolate a single track's value at time t (seconds).
function evalTrack(track, t) {
    const kfs = track.keyframes;
    if (!kfs || kfs.length === 0) return undefined;
    if (kfs.length === 1) return kfs[0].value;
    if (t <= kfs[0].t) return kfs[0].value;
    if (t >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].value;
    for (let i = 0; i < kfs.length - 1; i++) {
        const a = kfs[i], b = kfs[i + 1];
        if (t >= a.t && t <= b.t) {
            const span = b.t - a.t || 1e-6;
            const localT = (t - a.t) / span;
            const ease = EASING[b.easing] || EASING.easeInOut;
            const e = ease(localT);
            // Hex-color values lerp in RGB; everything else lerps as a number.
            if (typeof a.value === 'string' && typeof b.value === 'string') {
                return lerpHexColor(a.value, b.value, e);
            }
            return a.value + (b.value - a.value) * e;
        }
    }
    return kfs[kfs.length - 1].value;
}

// Evaluate all tracks at time t and write the values into the live entry settings.
function applyAnimationAtTime(entry, t) {
    const anim = getAnimation(entry);
    if (!anim || !anim.tracks.length) return;
    anim.tracks.forEach(track => {
        const v = evalTrack(track, t);
        if (v !== undefined) animSet(entry, track.path, v);
    });
}

// ---- Playhead / transport ----------------------------------------------------------
const timeline = { playing: false, time: 0, raf: null, lastTs: 0 };

function timelineDuration() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    return anim ? anim.duration : 6;
}

// Render the composition at the current playhead: drive video, apply animation, redraw.
function timelineRenderAtPlayhead() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) return;

    // Drive the video clock from the playhead (clamped to the video's own length).
    const media = (typeof getScreenshotImage === 'function') ? getScreenshotImage(entry) : null;
    if (media && media.tagName === 'VIDEO' && isFinite(media.duration) && media.duration > 0 && !timeline.playing) {
        const vt = Math.min(timeline.time, media.duration);
        if (Math.abs(media.currentTime - vt) > 0.05) {
            try { media.currentTime = vt; } catch (e) {}
        }
    }

    applyAnimationAtTime(entry, timeline.time);

    if (typeof _suppressSave !== "undefined") _suppressSave = true;
    if (typeof updateCanvas === 'function') updateCanvas();
    if (typeof _suppressSave !== "undefined") _suppressSave = false;

    updateTimelinePlayheadUI();
    // Light up the sidebar controls whose keyframe is at the playhead (works during
    // playback too, where the full UI sync is skipped for performance).
    if (typeof updateAnimatedControlIndicators === 'function') updateAnimatedControlIndicators();
}

function timelinePlay() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) return;
    timeline.playing = true;
    setTimelinePlayIcon(true);
    const dur = timelineDuration();
    if (timeline.time >= dur - 0.001) timeline.time = 0; // restart if at end

    const media = (typeof getScreenshotImage === 'function') ? getScreenshotImage(entry) : null;
    if (media && media.tagName === 'VIDEO') {
        media.muted = (typeof _userMuted !== 'undefined') ? _userMuted : true;
        try { media.currentTime = Math.min(timeline.time, media.duration || timeline.time); } catch (e) {}
        media.play().catch(() => {});
    }

    timeline.lastTs = performance.now();
    const tick = (ts) => {
        if (!timeline.playing) return;
        const dt = (ts - timeline.lastTs) / 1000;
        timeline.lastTs = ts;
        timeline.time += dt;
        const d = timelineDuration();
        if (timeline.time >= d) {
            timeline.time = 0; // loop the whole composition
            if (media && media.tagName === 'VIDEO') {
                try { media.currentTime = 0; } catch (e) {}
            }
        }
        applyAnimationAtTime(entry, timeline.time);
        if (typeof _suppressSave !== "undefined") _suppressSave = true;
        if (typeof updateCanvas === 'function') updateCanvas();
        if (typeof _suppressSave !== "undefined") _suppressSave = false;
        updateTimelinePlayheadUI();
        timeline.raf = requestAnimationFrame(tick);
    };
    timeline.raf = requestAnimationFrame(tick);
}

function timelinePause() {
    timeline.playing = false;
    setTimelinePlayIcon(false);
    if (timeline.raf) cancelAnimationFrame(timeline.raf);
    timeline.raf = null;
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const media = entry && typeof getScreenshotImage === 'function' ? getScreenshotImage(entry) : null;
    if (media && media.tagName === 'VIDEO') media.pause();
}

function timelineToggle() {
    if (timeline.playing) timelinePause(); else timelinePlay();
}

function timelineSeek(t) {
    const dur = timelineDuration();
    timeline.time = Math.max(0, Math.min(dur, t));
    timelineRenderAtPlayhead();
    if (!timeline.playing && typeof syncUIWithState === 'function') syncUIWithState();
}

// ---- UI -----------------------------------------------------------------------------
let selectedKeyframe = null; // { trackIndex, kfIndex } — the "primary" selection
let selectedKeyframes = [];  // multi-selection (box select): array of { trackIndex, kfIndex }
let boxSelectArmed = false;  // true after pressing B / clicking Box, until a marquee is drawn

// Is a given keyframe part of the current (multi or single) selection?
function isKeyframeSelected(ti, ki) {
    if (selectedKeyframe && selectedKeyframe.trackIndex === ti && selectedKeyframe.kfIndex === ki) return true;
    return selectedKeyframes.some(k => k.trackIndex === ti && k.kfIndex === ki);
}

function setTimelinePlayIcon(playing) {
    const play = document.getElementById('tl-play-icon');
    const pause = document.getElementById('tl-pause-icon');
    if (play) play.style.display = playing ? 'none' : '';
    if (pause) pause.style.display = playing ? '' : 'none';
}

function fmtTime(s) { return (Math.round(s * 10) / 10).toFixed(1) + 's'; }

function updateTimelinePlayheadUI() {
    const dur = timelineDuration();
    const timeEl = document.getElementById('tl-time');
    if (timeEl) timeEl.textContent = `${fmtTime(timeline.time)} / ${fmtTime(dur)}`;
    const pct = dur > 0 ? (timeline.time / dur) * 100 : 0;
    document.querySelectorAll('.tl-playhead').forEach(ph => { ph.style.left = pct + '%'; });
}

// Show the timeline panel whenever a screenshot is selected.
function updateTimelineVisibility() {
    const panel = document.getElementById('timeline-panel');
    if (!panel) return;
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    panel.hidden = !entry;
    if (entry) {
        const anim = getAnimation(entry);
        // Auto-fit the timeline to the video's length (unless the user set a custom
        // duration). This makes the single timeline scrubber span the whole clip, so it
        // can fully replace the old video bar.
        const media = (typeof getScreenshotImage === 'function') ? getScreenshotImage(entry) : null;
        if (media && media.tagName === 'VIDEO' && isFinite(media.duration) && media.duration > 0 && !anim._userDuration) {
            anim.duration = Math.round(media.duration * 10) / 10;
        }
        const durInput = document.getElementById('tl-duration');
        if (durInput) durInput.value = anim.duration;
        syncTimelineVolumeUI();
        renderTimelineTracks();
        updateTimelinePlayheadUI();
    }
}

// Mirror the app-level volume/mute state onto the timeline's volume controls.
function syncTimelineVolumeUI() {
    const vol = document.getElementById('tl-volume');
    const muted = (typeof _userMuted !== 'undefined') ? _userMuted : true;
    const v = (typeof _userVolume !== 'undefined') ? _userVolume : 1;
    if (vol) vol.value = String(Math.round(v * 100));
    const on = document.getElementById('tl-vol-on-icon');
    const off = document.getElementById('tl-vol-off-icon');
    if (on) on.style.display = muted ? 'none' : '';
    if (off) off.style.display = muted ? '' : 'none';
}

// Rebuilds the "Add Animation…" dropdown so it includes a row for every static prop
// (device + text) PLUS one row per existing element track. Called on populate AND
// whenever elements change, since the menu is data-dependent.
function populateAddTrackDropdown() {
    const sel = document.getElementById('tl-add-track');
    if (!sel) return;
    const placeholder = sel.querySelector('option[value=""]');
    sel.replaceChildren();
    if (placeholder) sel.appendChild(placeholder);
    else { const p = document.createElement('option'); p.value = ''; p.textContent = '+ Add Animation…'; sel.appendChild(p); }

    const addOpt = (label, value) => {
        const opt = document.createElement('option');
        opt.value = value; opt.textContent = label;
        sel.appendChild(opt);
    };
    const addGroup = (label) => {
        const g = document.createElement('optgroup'); g.label = label;
        sel.appendChild(g); return g;
    };

    // Group static props by area for legibility.
    const groups = {
        Device: ANIMATABLE_PROPS.filter(p => p.path.startsWith('screenshot.')),
        Text:   ANIMATABLE_PROPS.filter(p => p.path.startsWith('text.'))
    };
    Object.entries(groups).forEach(([name, list]) => {
        if (!list.length) return;
        const g = addGroup(name);
        list.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.path; opt.textContent = p.label;
            g.appendChild(opt);
        });
    });

    // Per-element groups.
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    (entry && entry.elements || []).forEach(el => {
        const name = el.name || el.type || 'Element';
        const g = addGroup(name);
        ELEMENT_TRACK_PROPS.forEach(tpl => {
            const opt = document.createElement('option');
            opt.value = `elements.${el.id}.${tpl.suffix}`;
            opt.textContent = tpl.label;
            g.appendChild(opt);
        });
    });
}

// ---- Undo / redo for timeline edits ------------------------------------------------
// Snapshot the current screenshot's animation before each edit so accidental changes
// (e.g. a stray keyframe) can be reverted with Cmd/Ctrl+Z. Scoped to the timeline.
let _animUndo = [];
let _animRedo = [];
function _animSnapshot() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) return null;
    return { entry, anim: JSON.parse(JSON.stringify(getAnimation(entry))) };
}
function pushAnimHistory() {
    const s = _animSnapshot();
    if (!s) return;
    _animUndo.push(s);
    if (_animUndo.length > 100) _animUndo.shift();
    _animRedo = [];
}
function _restoreAnimSnapshot(s) {
    if (!s || !s.entry) return;
    s.entry.animation = JSON.parse(JSON.stringify(s.anim));
    selectedKeyframe = null;
    renderTimelineTracks();
    timelineRenderAtPlayhead();
    saveIfPossible();
}
function undoAnim() {
    if (!_animUndo.length) return;
    const cur = _animSnapshot();
    if (cur) _animRedo.push(cur);
    _restoreAnimSnapshot(_animUndo.pop());
}
function redoAnim() {
    if (!_animRedo.length) return;
    const cur = _animSnapshot();
    if (cur) _animUndo.push(cur);
    _restoreAnimSnapshot(_animRedo.pop());
}

function addTrack(path) {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry || !path) return;
    const anim = getAnimation(entry);
    if (anim.tracks.some(t => t.path === path)) return;
    pushAnimHistory();
    const current = animGet(entry, path);
    anim.tracks.push({
        path,
        keyframes: [{ t: timeline.time, value: typeof current === 'number' ? current : 0, easing: 'easeInOut' }]
    });
    renderTimelineTracks();
    saveIfPossible();
}

function removeTrack(trackIndex) {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    pushAnimHistory();
    anim.tracks.splice(trackIndex, 1);
    selectedKeyframe = null;
    renderTimelineTracks();
    saveIfPossible();
}

// Add (or update) a keyframe on a SPECIFIC track at the playhead, capturing that
// property's current value. This is the per-track keyframe button — each lane keys its
// own property, so adjusting Rotate Y then Scale and keying each lands on the right track.
function addKeyframeToTrack(trackIndex, skipHistory) {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    const track = anim.tracks[trackIndex];
    if (!track) return;
    if (!skipHistory) pushAnimHistory();
    const value = animGet(entry, track.path);
    const easing = document.getElementById('tl-easing')?.value || 'easeInOut';
    const existing = track.keyframes.find(k => Math.abs(k.t - timeline.time) < 0.02);
    if (existing) {
        existing.value = typeof value === 'number' ? value : existing.value;
        existing.easing = easing;
    } else {
        track.keyframes.push({ t: timeline.time, value: typeof value === 'number' ? value : 0, easing });
        track.keyframes.sort((a, b) => a.t - b.t);
    }
    renderTimelineTracks();
    saveIfPossible();
}

// Toolbar "◆ Key" button: keys the selected track if one is selected, else keys ALL
// tracks at once (so you can snapshot the whole pose in one click).
function addKeyframeAtPlayhead() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    if (!anim.tracks.length) return;
    pushAnimHistory(); // one undo step for the whole "Key" action
    if (selectedKeyframe) {
        addKeyframeToTrack(selectedKeyframe.trackIndex, true);
    } else {
        anim.tracks.forEach((_, i) => addKeyframeToTrack(i, true));
    }
}

function deleteSelectedKeyframe() {
    // Delete the whole multi-selection if present, else the single selected keyframe.
    const targets = selectedKeyframes.length ? selectedKeyframes.slice()
                   : (selectedKeyframe ? [selectedKeyframe] : []);
    if (!targets.length) return;
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    pushAnimHistory();
    // Group indices per track and splice high→low so earlier removals don't shift the rest.
    const byTrack = {};
    targets.forEach(t => { (byTrack[t.trackIndex] = byTrack[t.trackIndex] || []).push(t.kfIndex); });
    Object.keys(byTrack).forEach(ti => {
        const track = anim.tracks[ti];
        if (!track) return;
        byTrack[ti].sort((a, b) => b - a).forEach(ki => track.keyframes.splice(ki, 1));
    });
    selectedKeyframe = null;
    selectedKeyframes = [];
    renderTimelineTracks();
    saveIfPossible();
}

// ---- Pose Tour ---------------------------------------------------------------------
// Capture a few device "poses" (position / zoom / rotation) and auto-build a snappy
// "hold → quick move → hold" animation that visits each — no manual keyframing. Tuned
// for quick takes (short transitions, minimal easing) rather than slow ease-in-out.
const TOUR_DEFAULTS = { hold: 0.8, transition: 0.35, easing: 'easeOut' };

function tourPoseProps(entry) {
    const use3D = entry && entry.screenshot && entry.screenshot.use3D;
    const props = ['screenshot.scale', 'screenshot.x', 'screenshot.y'];
    if (use3D) props.push('screenshot.rotation3D.x', 'screenshot.rotation3D.y', 'screenshot.rotation3D.z');
    else props.push('screenshot.rotation');
    // Text — numeric props (offset / size / line height / opacity) and colors.
    props.push('text.offsetY', 'text.lineHeight',
               'text.headlineSize', 'text.headlineOpacity', 'text.headlineColor',
               'text.subheadlineSize', 'text.subheadlineOpacity', 'text.subheadlineColor');
    // Per-element transform/opacity.
    (entry && entry.elements || []).forEach(el => {
        ELEMENT_TRACK_PROPS.forEach(tpl => props.push(`elements.${el.id}.${tpl.suffix}`));
    });
    return props;
}

// Capture every animatable value for the pose. Numbers + hex colors only; anything
// undefined (e.g., a text prop on a screenshot that hasn't set it) is skipped, which
// keeps rebuildTour from making 0-valued tracks for irrelevant props.
function captureTourPose(entry) {
    const pose = {};
    tourPoseProps(entry).forEach(p => {
        const v = animGet(entry, p);
        if (typeof v === 'number') pose[p] = v;
        else if (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v)) pose[p] = v;
    });
    return pose;
}

// Regenerate the keyframes for all tour-managed tracks from anim.poses + timings.
function rebuildTour(entry) {
    const anim = getAnimation(entry);
    const poses = anim.poses || [];
    const tour = anim.tour || (anim.tour = { ...TOUR_DEFAULTS });
    const hold = tour.hold, trans = tour.transition, ease = tour.easing || 'easeOut';

    // Every path any pose touches, plus paths a previous rebuild managed (so clearing a
    // pose empties its track instead of leaving stale keyframes).
    const paths = [...new Set([...(anim._tourPaths || []), ...poses.flatMap(p => Object.keys(p))])];
    anim._tourPaths = [...new Set(poses.flatMap(p => Object.keys(p)))];

    paths.forEach(path => {
        let track = anim.tracks.find(t => t.path === path);
        const managedNow = anim._tourPaths.includes(path);
        if (!managedNow) {
            // No longer used by any pose → drop the track entirely.
            if (track) anim.tracks.splice(anim.tracks.indexOf(track), 1);
            return;
        }
        if (!track) { track = { path, keyframes: [] }; anim.tracks.push(track); }
        track.keyframes = [];
        poses.forEach((pose, i) => {
            const holdStart = i * (hold + trans);
            const val = pose[path];
            if (val == null) return;
            // Arrival keyframe (governs the quick transition into this pose).
            track.keyframes.push({ t: +holdStart.toFixed(3), value: val, easing: i === 0 ? 'linear' : ease });
            // Hold keyframe — stay put until the next transition.
            if (hold > 0) track.keyframes.push({ t: +(holdStart + hold).toFixed(3), value: val, easing: 'linear' });
        });
        track.keyframes.sort((a, b) => a.t - b.t);
    });

    const n = poses.length;
    anim.duration = Math.max(0.5, n > 0 ? ((n - 1) * (hold + trans) + hold) : (anim.duration || 6));
    anim._userDuration = true;
}

function addTourPose() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) return;
    const anim = getAnimation(entry);
    if (!anim.poses) anim.poses = [];
    if (!anim.tour) anim.tour = { ...TOUR_DEFAULTS };
    pushAnimHistory();
    anim.poses.push(captureTourPose(entry));
    rebuildTour(entry);
    renderTimelineTracks();
    updateTourUI();
    saveIfPossible();
}

function clearTourPoses() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) return;
    const anim = getAnimation(entry);
    if (!anim.poses || !anim.poses.length) return;
    pushAnimHistory();
    anim.poses = [];
    rebuildTour(entry);
    renderTimelineTracks();
    updateTourUI();
    saveIfPossible();
}

function updateTourUI() {
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const count = entry && entry.animation && entry.animation.poses ? entry.animation.poses.length : 0;
    const badge = document.getElementById('tl-pose-count');
    if (badge) badge.textContent = count ? `${count} pose${count > 1 ? 's' : ''}` : '';
    const clearBtn = document.getElementById('tl-clear-poses');
    if (clearBtn) clearBtn.style.display = count ? '' : 'none';
}

function renderTimelineTracks() {
    const container = document.getElementById('tl-tracks');
    if (!container) return;
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) { container.replaceChildren(); return; }
    const anim = getAnimation(entry);
    const dur = anim.duration || 6;
    container.replaceChildren();

    // Time ruler: a tick every ~1s (fewer if the duration is long), labeled in seconds.
    const ruler = document.createElement('div');
    ruler.className = 'tl-ruler';
    const rulerSpacer = document.createElement('div');
    rulerSpacer.className = 'tl-ruler-spacer';
    ruler.appendChild(rulerSpacer);
    const rulerTrack = document.createElement('div');
    rulerTrack.className = 'tl-ruler-track';
    const step = dur <= 10 ? 1 : (dur <= 30 ? 5 : 10);
    for (let s = 0; s <= dur + 1e-6; s += step) {
        const left = (s / dur) * 100;
        const tick = document.createElement('div');
        tick.className = 'tl-ruler-tick';
        tick.style.left = left + '%';
        rulerTrack.appendChild(tick);
        const lbl = document.createElement('div');
        lbl.className = 'tl-ruler-label';
        lbl.style.left = left + '%';
        lbl.textContent = s + 's';
        rulerTrack.appendChild(lbl);
    }
    rulerTrack.addEventListener('mousedown', (e) => beginPlayheadScrub(e, rulerTrack));
    rulerTrack.addEventListener('touchstart', (e) => beginPlayheadScrub(e, rulerTrack), { passive: false });
    rulerTrack.style.cursor = 'ew-resize';
    ruler.appendChild(rulerTrack);
    container.appendChild(ruler);

    anim.tracks.forEach((track, ti) => {
        const meta = propMeta(track.path) || { label: track.path };
        const row = document.createElement('div');
        row.className = 'tl-track';

        const label = document.createElement('div');
        label.className = 'tl-track-label';
        const labelText = document.createElement('span');
        labelText.textContent = meta.label;
        label.appendChild(labelText);
        // Per-track keyframe button — keys THIS property at the playhead.
        const keyBtn = document.createElement('button');
        keyBtn.className = 'tl-track-key';
        keyBtn.textContent = '◆';
        keyBtn.title = 'Add keyframe for this property at the playhead';
        keyBtn.addEventListener('click', (e) => { e.stopPropagation(); addKeyframeToTrack(ti); });
        label.appendChild(keyBtn);
        const del = document.createElement('button');
        del.className = 'tl-track-del';
        del.textContent = '✕';
        del.title = 'Remove track';
        del.addEventListener('click', (e) => { e.stopPropagation(); removeTrack(ti); });
        label.appendChild(del);
        row.appendChild(label);

        const lane = document.createElement('div');
        lane.className = 'tl-lane';
        lane.dataset.trackIndex = ti;

        const ph = document.createElement('div');
        ph.className = 'tl-playhead';
        lane.appendChild(ph);

        // Connecting line between consecutive keyframes — shows the property is
        // transitioning (tweening) from one state to the next. Drawn before the
        // diamonds so they render on top.
        const sorted = [...track.keyframes].sort((a, b) => a.t - b.t);
        for (let i = 0; i < sorted.length - 1; i++) {
            const seg = document.createElement('div');
            seg.className = 'tl-kf-segment';
            const x1 = dur > 0 ? (sorted[i].t / dur) * 100 : 0;
            const x2 = dur > 0 ? (sorted[i + 1].t / dur) * 100 : 0;
            seg.style.left = x1 + '%';
            seg.style.width = Math.max(0, x2 - x1) + '%';
            lane.appendChild(seg);
        }

        track.keyframes.forEach((kf, ki) => {
            const dia = document.createElement('div');
            dia.className = 'tl-kf';
            dia.dataset.trackIndex = ti;
            dia.dataset.kfIndex = ki;
            if (isKeyframeSelected(ti, ki)) {
                dia.classList.add('selected');
            }
            dia.style.left = (dur > 0 ? (kf.t / dur) * 100 : 0) + '%';
            dia.title = `${meta.label} = ${Math.round(kf.value * 10) / 10} @ ${fmtTime(kf.t)} (${kf.easing})`;
            dia.addEventListener('mousedown', (e) => beginKeyframeDrag(e, ti, ki, lane));
            dia.addEventListener('touchstart', (e) => beginKeyframeDrag(e, ti, ki, lane), { passive: false });
            lane.appendChild(dia);
        });

        // Press-and-drag anywhere on an empty part of the lane to scrub the playhead in
        // real time. (Keyframe diamonds stopPropagation, so this won't fire on them.)
        lane.addEventListener('mousedown', (e) => {
            if (e.target !== lane) return;
            beginPlayheadScrub(e, lane);
        });
        lane.addEventListener('touchstart', (e) => {
            if (e.target !== lane) return;
            beginPlayheadScrub(e, lane);
        }, { passive: false });

        row.appendChild(lane);
        container.appendChild(row);
    });

    updateTimelinePlayheadUI();
    syncEasingDropdownToSelection();
    updateTourUI();
    populateAddTrackDropdown();
}

// Real-time playhead scrubbing: press on a lane/ruler and drag. Updates the preview
// continuously (throttled to one render per animation frame so it stays smooth). Does
// NOT rebuild the track DOM mid-drag (that would invalidate the rect we're measuring
// against), so we only call timelineRenderAtPlayhead during the drag and sync the
// sidebar sliders once on release.
function beginPlayheadScrub(e, scrubEl) {
    e.preventDefault();
    const dur = timelineDuration();
    const rect = scrubEl.getBoundingClientRect();
    const wasPlaying = timeline.playing;
    if (wasPlaying) timelinePause();

    let rafPending = false;
    const seekTo = (clientX) => {
        const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        timeline.time = frac * dur;
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => { rafPending = false; timelineRenderAtPlayhead(); });
        }
    };
    const clientXOf = (ev) => (ev.touches && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX;

    seekTo(clientXOf(e));

    const onMove = (ev) => { ev.preventDefault(); seekTo(clientXOf(ev)); };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        timelineRenderAtPlayhead();
        // Reflect the scrubbed values in the sidebar sliders (rebuilds track DOM — fine now).
        if (typeof syncUIWithState === 'function') syncUIWithState();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
}

// Drag a keyframe horizontally to retime it.
function beginKeyframeDrag(e, trackIndex, kfIndex, lane) {
    e.preventDefault();
    e.stopPropagation();
    // Measure the lane BEFORE any re-render — renderTimelineTracks() replaces the DOM,
    // which would detach `lane` and make getBoundingClientRect() return zeros (the bug
    // that made keyframe dragging feel broken). Capture geometry first.
    const rect = lane.getBoundingClientRect();
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    const dur = anim.duration || 6;
    const track = anim.tracks[trackIndex];
    const grabbedKf = track.keyframes[kfIndex];

    // If the grabbed keyframe is part of a box-selection, drag them ALL by the same time
    // delta; otherwise this is a normal single-keyframe retime (and clears any selection).
    const multi = selectedKeyframes.length > 1 && isKeyframeSelected(trackIndex, kfIndex);
    let movers;
    if (multi) {
        movers = selectedKeyframes
            .map(s => { const tr = anim.tracks[s.trackIndex]; const kf = tr && tr.keyframes[s.kfIndex]; return kf ? { tr, kf, t0: kf.t } : null; })
            .filter(Boolean);
    } else {
        selectedKeyframes = [];
        selectedKeyframe = { trackIndex, kfIndex };
        movers = [{ tr: track, kf: grabbedKf, t0: grabbedKf.t }];
    }
    const grabbedT0 = grabbedKf.t;

    pushAnimHistory(); // snapshot before the retime so the drag is undoable
    renderTimelineTracks();  // safe now: rect already captured

    const clientXOf = (ev) => (ev.touches && ev.touches[0]) ? ev.touches[0].clientX : ev.clientX;
    let rafPending = false;
    const onMove = (ev) => {
        ev.preventDefault();
        const frac = Math.max(0, Math.min(1, (clientXOf(ev) - rect.left) / rect.width));
        const deltaT = (frac * dur) - grabbedT0;
        movers.forEach(m => { m.kf.t = Math.max(0, Math.min(dur, m.t0 + deltaT)); });
        // Re-sort each affected track, then rebuild selection indices from the kf objects.
        const tracksTouched = [...new Set(movers.map(m => m.tr))];
        tracksTouched.forEach(tr => tr.keyframes.sort((a, b) => a.t - b.t));
        if (multi) {
            selectedKeyframes = movers.map(m => ({ trackIndex: anim.tracks.indexOf(m.tr), kfIndex: m.tr.keyframes.indexOf(m.kf) }));
        }
        selectedKeyframe = { trackIndex: anim.tracks.indexOf(track), kfIndex: track.keyframes.indexOf(grabbedKf) };
        if (!rafPending) {
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                renderTimelineTracks();
                timelineRenderAtPlayhead();
            });
        }
    };
    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        renderTimelineTracks();
        saveIfPossible();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
}

function syncEasingDropdownToSelection() {
    const sel = document.getElementById('tl-easing');
    if (!sel || !selectedKeyframe) return;
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = getAnimation(entry);
    const track = anim.tracks[selectedKeyframe.trackIndex];
    const kf = track && track.keyframes[selectedKeyframe.kfIndex];
    if (kf) sel.value = kf.easing;
}

function saveIfPossible() {
    if (typeof saveState === 'function') saveState();
}

// ---- Auto-keying --------------------------------------------------------------------
// When ON, changing a property that ALREADY has a track records/updates a keyframe at
// the playhead automatically (like After Effects' stopwatch / a record button). We only
// touch properties that already have a track, so no surprise keyframes appear.
let autoKeyEnabled = false;

function setAutoKey(on) {
    autoKeyEnabled = !!on;
    const btn = document.getElementById('tl-autokey-btn');
    if (btn) btn.classList.toggle('active', autoKeyEnabled);
    console.log('[autokey] toggled', autoKeyEnabled ? 'ON' : 'OFF');
}
function toggleAutoKey() { setAutoKey(!autoKeyEnabled); }

let _trackRerenderPending = false;
function scheduleTrackRerender() {
    if (_trackRerenderPending) return;
    _trackRerenderPending = true;
    requestAnimationFrame(() => { _trackRerenderPending = false; renderTimelineTracks(); });
}

// Called from app.js property setters. When auto-key is ON, changing ANY animatable
// property records a keyframe at the playhead — creating the track on the fly if it
// doesn't exist yet. Guarded to the known animatable props (propMeta) so non-animatable
// settings that also flow through the setters (corner radius, shadow, frame, etc.) are
// ignored. No-op when auto-key is off — cheap to call on every setter.
function autoKeyTouch(path) {
    if (!autoKeyEnabled) return;
    if (!propMeta(path)) { console.log('[autokey] skip — not animatable:', path); return; }
    const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    if (!entry) { console.log('[autokey] skip — no current screenshot'); return; }
    const value = animGet(entry, path);
    if (typeof value !== 'number') { console.log('[autokey] skip — value not number:', path, value); return; }

    const anim = getAnimation(entry);
    let track = anim.tracks.find(t => t.path === path);
    if (!track) {                                       // first touch → start tracking it
        track = { path, keyframes: [] };
        anim.tracks.push(track);
    }
    const existing = track.keyframes.find(k => Math.abs(k.t - timeline.time) < 0.02);
    if (existing) {
        existing.value = value; // continuous update during a drag — not a discrete undo step
    } else {
        pushAnimHistory(); // a NEW auto-keyframe is a discrete, undoable action
        const easing = document.getElementById('tl-easing')?.value || 'easeInOut';
        track.keyframes.push({ t: timeline.time, value, easing });
        track.keyframes.sort((a, b) => a.t - b.t);
    }
    console.log(`[autokey] recorded ${path} = ${Math.round(value*10)/10} @ ${Math.round(timeline.time*100)/100}s (${track.keyframes.length} kf)`);
    // Persistence is handled by the caller's updateCanvas→saveState; just refresh the UI.
    scheduleTrackRerender();
}

// Editor-style keyboard shortcuts. Only active when a screenshot is selected (timeline
// visible) and the user isn't typing into a field.
function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}
function timelineKeydown(e) {
    const panel = document.getElementById('timeline-panel');
    if (!panel || panel.hidden) return;        // no screenshot / timeline hidden
    if (isTypingTarget(e.target)) return;       // don't hijack typing

    // Undo / redo for timeline edits (handle before the modifier guard below).
    if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redoAnim(); else undoAnim();
        return;
    }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redoAnim();
        return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const dur = timelineDuration();
    switch (e.key) {
        case 'Delete':                          // Delete / Backspace → remove selected keyframe(s)
        case 'Backspace':
            if (selectedKeyframe || selectedKeyframes.length) { e.preventDefault(); deleteSelectedKeyframe(); }
            break;
        case 'b':                               // B → arm box-select (drag a marquee over keyframes)
        case 'B':
            e.preventDefault();
            toggleBoxSelect();
            break;
        case ' ':                               // Space → play/pause
            e.preventDefault();
            timelineToggle();
            break;
        case 'Enter':                           // Return / Home → jump to start
        case 'Home':
            e.preventDefault();
            if (timeline.playing) timelinePause();
            timelineSeek(0);
            break;
        case 'End':                             // End → jump to end
            e.preventDefault();
            if (timeline.playing) timelinePause();
            timelineSeek(dur);
            break;
        case 'ArrowLeft':                       // ← step back (Shift = bigger step)
            e.preventDefault();
            if (timeline.playing) timelinePause();
            timelineSeek(timeline.time - (e.shiftKey ? 1 : 0.1));
            break;
        case 'ArrowRight':                      // → step forward
            e.preventDefault();
            if (timeline.playing) timelinePause();
            timelineSeek(timeline.time + (e.shiftKey ? 1 : 0.1));
            break;
    }
}

// ---- Wire up controls ---------------------------------------------------------------
function initTimeline() {
    populateAddTrackDropdown();

    document.addEventListener('keydown', timelineKeydown);

    const playBtn = document.getElementById('tl-play-btn');
    if (playBtn) playBtn.addEventListener('click', timelineToggle);

    const durInput = document.getElementById('tl-duration');
    if (durInput) durInput.addEventListener('change', () => {
        const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
        if (!entry) return;
        const anim = getAnimation(entry);
        anim.duration = Math.max(0.5, Math.min(60, parseFloat(durInput.value) || 6));
        anim._userDuration = true; // user override — stop auto-fitting to video length
        if (timeline.time > anim.duration) timeline.time = anim.duration;
        renderTimelineTracks();
        updateTimelinePlayheadUI();
        saveIfPossible();
    });

    // Mute toggle + volume — delegate to the app-level volume state so it persists
    // across screenshots and matches the (now-hidden) old video bar's behavior.
    const muteBtn = document.getElementById('tl-mute-btn');
    if (muteBtn) muteBtn.addEventListener('click', () => {
        if (typeof _userMuted !== 'undefined') _userMuted = !_userMuted;
        if (typeof applyVolumeToCurrent === 'function') applyVolumeToCurrent();
        syncTimelineVolumeUI();
    });
    const volSlider = document.getElementById('tl-volume');
    if (volSlider) volSlider.addEventListener('input', () => {
        const v = parseInt(volSlider.value, 10) / 100;
        if (typeof _userVolume !== 'undefined') _userVolume = v;
        if (v > 0 && typeof _userMuted !== 'undefined') _userMuted = false;
        if (typeof applyVolumeToCurrent === 'function') applyVolumeToCurrent();
        syncTimelineVolumeUI();
    });

    const addTrackSel = document.getElementById('tl-add-track');
    if (addTrackSel) addTrackSel.addEventListener('change', () => {
        if (addTrackSel.value) addTrack(addTrackSel.value);
        addTrackSel.value = '';
    });

    const autoKeyBtn = document.getElementById('tl-autokey-btn');
    if (autoKeyBtn) autoKeyBtn.addEventListener('click', toggleAutoKey);

    const addKey = document.getElementById('tl-add-key');
    if (addKey) addKey.addEventListener('click', addKeyframeAtPlayhead);

    const delKey = document.getElementById('tl-del-key');
    if (delKey) delKey.addEventListener('click', deleteSelectedKeyframe);

    const boxBtn = document.getElementById('tl-box-select');
    if (boxBtn) boxBtn.addEventListener('click', toggleBoxSelect);

    const addPoseBtn = document.getElementById('tl-add-pose');
    if (addPoseBtn) addPoseBtn.addEventListener('click', addTourPose);
    const clearPosesBtn = document.getElementById('tl-clear-poses');
    if (clearPosesBtn) clearPosesBtn.addEventListener('click', clearTourPoses);

    const easingSel = document.getElementById('tl-easing');
    if (easingSel) easingSel.addEventListener('change', () => {
        // Apply easing to the whole selection (box-select) or the single selected keyframe.
        const targets = selectedKeyframes.length ? selectedKeyframes
                       : (selectedKeyframe ? [selectedKeyframe] : []);
        if (!targets.length) return;
        const entry = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
        const anim = getAnimation(entry);
        pushAnimHistory();
        let changed = false;
        targets.forEach(t => {
            const track = anim.tracks[t.trackIndex];
            const kf = track && track.keyframes[t.kfIndex];
            if (kf) { kf.easing = easingSel.value; changed = true; }
        });
        if (changed) { timelineRenderAtPlayhead(); saveIfPossible(); }
    });

    setupBoxSelect();
}

// Box select: arm with the toolbar button or the B key, then drag a marquee over the
// tracks to select every keyframe inside it (for bulk delete / retime / easing).
function setBoxSelectArmed(on) {
    boxSelectArmed = !!on;
    const btn = document.getElementById('tl-box-select');
    if (btn) btn.classList.toggle('active', boxSelectArmed);
    const tracks = document.getElementById('tl-tracks');
    if (tracks) tracks.classList.toggle('box-select-armed', boxSelectArmed);
}
function toggleBoxSelect() { setBoxSelectArmed(!boxSelectArmed); }

function setupBoxSelect() {
    const tracks = document.getElementById('tl-tracks');
    if (!tracks) return;
    let marquee = null, startX = 0, startY = 0;

    const place = (x, y) => {
        marquee.style.left = Math.min(startX, x) + 'px';
        marquee.style.top = Math.min(startY, y) + 'px';
        marquee.style.width = Math.abs(x - startX) + 'px';
        marquee.style.height = Math.abs(y - startY) + 'px';
    };
    const onMove = (e) => { if (marquee) { e.preventDefault(); place(e.clientX, e.clientY); } };
    const onUp = (e) => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        const box = { left: Math.min(startX, e.clientX), top: Math.min(startY, e.clientY),
                      right: Math.max(startX, e.clientX), bottom: Math.max(startY, e.clientY) };
        if (marquee) { marquee.remove(); marquee = null; }
        const picked = [];
        tracks.querySelectorAll('.tl-kf').forEach(d => {
            const r = d.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) {
                picked.push({ trackIndex: +d.dataset.trackIndex, kfIndex: +d.dataset.kfIndex });
            }
        });
        selectedKeyframes = picked;
        selectedKeyframe = picked.length ? picked[picked.length - 1] : null;
        setBoxSelectArmed(false);
        renderTimelineTracks();
        syncEasingDropdownToSelection();
    };

    // Capture phase so we intercept before the lane's scrub/keyframe handlers.
    tracks.addEventListener('mousedown', (e) => {
        if (!boxSelectArmed || (e.button !== undefined && e.button !== 0)) return;
        e.preventDefault();
        e.stopPropagation();
        startX = e.clientX; startY = e.clientY;
        marquee = document.createElement('div');
        marquee.className = 'tl-marquee';
        document.body.appendChild(marquee);
        place(e.clientX, e.clientY);
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
    }, true);
}
