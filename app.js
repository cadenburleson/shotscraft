// State management
const state = {
    screenshots: [],
    selectedIndex: 0,
    transferTarget: null, // Index of screenshot waiting to receive style transfer
    outputDevice: 'iphone-6.9',
    currentLanguage: 'en', // Global current language for all text
    projectLanguages: ['en'], // Languages available in this project
    customWidth: 1290,
    customHeight: 2796,
    // Default settings applied to new screenshots
    defaults: {
        background: {
            type: 'gradient',
            gradient: {
                angle: 135,
                stops: [
                    { color: '#667eea', position: 0 },
                    { color: '#764ba2', position: 100 }
                ]
            },
            solid: '#1a1a2e',
            image: null,
            imageFit: 'cover',
            imageBlur: 0,
            overlayColor: '#000000',
            overlayOpacity: 0,
            noise: false,
            noiseIntensity: 10
        },
        screenshot: {
            scale: 70,
            y: 60,
            x: 50,
            rotation: 0,
            perspective: 0,
            cornerRadius: 24,
            frameStyle: 'none',
            use3D: false,
            device3D: 'iphone',
            rotation3D: { x: 0, y: 0, z: 0 },
            shadow: {
                enabled: true,
                style: 'drop',
                color: '#000000',
                blur: 40,
                opacity: 30,
                x: 0,
                y: 20,
                lightAngle: 40,   // 3D wall-shadow direction (azimuth degrees)
                lightElev: 0.65   // 3D light elevation (0 = overhead, 1 = grazing)
            },
            frame: {
                enabled: false,
                color: '#1d1d1f',
                width: 12,
                opacity: 100
            }
        },
        text: {
            headlineEnabled: true,
            headlines: { en: '' },
            headlineLanguages: ['en'],
            currentHeadlineLang: 'en',
            headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            headlineSize: 100,
            headlineWeight: '600',
            headlineItalic: false,
            headlineUnderline: false,
            headlineStrikethrough: false,
            headlineColor: '#ffffff',
            headlineOpacity: 100,
            perLanguageLayout: false,
            languageSettings: {
                en: {
                    headlineSize: 100,
                    subheadlineSize: 50,
                    position: 'top',
                    offsetY: 12,
                    lineHeight: 110
                }
            },
            currentLayoutLang: 'en',
            position: 'top',
            offsetX: 0,
            offsetY: 12,
            lineHeight: 110,
            subheadlineEnabled: false,
            subheadlines: { en: '' },
            subheadlineLanguages: ['en'],
            currentSubheadlineLang: 'en',
            subheadlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            subheadlineSize: 50,
            subheadlineWeight: '400',
            subheadlineItalic: false,
            subheadlineUnderline: false,
            subheadlineStrikethrough: false,
            subheadlineColor: '#ffffff',
            subheadlineOpacity: 70,
            // Text effects (shared by headline + subheadline). See DEFAULT_TEXT_* in the
            // text-effects section. Magnitudes are % of font size so they scale across
            // preview/export resolutions.
            stroke: { enabled: false, color: '#000000', width: 8 },
            shadow: { enabled: false, color: '#000000', blur: 14, x: 0, y: 8, opacity: 60 },
            bubble: { style: 'none', color: '#2563eb', opacity: 100, padding: 38, radius: 50, tail: 'bottom-left', textColor: '', shadow: false, shadowColor: '#000000', shadowBlur: 30, shadowOpacity: 35, shadowY: 12 },
            reveal: { type: 'none', duration: 1.2, delay: 0 }
        },
        elements: [],
        popouts: []
    }
};

// Post-composite visual effects defaults (defined in effects.js, loaded first).
if (typeof cloneDefaultEffects === 'function') {
    state.defaults.effects = cloneDefaultEffects();
}

const baseTextDefaults = JSON.parse(JSON.stringify(state.defaults.text));

// Runtime-only state (not persisted)
let selectedElementId = null;
let selectedPopoutId = null;
let draggingElement = null;
let draggingTransform = null;       // active scale/rotate drag via a selection handle

// Preload laurel SVG images for element frames
const laurelImages = {};
['laurel-simple-left', 'laurel-detailed-left'].forEach(name => {
    const img = new Image();
    img.src = `img/${name}.svg`;
    laurelImages[name] = img;
});

// Helper functions to get/set current screenshot settings
function getCurrentScreenshot() {
    if (state.screenshots.length === 0) return null;
    return state.screenshots[state.selectedIndex];
}

function getBackground() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? screenshot.background : state.defaults.background;
}

function getScreenshotSettings() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? screenshot.screenshot : state.defaults.screenshot;
}

// Per-screenshot post-composite effects (bloom, vignette, gobo, …). Lazily
// backfills the effects object (and any newly-added fields) so older projects
// pick up the feature without a migration step.
function getEffects() {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return state.defaults.effects;
    if (typeof withEffectDefaults === 'function') {
        screenshot.effects = withEffectDefaults(screenshot.effects);
    } else if (!screenshot.effects) {
        screenshot.effects = {};
    }
    return screenshot.effects;
}

function setEffect(key, value) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.effects) {
        screenshot.effects = (typeof cloneDefaultEffects === 'function') ? cloneDefaultEffects() : {};
    }
    const parts = key.split('.');
    let obj = screenshot.effects;
    for (let i = 0; i < parts.length - 1; i++) {
        if (obj[parts[i]] == null) obj[parts[i]] = {};
        obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
}

// ---- Extra devices ---------------------------------------------------------
// A screenshot can carry additional 3D devices beyond the primary one, each with
// its own screen image and 3D pose, composited into the same frame. They live in
// screenshot.extraDevices[]; the array is lazily created so old projects upgrade
// without a migration. selectedExtraDeviceId tracks which one (if any) is selected
// for editing on the canvas.
let selectedExtraDeviceId = null;

function getExtraDevices(screenshot) {
    const ss = screenshot || getCurrentScreenshot();
    if (!ss) return [];
    if (!Array.isArray(ss.extraDevices)) ss.extraDevices = [];
    return ss.extraDevices;
}

function getSelectedExtraDevice() {
    if (!selectedExtraDeviceId) return null;
    return getExtraDevices().find(d => d.id === selectedExtraDeviceId) || null;
}

// Factory for a new extra device. Mirrors the primary device's 3D fields, but is
// always 3D and starts slightly offset from center so it doesn't hide behind the
// primary device. `src`/`image` are filled when the user drops a screenshot on it.
function createExtraDeviceObject(opts = {}) {
    return {
        id: crypto.randomUUID(),
        device3D: opts.device3D || 'iphone',
        scale: opts.scale ?? 55,
        x: opts.x ?? 65,
        y: opts.y ?? 55,
        rotation3D: { x: 0, y: -18, z: 0, ...(opts.rotation3D || {}) },
        frameColor: opts.frameColor || null,
        shadow: opts.shadow ? JSON.parse(JSON.stringify(opts.shadow)) : {
            enabled: true, style: 'drop', color: '#000000', blur: 40, opacity: 30,
            x: 0, y: 20, lightAngle: 40, lightElev: 0.65
        },
        src: opts.src || null,
        image: opts.image || null,
        name: opts.name || 'Device'
    };
}

// Add a new extra 3D device to the current screenshot and select it. Inherits the
// primary device's model as a sensible default.
function addExtraDevice() {
    const ss = getCurrentScreenshot();
    if (!ss) return;
    const devices = getExtraDevices(ss);
    const dev = createExtraDeviceObject({ device3D: (ss.screenshot && ss.screenshot.device3D) || 'iphone' });
    devices.push(dev);
    selectExtraDevice(dev.id);
    saveState();
}

function deleteExtraDevice(id) {
    const ss = getCurrentScreenshot();
    if (!ss) return;
    ss.extraDevices = getExtraDevices(ss).filter(d => d.id !== id);
    if (selectedExtraDeviceId === id) selectExtraDevice(null);
    else { updateExtraDevicesList(); updateCanvas(); saveState(); }
}

// Set the selected extra device (or null) and refresh the UI. Selecting a device
// clears element/popout selection so focus is unambiguous, and reveals the Device tab.
function selectExtraDevice(id) {
    selectedExtraDeviceId = id;
    if (id) {
        if (typeof setSelectedElement === 'function') setSelectedElement(null);
        if (typeof selectedPopoutId !== 'undefined') selectedPopoutId = null;
        const devTab = document.querySelector('.tab[data-tab="screenshot"]');
        if (devTab && !devTab.classList.contains('active')) devTab.click();
    }
    updateExtraDevicesList();
    updateExtraDeviceProperties();
    updateCanvas();
}

// Replace a device's screen image from a File, keeping its pose.
function replaceExtraDeviceImage(dev, file) {
    if (!dev || !file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const src = reader.result;
        const img = new Image();
        img.onload = () => {
            dev.src = src; dev.image = img; dev.name = file.name;
            updateExtraDevicesList();
            updateCanvas();
            saveState();
        };
        img.src = src;
    };
    reader.readAsDataURL(file);
}

// Render the list of extra devices in the Device tab (name + select + delete).
function updateExtraDevicesList() {
    const list = document.getElementById('extra-devices-list');
    if (!list) return;
    const devices = getExtraDevices();
    list.innerHTML = '';
    devices.forEach((dev, i) => {
        const row = document.createElement('div');
        row.className = 'extra-device-row' + (dev.id === selectedExtraDeviceId ? ' selected' : '');
        const label = document.createElement('span');
        label.className = 'extra-device-name';
        label.textContent = dev.name && dev.name !== 'Device' ? dev.name : `Device ${i + 2}`;
        label.addEventListener('click', () => selectExtraDevice(dev.id));
        const del = document.createElement('button');
        del.className = 'extra-device-del';
        del.title = 'Delete device';
        del.textContent = '✕';
        del.addEventListener('click', (e) => { e.stopPropagation(); deleteExtraDevice(dev.id); });
        row.appendChild(label);
        row.appendChild(del);
        row.addEventListener('click', () => selectExtraDevice(dev.id));
        list.appendChild(row);
    });
    updateDeviceGroupRow();
    if (typeof updateGroupsList === 'function') updateGroupsList(); // sidebar layers tree
}

// Reflect the selected device's settings into the properties panel (or hide it). While
// an extra device is selected, the primary device's controls are hidden so there aren't
// two competing Scale/Rotation sets — you edit just the selected device.
function updateExtraDeviceProperties() {
    const panel = document.getElementById('extra-device-properties');
    const dev = getSelectedExtraDevice();
    const primary = document.getElementById('primary-device-controls');
    if (primary) primary.style.display = dev ? 'none' : '';
    if (!panel) return;
    if (!dev) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const setVal = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const setTxt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    document.querySelectorAll('#extra-device-model button').forEach(b =>
        b.classList.toggle('active', b.dataset.model === (dev.device3D || 'iphone')));
    setVal('extra-device-scale', dev.scale); setTxt('extra-device-scale-value', Math.round(dev.scale));
    const r = dev.rotation3D || { x: 0, y: 0, z: 0 };
    setVal('extra-device-rot-x', r.x); setTxt('extra-device-rot-x-value', Math.round(r.x) + '°');
    setVal('extra-device-rot-y', r.y); setTxt('extra-device-rot-y-value', Math.round(r.y) + '°');
    setVal('extra-device-rot-z', r.z); setTxt('extra-device-rot-z-value', Math.round(r.z) + '°');
}

// ---- Group transforms ----------------------------------------------------------
// One transform core moves/scales/rotates a SET of canvas items as a single unit.
// Members are addressed by key — 'primary' | 'dev:<id>' | 'el:<id>' | 'pop:<id>' —
// so a group can mix 3D devices, text/graphic elements and popouts. Two consumers:
//   1. the Device tab's "Group — transform together" toggle (all devices linked)
//   2. named groups (folders) the user assembles in the Elements tab
// Positions are transformed in CANVAS-PIXEL space (each kind maps % → px
// differently), so scaling/orbiting keeps the layout's true on-screen shape.

// Non-rounding degree wrap — group rotation applies small incremental deltas, and
// _wrapDeg's rounding would swallow sub-degree steps.
function _wrapDegF(d) { return ((d + 180) % 360 + 360) % 360 - 180; }

function _groupClampPos(v) { return Math.max(-80, Math.min(180, v)); }

// Resolve member keys to live objects. Missing members (deleted items) drop out.
function resolveGroupMembers(keys) {
    const out = [];
    const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
    (keys || []).forEach(k => {
        if (k === 'primary') {
            if (ss) out.push({ kind: 'primary', key: k, obj: ss });
        } else if (k.startsWith('dev:')) {
            const d = getExtraDevices().find(d => d.id === k.slice(4));
            if (d) out.push({ kind: 'dev', key: k, obj: d });
        } else if (k.startsWith('el:')) {
            const el = getElements().find(e => e.id === k.slice(3));
            if (el) out.push({ kind: 'el', key: k, obj: el });
        } else if (k.startsWith('pop:')) {
            const p = getPopouts().find(p => p.id === k.slice(4));
            if (p) out.push({ kind: 'pop', key: k, obj: p });
        }
    });
    return out;
}

// Member-kind position adapters. Devices use the center-relative ±0.85
// visible-extent mapping (see positionRange in three-renderer.js); elements and
// popouts are plain fractions of the canvas.
function memberPosToPx(m, dims) {
    const o = m.obj;
    if (m.kind === 'primary' || m.kind === 'dev') {
        return {
            x: dims.width / 2 + ((o.x ?? 50) - 50) / 50 * 0.85 * dims.width / 2,
            y: dims.height / 2 + ((o.y ?? 50) - 50) / 50 * 0.85 * dims.height / 2
        };
    }
    return { x: (o.x ?? 50) / 100 * dims.width, y: (o.y ?? 50) / 100 * dims.height };
}
function memberPosFromPx(m, dims, px, py) {
    const o = m.obj;
    if (m.kind === 'primary' || m.kind === 'dev') {
        o.x = _groupClampPos(50 + (px - dims.width / 2) / (0.85 * dims.width / 2) * 50);
        o.y = _groupClampPos(50 + (py - dims.height / 2) / (0.85 * dims.height / 2) * 50);
    } else {
        o.x = Math.max(-50, Math.min(150, px / dims.width * 100));
        o.y = Math.max(-50, Math.min(150, py / dims.height * 100));
    }
}

function membersCentroidPx(members, dims) {
    if (!members.length) return { x: dims.width / 2, y: dims.height / 2 };
    let sx = 0, sy = 0;
    members.forEach(m => { const p = memberPosToPx(m, dims); sx += p.x; sy += p.y; });
    return { x: sx / members.length, y: sy / members.length };
}

function membersMoveBy(members, dxPx, dyPx) {
    const dims = getCanvasDimensions();
    members.forEach(m => {
        const p = memberPosToPx(m, dims);
        memberPosFromPx(m, dims, p.x + dxPx, p.y + dyPx);
    });
}

// Scale each member's size AND its distance from the group's center, so the
// arrangement zooms like one object instead of items piling onto their own spots.
function membersScaleBy(members, factor) {
    if (!members.length || !(factor > 0)) return;
    const dims = getCanvasDimensions();
    const c = membersCentroidPx(members, dims);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    members.forEach(m => {
        const p = memberPosToPx(m, dims);
        memberPosFromPx(m, dims, c.x + (p.x - c.x) * factor, c.y + (p.y - c.y) * factor);
        const o = m.obj;
        if (m.kind === 'primary') o.scale = clamp((o.scale ?? 70) * factor, 30, 400);
        else if (m.kind === 'dev') o.scale = clamp((o.scale ?? 55) * factor, 10, 150);
        else if (m.kind === 'el') {
            o.width = clamp((o.width ?? 20) * factor, 2, 300);
            o.fontSize = clamp((o.fontSize ?? 60) * factor, 6, 600);
        } else if (m.kind === 'pop') {
            o.width = clamp((o.width ?? 30) * factor, 2, 200);
        }
    });
}

// Rigid screen-space rotation of the whole arrangement: positions orbit the group
// centroid while each member spins in place — devices via roll (rotation3D.z, or
// the 2D rotation when the primary is in 2D mode), elements/popouts via rotation.
function membersRotate2DBy(members, delta) {
    if (!members.length || !delta) return;
    const dims = getCanvasDimensions();
    const c = membersCentroidPx(members, dims);
    const rad = delta * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    members.forEach(m => {
        const p = memberPosToPx(m, dims);
        const rx = p.x - c.x, ry = p.y - c.y;
        memberPosFromPx(m, dims, c.x + rx * cos - ry * sin, c.y + rx * sin + ry * cos);
        const o = m.obj;
        if (m.kind === 'dev' || (m.kind === 'primary' && o.use3D)) {
            o.rotation3D = o.rotation3D || { x: 0, y: 0, z: 0 };
            o.rotation3D.z = _wrapDegF(o.rotation3D.z + delta);
        } else {
            o.rotation = _wrapDegF((o.rotation || 0) + delta);
        }
    });
}

// Turn (y) / tilt (x) every 3D device in the set in sync, in place — keeps their
// relative pose offsets. Non-device members are unaffected (no 3D axes).
function membersRotate3DBy(members, axis, delta) {
    if (!delta) return;
    members.forEach(m => {
        if (m.kind !== 'primary' && m.kind !== 'dev') return;
        const o = m.obj;
        o.rotation3D = o.rotation3D || { x: 0, y: 0, z: 0 };
        o.rotation3D[axis] = _wrapDegF(o.rotation3D[axis] + delta);
    });
}

// ---- Device-link toggle (all devices as one) ------------------------------------
// ss.linkDevices: every canvas gesture on ANY device drives the whole device set.

function deviceGroupActive() {
    const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
    return !!(ss && ss.use3D && ss.linkDevices && getExtraDevices().length);
}

function allDeviceMembers() {
    return resolveGroupMembers(['primary', ...getExtraDevices().map(d => 'dev:' + d.id)]);
}

// Refresh the panels that show group members' values after a group edit.
function groupSyncUI() {
    if (typeof syncPrimaryDeviceSliders === 'function') syncPrimaryDeviceSliders();
    if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
}

// Show the group toggle only when there's actually a group to link (3D + extras).
function updateDeviceGroupRow() {
    const row = document.getElementById('device-group-row');
    if (!row) return;
    const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
    const show = !!(ss && ss.use3D) && getExtraDevices().length > 0;
    row.style.display = show ? 'flex' : 'none';
    document.getElementById('device-group-toggle')?.classList.toggle('active', !!(ss && ss.linkDevices));
}

// ---- Named groups (folders) ------------------------------------------------------
// A group is a saved set of member keys on the screenshot: { id, name, members }.
// Select one in the Elements tab and the canvas treats it as a single object —
// drag moves everything, Alt+drag zooms it (sizes + spacing), Ctrl/⌘+drag rotates
// it rigidly. Members keep their identity; deleting a group never deletes items.

let selectedGroupId = null;

function getGroups() {
    const s = getCurrentScreenshot();
    if (!s) return [];
    if (!Array.isArray(s.groups)) s.groups = [];
    return s.groups;
}

function getSelectedGroup() {
    return getGroups().find(g => g.id === selectedGroupId) || null;
}

// Friendly label for a member key (groups panel + builder checklist).
function groupMemberLabel(key) {
    if (key === 'primary') return 'Main device';
    if (key.startsWith('dev:')) {
        const devs = getExtraDevices();
        const i = devs.findIndex(d => d.id === key.slice(4));
        const d = devs[i];
        if (!d) return '(deleted device)';
        return d.name && d.name !== 'Device' ? d.name : `Device ${i + 2}`;
    }
    if (key.startsWith('el:')) {
        const el = getElements().find(e => e.id === key.slice(3));
        if (!el) return '(deleted element)';
        if (el.type === 'text') {
            const t = (getElementText(el) || 'Text').trim();
            return '“' + (t.length > 16 ? t.slice(0, 16) + '…' : t) + '”';
        }
        return el.name || 'Graphic';
    }
    if (key.startsWith('pop:')) {
        const i = getPopouts().findIndex(p => p.id === key.slice(4));
        return i >= 0 ? `Popout ${i + 1}` : '(deleted popout)';
    }
    return key;
}

// Everything on the current screen that can join a group, as {key, label}.
function groupCandidates() {
    const out = [];
    if (getCurrentScreenshot()) out.push({ key: 'primary', label: 'Main device' });
    getExtraDevices().forEach(d => out.push({ key: 'dev:' + d.id, label: groupMemberLabel('dev:' + d.id) }));
    getElements().forEach(el => out.push({ key: 'el:' + el.id, label: groupMemberLabel('el:' + el.id) }));
    getPopouts().forEach((p, i) => out.push({ key: 'pop:' + p.id, label: `Popout ${i + 1}` }));
    return out;
}

// Select a group (or null). Clears single-item selections so the focus is the folder.
function selectGroup(id) {
    selectedGroupId = id;
    if (id) {
        if (typeof setSelectedElement === 'function') setSelectedElement(null);
        if (typeof selectedPopoutId !== 'undefined') selectedPopoutId = null;
        if (typeof selectedExtraDeviceId !== 'undefined' && selectedExtraDeviceId &&
            typeof selectExtraDevice === 'function') selectExtraDevice(null);
        if (typeof updateElementProperties === 'function') updateElementProperties();
        if (typeof updatePopoutsList === 'function') updatePopoutsList();
        if (typeof updatePopoutProperties === 'function') updatePopoutProperties();
    }
    updateGroupsList();
    if (typeof drawSelectionOverlay === 'function') drawSelectionOverlay();
}

// Canvas-px bounds of a group: union of device projected rects where available,
// with elements/popouts approximated from their center + width. Padded slightly.
function groupBoundsPx(group) {
    const members = resolveGroupMembers(group ? group.members : null);
    if (!members.length) return null;
    const dims = getCanvasDimensions();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x0, y0, x1, y1) => {
        minX = Math.min(minX, x0); minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    };
    members.forEach(m => {
        let r = null;
        if (m.kind === 'primary') r = primaryDeviceScreenRect();
        else if (m.kind === 'dev') r = m.obj._screenRect;
        if (r && r.w > 0) { grow(r.x, r.y, r.x + r.w, r.y + r.h); return; }
        const p = memberPosToPx(m, dims);
        const halfW = Math.max(40, ((m.obj.width ?? 20) / 100) * dims.width / 2);
        const halfH = (m.kind === 'el' && m.obj.type === 'text')
            ? Math.max(40, (m.obj.fontSize ?? 60) * 1.2)
            : halfW;
        grow(p.x - halfW, p.y - halfH, p.x + halfW, p.y + halfH);
    });
    if (!isFinite(minX)) return null;
    const pad = 14;
    return { x: minX - pad, y: minY - pad, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 };
}

function deleteGroup(id) {
    const s = getCurrentScreenshot();
    if (!s || !Array.isArray(s.groups)) return;
    s.groups = s.groups.filter(g => g.id !== id);
    if (selectedGroupId === id) selectedGroupId = null;
    updateGroupsList();
    updateCanvas();
    saveState();
}

// Route a layer-row click to the right selection machinery, revealing the matching
// editor tab — the tree is the one place every kind of item can be picked from.
function selectLayerKey(key) {
    const clickTab = (name) => {
        const t = document.querySelector(`.tab[data-tab="${name}"]`);
        if (t && !t.classList.contains('active')) t.click();
    };
    if (key === 'primary') {
        selectGroup(null);
        if (typeof setSelectedElement === 'function') setSelectedElement(null);
        if (typeof selectedPopoutId !== 'undefined') selectedPopoutId = null;
        if (selectedExtraDeviceId) selectExtraDevice(null);
        if (typeof updateElementsList === 'function') updateElementsList();
        if (typeof updateElementProperties === 'function') updateElementProperties();
        if (typeof updatePopoutsList === 'function') updatePopoutsList();
        if (typeof updatePopoutProperties === 'function') updatePopoutProperties();
        clickTab('screenshot');
        updateCanvas();
    } else if (key.startsWith('dev:')) {
        selectGroup(null);
        selectExtraDevice(key.slice(4)); // reveals the Device tab itself
    } else if (key.startsWith('el:')) {
        selectGroup(null);
        if (selectedExtraDeviceId) selectExtraDevice(null);
        if (typeof selectedPopoutId !== 'undefined') selectedPopoutId = null;
        setSelectedElement(key.slice(3));
        updateElementsList();
        updateElementProperties();
        if (typeof updatePopoutsList === 'function') updatePopoutsList();
        if (typeof updatePopoutProperties === 'function') updatePopoutProperties();
        clickTab('elements');
        updateCanvas();
    } else if (key.startsWith('pop:')) {
        selectGroup(null);
        if (selectedExtraDeviceId) selectExtraDevice(null);
        if (typeof setSelectedElement === 'function') setSelectedElement(null);
        selectedPopoutId = key.slice(4);
        updatePopoutsList();
        updatePopoutProperties();
        updateElementsList();
        if (typeof updateElementProperties === 'function') updateElementProperties();
        clickTab('popouts');
        updateCanvas();
    }
}

// Is this member key currently the app's selection? (Drives row highlights.)
function layerKeySelected(key) {
    if (key.startsWith('dev:')) return selectedExtraDeviceId === key.slice(4);
    if (key.startsWith('el:')) return typeof selectedElementId !== 'undefined' && selectedElementId === key.slice(3);
    if (key.startsWith('pop:')) return typeof selectedPopoutId !== 'undefined' && selectedPopoutId === key.slice(4);
    return false;
}

// ---- Layer reordering (drag rows in the tree) -----------------------------------
// Rows of the same kind reorder their underlying array, which IS the z-order for
// that kind (later in the array draws on top). Cross-kind stacking (devices vs
// elements vs popouts) is fixed by the render pipeline, so drops only land on
// rows of the same kind.

let _layerDrag = null; // { kind, id } while a tree row is being dragged

function _layerArrayFor(kind) {
    const s = getCurrentScreenshot();
    if (!s) return null;
    if (kind === 'dev') return getExtraDevices(s);
    if (kind === 'el') return s.elements || null;
    if (kind === 'pop') return s.popouts || null;
    if (kind === 'group') return getGroups();
    return null;
}

function reorderLayerItem(kind, dragId, targetId, after) {
    const arr = _layerArrayFor(kind);
    if (!arr) return;
    const from = arr.findIndex(o => o.id === dragId);
    if (from < 0) return;
    const [item] = arr.splice(from, 1);
    let to = arr.findIndex(o => o.id === targetId);
    if (to < 0) { arr.splice(from, 0, item); return; } // target vanished — put it back
    if (after) to += 1;
    arr.splice(to, 0, item);
    updateCanvas();
    saveState();
    // Refresh the panel that mirrors this kind (each also re-renders the tree).
    if (kind === 'dev') updateExtraDevicesList();
    else if (kind === 'el') updateElementsList();
    else if (kind === 'pop') updatePopoutsList();
    else updateGroupsList();
}

// Rebuild the sidebar layers tree (groups as folders, then ungrouped items).
// Name kept from the earlier Elements-tab panel so existing refresh call sites work.
function updateGroupsList() {
    const tree = document.getElementById('layers-tree');
    if (!tree) return;
    tree.innerHTML = '';

    const mkRow = (opts) => {
        const row = document.createElement('div');
        row.className = 'layer-row' +
            (opts.depth ? ' nested' : '') +
            (opts.selected ? ' selected' : '') +
            (opts.isFolder ? ' folder' : '');
        if (opts.title) row.title = opts.title;
        const icon = document.createElement('span');
        icon.className = 'layer-icon';
        icon.textContent = opts.icon;
        const label = document.createElement('span');
        label.className = 'layer-label';
        label.textContent = opts.label;
        row.appendChild(icon);
        row.appendChild(label);
        if (opts.onDelete) {
            const del = document.createElement('button');
            del.className = 'layer-del';
            del.title = opts.deleteTitle || 'Remove';
            del.textContent = '✕';
            del.addEventListener('click', (e) => { e.stopPropagation(); opts.onDelete(); });
            row.appendChild(del);
        }
        if (opts.onClick) row.addEventListener('click', opts.onClick);
        // Drag-to-reorder among rows of the same kind (array order = z-order;
        // lower in the list draws in front).
        if (opts.drag) {
            row.draggable = true;
            row.addEventListener('dragstart', (e) => {
                _layerDrag = opts.drag;
                row.classList.add('dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', opts.drag.kind + ':' + opts.drag.id);
                }
            });
            row.addEventListener('dragend', () => {
                _layerDrag = null;
                tree.querySelectorAll('.layer-row').forEach(r =>
                    r.classList.remove('dragging', 'insert-before', 'insert-after'));
            });
            row.addEventListener('dragover', (e) => {
                if (!_layerDrag || _layerDrag.kind !== opts.drag.kind || _layerDrag.id === opts.drag.id) return;
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                const r = row.getBoundingClientRect();
                const below = e.clientY > r.top + r.height / 2;
                row.classList.toggle('insert-after', below);
                row.classList.toggle('insert-before', !below);
            });
            row.addEventListener('dragleave', () => row.classList.remove('insert-before', 'insert-after'));
            row.addEventListener('drop', (e) => {
                if (!_layerDrag || _layerDrag.kind !== opts.drag.kind || _layerDrag.id === opts.drag.id) return;
                e.preventDefault();
                e.stopPropagation();
                const r = row.getBoundingClientRect();
                const below = e.clientY > r.top + r.height / 2;
                // Item kinds display top = front (reversed), so a visually-higher drop
                // means LATER in the draw array; groups list in natural order.
                reorderLayerItem(_layerDrag.kind, _layerDrag.id, opts.drag.id,
                    opts.drag.reversed ? !below : below);
            });
        }
        tree.appendChild(row);
        return row;
    };

    const iconFor = (key) => {
        if (key === 'primary' || key.startsWith('dev:')) return '📱';
        if (key.startsWith('pop:')) return '🔍';
        const el = getElements().find(e => e.id === key.slice(3));
        return el && el.type === 'text' ? '🅣' : '🖼';
    };

    // kind for a member key, for drag-reorder ('primary' is fixed — not draggable).
    // `reversed`: item kinds display top = front (reverse of array order), so a drop
    // ABOVE a row means AFTER it in the array. Groups list in natural order.
    const dragFor = (key) => {
        if (key.startsWith('dev:')) return { kind: 'dev', id: key.slice(4), reversed: true };
        if (key.startsWith('el:')) return { kind: 'el', id: key.slice(3), reversed: true };
        if (key.startsWith('pop:')) return { kind: 'pop', id: key.slice(4), reversed: true };
        return null;
    };

    const grouped = new Set();
    getGroups().forEach(g => {
        mkRow({
            icon: '📁',
            label: g.name,
            isFolder: true,
            selected: g.id === selectedGroupId,
            title: 'Click to select the group — drag on the canvas moves it · Alt+drag zooms · Ctrl/⌘+drag rotates',
            onClick: () => selectGroup(g.id === selectedGroupId ? null : g.id),
            onDelete: () => deleteGroup(g.id),
            deleteTitle: 'Ungroup (items stay on the canvas)',
            drag: { kind: 'group', id: g.id }
        });
        (g.members || []).forEach(key => {
            grouped.add(key);
            if (!resolveGroupMembers([key]).length) return; // skip deleted members
            // Members stay draggable: grouping bundles transforms, not z-order —
            // a grouped device still stacks against ungrouped ones of its kind.
            mkRow({
                icon: iconFor(key),
                label: groupMemberLabel(key),
                depth: 1,
                selected: layerKeySelected(key),
                title: key === 'primary' ? undefined
                    : 'Click to select · drag to reorder (higher rows draw in front)',
                onClick: () => selectLayerKey(key),
                drag: dragFor(key)
            });
        });
    });

    // Ungrouped items, listed TOP = FRONT (the universal layers-panel convention):
    // front-most kinds first, each kind in reverse array order (arrays draw first →
    // last, so the last item is the front-most), with the fixed main device at the
    // bottom of the stack.
    const orderedKeys = [
        ...getPopouts().slice().reverse().map(p => 'pop:' + p.id),
        ...getElements().slice().reverse().map(el => 'el:' + el.id),
        ...getExtraDevices().slice().reverse().map(d => 'dev:' + d.id),
        ...(getCurrentScreenshot() ? ['primary'] : [])
    ];
    orderedKeys.forEach(key => {
        if (grouped.has(key)) return;
        mkRow({
            icon: iconFor(key),
            label: groupMemberLabel(key),
            selected: layerKeySelected(key),
            title: key === 'primary' ? undefined
                : 'Click to select · drag to reorder (higher rows draw in front)',
            onClick: () => selectLayerKey(key),
            drag: dragFor(key)
        });
    });
}

// Inline member-picker: checklist of everything on the screen + a name field.
function openGroupBuilder() {
    const builder = document.getElementById('group-builder');
    if (!builder) return;
    builder.innerHTML = '';
    builder.style.display = 'block';

    const name = document.createElement('input');
    name.type = 'text';
    name.placeholder = 'Group name';
    name.value = 'Group ' + (getGroups().length + 1);
    name.style.marginBottom = '6px';
    builder.appendChild(name);

    const listWrap = document.createElement('div');
    listWrap.className = 'group-builder-list';
    groupCandidates().forEach(c => {
        const row = document.createElement('label');
        row.className = 'group-builder-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = c.key;
        const span = document.createElement('span');
        span.textContent = c.label;
        row.appendChild(cb);
        row.appendChild(span);
        listWrap.appendChild(row);
    });
    builder.appendChild(listWrap);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex; gap:6px; margin-top:8px;';
    const mkBtn = (txt) => {
        const b = document.createElement('button');
        b.className = 'add-element-btn';
        b.style.cssText = 'flex:1; justify-content:center;';
        b.textContent = txt;
        return b;
    };
    const createBtn = mkBtn('Create Group');
    createBtn.addEventListener('click', () => {
        const members = [...listWrap.querySelectorAll('input:checked')].map(i => i.value);
        builder.style.display = 'none';
        if (!members.length) return;
        const g = { id: crypto.randomUUID(), name: name.value.trim() || 'Group', members };
        getGroups().push(g);
        selectGroup(g.id);
        saveState();
    });
    const cancelBtn = mkBtn('Cancel');
    cancelBtn.addEventListener('click', () => { builder.style.display = 'none'; });
    actions.appendChild(createBtn);
    actions.appendChild(cancelBtn);
    builder.appendChild(actions);
}

// Wire the extra-device controls once at init.
function setupExtraDeviceControls() {
    const byId = id => document.getElementById(id);
    const addBtn = byId('add-device-btn');
    if (addBtn) addBtn.addEventListener('click', addExtraDevice);

    // Group toggle: link all devices so canvas gestures transform them together.
    byId('device-group-toggle')?.addEventListener('click', () => {
        const ss = getScreenshotSettings(); if (!ss) return;
        ss.linkDevices = !ss.linkDevices;
        updateDeviceGroupRow();
        updateCanvas();
        saveState();
    });

    // (The "+ Group" button lives in the sidebar layers tree and is rebuilt with it,
    // so its click handler is attached at render time in updateScreenshotList.)

    byId('extra-device-model')?.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const dev = getSelectedExtraDevice(); if (!dev) return;
            dev.device3D = btn.dataset.model;
            updateExtraDeviceProperties();
            updateCanvas(); saveState();
        });
    });

    const onRot = (id, axis) => {
        const el = byId(id); if (!el) return;
        el.addEventListener('input', e => {
            const dev = getSelectedExtraDevice(); if (!dev) return;
            if (!dev.rotation3D) dev.rotation3D = { x: 0, y: 0, z: 0 };
            const v = parseFloat(e.target.value);
            dev.rotation3D[axis] = v;
            const lbl = byId(id + '-value'); if (lbl) lbl.textContent = Math.round(v) + '°';
            updateCanvas();
        });
        el.addEventListener('change', () => saveState());
    };
    onRot('extra-device-rot-x', 'x');
    onRot('extra-device-rot-y', 'y');
    onRot('extra-device-rot-z', 'z');

    const scale = byId('extra-device-scale');
    if (scale) {
        scale.addEventListener('input', e => {
            const dev = getSelectedExtraDevice(); if (!dev) return;
            dev.scale = parseFloat(e.target.value);
            const lbl = byId('extra-device-scale-value'); if (lbl) lbl.textContent = Math.round(dev.scale);
            updateCanvas();
        });
        scale.addEventListener('change', () => saveState());
    }

    const replaceBtn = byId('extra-device-replace-btn');
    const fileInput = byId('extra-device-file');
    if (replaceBtn && fileInput) {
        replaceBtn.addEventListener('click', () => { if (getSelectedExtraDevice()) fileInput.click(); });
        fileInput.addEventListener('change', e => {
            const dev = getSelectedExtraDevice();
            if (dev && e.target.files[0]) replaceExtraDeviceImage(dev, e.target.files[0]);
            e.target.value = '';
        });
    }

    const delBtn = byId('extra-device-delete-btn');
    if (delBtn) delBtn.addEventListener('click', () => {
        const dev = getSelectedExtraDevice(); if (dev) deleteExtraDevice(dev.id);
    });
}

function getText() {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        screenshot.text = normalizeTextSettings(screenshot.text);
        return screenshot.text;
    }
    state.defaults.text = normalizeTextSettings(state.defaults.text);
    return state.defaults.text;
}

function getTextLayoutLanguage(text) {
    if (text.currentLayoutLang) return text.currentLayoutLang;
    if (text.headlineEnabled !== false) return text.currentHeadlineLang || 'en';
    if (text.subheadlineEnabled) return text.currentSubheadlineLang || 'en';
    return text.currentHeadlineLang || text.currentSubheadlineLang || 'en';
}

function getTextLanguageSettings(text, lang) {
    if (!text.languageSettings) text.languageSettings = {};
    if (!text.languageSettings[lang]) {
        const sourceLang = text.currentLayoutLang || text.currentHeadlineLang || text.currentSubheadlineLang || 'en';
        const sourceSettings = text.languageSettings[sourceLang];
        text.languageSettings[lang] = {
            headlineSize: sourceSettings ? sourceSettings.headlineSize : (text.headlineSize || 100),
            subheadlineSize: sourceSettings ? sourceSettings.subheadlineSize : (text.subheadlineSize || 50),
            position: sourceSettings ? sourceSettings.position : (text.position || 'top'),
            offsetY: sourceSettings ? sourceSettings.offsetY : (typeof text.offsetY === 'number' ? text.offsetY : 12),
            lineHeight: sourceSettings ? sourceSettings.lineHeight : (text.lineHeight || 110)
        };
    }
    return text.languageSettings[lang];
}

function getEffectiveLayout(text, lang) {
    if (!text.perLanguageLayout) {
        return {
            headlineSize: text.headlineSize || 100,
            subheadlineSize: text.subheadlineSize || 50,
            position: text.position || 'top',
            offsetY: typeof text.offsetY === 'number' ? text.offsetY : 12,
            lineHeight: text.lineHeight || 110
        };
    }
    return getTextLanguageSettings(text, lang);
}

function normalizeTextSettings(text) {
    const merged = JSON.parse(JSON.stringify(baseTextDefaults));
    if (text) {
        Object.assign(merged, text);
        if (text.languageSettings) {
            merged.languageSettings = JSON.parse(JSON.stringify(text.languageSettings));
        }
    }

    merged.headlines = merged.headlines || { en: '' };
    merged.headlineLanguages = merged.headlineLanguages || ['en'];
    merged.currentHeadlineLang = merged.currentHeadlineLang || merged.headlineLanguages[0] || 'en';
    merged.currentLayoutLang = merged.currentLayoutLang || merged.currentHeadlineLang || 'en';

    merged.subheadlines = merged.subheadlines || { en: '' };
    merged.subheadlineLanguages = merged.subheadlineLanguages || ['en'];
    merged.currentSubheadlineLang = merged.currentSubheadlineLang || merged.subheadlineLanguages[0] || 'en';

    if (!merged.languageSettings) merged.languageSettings = {};
    const languages = new Set([...merged.headlineLanguages, ...merged.subheadlineLanguages]);
    if (languages.size === 0) languages.add('en');
    languages.forEach((lang) => {
        getTextLanguageSettings(merged, lang);
    });

    return merged;
}

function getElements() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? (screenshot.elements || []) : [];
}

function getSelectedElement() {
    if (!selectedElementId) return null;
    return getElements().find(el => el.id === selectedElementId) || null;
}

// Set the selected element and keep the timeline in sync. The timeline is per-selection
// (it shows only the selected item's tracks), so any selection change must re-render it.
// Routing selection through this setter avoids sprinkling refresh calls at every site.
function setSelectedElement(id) {
    if (selectedElementId === id) return;
    selectedElementId = id;
    refreshTimelineForSelection();
}

// Re-render the timeline tracks + Add-Animation menu for the current selection, but only
// when the timeline is actually open (cheap no-op otherwise).
function refreshTimelineForSelection() {
    const panel = document.getElementById('timeline-panel');
    if (!panel || panel.hidden) return;
    // timelineOnSelectionChange resets per-group collapse overrides so the selected
    // object's folder auto-expands; falls back to a plain re-render if unavailable.
    if (typeof timelineOnSelectionChange === 'function') timelineOnSelectionChange();
    else if (typeof renderTimelineTracks === 'function') renderTimelineTracks();
}

function getElementText(el) {
    if (el.texts) {
        return el.texts[state.currentLanguage]
            || el.texts['en']
            || Object.values(el.texts).find(v => v)
            || el.text || '';
    }
    return el.text || '';
}

function setElementProperty(id, key, value) {
    const elements = getElements();
    const el = elements.find(e => e.id === id);
    if (el) {
        el[key] = value;
        // Auto-key the change so Auto-record mode captures element changes the same
        // way it does for device + text. Only transform/opacity paths are animatable
        // (autoKeyTouch quietly ignores anything not in the animation registry).
        if (typeof autoKeyTouch === 'function') autoKeyTouch(`elements.${id}.${key}`);
        updateCanvas();
        updateElementsList();
    }
}

// ===== Popout accessors =====
function getPopouts() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? (screenshot.popouts || []) : [];
}

function getSelectedPopout() {
    if (!selectedPopoutId) return null;
    return getPopouts().find(p => p.id === selectedPopoutId) || null;
}

function setPopoutProperty(id, key, value) {
    const popouts = getPopouts();
    const p = popouts.find(po => po.id === id);
    if (p) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = p;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            p[key] = value;
        }
        updateCanvas();
        updatePopoutProperties();
    }
}

// The image a popout crops from. p.source picks the screen: 'primary' (default,
// also covers legacy popouts with no source field) or an extra device's id. A
// deleted source device falls back to the primary image so the popout doesn't
// silently vanish; a source device with no image yet resolves to null (skipped).
function popoutSourceImage(p, screenshot) {
    screenshot = screenshot || getCurrentScreenshot();
    if (!screenshot) return null;
    if (p && p.source && p.source !== 'primary') {
        const dev = (screenshot.extraDevices || []).find(d => d.id === p.source);
        if (dev) return dev.image || null;
    }
    return getScreenshotImage(screenshot);
}

function addPopout() {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    // Default the new popout's source to the first screen that actually has an
    // image — primary if possible, else an extra device (multi-device screens).
    let source = 'primary';
    let img = getScreenshotImage(screenshot);
    if (!img) {
        const dev = (screenshot.extraDevices || []).find(d => d.image);
        if (dev) { source = dev.id; img = dev.image; }
    }
    if (!img) return;
    if (!screenshot.popouts) screenshot.popouts = [];
    const p = {
        id: crypto.randomUUID(),
        source: source,
        cropX: 25, cropY: 25, cropWidth: 30, cropHeight: 30,
        x: 70, y: 30,
        width: 30,
        rotation: 0, opacity: 100, cornerRadius: 12,
        shadow: { enabled: true, style: 'drop', color: '#000000', blur: 30, opacity: 40, x: 0, y: 15 },
        border: { enabled: true, color: '#ffffff', width: 3, opacity: 100 }
    };
    screenshot.popouts.push(p);
    selectedPopoutId = p.id;
    updateCanvas();
    updatePopoutsList();
    updatePopoutProperties();
}

function deletePopout(id) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.popouts) return;
    screenshot.popouts = screenshot.popouts.filter(p => p.id !== id);
    if (selectedPopoutId === id) selectedPopoutId = null;
    updateCanvas();
    updatePopoutsList();
    updatePopoutProperties();
}

function movePopout(id, direction) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.popouts) return;
    const idx = screenshot.popouts.findIndex(p => p.id === id);
    if (idx === -1) return;
    if (direction === 'up' && idx < screenshot.popouts.length - 1) {
        [screenshot.popouts[idx], screenshot.popouts[idx + 1]] = [screenshot.popouts[idx + 1], screenshot.popouts[idx]];
    } else if (direction === 'down' && idx > 0) {
        [screenshot.popouts[idx], screenshot.popouts[idx - 1]] = [screenshot.popouts[idx - 1], screenshot.popouts[idx]];
    }
    updateCanvas();
    updatePopoutsList();
}

function addGraphicElement(img, src, name) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'graphic',
        x: 50, y: 50,
        width: 20,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        image: img,
        src: src,
        name: name || 'Graphic',
        text: '',
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    setSelectedElement(el.id);
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

function addTextElement() {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'text',
        x: 50, y: 50,
        width: 40,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        image: null,
        src: null,
        name: 'Text',
        text: 'Your Text',
        texts: { [state.currentLanguage]: 'Your Text' },
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100,
        // Text effects (see DEFAULT_TEXT_* / resolveText* in the text-effects section).
        stroke: { enabled: false, color: '#000000', width: 8 },
        shadow: { enabled: false, color: '#000000', blur: 14, x: 0, y: 8, opacity: 60 },
        bubble: { style: 'none', color: '#2563eb', opacity: 100, padding: 38, radius: 50, tail: 'bottom-left', textColor: '', shadow: false, shadowColor: '#000000', shadowBlur: 30, shadowOpacity: 35, shadowY: 12 },
        reveal: { type: 'none', duration: 1.2, delay: 0 }
    };
    screenshot.elements.push(el);
    setSelectedElement(el.id);
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

// ===== Lucide SVG loading & caching =====
const lucideSVGCache = new Map(); // name -> raw SVG text

async function fetchLucideSVG(name) {
    if (lucideSVGCache.has(name)) return lucideSVGCache.get(name);
    const url = `https://unpkg.com/lucide-static@latest/icons/${name}.svg`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch icon: ${name}`);
    const svgText = await resp.text();
    lucideSVGCache.set(name, svgText);
    return svgText;
}

function colorizeLucideSVG(svgText, color, strokeWidth) {
    return svgText
        .replace(/stroke="currentColor"/g, `stroke="${color}"`)
        .replace(/stroke-width="[^"]*"/g, `stroke-width="${strokeWidth}"`);
}

async function getLucideImage(name, color, strokeWidth) {
    const rawSVG = await fetchLucideSVG(name);
    const colorized = colorizeLucideSVG(rawSVG, color, strokeWidth);
    const blob = new Blob([colorized], { type: 'image/svg+xml' });
    const blobURL = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = blobURL;
    });
}

async function updateIconImage(el) {
    if (el.type !== 'icon') return;
    try {
        el.image = await getLucideImage(el.iconName, el.iconColor, el.iconStrokeWidth);
        updateCanvas();
    } catch (e) {
        console.error('Failed to update icon image:', e);
    }
}

function addEmojiElement(emoji, name) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'emoji',
        x: 50, y: 50,
        width: 15,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        emoji: emoji,
        name: name || 'Emoji',
        image: null,
        src: null,
        text: '',
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    setSelectedElement(el.id);
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

async function addIconElement(iconName) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'icon',
        x: 50, y: 50,
        width: 15,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        iconName: iconName,
        iconColor: '#ffffff',
        iconStrokeWidth: 2,
        iconShadow: { enabled: false, color: '#000000', blur: 20, opacity: 40, x: 0, y: 10 },
        image: null,
        src: null,
        name: iconName,
        text: '',
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    setSelectedElement(el.id);
    updateElementsList();
    updateElementProperties();
    // Async: fetch icon SVG
    try {
        el.image = await getLucideImage(iconName, el.iconColor, el.iconStrokeWidth);
        updateCanvas();
    } catch (e) {
        console.error('Failed to load icon:', e);
    }
    updateCanvas();
}

function deleteElement(id) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.elements) return;
    screenshot.elements = screenshot.elements.filter(e => e.id !== id);
    if (selectedElementId === id) setSelectedElement(null);
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

function moveElementLayer(id, direction) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.elements) return;
    const idx = screenshot.elements.findIndex(e => e.id === id);
    if (idx === -1) return;
    if (direction === 'up' && idx < screenshot.elements.length - 1) {
        [screenshot.elements[idx], screenshot.elements[idx + 1]] = [screenshot.elements[idx + 1], screenshot.elements[idx]];
    } else if (direction === 'down' && idx > 0) {
        [screenshot.elements[idx], screenshot.elements[idx - 1]] = [screenshot.elements[idx - 1], screenshot.elements[idx]];
    }
    updateCanvas();
    updateElementsList();
}

// Add reset buttons to all slider control rows
function setupSliderResetButtons() {
    document.querySelectorAll('.control-row input[type="range"]').forEach(slider => {
        const row = slider.closest('.control-row');
        if (!row || row.querySelector('.slider-reset-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'slider-reset-btn';
        btn.title = 'Reset to default';
        btn.type = 'button';
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.75"/><polyline points="3 16 3 10 9 10"/></svg>';
        btn.addEventListener('click', () => {
            let resetVal = slider.defaultValue;
            // For the landscape MacBook, the position sliders center the device at 50%
            // (the phone default leaves headline room and would reset off-center).
            const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
            if (ss && ss.use3D && ss.device3D === 'macbook' &&
                (slider.id === 'screenshot-x' || slider.id === 'screenshot-y')) {
                resetVal = 50;
            }
            slider.value = resetVal;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        row.appendChild(btn);
    });
}

const LIGHT_DIR_MAX_R = 40; // % of picker the handle can travel from center

// Position the light "sun" handle for an azimuth (degrees, 0° = top, clockwise) and
// an elevation (0 = center/overhead, 1 = edge/grazing).
function positionLightDirHandle(angle, elev) {
    const handle = document.getElementById('light-dir-handle');
    if (!handle) return;
    const rad = angle * Math.PI / 180;
    const r = Math.max(0, Math.min(1, elev)) * LIGHT_DIR_MAX_R;
    handle.style.left = (50 + Math.sin(rad) * r) + '%';
    handle.style.top = (50 - Math.cos(rad) * r) + '%';
}

// Drag the sun anywhere inside the circular picker: angle = direction, distance from
// center = light elevation (overhead ↔ grazing).
function setupLightDirectionPicker() {
    const picker = document.getElementById('light-dir-picker');
    if (!picker) return;
    let dragging = false;

    const apply = (e) => {
        const rect = picker.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const point = e.touches ? e.touches[0] : e;
        const dx = point.clientX - cx;
        const dy = point.clientY - cy;
        let deg = Math.atan2(dx, -dy) * 180 / Math.PI; // 0° at top, clockwise
        if (deg < 0) deg += 360;
        const angle = Math.round(deg);
        // distance from center, normalized 0–1 (clamped to the travel radius)
        const dist = Math.hypot(dx, dy) / (rect.width / 2);
        const elev = Math.max(0, Math.min(1, dist / (LIGHT_DIR_MAX_R / 50)));
        setScreenshotSetting('shadow.lightAngle', angle);
        setScreenshotSetting('shadow.lightElev', elev);
        positionLightDirHandle(angle, elev);
        updateCanvas();
    };

    picker.addEventListener('pointerdown', (e) => {
        dragging = true;
        try { picker.setPointerCapture(e.pointerId); } catch (_) {}
        apply(e);
    });
    picker.addEventListener('pointermove', (e) => { if (dragging) apply(e); });
    picker.addEventListener('pointerup', () => { dragging = false; });
    picker.addEventListener('pointercancel', () => { dragging = false; });
}

// Format number to at most 1 decimal place
function formatValue(num) {
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

function setBackground(key, value) {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = screenshot.background;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            screenshot.background[key] = value;
        }
    }
}

function setScreenshotSetting(key, value) {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = screenshot.screenshot;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            screenshot.screenshot[key] = value;
        }
    }
    if (typeof autoKeyTouch === 'function') autoKeyTouch('screenshot.' + key);
}

function setTextSetting(key, value) {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        screenshot.text[key] = value;
    }
    if (typeof autoKeyTouch === 'function') autoKeyTouch('text.' + key);
}

function setCurrentScreenshotAsDefault() {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        state.defaults.background = JSON.parse(JSON.stringify(screenshot.background));
        state.defaults.screenshot = JSON.parse(JSON.stringify(screenshot.screenshot));
        state.defaults.text = JSON.parse(JSON.stringify(screenshot.text));
        if (screenshot.effects) state.defaults.effects = JSON.parse(JSON.stringify(screenshot.effects));
    }
}

// Language flags mapping
const languageFlags = {
    'en': '🇺🇸', 'en-gb': '🇬🇧', 'de': '🇩🇪', 'fr': '🇫🇷', 'es': '🇪🇸',
    'it': '🇮🇹', 'pt': '🇵🇹', 'pt-br': '🇧🇷', 'nl': '🇳🇱', 'ru': '🇷🇺',
    'ja': '🇯🇵', 'ko': '🇰🇷', 'zh': '🇨🇳', 'zh-tw': '🇹🇼', 'ar': '🇸🇦',
    'hi': '🇮🇳', 'tr': '🇹🇷', 'pl': '🇵🇱', 'sv': '🇸🇪', 'da': '🇩🇰',
    'no': '🇳🇴', 'fi': '🇫🇮', 'th': '🇹🇭', 'vi': '🇻🇳', 'id': '🇮🇩',
    'uk': '🇺🇦'
};

// Google Fonts configuration
const googleFonts = {
    loaded: new Set(),
    loading: new Set(),
    // Popular fonts that are commonly used for marketing/app store
    popular: [
        'Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Raleway',
        'Nunito', 'Playfair Display', 'Oswald', 'Merriweather', 'Source Sans Pro',
        'PT Sans', 'Ubuntu', 'Rubik', 'Work Sans', 'Quicksand', 'Mulish', 'Barlow',
        'DM Sans', 'Manrope', 'Space Grotesk', 'Plus Jakarta Sans', 'Outfit', 'Sora',
        'Lexend', 'Figtree', 'Albert Sans', 'Urbanist', 'Satoshi', 'General Sans',
        'Bebas Neue', 'Anton', 'Archivo', 'Bitter', 'Cabin', 'Crimson Text',
        'Dancing Script', 'Fira Sans', 'Heebo', 'IBM Plex Sans', 'Josefin Sans',
        'Karla', 'Libre Franklin', 'Lora', 'Noto Sans', 'Nunito Sans', 'Pacifico',
        'Permanent Marker', 'Roboto Condensed', 'Roboto Mono', 'Roboto Slab',
        'Shadows Into Light', 'Signika', 'Slabo 27px', 'Source Code Pro', 'Titillium Web',
        'Varela Round', 'Zilla Slab', 'Arimo', 'Barlow Condensed', 'Catamaran',
        'Comfortaa', 'Cormorant Garamond', 'Dosis', 'EB Garamond', 'Exo 2',
        'Fira Code', 'Hind', 'Inconsolata', 'Indie Flower', 'Jost', 'Kanit',
        'Libre Baskerville', 'Maven Pro', 'Mukta', 'Nanum Gothic', 'Noticia Text',
        'Oxygen', 'Philosopher', 'Play', 'Prompt', 'Rajdhani', 'Red Hat Display',
        'Righteous', 'Saira', 'Sen', 'Spectral', 'Teko', 'Vollkorn', 'Yanone Kaffeesatz',
        'Zeyada', 'Amatic SC', 'Archivo Black', 'Asap', 'Assistant', 'Bangers',
        'BioRhyme', 'Cairo', 'Cardo', 'Chivo', 'Concert One', 'Cormorant',
        'Cousine', 'DM Serif Display', 'DM Serif Text', 'Dela Gothic One',
        'El Messiri', 'Encode Sans', 'Eczar', 'Fahkwang', 'Gelasio'
    ],
    // System fonts that don't need loading
    system: [
        { name: 'SF Pro Display', value: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'" },
        { name: 'SF Pro Rounded', value: "'SF Pro Rounded', -apple-system" },
        { name: 'Helvetica Neue', value: "'Helvetica Neue', Helvetica" },
        { name: 'Avenir Next', value: "'Avenir Next', Avenir" },
        { name: 'Georgia', value: "Georgia, serif" },
        { name: 'Arial', value: "Arial, sans-serif" },
        { name: 'Times New Roman', value: "'Times New Roman', serif" },
        { name: 'Courier New', value: "'Courier New', monospace" },
        { name: 'Verdana', value: "Verdana, sans-serif" },
        { name: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" }
    ],
    // Cache for all Google Fonts (loaded on demand)
    allFonts: null
};

// Load a Google Font dynamically
async function loadGoogleFont(fontName) {
    // Check if it's a system font
    const isSystem = googleFonts.system.some(f => f.name === fontName);
    if (isSystem) return;

    // If already loaded, just ensure the current weight is available
    if (googleFonts.loaded.has(fontName)) {
        const text = getTextSettings();
        const weight = text.headlineWeight || '600';
        try {
            await document.fonts.load(`${weight} 16px "${fontName}"`);
        } catch (e) {
            // Font already loaded, weight might not exist but that's ok
        }
        return;
    }

    // If currently loading, wait for it
    if (googleFonts.loading.has(fontName)) {
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 100));
        if (googleFonts.loading.has(fontName)) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return;
    }

    googleFonts.loading.add(fontName);

    try {
        const link = document.createElement('link');
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700;800;900&display=swap`;
        link.rel = 'stylesheet';

        // Wait for stylesheet to load first
        await new Promise((resolve, reject) => {
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });

        // Wait for the font to actually load with the required weights
        const text = getTextSettings();
        const headlineWeight = text.headlineWeight || '600';
        const subheadlineWeight = text.subheadlineWeight || '400';

        // Load all weights we might need
        await Promise.all([
            document.fonts.load(`400 16px "${fontName}"`),
            document.fonts.load(`${headlineWeight} 16px "${fontName}"`),
            document.fonts.load(`${subheadlineWeight} 16px "${fontName}"`)
        ]);

        googleFonts.loaded.add(fontName);
        googleFonts.loading.delete(fontName);
    } catch (error) {
        console.warn(`Failed to load font: ${fontName}`, error);
        googleFonts.loading.delete(fontName);
    }
}

// Fetch all Google Fonts from the API (cached)
async function fetchAllGoogleFonts() {
    if (googleFonts.allFonts) {
        return googleFonts.allFonts;
    }

    try {
        // Try to fetch from Google Fonts API v2
        // API key is optional - the API works without it but has lower rate limits
        const apiKey = state.settings?.googleFontsApiKey || '';
        const url = new URL('https://www.googleapis.com/webfonts/v1/webfonts');
        url.searchParams.set('sort', 'popularity');
        if (apiKey) {
            url.searchParams.set('key', apiKey);
        }
        
        try {
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                    // Extract font family names from API response
                    googleFonts.allFonts = data.items.map(font => font.family);
                    console.log(`Loaded ${googleFonts.allFonts.length} fonts from Google Fonts API`);
                    return googleFonts.allFonts;
                }
            } else if (response.status === 429) {
                console.warn('Google Fonts API rate limit reached, using fallback font list');
            } else {
                console.warn(`Google Fonts API returned status ${response.status}, using fallback font list`);
            }
        } catch (apiError) {
            console.warn('Failed to fetch from Google Fonts API, using fallback font list:', apiError);
        }

        // Fallback to curated list of 1000+ popular fonts
        // This list covers the most commonly used fonts on Google Fonts
        googleFonts.allFonts = [
            ...googleFonts.popular,
            'ABeeZee', 'Abel', 'Abhaya Libre', 'Abril Fatface', 'Aclonica', 'Acme',
            'Actor', 'Adamina', 'Advent Pro', 'Aguafina Script', 'Akronim', 'Aladin',
            'Aldrich', 'Alef', 'Alegreya', 'Alegreya Sans', 'Alegreya Sans SC', 'Alex Brush',
            'Alfa Slab One', 'Alice', 'Alike', 'Alike Angular', 'Allan', 'Allerta',
            'Allison', 'Allura', 'Almendra', 'Amaranth', 'Amatic SC', 'Amethysta',
            'Amiko', 'Amiri', 'Amita', 'Anaheim', 'Andada', 'Andika', 'Angkor',
            'Annie Use Your Telescope', 'Anonymous Pro', 'Antic', 'Antic Didone',
            'Antonio', 'Arapey', 'Arbutus', 'Arbutus Slab', 'Architects Daughter',
            'Archivo Narrow', 'Aref Ruqaa', 'Arima Madurai', 'Arvo', 'Asap Condensed',
            'Asar', 'Asset', 'Astloch', 'Asul', 'Athiti', 'Atkinson Hyperlegible',
            'Atomic Age', 'Aubrey', 'Audiowide', 'Autour One', 'Average', 'Average Sans',
            'Averia Gruesa Libre', 'Averia Libre', 'Averia Sans Libre', 'Averia Serif Libre',
            'B612', 'B612 Mono', 'Bad Script', 'Bahiana', 'Bahianita', 'Bai Jamjuree',
            'Baloo', 'Baloo 2', 'Balsamiq Sans', 'Balthazar', 'Baskervville',
            'Battambang', 'Baumans', 'Bellefair', 'Belleza', 'Bellota', 'Bellota Text',
            'BenchNine', 'Bentham', 'Berkshire Swash', 'Beth Ellen', 'Bevan',
            'Big Shoulders Display', 'Big Shoulders Text', 'Bigelow Rules', 'Bigshot One',
            'Bilbo', 'Bilbo Swash Caps', 'Blinker', 'Bodoni Moda', 'Bokor', 'Bonbon',
            'Boogaloo', 'Bowlby One', 'Bowlby One SC', 'Brawler', 'Bree Serif',
            'Brygada 1918', 'Bubblegum Sans', 'Bubbler One', 'Buda', 'Buenard',
            'Bungee', 'Bungee Hairline', 'Bungee Inline', 'Bungee Outline', 'Bungee Shade',
            'Butcherman', 'Butterfly Kids', 'Cabin Condensed', 'Cabin Sketch', 'Caesar Dressing',
            'Cagliostro', 'Caladea', 'Calistoga', 'Calligraffitti', 'Cambay', 'Cambo',
            'Candal', 'Cantarell', 'Cantata One', 'Cantora One', 'Capriola', 'Cardo',
            'Carme', 'Carrois Gothic', 'Carrois Gothic SC', 'Carter One', 'Castoro',
            'Caveat', 'Caveat Brush', 'Cedarville Cursive', 'Ceviche One', 'Chakra Petch',
            'Changa', 'Changa One', 'Chango', 'Charm', 'Charmonman', 'Chathura',
            'Chau Philomene One', 'Chela One', 'Chelsea Market', 'Chenla', 'Cherry Cream Soda',
            'Cherry Swash', 'Chewy', 'Chicle', 'Chilanka', 'Chonburi', 'Cinzel',
            'Cinzel Decorative', 'Clicker Script', 'Coda', 'Coda Caption', 'Codystar',
            'Coiny', 'Combo', 'Comforter', 'Comforter Brush', 'Comic Neue', 'Coming Soon',
            'Commissioner', 'Condiment', 'Content', 'Contrail One', 'Convergence',
            'Cookie', 'Copse', 'Corben', 'Corinthia', 'Cormorant Infant', 'Cormorant SC',
            'Cormorant Unicase', 'Cormorant Upright', 'Courgette', 'Courier Prime',
            'Covered By Your Grace', 'Crafty Girls', 'Creepster', 'Crete Round',
            'Crimson Pro', 'Croissant One', 'Crushed', 'Cuprum', 'Cute Font',
            'Cutive', 'Cutive Mono', 'Damion', 'Dangrek', 'Darker Grotesque',
            'David Libre', 'Dawning of a New Day', 'Days One', 'Dekko', 'Delius',
            'Delius Swash Caps', 'Delius Unicase', 'Della Respira', 'Denk One',
            'Devonshire', 'Dhurjati', 'Didact Gothic', 'Diplomata', 'Diplomata SC',
            'Do Hyeon', 'Dokdo', 'Domine', 'Donegal One', 'Dongle', 'Doppio One',
            'Dorsa', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif', 'Duru Sans',
            'Dynalight', 'Eagle Lake', 'East Sea Dokdo', 'Eater', 'Economica',
            'Eczar', 'Edu NSW ACT Foundation', 'Edu QLD Beginner', 'Edu SA Beginner',
            'Edu TAS Beginner', 'Edu VIC WA NT Beginner', 'Electrolize', 'Elsie',
            'Elsie Swash Caps', 'Emblema One', 'Emilys Candy', 'Encode Sans Condensed',
            'Encode Sans Expanded', 'Encode Sans Semi Condensed', 'Encode Sans Semi Expanded',
            'Engagement', 'Englebert', 'Enriqueta', 'Ephesis', 'Epilogue', 'Erica One',
            'Esteban', 'Estonia', 'Euphoria Script', 'Ewert', 'Exo', 'Expletus Sans',
            'Explora', 'Fahkwang', 'Fanwood Text', 'Farro', 'Farsan', 'Fascinate',
            'Fascinate Inline', 'Faster One', 'Fasthand', 'Fauna One', 'Faustina',
            'Federant', 'Federo', 'Felipa', 'Fenix', 'Festive', 'Finger Paint',
            'Fira Sans Condensed', 'Fira Sans Extra Condensed', 'Fjalla One', 'Fjord One',
            'Flamenco', 'Flavors', 'Fleur De Leah', 'Flow Block', 'Flow Circular',
            'Flow Rounded', 'Fondamento', 'Fontdiner Swanky', 'Forum', 'Francois One',
            'Frank Ruhl Libre', 'Fraunces', 'Freckle Face', 'Fredericka the Great',
            'Fredoka', 'Fredoka One', 'Freehand', 'Fresca', 'Frijole', 'Fruktur',
            'Fugaz One', 'Fuggles', 'Fuzzy Bubbles', 'GFS Didot', 'GFS Neohellenic',
            'Gabriela', 'Gaegu', 'Gafata', 'Galada', 'Galdeano', 'Galindo', 'Gamja Flower',
            'Gayathri', 'Gelasio', 'Gemunu Libre', 'Genos', 'Gentium Basic', 'Gentium Book Basic',
            'Gentium Book Plus', 'Gentium Plus', 'Geo', 'Georama', 'Geostar', 'Geostar Fill',
            'Germania One', 'Gideon Roman', 'Gidugu', 'Gilda Display', 'Girassol',
            'Give You Glory', 'Glass Antiqua', 'Glegoo', 'Gloria Hallelujah', 'Glory',
            'Gluten', 'Goblin One', 'Gochi Hand', 'Goldman', 'Gorditas', 'Gothic A1',
            'Gotu', 'Goudy Bookletter 1911', 'Gowun Batang', 'Gowun Dodum', 'Graduate',
            'Grand Hotel', 'Grandstander', 'Grape Nuts', 'Gravitas One', 'Great Vibes',
            'Grechen Fuemen', 'Grenze', 'Grenze Gotisch', 'Grey Qo', 'Griffy', 'Gruppo',
            'Gudea', 'Gugi', 'Gupter', 'Gurajada', 'Gwendolyn', 'Habibi', 'Hachi Maru Pop',
            'Hahmlet', 'Halant', 'Hammersmith One', 'Hanalei', 'Hanalei Fill', 'Handlee',
            'Hanuman', 'Happy Monkey', 'Harmattan', 'Headland One', 'Hepta Slab',
            'Herr Von Muellerhoff', 'Hi Melody', 'Hina Mincho', 'Hind Guntur', 'Hind Madurai',
            'Hind Siliguri', 'Hind Vadodara', 'Holtwood One SC', 'Homemade Apple', 'Homenaje',
            'Hubballi', 'Hurricane', 'IBM Plex Mono', 'IBM Plex Sans Condensed', 'IBM Plex Serif',
            'IM Fell DW Pica', 'IM Fell DW Pica SC', 'IM Fell Double Pica', 'IM Fell Double Pica SC',
            'IM Fell English', 'IM Fell English SC', 'IM Fell French Canon', 'IM Fell French Canon SC',
            'IM Fell Great Primer', 'IM Fell Great Primer SC', 'Ibarra Real Nova', 'Iceberg',
            'Iceland', 'Imbue', 'Imperial Script', 'Imprima', 'Inconsolata', 'Inder', 'Ingrid Darling',
            'Inika', 'Inknut Antiqua', 'Inria Sans', 'Inria Serif', 'Inspiration', 'Inter Tight',
            'Irish Grover', 'Island Moments', 'Istok Web', 'Italiana', 'Italianno', 'Itim',
            'Jacques Francois', 'Jacques Francois Shadow', 'Jaldi', 'JetBrains Mono', 'Jim Nightshade',
            'Joan', 'Jockey One', 'Jolly Lodger', 'Jomhuria', 'Jomolhari', 'Josefin Slab',
            'Joti One', 'Jua', 'Judson', 'Julee', 'Julius Sans One', 'Junge', 'Jura',
            'Just Another Hand', 'Just Me Again Down Here', 'K2D', 'Kadwa', 'Kaisei Decol',
            'Kaisei HarunoUmi', 'Kaisei Opti', 'Kaisei Tokumin', 'Kalam', 'Kameron', 'Kanit',
            'Kantumruy', 'Kantumruy Pro', 'Karantina', 'Karla', 'Karma', 'Katibeh', 'Kaushan Script',
            'Kavivanar', 'Kavoon', 'Kdam Thmor Pro', 'Keania One', 'Kelly Slab', 'Kenia',
            'Khand', 'Khmer', 'Khula', 'Kings', 'Kirang Haerang', 'Kite One', 'Kiwi Maru',
            'Klee One', 'Knewave', 'KoHo', 'Kodchasan', 'Koh Santepheap', 'Kolker Brush',
            'Kosugi', 'Kosugi Maru', 'Kotta One', 'Koulen', 'Kranky', 'Kreon', 'Kristi',
            'Krona One', 'Krub', 'Kufam', 'Kulim Park', 'Kumar One', 'Kumar One Outline',
            'Kumbh Sans', 'Kurale', 'La Belle Aurore', 'Lacquer', 'Laila', 'Lakki Reddy',
            'Lalezar', 'Lancelot', 'Langar', 'Lateef', 'League Gothic', 'League Script',
            'League Spartan', 'Leckerli One', 'Ledger', 'Lekton', 'Lemon', 'Lemonada',
            'Lexend Deca', 'Lexend Exa', 'Lexend Giga', 'Lexend Mega', 'Lexend Peta',
            'Lexend Tera', 'Lexend Zetta', 'Libre Barcode 128', 'Libre Barcode 128 Text',
            'Libre Barcode 39', 'Libre Barcode 39 Extended', 'Libre Barcode 39 Extended Text',
            'Libre Barcode 39 Text', 'Libre Barcode EAN13 Text', 'Libre Bodoni', 'Libre Caslon Display',
            'Libre Caslon Text', 'Life Savers', 'Lilita One', 'Lily Script One', 'Limelight',
            'Linden Hill', 'Literata', 'Liu Jian Mao Cao', 'Livvic', 'Lobster', 'Lobster Two',
            'Londrina Outline', 'Londrina Shadow', 'Londrina Sketch', 'Londrina Solid',
            'Long Cang', 'Lora', 'Love Light', 'Love Ya Like A Sister', 'Loved by the King',
            'Lovers Quarrel', 'Luckiest Guy', 'Lusitana', 'Lustria', 'Luxurious Roman',
            'Luxurious Script', 'M PLUS 1', 'M PLUS 1 Code', 'M PLUS 1p', 'M PLUS 2',
            'M PLUS Code Latin', 'M PLUS Rounded 1c', 'Ma Shan Zheng', 'Macondo', 'Macondo Swash Caps',
            'Mada', 'Magra', 'Maiden Orange', 'Maitree', 'Major Mono Display', 'Mako', 'Mali',
            'Mallanna', 'Mandali', 'Manjari', 'Mansalva', 'Manuale', 'Marcellus', 'Marcellus SC',
            'Marck Script', 'Margarine', 'Markazi Text', 'Marko One', 'Marmelad', 'Martel',
            'Martel Sans', 'Marvel', 'Mate', 'Mate SC', 'Material Icons', 'Material Icons Outlined',
            'Material Icons Round', 'Material Icons Sharp', 'Material Icons Two Tone', 'Material Symbols Outlined',
            'Material Symbols Rounded', 'Material Symbols Sharp', 'Maven Pro', 'McLaren', 'Mea Culpa',
            'Meddon', 'MedievalSharp', 'Medula One', 'Meera Inimai', 'Megrim', 'Meie Script',
            'Meow Script', 'Merienda', 'Merienda One', 'Merriweather Sans', 'Metal', 'Metal Mania',
            'Metamorphous', 'Metrophobic', 'Michroma', 'Milonga', 'Miltonian', 'Miltonian Tattoo',
            'Mina', 'Miniver', 'Miriam Libre', 'Mirza', 'Miss Fajardose', 'Mitr', 'Mochiy Pop One',
            'Mochiy Pop P One', 'Modak', 'Modern Antiqua', 'Mogra', 'Mohave', 'Molengo', 'Molle',
            'Monda', 'Monofett', 'Monoton', 'Monsieur La Doulaise', 'Montaga', 'Montagu Slab',
            'MonteCarlo', 'Montez', 'Montserrat Alternates', 'Montserrat Subrayada', 'Moo Lah Lah',
            'Moon Dance', 'Moul', 'Moulpali', 'Mountains of Christmas', 'Mouse Memoirs', 'Mr Bedfort',
            'Mr Dafoe', 'Mr De Haviland', 'Mrs Saint Delafield', 'Mrs Sheppards', 'Ms Madi', 'Mukta Mahee',
            'Mukta Malar', 'Mukta Vaani', 'Muli', 'Murecho', 'MuseoModerno', 'My Soul', 'Mystery Quest',
            'NTR', 'Nanum Brush Script', 'Nanum Gothic Coding', 'Nanum Myeongjo', 'Nanum Pen Script',
            'Neonderthaw', 'Nerko One', 'Neucha', 'Neuton', 'New Rocker', 'New Tegomin', 'News Cycle',
            'Newsreader', 'Niconne', 'Niramit', 'Nixie One', 'Nobile', 'Nokora', 'Norican', 'Nosifer',
            'Notable', 'Nothing You Could Do', 'Noticia Text', 'Noto Color Emoji', 'Noto Emoji',
            'Noto Kufi Arabic', 'Noto Music', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Noto Rashi Hebrew',
            'Noto Sans Arabic', 'Noto Sans Bengali', 'Noto Sans Devanagari', 'Noto Sans Display',
            'Noto Sans Georgian', 'Noto Sans Hebrew', 'Noto Sans HK', 'Noto Sans JP', 'Noto Sans KR',
            'Noto Sans Mono', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', 'Noto Serif',
            'Noto Serif Bengali', 'Noto Serif Devanagari', 'Noto Serif Display', 'Noto Serif Georgian',
            'Noto Serif Hebrew', 'Noto Serif JP', 'Noto Serif KR', 'Noto Serif SC', 'Noto Serif TC',
            'Noto Serif Thai', 'Nova Cut', 'Nova Flat', 'Nova Mono', 'Nova Oval', 'Nova Round',
            'Nova Script', 'Nova Slim', 'Nova Square', 'Numans', 'Nunito', 'Nunito Sans', 'Nuosu SIL',
            'Odibee Sans', 'Odor Mean Chey', 'Offside', 'Oi', 'Old Standard TT', 'Oldenburg', 'Ole',
            'Oleo Script', 'Oleo Script Swash Caps', 'Oooh Baby', 'Open Sans Condensed', 'Oranienbaum',
            'Orbit', 'Orbitron', 'Oregano', 'Orelega One', 'Orienta', 'Original Surfer', 'Oswald',
            'Otomanopee One', 'Outfit', 'Over the Rainbow', 'Overlock', 'Overlock SC', 'Overpass',
            'Overpass Mono', 'Ovo', 'Oxanium', 'Oxygen Mono', 'PT Mono', 'PT Sans Caption',
            'PT Sans Narrow', 'PT Serif', 'PT Serif Caption', 'Pacifico', 'Padauk', 'Padyakke Expanded One',
            'Palanquin', 'Palanquin Dark', 'Palette Mosaic', 'Pangolin', 'Paprika', 'Parisienne',
            'Passero One', 'Passion One', 'Passions Conflict', 'Pathway Gothic One', 'Patrick Hand',
            'Patrick Hand SC', 'Pattaya', 'Patua One', 'Pavanam', 'Paytone One', 'Peddana',
            'Peralta', 'Permanent Marker', 'Petemoss', 'Petit Formal Script', 'Petrona', 'Phetsarath',
            'Philosopher', 'Piazzolla', 'Piedra', 'Pinyon Script', 'Pirata One', 'Plaster', 'Play',
            'Playball', 'Playfair Display SC', 'Podkova', 'Poiret One', 'Poller One', 'Poly', 'Pompiere',
            'Pontano Sans', 'Poor Story', 'Poppins', 'Port Lligat Sans', 'Port Lligat Slab', 'Potta One',
            'Pragati Narrow', 'Praise', 'Prata', 'Preahvihear', 'Press Start 2P', 'Pridi', 'Princess Sofia',
            'Prociono', 'Prompt', 'Prosto One', 'Proza Libre', 'Public Sans', 'Puppies Play', 'Puritan',
            'Purple Purse', 'Qahiri', 'Quando', 'Quantico', 'Quattrocento', 'Quattrocento Sans', 'Questrial',
            'Quicksand', 'Quintessential', 'Qwigley', 'Qwitcher Grypen', 'Racing Sans One', 'Radio Canada',
            'Radley', 'Rajdhani', 'Rakkas', 'Raleway Dots', 'Ramabhadra', 'Ramaraja', 'Rambla', 'Rammetto One',
            'Rampart One', 'Ranchers', 'Rancho', 'Ranga', 'Rasa', 'Rationale', 'Ravi Prakash', 'Readex Pro',
            'Recursive', 'Red Hat Mono', 'Red Hat Text', 'Red Rose', 'Redacted', 'Redacted Script', 'Redressed',
            'Reem Kufi', 'Reenie Beanie', 'Reggae One', 'Revalia', 'Rhodium Libre', 'Ribeye', 'Ribeye Marrow',
            'Righteous', 'Risque', 'Road Rage', 'Roboto Flex', 'Rochester', 'Rock Salt', 'RocknRoll One',
            'Rokkitt', 'Romanesco', 'Ropa Sans', 'Rosario', 'Rosarivo', 'Rouge Script', 'Rowdies', 'Rozha One',
            'Rubik Beastly', 'Rubik Bubbles', 'Rubik Burned', 'Rubik Dirt', 'Rubik Distressed', 'Rubik Glitch',
            'Rubik Marker Hatch', 'Rubik Maze', 'Rubik Microbe', 'Rubik Mono One', 'Rubik Moonrocks',
            'Rubik Puddles', 'Rubik Wet Paint', 'Ruda', 'Rufina', 'Ruge Boogie', 'Ruluko', 'Rum Raisin',
            'Ruslan Display', 'Russo One', 'Ruthie', 'Rye', 'STIX Two Math', 'STIX Two Text', 'Sacramento',
            'Sahitya', 'Sail', 'Saira Condensed', 'Saira Extra Condensed', 'Saira Semi Condensed', 'Saira Stencil One',
            'Salsa', 'Sanchez', 'Sancreek', 'Sansita', 'Sansita Swashed', 'Sarabun', 'Sarala', 'Sarina', 'Sarpanch',
            'Sassy Frass', 'Satisfy', 'Sawarabi Gothic', 'Sawarabi Mincho', 'Scada', 'Scheherazade New', 'Schoolbell',
            'Scope One', 'Seaweed Script', 'Secular One', 'Sedgwick Ave', 'Sedgwick Ave Display', 'Sen',
            'Send Flowers', 'Sevillana', 'Seymour One', 'Shadows Into Light Two', 'Shalimar', 'Shanti',
            'Share', 'Share Tech', 'Share Tech Mono', 'Shippori Antique', 'Shippori Antique B1', 'Shippori Mincho',
            'Shippori Mincho B1', 'Shizuru', 'Shojumaru', 'Short Stack', 'Shrikhand', 'Siemreap', 'Sigmar One',
            'Signika Negative', 'Silkscreen', 'Simonetta', 'Single Day', 'Sintony', 'Sirin Stencil', 'Six Caps',
            'Skranji', 'Slabo 13px', 'Slackey', 'Smokum', 'Smooch', 'Smooch Sans', 'Smythe', 'Sniglet',
            'Snippet', 'Snowburst One', 'Sofadi One', 'Sofia', 'Sofia Sans', 'Sofia Sans Condensed',
            'Sofia Sans Extra Condensed', 'Sofia Sans Semi Condensed', 'Solitreo', 'Solway', 'Song Myung',
            'Sophia', 'Sora', 'Sorts Mill Goudy', 'Source Code Pro', 'Source Sans 3', 'Source Serif 4',
            'Source Serif Pro', 'Space Mono', 'Spartan', 'Special Elite', 'Spectral SC', 'Spicy Rice',
            'Spinnaker', 'Spirax', 'Splash', 'Spline Sans', 'Spline Sans Mono', 'Squada One', 'Square Peg',
            'Sree Krushnadevaraya', 'Sriracha', 'Srisakdi', 'Staatliches', 'Stalemate', 'Stalinist One',
            'Stardos Stencil', 'Stick', 'Stick No Bills', 'Stint Ultra Condensed', 'Stint Ultra Expanded',
            'Stoke', 'Strait', 'Style Script', 'Stylish', 'Sue Ellen Francisco', 'Suez One', 'Sulphur Point',
            'Sumana', 'Sunflower', 'Sunshiney', 'Supermercado One', 'Sura', 'Suranna', 'Suravaram', 'Suwannaphum',
            'Swanky and Moo Moo', 'Syncopate', 'Syne', 'Syne Mono', 'Syne Tactile', 'Tajawal', 'Tangerine',
            'Tapestry', 'Taprom', 'Tauri', 'Taviraj', 'Teko', 'Telex', 'Tenali Ramakrishna', 'Tenor Sans',
            'Text Me One', 'Texturina', 'Thasadith', 'The Girl Next Door', 'The Nautigal', 'Tienne', 'Tillana',
            'Tilt Neon', 'Tilt Prism', 'Tilt Warp', 'Timmana', 'Tinos', 'Tiro Bangla', 'Tiro Devanagari Hindi',
            'Tiro Devanagari Marathi', 'Tiro Devanagari Sanskrit', 'Tiro Gurmukhi', 'Tiro Kannada', 'Tiro Tamil',
            'Tiro Telugu', 'Titan One', 'Trade Winds', 'Train One', 'Trirong', 'Trispace', 'Trocchi',
            'Trochut', 'Truculenta', 'Trykker', 'Tulpen One', 'Turret Road', 'Twinkle Star', 'Ubuntu Condensed',
            'Ubuntu Mono', 'Uchen', 'Ultra', 'Uncial Antiqua', 'Underdog', 'Unica One', 'UnifrakturCook',
            'UnifrakturMaguntia', 'Unkempt', 'Unlock', 'Unna', 'Updock', 'Urbanist', 'Varta', 'Vast Shadow',
            'Vazirmatn', 'Vesper Libre', 'Viaoda Libre', 'Vibes', 'Vibur', 'Vidaloka', 'Viga', 'Voces',
            'Volkhov', 'Vollkorn SC', 'Voltaire', 'Vujahday Script', 'Waiting for the Sunrise', 'Wallpoet',
            'Walter Turncoat', 'Warnes', 'Water Brush', 'Waterfall', 'Wellfleet', 'Wendy One', 'Whisper',
            'WindSong', 'Wire One', 'Wix Madefor Display', 'Wix Madefor Text', 'Work Sans', 'Xanh Mono',
            'Yaldevi', 'Yanone Kaffeesatz', 'Yantramanav', 'Yatra One', 'Yellowtail', 'Yeon Sung', 'Yeseva One',
            'Yesteryear', 'Yomogi', 'Yrsa', 'Ysabeau', 'Ysabeau Infant', 'Ysabeau Office', 'Ysabeau SC',
            'Yuji Boku', 'Yuji Hentaigana Akari', 'Yuji Hentaigana Akebono', 'Yuji Mai', 'Yuji Syuku',
            'Yusei Magic', 'ZCOOL KuaiLe', 'ZCOOL QingKe HuangYou', 'ZCOOL XiaoWei', 'Zen Antique',
            'Zen Antique Soft', 'Zen Dots', 'Zen Kaku Gothic Antique', 'Zen Kaku Gothic New', 'Zen Kurenaido',
            'Zen Loop', 'Zen Maru Gothic', 'Zen Old Mincho', 'Zen Tokyo Zoo', 'Zeyada', 'Zhi Mang Xing',
            'Zilla Slab Highlight'
        ];
        // Remove duplicates
        googleFonts.allFonts = [...new Set(googleFonts.allFonts)].sort();
        return googleFonts.allFonts;
    } catch (error) {
        console.error('Failed to load font list:', error);
        return googleFonts.popular;
    }
}

// Font picker state - separate state for each picker
const fontPickerState = {
    headline: { category: 'popular', search: '' },
    subheadline: { category: 'popular', search: '' },
    element: { category: 'popular', search: '' }
};

// Initialize all font pickers
function initFontPicker() {
    initSingleFontPicker('headline', {
        picker: 'font-picker',
        trigger: 'font-picker-trigger',
        dropdown: 'font-picker-dropdown',
        search: 'font-search',
        list: 'font-picker-list',
        preview: 'font-picker-preview',
        hidden: 'headline-font',
        stateKey: 'headlineFont'
    });

    initSingleFontPicker('subheadline', {
        picker: 'subheadline-font-picker',
        trigger: 'subheadline-font-picker-trigger',
        dropdown: 'subheadline-font-picker-dropdown',
        search: 'subheadline-font-search',
        list: 'subheadline-font-picker-list',
        preview: 'subheadline-font-picker-preview',
        hidden: 'subheadline-font',
        stateKey: 'subheadlineFont'
    });

    initSingleFontPicker('element', {
        picker: 'element-font-picker',
        trigger: 'element-font-picker-trigger',
        dropdown: 'element-font-picker-dropdown',
        search: 'element-font-search',
        list: 'element-font-picker-list',
        preview: 'element-font-picker-preview',
        hidden: 'element-font',
        stateKey: 'font',
        getFont: () => { const el = getSelectedElement(); return el ? el.font : ''; },
        setFont: (value) => { if (selectedElementId) setElementProperty(selectedElementId, 'font', value); }
    });
}

// Initialize a single font picker instance
function initSingleFontPicker(pickerId, ids) {
    const trigger = document.getElementById(ids.trigger);
    const dropdown = document.getElementById(ids.dropdown);
    const searchInput = document.getElementById(ids.search);
    const picker = document.getElementById(ids.picker);

    if (!trigger || !dropdown) return;

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other font picker dropdowns
        document.querySelectorAll('.font-picker-dropdown.open').forEach(d => {
            if (d.id !== ids.dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            searchInput.focus();
            renderFontList(pickerId, ids);
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest(`#${ids.picker}`)) {
            dropdown.classList.remove('open');
        }
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
        fontPickerState[pickerId].search = e.target.value.toLowerCase();
        renderFontList(pickerId, ids);
    });

    // Prevent dropdown close when clicking inside
    dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Category buttons
    const categoryButtons = picker.querySelectorAll('.font-category');
    categoryButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fontPickerState[pickerId].category = btn.dataset.category;
            renderFontList(pickerId, ids);
        });
    });

    // Initial render
    renderFontList(pickerId, ids);
}

// Render the font list for a specific picker
async function renderFontList(pickerId, ids) {
    const fontList = document.getElementById(ids.list);
    if (!fontList) return;

    const pickerState = fontPickerState[pickerId];
    let fonts = [];
    const currentFont = ids.getFont ? ids.getFont() : getTextSettings()[ids.stateKey];

    if (pickerState.category === 'system') {
        fonts = googleFonts.system.map(f => ({
            name: f.name,
            value: f.value,
            category: 'system'
        }));
    } else if (pickerState.category === 'popular') {
        fonts = googleFonts.popular.map(name => ({
            name,
            value: `'${name}', sans-serif`,
            category: 'google'
        }));
    } else {
        // All fonts
        const allFonts = await fetchAllGoogleFonts();
        fonts = [
            ...googleFonts.system.map(f => ({
                name: f.name,
                value: f.value,
                category: 'system'
            })),
            ...allFonts.map(name => ({
                name,
                value: `'${name}', sans-serif`,
                category: 'google'
            }))
        ];
    }

    // Filter by search
    if (pickerState.search) {
        fonts = fonts.filter(f => f.name.toLowerCase().includes(pickerState.search));
    }

    // Limit to prevent performance issues
    const displayFonts = fonts.slice(0, 100);

    if (displayFonts.length === 0) {
        fontList.innerHTML = '<div class="font-picker-empty">No fonts found</div>';
        return;
    }

    fontList.innerHTML = displayFonts.map(font => {
        const isSelected = currentFont && (currentFont.includes(font.name) || currentFont === font.value);
        const isLoaded = font.category === 'system' || googleFonts.loaded.has(font.name);
        const isLoading = googleFonts.loading.has(font.name);

        return `
            <div class="font-option ${isSelected ? 'selected' : ''}"
                 data-font-name="${font.name}"
                 data-font-value="${font.value}"
                 data-font-category="${font.category}">
                <span class="font-option-name" style="font-family: ${isLoaded ? font.value : 'inherit'}">${font.name}</span>
                ${isLoading ? '<span class="font-option-loading">Loading...</span>' :
                `<span class="font-option-category">${font.category}</span>`}
            </div>
        `;
    }).join('');

    // Add click handlers
    fontList.querySelectorAll('.font-option').forEach(option => {
        option.addEventListener('click', async () => {
            const fontName = option.dataset.fontName;
            const fontValue = option.dataset.fontValue;
            const fontCategory = option.dataset.fontCategory;

            // Load Google Font if needed
            if (fontCategory === 'google') {
                option.querySelector('.font-option-category').textContent = 'Loading...';
                option.querySelector('.font-option-category').classList.add('font-option-loading');
                await loadGoogleFont(fontName);
                option.querySelector('.font-option-name').style.fontFamily = fontValue;
                option.querySelector('.font-option-category').textContent = 'google';
                option.querySelector('.font-option-category').classList.remove('font-option-loading');
            }

            // Update state
            document.getElementById(ids.hidden).value = fontValue;
            if (ids.setFont) {
                ids.setFont(fontValue);
            } else {
                setTextValue(ids.stateKey, fontValue);
            }

            // Update preview
            const preview = document.getElementById(ids.preview);
            preview.textContent = fontName;
            preview.style.fontFamily = fontValue;

            // Update selection in list
            fontList.querySelectorAll('.font-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');

            // Close dropdown
            document.getElementById(ids.dropdown).classList.remove('open');

            updateCanvas();
        });

        // Preload font on hover for better UX
        option.addEventListener('mouseenter', () => {
            const fontName = option.dataset.fontName;
            const fontCategory = option.dataset.fontCategory;
            if (fontCategory === 'google' && !googleFonts.loaded.has(fontName)) {
                loadGoogleFont(fontName).then(() => {
                    option.querySelector('.font-option-name').style.fontFamily = option.dataset.fontValue;
                });
            }
        });
    });
}

// Update font picker preview from state
function updateFontPickerPreview() {
    updateSingleFontPickerPreview('headline-font', 'font-picker-preview', 'headlineFont');
    updateSingleFontPickerPreview('subheadline-font', 'subheadline-font-picker-preview', 'subheadlineFont');
}

function updateSingleFontPickerPreview(hiddenId, previewId, stateKey) {
    const preview = document.getElementById(previewId);
    const hiddenInput = document.getElementById(hiddenId);
    if (!preview || !hiddenInput) return;

    const text = getTextSettings();
    const fontValue = text[stateKey];
    if (!fontValue) return;

    hiddenInput.value = fontValue;

    // Extract font name from value
    let fontName = 'SF Pro Display';
    const systemFont = googleFonts.system.find(f => f.value === fontValue);
    if (systemFont) {
        fontName = systemFont.name;
    } else {
        // Try to extract from Google Font value like "'Roboto', sans-serif"
        const match = fontValue.match(/'([^']+)'/);
        if (match) {
            fontName = match[1];
            // Load the font if it's a Google Font
            loadGoogleFont(fontName);
        }
    }

    preview.textContent = fontName;
    preview.style.fontFamily = fontValue;
}

function updateElementFontPickerPreview(el) {
    const preview = document.getElementById('element-font-picker-preview');
    const hiddenInput = document.getElementById('element-font');
    if (!preview || !hiddenInput || !el) return;

    const fontValue = el.font;
    if (!fontValue) return;

    hiddenInput.value = fontValue;

    let fontName = 'SF Pro Display';
    const systemFont = googleFonts.system.find(f => f.value === fontValue);
    if (systemFont) {
        fontName = systemFont.name;
    } else {
        const match = fontValue.match(/'([^']+)'/);
        if (match) {
            fontName = match[1];
            loadGoogleFont(fontName);
        }
    }

    preview.textContent = fontName;
    preview.style.fontFamily = fontValue;
}

// Device dimensions
const deviceDimensions = {
    'iphone-6.9': { width: 1320, height: 2868 },
    'iphone-6.7': { width: 1290, height: 2796 },
    'iphone-6.5': { width: 1284, height: 2778 },
    'iphone-5.5': { width: 1242, height: 2208 },
    'ipad-12.9': { width: 2048, height: 2732 },
    'ipad-11': { width: 1668, height: 2388 },
    'android-phone': { width: 1080, height: 1920 },
    'android-phone-hd': { width: 1440, height: 2560 },
    'android-tablet-7': { width: 1200, height: 1920 },
    'android-tablet-10': { width: 1600, height: 2560 },
    'web-og': { width: 1200, height: 630 },
    'web-twitter': { width: 1200, height: 675 },
    'web-hero': { width: 1920, height: 1080 },
    'web-feature': { width: 1024, height: 500 },
    // Social media presets
    'social-ig-square': { width: 1080, height: 1080 },
    'social-ig-portrait': { width: 1080, height: 1350 },
    'social-ig-story': { width: 1080, height: 1920 },
    'social-x-post': { width: 1600, height: 900 },
    'social-x-card': { width: 1200, height: 675 },
    'social-linkedin-post': { width: 1200, height: 627 },
    'social-facebook-post': { width: 1200, height: 630 },
    'social-og': { width: 1200, height: 630 },
    'social-youtube-thumb': { width: 1280, height: 720 },
    'social-tiktok': { width: 1080, height: 1920 }
};

// DOM elements
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');
const canvasLeft = document.getElementById('preview-canvas-left');
const ctxLeft = canvasLeft.getContext('2d');
const canvasRight = document.getElementById('preview-canvas-right');
const ctxRight = canvasRight.getContext('2d');
const canvasFarLeft = document.getElementById('preview-canvas-far-left');
const ctxFarLeft = canvasFarLeft.getContext('2d');
const canvasFarRight = document.getElementById('preview-canvas-far-right');
const ctxFarRight = canvasFarRight.getContext('2d');
const sidePreviewLeft = document.getElementById('side-preview-left');
const sidePreviewRight = document.getElementById('side-preview-right');
const sidePreviewFarLeft = document.getElementById('side-preview-far-left');
const sidePreviewFarRight = document.getElementById('side-preview-far-right');
const previewStrip = document.querySelector('.preview-strip');
const canvasWrapper = document.getElementById('canvas-wrapper');

let isSliding = false;
let skipSidePreviewRender = false;  // Flag to skip re-rendering side previews after pre-render
let lastSlideAt = 0;                // last slide start (ms), for velocity-adaptive duration

// Side previews are displayed small (~200px wide) but were rendered at full export
// resolution (e.g. 1320x2868), which made the 3D device render dominate the carousel
// slide cost. Render them at a fraction of the resolution (same DISPLAY size — the
// canvas is just downscaled less), which keeps them crisp while cutting the 3D render
// work several-fold. The main editing canvas stays full-res.
const SIDE_PREVIEW_Q = 0.45;
function sidePreviewDims(dims, previewScale) {
    return {
        pdims: { width: Math.max(1, Math.round(dims.width * SIDE_PREVIEW_Q)), height: Math.max(1, Math.round(dims.height * SIDE_PREVIEW_Q)) },
        pscale: previewScale / SIDE_PREVIEW_Q
    };
}

// After carousel scrolling stops, do one full render so the far previews (skipped
// mid-slide for speed) refresh. Debounced so rapid chained slides only settle once.
let _settleTimer = null;
function scheduleSettleRender() {
    if (_settleTimer) clearTimeout(_settleTimer);
    _settleTimer = setTimeout(() => {
        _settleTimer = null;
        if (!isSliding) updateCanvas();
    }, 140);
}

// Two-finger horizontal swipe to navigate between screenshots
let swipeAccumulator = 0;
const SWIPE_THRESHOLD = 50; // Minimum accumulated delta to trigger navigation
let lastSwipeAt = 0;        // last trackpad wheel-event time (to detect when the gesture ends)
let swipeLocked = false;    // true after a swipe advances — absorbs the inertial momentum tail
const SWIPE_IDLE_GAP = 150; // ms of no trackpad events ⇒ the swipe AND its momentum have ended

// Prevent browser back/forward gesture on the entire canvas area
canvasWrapper.addEventListener('wheel', (e) => {
    // Cmd/Ctrl + scroll (or trackpad pinch, which fires wheel with ctrlKey) → zoom the
    // device by adjusting Screenshot Scale, so you can zoom with the mouse instead of
    // only the slider. Works in both 2D and 3D (both read screenshot.scale).
    if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        const ss = getScreenshotSettings();
        if (!ss) return;
        const slider = document.getElementById('screenshot-scale');
        const min = slider ? parseFloat(slider.min) : 30;
        const max = slider ? parseFloat(slider.max) : 400;
        // Scroll up / pinch out → zoom in. ~10% per notch, scaled by deltaY magnitude.
        const step = -e.deltaY * 0.15;
        const next = Math.max(min, Math.min(max, (ss.scale || 100) + step));
        ss.scale = next;
        if (slider) {
            slider.value = next;
            const lbl = document.getElementById('screenshot-scale-value');
            if (lbl) lbl.textContent = Math.round(next) + '%';
        }
        if (typeof autoKeyTouch === 'function') autoKeyTouch('screenshot.scale');
        updateCanvas();
        return;
    }
    // Prevent horizontal scroll from triggering browser back/forward
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
    }
}, { passive: false });

let pendingSteps = 0;        // queued discrete carousel steps (mouse Shift+wheel), signed
let lastShiftStepAt = 0;     // last ACCEPTED step time (sustained-mode rate limiter)
let lastShiftWheelAt = 0;    // last Shift+wheel EVENT time (gesture liveness)
let shiftGestureStart = 0;   // when the current scroll gesture began
// Mouse Shift+wheel feel. One physical scroll arrives as a burst of events (macOS scroll
// acceleration / hi-res wheels), so we treat scrolling as GESTURES rather than counting
// events. Tune these three to taste:
const SHIFT_GESTURE_GAP = 160;      // ms of wheel silence that starts a NEW gesture → one instant step
const SHIFT_ENGAGE_MS = 280;        // grace window after a gesture starts; events here are the
                                    //   momentum tail of a single scroll → ignored (one nudge = one slide)
const SHIFT_SUSTAIN_INTERVAL = 130; // once past the grace window, keep advancing this often (fast multi)

// IMPORTANT: this listener lives on the STABLE parent (.canvas-area), NOT on
// .preview-strip. While a slide is in flight, slideToScreenshot() adds the `.sliding`
// class and `.preview-strip.sliding { pointer-events: none }` makes the whole strip
// subtree deaf to wheel events (pointer-events is inherited). If the listener sat on the
// strip, every notch scrolled DURING a slide would be lost — which defeats the entire
// pendingSteps queue (it exists precisely to accumulate notches mid-slide and chain into
// the next one). On .canvas-area the events keep flowing the whole time, so continuous
// scrolling keeps advancing screenshots smoothly. Do not move this back onto the strip.
const navWheelTarget = previewStrip.parentElement;  // .canvas-area
navWheelTarget.addEventListener('wheel', (e) => {
    // Cmd/Ctrl+scroll is reserved for zoom (handled on .canvas-wrapper) — never navigate.
    if (e.metaKey || e.ctrlKey) return;
    // Navigate on horizontal intent: a trackpad two-finger swipe (deltaX dominant) OR
    // Shift+wheel on a mouse (held Shift makes wheel scrolling horizontal).
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
    if (!horizontal) return;

    e.preventDefault();
    e.stopPropagation();
    if (state.screenshots.length <= 1) return;

    if (e.shiftKey) {
        // Mouse Shift+wheel — gesture-aware so ONE scroll moves ONE slide while holding the
        // scroll blasts through many. Magnitude is unreliable on a mouse, so we go by DIRECTION
        // and TIMING only. A "gesture" is a run of wheel events with no >SHIFT_GESTURE_GAP gap.
        //   • New gesture (wheel was quiet): advance exactly one slide NOW → responsive & precise.
        //   • Within SHIFT_ENGAGE_MS of that start: ignore — this is the momentum tail of a single
        //     scroll, so one nudge stays one slide (the overshoot you were seeing).
        //   • Past the grace window and still scrolling: you clearly mean to travel — advance
        //     every SHIFT_SUSTAIN_INTERVAL → fast multi-slide scrubbing.
        //   • Slow notch-by-notch scrolling (gaps > the gesture gap) = each notch is its own
        //     gesture → one slide per notch.
        const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX)) ? e.deltaY : e.deltaX;
        if (d === 0) return;
        const dir = d > 0 ? 1 : -1;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const newGesture = (now - lastShiftWheelAt) > SHIFT_GESTURE_GAP;
        lastShiftWheelAt = now;
        const step = () => { pendingSteps = Math.max(-2, Math.min(2, pendingSteps + dir)); processPendingSteps(); };

        if (newGesture) {
            shiftGestureStart = now;
            lastShiftStepAt = now;
            step();                                              // instant single step
        } else if (now - shiftGestureStart >= SHIFT_ENGAGE_MS    // past the single-scroll grace window…
                   && now - lastShiftStepAt >= SHIFT_SUSTAIN_INTERVAL) {
            lastShiftStepAt = now;
            step();                                              // …sustained fast multi-advance
        }
        // else: momentum tail of a single scroll → ignored
        return;
    }

    // Trackpad two-finger horizontal swipe. macOS appends an inertial MOMENTUM tail after you
    // lift your fingers — a long stream of decaying deltaX events. Counting all of it made one
    // swipe cross the threshold repeatedly and skip several slides. So: advance ONE slide when a
    // swipe crosses the threshold, then LOCK until the event stream goes idle (the swipe and its
    // momentum have ended). One physical swipe = one slide; swipe again to move again.
    const nowSwipe = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (nowSwipe - lastSwipeAt > SWIPE_IDLE_GAP) { swipeAccumulator = 0; swipeLocked = false; } // new gesture
    lastSwipeAt = nowSwipe;
    if (swipeLocked) return;                       // still absorbing this swipe's momentum tail
    swipeAccumulator += e.deltaX;
    if (Math.abs(swipeAccumulator) > SWIPE_THRESHOLD) {
        swipeLocked = true;                        // one advance per swipe; ignore the rest of the tail
        const dir = swipeAccumulator > 0 ? 1 : -1;
        swipeAccumulator = 0;
        pendingSteps = Math.max(-2, Math.min(2, pendingSteps + dir));
        processPendingSteps();                     // chains at slide-end for quick successive swipes
    }
}, { passive: false });

// Process one queued discrete step (mouse Shift+wheel). Called per notch AND on each
// slide end, so a quick burst of notches plays out one-screenshot-at-a-time.
function processPendingSteps() {
    if (isSliding || pendingSteps === 0) return;
    if (state.screenshots.length <= 1) { pendingSteps = 0; return; }
    if (pendingSteps > 0) {
        const n = state.selectedIndex + 1;
        pendingSteps--;
        if (n < state.screenshots.length) slideToScreenshot(n, 'right'); else pendingSteps = 0;
    } else {
        const p = state.selectedIndex - 1;
        pendingSteps++;
        if (p >= 0) slideToScreenshot(p, 'left'); else pendingSteps = 0;
    }
}

// Advance the carousel if enough horizontal scroll has accumulated (trackpad). Called on
// each tick AND when a slide finishes, so continued swiping chains immediately.
function tryAdvanceCarousel() {
    if (isSliding) return;            // the in-flight slide re-checks this when it ends
    if (state.screenshots.length <= 1) return;
    // Reset (not decrement) on each advance: one notch = one screenshot. Continuous fast
    // scrolling still chains because new events accumulate DURING the slide.
    if (swipeAccumulator > SWIPE_THRESHOLD) {
        const nextIndex = state.selectedIndex + 1;
        swipeAccumulator = 0;
        if (nextIndex < state.screenshots.length) slideToScreenshot(nextIndex, 'right');
    } else if (swipeAccumulator < -SWIPE_THRESHOLD) {
        const prevIndex = state.selectedIndex - 1;
        swipeAccumulator = 0;
        if (prevIndex >= 0) slideToScreenshot(prevIndex, 'left');
    }
}
let suppressSwitchModelUpdate = false;  // Flag to suppress updateCanvas from switchPhoneModel
const fileInput = document.getElementById('file-input');
const screenshotList = document.getElementById('screenshot-list');
const noScreenshot = document.getElementById('no-screenshot');

// IndexedDB for larger storage (can store hundreds of MB vs localStorage's 5-10MB)
let db = null;
const DB_NAME = 'AppStoreScreenshotGenerator';
const DB_VERSION = 4;
const MEDIA_STORE = 'media';
const PROJECTS_STORE = 'projects';
const META_STORE = 'meta';
const TEMPLATES_STORE = 'templates'; // user-saved custom screenshot templates

let currentProjectId = 'default';
let projects = [{ id: 'default', name: 'Default Project', screenshotCount: 0 }];

function openDatabase() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                // Continue without database
                resolve(null);
            };

            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;

                // Delete old store if exists (from version 1)
                if (database.objectStoreNames.contains('state')) {
                    database.deleteObjectStore('state');
                }

                // Create projects store
                if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
                    database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
                }

                // Create meta store for project list and current project
                if (!database.objectStoreNames.contains(META_STORE)) {
                    database.createObjectStore(META_STORE, { keyPath: 'key' });
                }

                // Create media store for video Blobs (videos can't be base64'd into the
                // project doc — too large; store as native Blob keyed by uuid).
                if (!database.objectStoreNames.contains(MEDIA_STORE)) {
                    database.createObjectStore(MEDIA_STORE, { keyPath: 'key' });
                }

                // Create templates store for user-saved custom templates (v4).
                if (!database.objectStoreNames.contains(TEMPLATES_STORE)) {
                    database.createObjectStore(TEMPLATES_STORE, { keyPath: 'id' });
                }
            };

            request.onblocked = () => {
                console.warn('Database upgrade blocked. Please close other tabs.');
                resolve(null);
            };
        } catch (e) {
            console.error('Failed to open IndexedDB:', e);
            resolve(null);
        }
    });
}

// Load project list and current project
async function loadProjectsMeta() {
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const transaction = db.transaction([META_STORE], 'readonly');
            const store = transaction.objectStore(META_STORE);

            const projectsReq = store.get('projects');
            const currentReq = store.get('currentProject');

            transaction.oncomplete = () => {
                if (projectsReq.result) {
                    projects = projectsReq.result.value;
                }
                if (currentReq.result) {
                    currentProjectId = currentReq.result.value;
                }
                updateProjectSelector();
                resolve();
            };

            transaction.onerror = () => resolve();
        } catch (e) {
            resolve();
        }
    });
}

// Save project list and current project
function saveProjectsMeta() {
    if (!db) return;

    try {
        const transaction = db.transaction([META_STORE], 'readwrite');
        const store = transaction.objectStore(META_STORE);
        store.put({ key: 'projects', value: projects });
        store.put({ key: 'currentProject', value: currentProjectId });
    } catch (e) {
        console.error('Error saving projects meta:', e);
    }
}

// Update project selector dropdown
function updateProjectSelector() {
    const menu = document.getElementById('project-menu');
    menu.innerHTML = '';

    // Find current project
    const currentProject = projects.find(p => p.id === currentProjectId) || projects[0];

    // Update trigger display - always use actual state for current project
    document.getElementById('project-trigger-name').textContent = currentProject.name;
    const count = state.screenshots.length;
    document.getElementById('project-trigger-meta').textContent = `${count} screenshot${count !== 1 ? 's' : ''}`;

    // Build menu options
    projects.forEach(project => {
        const option = document.createElement('div');
        option.className = 'project-option' + (project.id === currentProjectId ? ' selected' : '');
        option.dataset.projectId = project.id;

        const screenshotCount = project.id === currentProjectId ? state.screenshots.length : (project.screenshotCount || 0);

        option.innerHTML = `
            <span class="project-option-name">${project.name}</span>
            <span class="project-option-meta">${screenshotCount} screenshot${screenshotCount !== 1 ? 's' : ''}</span>
        `;

        option.addEventListener('click', (e) => {
            e.stopPropagation();
            if (project.id !== currentProjectId) {
                switchProject(project.id);
            }
            document.getElementById('project-dropdown').classList.remove('open');
        });

        menu.appendChild(option);
    });
}

// Initialize
async function init() {
    try {
        await openDatabase();
        await loadProjectsMeta();
        await loadCustomTemplates();
        await loadState();
        syncUIWithState();
        updateCanvas();
        resetHistory(); // baseline undo history to the freshly-loaded project
    } catch (e) {
        console.error('Initialization error:', e);
        // Continue with defaults
        syncUIWithState();
        updateCanvas();
        resetHistory();
    }
}

// Relocate existing wired controls (project dropdown, project actions, utility
// icons, output size + export) into the top toolbar. Moving the live nodes keeps
// every event handler and ID intact — no markup is duplicated. Called before
// setupEventListeners (order is irrelevant since handlers bind by ID).
function setupToolbar() {
    const left = document.getElementById('toolbar-left');
    const right = document.getElementById('toolbar-right');
    if (!left || !right) return;

    const projectDropdown = document.getElementById('project-dropdown');
    const projectButtons = document.querySelector('.sidebar .project-buttons');
    const utilityIds = ['language-picker', 'templates-btn', 'animations-btn', 'magical-titles-btn', 'about-btn', 'settings-btn'];
    const exportSection = document.querySelector('.export-output-section');

    // Left: project name dropdown + project management actions
    if (projectDropdown) left.appendChild(projectDropdown);
    if (projectButtons) left.appendChild(projectButtons);

    // Right: utility icons, a divider, then output size + export controls
    utilityIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) right.appendChild(el);
    });
    const divider = document.createElement('div');
    divider.className = 'toolbar-divider';
    right.appendChild(divider);
    if (exportSection) right.appendChild(exportSection);

    // Clean up the now-empty/redundant left-sidebar chrome.
    document.querySelector('.sidebar .sidebar-header')?.remove();   // held "Project" h2 + moved buttons
    document.querySelector('.sidebar .project-controls')?.remove(); // wrapper, now empty
    document.querySelector('.sidebar-content > .divider')?.remove();// separator after project controls
    document.querySelector('.sidebar-footer')?.remove();            // held the moved export section
}

// Set up event listeners immediately (don't wait for async init)
function initSync() {
    setupToolbar();
    setupEventListeners();
    setupElementEventListeners();
    setupPopoutEventListeners();
    setupSliderResetButtons();
    setupTemplatesUI();
    if (typeof initAnimationPresets === 'function') initAnimationPresets();
    initFontPicker();
    initVideoControls();
    if (typeof initTimeline === 'function') initTimeline();
    if (typeof initExportModal === 'function') initExportModal();
    updateGradientStopsUI();
    updateCanvas();
    // Then load saved data asynchronously
    init();
}

// Save state to IndexedDB for current project
// When true, updateCanvas() skips persistence. Used by the video tick loop so we
// don't write to IndexedDB 30× per second while a video plays — state hasn't
// actually changed, only the rendered frame has.
let _suppressSave = false;

// --- Media (video Blob) persistence ---
function saveMediaBlob(key, blob) {
    return new Promise((resolve) => {
        if (!db || !blob) return resolve();
        try {
            const tx = db.transaction([MEDIA_STORE], 'readwrite');
            tx.objectStore(MEDIA_STORE).put({ key, blob, type: blob.type, savedAt: Date.now() });
            tx.oncomplete = () => resolve(key);
            tx.onerror = () => resolve(); // fail silently — video will just need re-upload
        } catch { resolve(); }
    });
}
function loadMediaBlob(key) {
    return new Promise((resolve) => {
        if (!db || !key) return resolve(null);
        try {
            const tx = db.transaction([MEDIA_STORE], 'readonly');
            const req = tx.objectStore(MEDIA_STORE).get(key);
            req.onsuccess = () => resolve(req.result?.blob || null);
            req.onerror = () => resolve(null);
        } catch { resolve(null); }
    });
}
function genMediaKey() {
    return 'media-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

// Debounced persistence: updateCanvas() runs on every state change (drags,
// slider scrubbing, etc.), but saveState() serializes every screenshot to
// base64 and writes to IndexedDB, which is far too heavy to run per-frame.
// scheduleSave() coalesces those writes into a single one after activity
// settles. Explicit, critical save points still call saveState() directly.
let _saveTimer = null;
function scheduleSave(delay = 400) {
    if (!db || _suppressSave) return;
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
        _saveTimer = null;
        saveState();
    }, delay);
}

// ===========================================================================
// Undo / Redo history (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z / Ctrl+Y)
// ---------------------------------------------------------------------------
// Snapshot-based: each entry is a deep clone of state.screenshots with live
// Image/Video/Canvas objects kept BY REFERENCE (so restoring is instant and the
// pixels survive). Recording is hooked off the same settle boundary as the
// debounced save, but only fires when the *serializable* content actually changed
// — so selections, hovers, and timeline scrubbing (which don't alter screenshot
// data) never create history entries. Transient fields (_screenRect, _imageLoading,
// …) and the heavy media objects are excluded from change-detection.
const HISTORY_LIMIT = 60;
let _histUndo = [];
let _histRedo = [];
let _histBaselineSnap = null;
let _histBaselineHash = null;
let _histTimer = null;
let _histSuppress = false;
let _historyReady = false;

// Deep clone preserving media elements by reference (they can't be structured-cloned
// and don't need to be — the same pixels are valid in every snapshot).
function cloneLive(v) {
    if (v === null || typeof v !== 'object') return v;
    if (v instanceof HTMLImageElement || v instanceof HTMLVideoElement || v instanceof HTMLCanvasElement) return v;
    if (Array.isArray(v)) return v.map(cloneLive);
    const o = {};
    for (const k in v) {
        if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
        if (k[0] === '_') continue; // drop transient fields (_screenRect, _imageLoading, …)
        o[k] = cloneLive(v[k]);
    }
    return o;
}

// A stable string of just the editable content, used to tell real edits apart from
// pure re-renders. Media elements and _-prefixed transients are omitted. Long strings
// (base64 image/data-URLs) are reduced to a length+sample digest so the hash stays
// small and fast even on projects with many full-res screenshots — a different image
// still changes the digest, so swaps are detected.
function historyHash() {
    try {
        return JSON.stringify(state.screenshots, (k, val) => {
            if (k && k[0] === '_') return undefined;
            if (val instanceof HTMLImageElement || val instanceof HTMLVideoElement || val instanceof HTMLCanvasElement) return undefined;
            if (typeof val === 'string' && val.length > 256) {
                return `§${val.length}:${val.slice(0, 48)}…${val.slice(-48)}`;
            }
            return val;
        });
    } catch (e) {
        return null;
    }
}

function snapshotScreenshots() {
    return cloneLive(state.screenshots);
}

// (Re)initialize history to the current state as the clean baseline. Call after a
// project loads/switches so undo can't cross project boundaries.
function resetHistory() {
    _histUndo = [];
    _histRedo = [];
    _histBaselineSnap = snapshotScreenshots();
    _histBaselineHash = historyHash();
    _historyReady = true;
    updateUndoRedoButtons();
}

// Called from updateCanvas on every render; debounced so a continuous gesture (a
// slider drag, a canvas move) collapses into ONE undo step at the settle boundary.
function noteHistoryActivity() {
    if (!_historyReady || _histSuppress) return;
    if (_histTimer) clearTimeout(_histTimer);
    _histTimer = setTimeout(commitHistoryIfChanged, 500);
}

function commitHistoryIfChanged() {
    if (_histSuppress || !_historyReady) return;
    const h = historyHash();
    if (h === _histBaselineHash) return; // nothing actually changed (re-render only)
    if (_histBaselineSnap) {
        _histUndo.push({ snap: _histBaselineSnap, hash: _histBaselineHash, sel: state.selectedIndex });
        if (_histUndo.length > HISTORY_LIMIT) _histUndo.shift();
    }
    _histRedo = [];
    _histBaselineSnap = snapshotScreenshots();
    _histBaselineHash = h;
    updateUndoRedoButtons();
}

// Swap the live screenshots for a snapshot and rebuild the UI. Clones the snapshot
// so later edits don't mutate the stored history entry.
function restoreHistorySnapshot(entry) {
    _histSuppress = true;
    if (_histTimer) { clearTimeout(_histTimer); _histTimer = null; }
    state.screenshots = cloneLive(entry.snap);
    if (typeof entry.sel === 'number') {
        state.selectedIndex = Math.max(0, Math.min(entry.sel, state.screenshots.length - 1));
    }
    if (state.selectedIndex >= state.screenshots.length) state.selectedIndex = state.screenshots.length - 1;
    if (state.selectedIndex < 0 && state.screenshots.length) state.selectedIndex = 0;
    // Clear selections that may no longer be valid.
    if (typeof setSelectedElement === 'function') setSelectedElement(null);
    selectedPopoutId = null;
    selectedExtraDeviceId = null;
    if (typeof syncUIWithState === 'function') syncUIWithState();
    updateCanvas();
    saveState();
    // Capture the baseline AFTER syncUIWithState()/updateCanvas() have applied their
    // normalizations (text normalize, effects/extraDevices backfill). Capturing it
    // earlier would leave the hash out of sync with the now-normalized state, making
    // the very next undo see a phantom change and commit instead of stepping back.
    _histBaselineSnap = snapshotScreenshots();
    _histBaselineHash = historyHash();
    _histSuppress = false;
}

function undo() {
    if (!_histUndo.length) return;
    // Make sure any in-flight gesture is committed before stepping back.
    commitHistoryIfChanged();
    if (!_histUndo.length) return;
    _histRedo.push({ snap: snapshotScreenshots(), hash: _histBaselineHash, sel: state.selectedIndex });
    const entry = _histUndo.pop();
    restoreHistorySnapshot(entry);
    updateUndoRedoButtons();
}

function redo() {
    if (!_histRedo.length) return;
    _histUndo.push({ snap: snapshotScreenshots(), hash: _histBaselineHash, sel: state.selectedIndex });
    const entry = _histRedo.pop();
    restoreHistorySnapshot(entry);
    updateUndoRedoButtons();
}

// Reflect availability on the optional toolbar buttons (no-op if absent).
function updateUndoRedoButtons() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.disabled = _histUndo.length === 0;
    if (r) r.disabled = _histRedo.length === 0;
}

// A background may hold a live HTMLImageElement in `.image`, which IndexedDB's
// structured clone cannot serialize — attempting to do so throws DataCloneError
// and silently fails the *entire* save. Persist the image's data-URL src instead
// and drop the element; reconstructBackgroundImage() rebuilds it on load.
function sanitizeBackgroundForSave(bg) {
    if (!bg || typeof bg !== 'object') return bg;
    const copy = { ...bg };
    if (copy.image) {
        copy.imageSrc = copy.image.src || copy.imageSrc || '';
        copy.image = null;
    }
    delete copy._imageLoading; // transient flag, never persist
    return copy;
}

function reconstructBackgroundImage(bg) {
    if (bg && bg.imageSrc && !bg.image && !bg._imageLoading) {
        bg._imageLoading = true;
        const img = new Image();
        img.onload = () => { bg.image = img; bg._imageLoading = false; updateCanvas(); };
        img.onerror = () => { bg._imageLoading = false; };
        img.src = bg.imageSrc;
    }
}

function saveState() {
    if (!db) return;
    if (_suppressSave) return;
    // Cancel any pending debounced save since we're persisting now.
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }

    // Convert screenshots to base64 for storage, including per-screenshot settings and localized images
    const screenshotsToSave = state.screenshots.map(s => {
        // Save localized images (without Image objects, just src/name)
        const localizedImages = {};
        if (s.localizedImages) {
            Object.keys(s.localizedImages).forEach(lang => {
                const langData = s.localizedImages[lang];
                if (langData?.src || langData?.mediaKey || langData?.image?.dataset?.mediaKey) {
                    // For videos we persist a mediaKey pointing at a Blob in IDB;
                    // src (a blob: URL) doesn't survive reload so we leave it empty.
                    const isBlobUrl = typeof langData.src === 'string' && langData.src.startsWith('blob:');
                    const mediaKey = langData.mediaKey || langData.image?.dataset?.mediaKey || null;
                    localizedImages[lang] = {
                        src: isBlobUrl ? '' : (langData.src || ''),
                        name: langData.name,
                        isVideo: !!mediaKey || isBlobUrl || !!langData.isVideo,
                        mediaKey: mediaKey
                    };
                }
            });
        }

        // Legacy src field: never persist blob: URLs (object URLs die with the
        // session — videos use mediaKey; a saved blob: src would stall the loader).
        const legacySrc = (typeof s.image?.src === 'string' && !s.image.src.startsWith('blob:'))
            ? s.image.src : '';
        return {
            src: legacySrc, // Legacy compatibility
            name: s.name,
            deviceType: s.deviceType,
            localizedImages: localizedImages,
            background: sanitizeBackgroundForSave(s.background),
            screenshot: s.screenshot,
            text: s.text,
            effects: s.effects || null,
            elements: (s.elements || []).map(el => ({
                ...el,
                image: undefined // Don't serialize Image objects
            })),
            // Extra 3D devices: keep the data-URL (src) but drop the live Image and the
            // transient projected rect, mirroring how element images are handled.
            extraDevices: (s.extraDevices || []).map(d => ({
                ...d,
                image: undefined,
                _screenRect: undefined
            })),
            popouts: s.popouts || [],
            groups: s.groups || [],   // named folders of member keys (see resolveGroupMembers)
            overrides: s.overrides,
            animation: s.animation || null  // keyframe timeline (duration + tracks)
        };
    });

    const stateToSave = {
        id: currentProjectId,
        formatVersion: 3, // v2: 3D positioning formula · v3: headlines migrated to text elements
        screenshots: screenshotsToSave,
        selectedIndex: state.selectedIndex,
        outputDevice: state.outputDevice,
        customWidth: state.customWidth,
        customHeight: state.customHeight,
        currentLanguage: state.currentLanguage,
        projectLanguages: state.projectLanguages,
        // defaults can also carry non-cloneable Image objects (background + elements)
        defaults: {
            ...state.defaults,
            background: sanitizeBackgroundForSave(state.defaults.background),
            elements: (state.defaults.elements || []).map(el => ({ ...el, image: undefined }))
        }
    };

    // Update screenshot count in project metadata
    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        project.screenshotCount = state.screenshots.length;
        saveProjectsMeta();
    }

    try {
        const transaction = db.transaction([PROJECTS_STORE], 'readwrite');
        const store = transaction.objectStore(PROJECTS_STORE);
        store.put(stateToSave);
    } catch (e) {
        console.error('Error saving state:', e);
    }
}

// Flush any pending debounced save before the page goes away, so the last
// edit isn't lost if the user reloads/closes within the debounce window.
window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _saveTimer) saveState();
});
window.addEventListener('pagehide', () => { if (_saveTimer) saveState(); });

// Reflow the preview when the window resizes so it keeps filling the work area.
let _resizeTimer = null;
window.addEventListener('resize', () => {
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
        _resizeTimer = null;
        if (typeof updateCanvas === 'function') updateCanvas();
    }, 120);
});

// Migrate 3D positions from old formula to new formula
// Old: xOffset = ((x-50)/50)*2, yOffset = -((y-50)/50)*3
// New: xOffset = ((x-50)/50)*(1-scale)*0.9, yOffset = -((y-50)/50)*(1-scale)*2
function migrate3DPosition(screenshotSettings) {
    if (!screenshotSettings?.use3D) return; // Only migrate 3D screenshots

    const scale = (screenshotSettings.scale || 70) / 100;
    const oldX = screenshotSettings.x ?? 50;
    const oldY = screenshotSettings.y ?? 50;

    // Convert old position to new position that produces same visual offset
    // newX = 50 + (oldX - 50) * oldFactor / newFactor
    const xFactor = 2 / ((1 - scale) * 0.9);
    const yFactor = 3 / ((1 - scale) * 2);

    screenshotSettings.x = Math.max(0, Math.min(100, 50 + (oldX - 50) * xFactor));
    screenshotSettings.y = Math.max(0, Math.min(100, 50 + (oldY - 50) * yFactor));
}

// Migrate a loaded screenshot's headline/subheadline into text ELEMENTS (formatVersion < 3).
// NON-DESTRUCTIVE: the original `text` strings are kept (just headlineEnabled/subheadlineEnabled
// flipped off so nothing double-renders), so a rollback is possible. Idempotent via the
// disabled flags + a runtime guard. Animation size/opacity/color tracks are repointed to the
// new elements; position tracks (text.offsetX/offsetY/lineHeight) are dropped because their
// values don't translate to absolute element coordinates.
function migrateScreenshotHeadlines(screenshot) {
    if (!screenshot || screenshot._headlinesMigrated) return;
    const text = screenshot.text;
    if (!text) { screenshot._headlinesMigrated = true; return; }
    if (!Array.isArray(screenshot.elements)) screenshot.elements = [];

    const nonEmpty = (obj) => obj && Object.values(obj).some(v => typeof v === 'string' && v.trim());
    const created = {};
    if (text.headlineEnabled !== false && nonEmpty(text.headlines)) {
        const el = buildTextElementFromTextObj(text, 'headline', text.headlines);
        screenshot.elements.push(el);
        created.headline = el.id;
    }
    if (text.subheadlineEnabled && nonEmpty(text.subheadlines)) {
        const el = buildTextElementFromTextObj(text, 'subheadline', text.subheadlines);
        screenshot.elements.push(el);
        created.subheadline = el.id;
    }

    // Stop the old headline/subheadline from rendering (keep strings as a dormant backup).
    text.headlineEnabled = false;
    text.subheadlineEnabled = false;

    // Repoint animation tracks that map 1:1 (same value scale); drop the rest of text.*.
    const anim = screenshot.animation;
    if (anim && Array.isArray(anim.tracks)) {
        const map = {};
        if (created.headline) {
            map['text.headlineSize'] = `elements.${created.headline}.fontSize`;
            map['text.headlineOpacity'] = `elements.${created.headline}.opacity`;
            map['text.headlineColor'] = `elements.${created.headline}.fontColor`;
        }
        if (created.subheadline) {
            map['text.subheadlineSize'] = `elements.${created.subheadline}.fontSize`;
            map['text.subheadlineOpacity'] = `elements.${created.subheadline}.opacity`;
            map['text.subheadlineColor'] = `elements.${created.subheadline}.fontColor`;
        }
        anim.tracks.forEach(t => { if (map[t.path]) t.path = map[t.path]; });
        anim.tracks = anim.tracks.filter(t => !t.path.startsWith('text.')); // drop untranslatable position tracks
    }

    screenshot._headlinesMigrated = true;
}

// Reconstruct Image objects for graphic/icon elements from saved data
function reconstructElementImages(elements) {
    if (!elements || !Array.isArray(elements)) return [];
    return elements.map(el => {
        const restored = { ...el };
        if (el.type === 'graphic' && el.src) {
            const img = new Image();
            img.src = el.src;
            restored.image = img;
        } else if (el.type === 'icon' && el.iconName) {
            // Async fetch; image will be null initially, then updateCanvas() when ready
            getLucideImage(el.iconName, el.iconColor || '#ffffff', el.iconStrokeWidth || 2)
                .then(img => {
                    restored.image = img;
                    updateCanvas();
                })
                .catch(e => console.error('Failed to reconstruct icon:', e));
        }
        return restored;
    });
}

// Rehydrate extra-device screen Images from their saved data-URLs (src). The Image
// loads async; updateCanvas() fires once it's ready so the device's screen appears.
function reconstructExtraDeviceImages(devices) {
    if (!devices || !Array.isArray(devices)) return [];
    return devices.map(d => {
        const restored = { ...d, image: null, _screenRect: undefined };
        if (d.src) {
            const img = new Image();
            img.onload = () => { restored.image = img; if (typeof updateCanvas === 'function') updateCanvas(); };
            img.src = d.src;
            // If already cached/decoded synchronously, onload may not fire — set it now too.
            if (img.complete && img.naturalWidth) restored.image = img;
        }
        return restored;
    });
}

// Load state from IndexedDB for current project
function loadState() {
    if (!db) return Promise.resolve();

    return new Promise((resolve) => {
        try {
            const transaction = db.transaction([PROJECTS_STORE], 'readonly');
            const store = transaction.objectStore(PROJECTS_STORE);
            const request = store.get(currentProjectId);

            request.onsuccess = () => {
                const parsed = request.result;
                if (parsed) {
                    // Check if this is an old-style project (no per-screenshot settings)
                    const isOldFormat = !parsed.defaults && (parsed.background || parsed.screenshot || parsed.text);
                    const hasScreenshotsWithoutSettings = parsed.screenshots?.some(s => !s.background && !s.screenshot && !s.text);
                    const needsMigration = isOldFormat || hasScreenshotsWithoutSettings;

                    // Check if we need to migrate 3D positions (formatVersion < 2)
                    const needs3DMigration = !parsed.formatVersion || parsed.formatVersion < 2;
                    // Headlines→text-elements migration (formatVersion < 3).
                    const needsHeadlineMigration = !parsed.formatVersion || parsed.formatVersion < 3;

                    // Load screenshots with their per-screenshot settings
                    state.screenshots = [];

                    // Build migrated settings from old format if needed
                    let migratedBackground = state.defaults.background;
                    let migratedScreenshot = state.defaults.screenshot;
                    let migratedText = state.defaults.text;

                    if (isOldFormat) {
                        if (parsed.background) {
                            migratedBackground = {
                                type: parsed.background.type || 'gradient',
                                gradient: parsed.background.gradient || state.defaults.background.gradient,
                                solid: parsed.background.solid || state.defaults.background.solid,
                                image: null,
                                imageFit: parsed.background.imageFit || 'cover',
                                imageBlur: parsed.background.imageBlur || 0,
                                overlayColor: parsed.background.overlayColor || '#000000',
                                overlayOpacity: parsed.background.overlayOpacity || 0,
                                noise: parsed.background.noise || false,
                                noiseIntensity: parsed.background.noiseIntensity || 10
                            };
                        }
                        if (parsed.screenshot) {
                            migratedScreenshot = { ...state.defaults.screenshot, ...parsed.screenshot };
                        }
                        if (parsed.text) {
                            migratedText = { ...state.defaults.text, ...parsed.text };
                        }
                    }

                    if (parsed.screenshots && parsed.screenshots.length > 0) {
                        let loadedCount = 0;
                        const totalToLoad = parsed.screenshots.length;

                        parsed.screenshots.forEach((s, index) => {
                            // Check if we have new localized format or old single-image format
                            const hasLocalizedImages = s.localizedImages && Object.keys(s.localizedImages).length > 0;
                            // A blob: URL in the legacy src field is dead by definition after a
                            // reload (object URLs don't survive the session) — treat as blank
                            // instead of waiting forever on an Image that will never load.
                            if (typeof s.src === 'string' && s.src.startsWith('blob:')) s.src = '';

                            if (!hasLocalizedImages && !s.src) {
                                // Blank screen (no image)
                                const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                if (needs3DMigration) {
                                    migrate3DPosition(screenshotSettings);
                                }
                                state.screenshots[index] = {
                                    image: null,
                                    name: s.name || 'Blank Screen',
                                    deviceType: s.deviceType,
                                    localizedImages: {},
                                    background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                    screenshot: screenshotSettings,
                                    text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                    effects: (typeof withEffectDefaults === 'function') ? withEffectDefaults(s.effects) : (s.effects || null),
                                    elements: reconstructElementImages(s.elements),
                                    extraDevices: reconstructExtraDeviceImages(s.extraDevices),
                                    popouts: s.popouts || [],
                                    groups: s.groups || [],
                                    overrides: s.overrides || {},
                                    animation: s.animation || null
                                };
                                loadedCount++;
                                checkAllLoaded();
                            } else if (hasLocalizedImages) {
                                // New format: load all localized images
                                const langKeys = Object.keys(s.localizedImages);
                                let langLoadedCount = 0;
                                const localizedImages = {};

                                // Shared "all langs done" finalization. Hoisted so the video
                                // loader (which awaits async Blob fetch) can call it too.
                                const finalizeScreenshot = () => {
                                    const firstLang = langKeys[0];
                                    const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                    if (needs3DMigration) migrate3DPosition(screenshotSettings);
                                    state.screenshots[index] = {
                                        image: localizedImages[firstLang]?.image,
                                        name: s.name,
                                        deviceType: s.deviceType,
                                        localizedImages: localizedImages,
                                        background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                        screenshot: screenshotSettings,
                                        text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                        effects: (typeof withEffectDefaults === 'function') ? withEffectDefaults(s.effects) : (s.effects || null),
                                        elements: reconstructElementImages(s.elements),
                                    extraDevices: reconstructExtraDeviceImages(s.extraDevices),
                                        popouts: s.popouts || [],
                                        groups: s.groups || [],
                                        overrides: s.overrides || {},
                                        animation: s.animation || null
                                    };
                                    loadedCount++;
                                    checkAllLoaded();
                                };

                                langKeys.forEach(lang => {
                                    const langData = s.localizedImages[lang];
                                    // Video path: load the stored Blob, materialize a video element.
                                    if (langData?.mediaKey) {
                                        // Every failure mode MUST still settle this lang exactly
                                        // once, or the screenshot never finalizes and the project
                                        // loads with a hole (missing card, blank canvas). And a
                                        // failed load must KEEP the mediaKey: a transient IndexedDB
                                        // or decode error followed by any save would otherwise
                                        // permanently orphan the stored Blob.
                                        let settled = false;
                                        const keepLinkOnly = () => {
                                            if (settled) return;
                                            settled = true;
                                            localizedImages[lang] = {
                                                image: null,
                                                src: '',
                                                name: langData.name || s.name,
                                                isVideo: true,
                                                mediaKey: langData.mediaKey
                                            };
                                            langLoadedCount++;
                                            if (langLoadedCount === langKeys.length) finalizeScreenshot();
                                        };
                                        loadMediaBlob(langData.mediaKey).then((blob) => {
                                            if (!blob) { keepLinkOnly(); return; }
                                            const url = URL.createObjectURL(blob);
                                            const video = document.createElement('video');
                                            video.src = url;
                                            video.muted = true;
                                            video.loop = false;            // timeline loops the composition, not the clip
                                            video.playsInline = true;
                                            video.preload = 'auto';
                                            video.dataset.isVideo = 'true';
                                            video.dataset.blobUrl = url;
                                            video.dataset.mediaKey = langData.mediaKey;
                                            video.addEventListener('error', keepLinkOnly, { once: true });
                                            video.addEventListener('loadedmetadata', () => {
                                                if (settled) return;
                                                settled = true;
                                                video.width = video.videoWidth;
                                                video.height = video.videoHeight;
                                                try { video.pause(); video.currentTime = 0; } catch (e) {}
                                                localizedImages[lang] = {
                                                    image: video,
                                                    src: url,
                                                    name: langData.name || s.name,
                                                    isVideo: true,
                                                    mediaKey: langData.mediaKey
                                                };
                                                langLoadedCount++;
                                                if (langLoadedCount === langKeys.length) {
                                                    finalizeScreenshot();
                                                }
                                                if (typeof ensureVideoTickLoop === 'function') ensureVideoTickLoop();
                                                if (typeof updateVideoControlsVisibility === 'function') updateVideoControlsVisibility();
                                                updateCanvas();
                                            }, { once: true });
                                        }).catch(keepLinkOnly);
                                        return;
                                    }
                                    if (langData?.src) {
                                        const langImg = new Image();
                                        langImg.onload = () => {
                                            localizedImages[lang] = {
                                                image: langImg,
                                                src: langData.src,
                                                name: langData.name || s.name
                                            };
                                            langLoadedCount++;
                                            if (langLoadedCount === langKeys.length) finalizeScreenshot();
                                        };
                                        // A corrupt/dead src must still settle the lang (keep the
                                        // src so a later session can retry) — never leave a hole.
                                        langImg.onerror = () => {
                                            localizedImages[lang] = {
                                                image: null,
                                                src: langData.src,
                                                name: langData.name || s.name
                                            };
                                            langLoadedCount++;
                                            if (langLoadedCount === langKeys.length) finalizeScreenshot();
                                        };
                                        langImg.src = langData.src;
                                    } else {
                                        langLoadedCount++;
                                        if (langLoadedCount === langKeys.length) finalizeScreenshot();
                                    }
                                });
                            } else {
                                // Old format: migrate to localized images
                                const img = new Image();
                                img.onload = () => {
                                    // Detect language from filename, default to 'en'
                                    const detectedLang = typeof detectLanguageFromFilename === 'function'
                                        ? detectLanguageFromFilename(s.name || '')
                                        : 'en';

                                    const localizedImages = {};
                                    localizedImages[detectedLang] = {
                                        image: img,
                                        src: s.src,
                                        name: s.name
                                    };

                                    const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                    if (needs3DMigration) {
                                        migrate3DPosition(screenshotSettings);
                                    }
                                    state.screenshots[index] = {
                                        image: img,
                                        name: s.name,
                                        deviceType: s.deviceType,
                                        localizedImages: localizedImages,
                                        background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                        screenshot: screenshotSettings,
                                        text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                        effects: (typeof withEffectDefaults === 'function') ? withEffectDefaults(s.effects) : (s.effects || null),
                                        elements: reconstructElementImages(s.elements),
                                    extraDevices: reconstructExtraDeviceImages(s.extraDevices),
                                        popouts: s.popouts || [],
                                        groups: s.groups || [],
                                        overrides: s.overrides || {},
                                        animation: s.animation || null
                                    };
                                    loadedCount++;
                                    checkAllLoaded();
                                };
                                // A dead legacy src must still produce a (blank) screenshot entry
                                // — a hole would hide the card and break selection/rendering.
                                img.onerror = () => {
                                    const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                    if (needs3DMigration) migrate3DPosition(screenshotSettings);
                                    state.screenshots[index] = {
                                        image: null,
                                        name: s.name,
                                        deviceType: s.deviceType,
                                        localizedImages: {},
                                        background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                        screenshot: screenshotSettings,
                                        text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                        effects: (typeof withEffectDefaults === 'function') ? withEffectDefaults(s.effects) : (s.effects || null),
                                        elements: reconstructElementImages(s.elements),
                                        extraDevices: reconstructExtraDeviceImages(s.extraDevices),
                                        popouts: s.popouts || [],
                                        groups: s.groups || [],
                                        overrides: s.overrides || {},
                                        animation: s.animation || null
                                    };
                                    loadedCount++;
                                    checkAllLoaded();
                                };
                                img.src = s.src;
                            }
                        });

                        function checkAllLoaded() {
                            if (loadedCount === totalToLoad) {
                                // Belt and braces: never carry holes into the session. A sparse
                                // entry hides its card while still counting in the header, and a
                                // selectedIndex pointing at it renders an empty (background-only)
                                // canvas.
                                if (state.screenshots.length !== totalToLoad || state.screenshots.some(x => !x)) {
                                    state.screenshots = state.screenshots.filter(Boolean);
                                }
                                if (state.selectedIndex >= state.screenshots.length || state.selectedIndex < 0 ||
                                    !state.screenshots[state.selectedIndex]) {
                                    state.selectedIndex = Math.max(0, state.screenshots.length - 1);
                                }
                                // One-time headlines→elements migration before the first render,
                                // then persist (so formatVersion=3 sticks and it won't re-run).
                                if (needsHeadlineMigration) {
                                    state.screenshots.forEach(s => migrateScreenshotHeadlines(s));
                                    if (typeof saveState === 'function') saveState();
                                }
                                updateScreenshotList();
                                syncUIWithState();
                                updateGradientStopsUI();
                                updateCanvas();
                                if (typeof updateTimelineVisibility === 'function') updateTimelineVisibility();

                                if (needsMigration && parsed.screenshots.length > 0) {
                                    showMigrationPrompt();
                                }
                            }
                        }
                    } else {
                        // No screenshots - still need to update UI
                        updateScreenshotList();
                        syncUIWithState();
                        updateGradientStopsUI();
                        updateCanvas();
                    }

                    state.selectedIndex = parsed.selectedIndex || 0;
                    state.outputDevice = parsed.outputDevice || 'iphone-6.9';
                    state.customWidth = parsed.customWidth || 1320;
                    state.customHeight = parsed.customHeight || 2868;

                    // Load global language settings
                    state.currentLanguage = parsed.currentLanguage || 'en';
                    state.projectLanguages = parsed.projectLanguages || ['en'];

                    // Load defaults (new format) or use migrated settings
                    if (parsed.defaults) {
                        state.defaults = parsed.defaults;
                        // Ensure elements array exists (may be missing from older saves)
                        if (!state.defaults.elements) state.defaults.elements = [];
                    } else {
                        state.defaults.background = migratedBackground;
                        state.defaults.screenshot = migratedScreenshot;
                        state.defaults.text = migratedText;
                    }

                    // Rebuild background Image objects from their saved data-URLs
                    state.screenshots.forEach(s => reconstructBackgroundImage(s.background));
                    reconstructBackgroundImage(state.defaults.background);
                } else {
                    // New project, reset to defaults
                    resetStateToDefaults();
                    updateScreenshotList();
                }
                resolve();
            };

            request.onerror = () => {
                console.error('Error loading state:', request.error);
                resolve();
            };
        } catch (e) {
            console.error('Error loading state:', e);
            resolve();
        }
    });
}

// Show migration prompt for old-style projects
function showMigrationPrompt() {
    const modal = document.getElementById('migration-modal');
    if (modal) {
        modal.classList.add('visible');
    }
}

function hideMigrationPrompt() {
    const modal = document.getElementById('migration-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
}

function convertProject() {
    // Project is already converted in memory, just save it
    saveState();
    hideMigrationPrompt();
}

// Reset state to defaults (without clearing storage)
function resetStateToDefaults() {
    state.screenshots = [];
    state.selectedIndex = 0;
    state.outputDevice = 'iphone-6.9';
    state.customWidth = 1320;
    state.customHeight = 2868;
    state.currentLanguage = 'en';
    state.projectLanguages = ['en'];
    state.defaults = {
        background: {
            type: 'gradient',
            gradient: {
                angle: 135,
                stops: [
                    { color: '#667eea', position: 0 },
                    { color: '#764ba2', position: 100 }
                ]
            },
            solid: '#1a1a2e',
            image: null,
            imageFit: 'cover',
            imageBlur: 0,
            overlayColor: '#000000',
            overlayOpacity: 0,
            noise: false,
            noiseIntensity: 10
        },
        screenshot: {
            scale: 70,
            y: 60,
            x: 50,
            rotation: 0,
            perspective: 0,
            cornerRadius: 24,
            frameStyle: 'none',
            shadow: {
                enabled: true,
                style: 'drop',
                color: '#000000',
                blur: 40,
                opacity: 30,
                x: 0,
                y: 20,
                lightAngle: 40,   // 3D wall-shadow direction (azimuth degrees)
                lightElev: 0.65   // 3D light elevation (0 = overhead, 1 = grazing)
            },
            frame: {
                enabled: false,
                color: '#1d1d1f',
                width: 12,
                opacity: 100
            }
        },
        text: {
            headlineEnabled: true,
            headlines: { en: '' },
            headlineLanguages: ['en'],
            currentHeadlineLang: 'en',
            headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            headlineSize: 100,
            headlineWeight: '600',
            headlineItalic: false,
            headlineUnderline: false,
            headlineStrikethrough: false,
            headlineColor: '#ffffff',
            headlineOpacity: 100,
            perLanguageLayout: false,
            languageSettings: {
                en: {
                    headlineSize: 100,
                    subheadlineSize: 50,
                    position: 'top',
                    offsetY: 12,
                    lineHeight: 110
                }
            },
            currentLayoutLang: 'en',
            position: 'top',
            offsetX: 0,
            offsetY: 12,
            lineHeight: 110,
            subheadlineEnabled: false,
            subheadlines: { en: '' },
            subheadlineLanguages: ['en'],
            currentSubheadlineLang: 'en',
            subheadlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            subheadlineSize: 50,
            subheadlineWeight: '400',
            subheadlineItalic: false,
            subheadlineUnderline: false,
            subheadlineStrikethrough: false,
            subheadlineColor: '#ffffff',
            subheadlineOpacity: 70
        }
    };
}

// Switch to a different project
async function switchProject(projectId, skipSave = false) {
    // Save current project first — UNLESS the caller just deleted the current
    // project (deleteProject), in which case saving would re-create the deleted
    // doc as an orphan, since currentProjectId still points at it here.
    if (!skipSave) saveState();

    currentProjectId = projectId;
    saveProjectsMeta();

    // Reset and load new project
    resetStateToDefaults();
    await loadState();

    syncUIWithState();
    updateScreenshotList();
    updateGradientStopsUI();
    updateProjectSelector();
    updateCanvas();
    resetHistory(); // undo history is per-project; start fresh after a switch
}

// Create a new project
async function createProject(name) {
    const id = 'project_' + Date.now();
    projects.push({ id, name, screenshotCount: 0 });
    saveProjectsMeta();
    await switchProject(id);
    updateProjectSelector();
}

// Rename current project
function renameProject(newName) {
    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        project.name = newName;
        saveProjectsMeta();
        updateProjectSelector();
    }
}

// Delete current project
async function deleteProject() {
    if (projects.length <= 1) {
        await showAppAlert('Cannot delete the only project', 'info');
        return;
    }

    // Remove from projects list
    const index = projects.findIndex(p => p.id === currentProjectId);
    if (index > -1) {
        projects.splice(index, 1);
    }

    // Delete from IndexedDB
    if (db) {
        const transaction = db.transaction([PROJECTS_STORE], 'readwrite');
        const store = transaction.objectStore(PROJECTS_STORE);
        store.delete(currentProjectId);
    }

    // Switch to first available project. skipSave=true: the current project's doc
    // was just deleted above, so we must NOT let switchProject's leading saveState
    // re-write it (which previously left an orphan doc in the store).
    saveProjectsMeta();
    await switchProject(projects[0].id, true);
    updateProjectSelector();
}

async function duplicateProject(sourceProjectId, customName) {
    if (!db) return;

    const transaction = db.transaction([PROJECTS_STORE], 'readonly');
    const store = transaction.objectStore(PROJECTS_STORE);
    const request = store.get(sourceProjectId);

    return new Promise((resolve) => {
        request.onsuccess = async () => {
            const projectData = request.result;
            if (!projectData) {
                await showAppAlert('Could not read project data', 'error');
                resolve();
                return;
            }

            const newId = 'project_' + Date.now();
            const sourceProject = projects.find(p => p.id === sourceProjectId);
            const newName = customName || (sourceProject ? sourceProject.name : 'Project') + ' (Copy)';

            const clonedData = JSON.parse(JSON.stringify(projectData));
            clonedData.id = newId;

            projects.push({ id: newId, name: newName, screenshotCount: clonedData.screenshots?.length || 0 });
            saveProjectsMeta();

            const writeTransaction = db.transaction([PROJECTS_STORE], 'readwrite');
            const writeStore = writeTransaction.objectStore(PROJECTS_STORE);
            writeStore.put(clonedData);

            writeTransaction.oncomplete = async () => {
                await switchProject(newId);
                updateProjectSelector();
                resolve();
            };
        };
    });
}

function duplicateScreenshot(index) {
    const original = state.screenshots[index];
    if (!original) return;

    const clone = JSON.parse(JSON.stringify({
        name: original.name,
        deviceType: original.deviceType,
        background: original.background,
        screenshot: original.screenshot,
        text: original.text,
        overrides: original.overrides
    }));

    const nameParts = clone.name.split('.');
    if (nameParts.length > 1) {
        const ext = nameParts.pop();
        clone.name = nameParts.join('.') + ' (Copy).' + ext;
    } else {
        clone.name = clone.name + ' (Copy)';
    }

    clone.localizedImages = {};
    if (original.localizedImages) {
        Object.keys(original.localizedImages).forEach(lang => {
            const langData = original.localizedImages[lang];
            if (langData?.src) {
                const img = new Image();
                img.src = langData.src;
                clone.localizedImages[lang] = {
                    image: img,
                    src: langData.src,
                    name: langData.name
                };
            }
        });
    }

    if (original.image?.src) {
        const img = new Image();
        img.src = original.image.src;
        clone.image = img;
    }

    state.screenshots.splice(index + 1, 0, clone);
    state.selectedIndex = index + 1;

    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    updateCanvas();
}

// Populate frame color swatches for the given device and highlight the active one
function updateFrameColorSwatches(deviceType, activeColorId) {
    const container = document.getElementById('frame-color-swatches');
    if (!container) return;

    const presets = typeof frameColorPresets !== 'undefined' ? frameColorPresets[deviceType] : null;
    if (!presets) {
        container.innerHTML = '';
        return;
    }

    // Default to first preset if none specified
    if (!activeColorId) activeColorId = presets[0].id;

    container.innerHTML = presets.map(p =>
        `<div class="frame-color-swatch${p.id === activeColorId ? ' active' : ''}" ` +
        `data-color-id="${p.id}" title="${p.label}" ` +
        `style="background: ${p.swatch}"></div>`
    ).join('');

    // Attach click handlers
    container.querySelectorAll('.frame-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const colorId = swatch.dataset.colorId;
            container.querySelectorAll('.frame-color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');

            setScreenshotSetting('frameColor', colorId);

            if (typeof setPhoneFrameColor === 'function') {
                setPhoneFrameColor(colorId, deviceType);
            }

            updateCanvas();
        });
    });
}

// Sync UI controls with current state
// Maps each animatable property path to its sidebar slider, so we can flag which
// controls are animated and light them up when the playhead sits on a keyframe.
const ANIM_CONTROL_MAP = {
    'screenshot.scale':        'screenshot-scale',
    'screenshot.x':            'screenshot-x',
    'screenshot.y':            'screenshot-y',
    'screenshot.rotation3D.x': 'rotation-3d-x',
    'screenshot.rotation3D.y': 'rotation-3d-y',
    'screenshot.rotation3D.z': 'rotation-3d-z'
    // Text is now element-based; element tracks light up via the element controls.
};

// Flag animated controls (have keyframes) and highlight the ones whose keyframe is at
// the current playhead — so you can see what's being manipulated and watch properties
// light up as you scrub/play. Called from syncUIWithState and the timeline tick.
function updateAnimatedControlIndicators() {
    const entry = getCurrentScreenshot();
    const tracks = (entry && entry.animation && entry.animation.tracks) || [];
    const time = (typeof timeline !== 'undefined' && timeline) ? timeline.time : 0;
    Object.keys(ANIM_CONTROL_MAP).forEach(path => {
        const slider = document.getElementById(ANIM_CONTROL_MAP[path]);
        const group = slider && slider.closest('.control-group');
        if (!group) return;
        const track = tracks.find(t => t.path === path);
        const animated = !!(track && track.keyframes && track.keyframes.length);
        const onKey = animated && track.keyframes.some(k => Math.abs(k.t - time) < 0.05);
        group.classList.toggle('is-animated', animated);
        group.classList.toggle('is-keyed-now', !!onKey);
    });
}

// Reflect an effect section's enabled state into its toggle + collapsible options,
// matching the Noise/Shadow expand-when-on behavior.
function syncEffectToggleRow(toggleId, optionsId, enabled) {
    const toggle = document.getElementById(toggleId);
    if (toggle) toggle.classList.toggle('active', !!enabled);
    const row = toggle ? toggle.closest('.toggle-row') : null;
    if (row) row.classList.toggle('collapsed', !enabled);
    const opts = document.getElementById(optionsId);
    if (opts) opts.style.display = enabled ? 'block' : 'none';
}

// Push the current screenshot's effects object into all Effects-tab controls.
function syncEffectsUI() {
    const fx = getEffects();
    if (!fx) return;
    const setR = (id, val, suffix) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
        const lab = document.getElementById(id + '-value');
        if (lab) lab.textContent = formatValue(val) + (suffix || '');
    };
    const setV = (id, val) => { const el = document.getElementById(id); if (el && val != null) el.value = val; };

    syncEffectToggleRow('fx-colorgrade-toggle', 'fx-colorgrade-options', fx.colorGrade.enabled);
    setR('fx-cg-temp', fx.colorGrade.temperature, '');
    setR('fx-cg-tint', fx.colorGrade.tint, '');
    setR('fx-cg-sat', fx.colorGrade.saturation, '');
    setR('fx-cg-bright', fx.colorGrade.brightness, '');
    setR('fx-cg-contrast', fx.colorGrade.contrast, '');

    syncEffectToggleRow('fx-gobo-toggle', 'fx-gobo-options', fx.gobo.enabled);
    setV('fx-gobo-pattern', fx.gobo.pattern);
    setR('fx-gobo-intensity', fx.gobo.intensity, '%');
    setR('fx-gobo-scale', fx.gobo.scale, '%');
    setR('fx-gobo-angle', fx.gobo.angle, '°');
    setR('fx-gobo-blur', fx.gobo.blur, 'px');
    setR('fx-gobo-x', fx.gobo.x, '%');
    setR('fx-gobo-y', fx.gobo.y, '%');

    syncEffectToggleRow('fx-bloom-toggle', 'fx-bloom-options', fx.bloom.enabled);
    setR('fx-bloom-intensity', fx.bloom.intensity, '%');
    setR('fx-bloom-threshold', fx.bloom.threshold, '%');
    setR('fx-bloom-radius', fx.bloom.radius, 'px');

    syncEffectToggleRow('fx-leak-toggle', 'fx-leak-options', fx.lightLeak.enabled);
    setR('fx-leak-intensity', fx.lightLeak.intensity, '%');
    setV('fx-leak-color', fx.lightLeak.color);
    setV('fx-leak-position', fx.lightLeak.position);

    syncEffectToggleRow('fx-vignette-toggle', 'fx-vignette-options', fx.vignette.enabled);
    setR('fx-vignette-amount', fx.vignette.amount, '%');
    setR('fx-vignette-softness', fx.vignette.softness, '%');
    setV('fx-vignette-color', fx.vignette.color);

    if (fx.motionBlur) {
        syncEffectToggleRow('fx-mblur-toggle', 'fx-mblur-options', fx.motionBlur.enabled);
        setR('fx-mblur-amount', fx.motionBlur.amount, '%');
        setR('fx-mblur-samples', fx.motionBlur.samples, '');
    }
}

function syncUIWithState() {
    // Update language button
    updateLanguageButton();

    // Device selector dropdown
    document.querySelectorAll('.output-size-menu .device-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.device === state.outputDevice);
    });

    // Update dropdown trigger text
    const selectedOption = document.querySelector(`.output-size-menu .device-option[data-device="${state.outputDevice}"]`);
    if (selectedOption) {
        document.getElementById('output-size-name').textContent = selectedOption.querySelector('.device-option-name').textContent;
        if (state.outputDevice === 'custom') {
            document.getElementById('output-size-dims').textContent = `${state.customWidth} × ${state.customHeight}`;
        } else {
            document.getElementById('output-size-dims').textContent = selectedOption.querySelector('.device-option-size').textContent;
        }
    }

    // Show/hide custom inputs
    const customInputs = document.getElementById('custom-size-inputs');
    customInputs.classList.toggle('visible', state.outputDevice === 'custom');
    document.getElementById('custom-width').value = state.customWidth;
    document.getElementById('custom-height').value = state.customHeight;

    // Get current screenshot's settings
    const bg = getBackground();
    const ss = getScreenshotSettings();
    const txt = getText();

    // Background type
    document.querySelectorAll('#bg-type-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === bg.type);
    });
    document.getElementById('gradient-options').style.display = bg.type === 'gradient' ? 'block' : 'none';
    document.getElementById('solid-options').style.display = bg.type === 'solid' ? 'block' : 'none';
    document.getElementById('image-options').style.display = bg.type === 'image' ? 'block' : 'none';

    // Gradient
    document.getElementById('gradient-angle').value = bg.gradient.angle;
    document.getElementById('gradient-angle-value').textContent = formatValue(bg.gradient.angle) + '°';
    updateGradientStopsUI();

    // Solid color
    document.getElementById('solid-color').value = bg.solid;
    document.getElementById('solid-color-hex').value = bg.solid;

    // Image background
    const bgImagePreview = document.getElementById('bg-image-preview');
    if (bgImagePreview) {
        const bgSrc = bg.image?.src || bg.imageSrc || '';
        if (bgSrc) {
            bgImagePreview.src = bgSrc;
            bgImagePreview.style.display = 'block';
        } else {
            bgImagePreview.removeAttribute('src');
            bgImagePreview.style.display = 'none';
        }
    }
    document.getElementById('bg-image-fit').value = bg.imageFit;
    document.getElementById('bg-blur').value = bg.imageBlur;
    document.getElementById('bg-blur-value').textContent = formatValue(bg.imageBlur) + 'px';
    document.getElementById('bg-overlay-color').value = bg.overlayColor;
    document.getElementById('bg-overlay-hex').value = bg.overlayColor;
    document.getElementById('bg-overlay-opacity').value = bg.overlayOpacity;
    document.getElementById('bg-overlay-opacity-value').textContent = formatValue(bg.overlayOpacity) + '%';

    // Noise (now lives in the Effects tab, but its state stays on the background object)
    document.getElementById('noise-toggle').classList.toggle('active', bg.noise);
    syncEffectToggleRow('noise-toggle', 'noise-options', bg.noise);
    document.getElementById('noise-intensity').value = bg.noiseIntensity;
    document.getElementById('noise-intensity-value').textContent = formatValue(bg.noiseIntensity) + '%';

    // Effects tab
    syncEffectsUI();

    // Screenshot settings
    document.getElementById('screenshot-scale').value = ss.scale;
    document.getElementById('screenshot-scale-value').textContent = formatValue(ss.scale) + '%';
    document.getElementById('screenshot-y').value = ss.y;
    document.getElementById('screenshot-y-value').textContent = formatValue(ss.y) + '%';
    document.getElementById('screenshot-x').value = ss.x;
    document.getElementById('screenshot-x-value').textContent = formatValue(ss.x) + '%';
    document.getElementById('corner-radius').value = ss.cornerRadius;
    document.getElementById('corner-radius-value').textContent = formatValue(ss.cornerRadius) + 'px';
    const frameStyleSelectSync = document.getElementById('frame-style-select');
    if (frameStyleSelectSync) frameStyleSelectSync.value = ss.frameStyle || 'none';
    document.getElementById('screenshot-rotation').value = ss.rotation;
    document.getElementById('screenshot-rotation-value').textContent = formatValue(ss.rotation) + '°';

    // Shadow
    document.getElementById('shadow-toggle').classList.toggle('active', ss.shadow.enabled);
    document.getElementById('shadow-style').value = ss.shadow.style || 'drop';
    // 3D wall-shadow controls (share shadow.blur=softness, shadow.opacity=strength)
    const sh3dToggle = document.getElementById('shadow-3d-toggle');
    if (sh3dToggle) {
        sh3dToggle.classList.toggle('active', ss.shadow.enabled !== false);
        const sft = document.getElementById('shadow-3d-softness');
        const str = document.getElementById('shadow-3d-strength');
        if (sft) { sft.value = ss.shadow.blur; document.getElementById('shadow-3d-softness-value').textContent = formatValue(ss.shadow.blur) + '%'; }
        if (str) { str.value = ss.shadow.opacity; document.getElementById('shadow-3d-strength-value').textContent = formatValue(ss.shadow.opacity) + '%'; }
        positionLightDirHandle(
            typeof ss.shadow.lightAngle === 'number' ? ss.shadow.lightAngle : 40,
            typeof ss.shadow.lightElev === 'number' ? ss.shadow.lightElev : 0.65
        );
    }
    document.getElementById('shadow-color').value = ss.shadow.color;
    document.getElementById('shadow-color-hex').value = ss.shadow.color;
    document.getElementById('shadow-blur').value = ss.shadow.blur;
    document.getElementById('shadow-blur-value').textContent = formatValue(ss.shadow.blur) + 'px';
    document.getElementById('shadow-opacity').value = ss.shadow.opacity;
    document.getElementById('shadow-opacity-value').textContent = formatValue(ss.shadow.opacity) + '%';
    document.getElementById('shadow-x').value = ss.shadow.x;
    document.getElementById('shadow-x-value').textContent = formatValue(ss.shadow.x) + 'px';
    document.getElementById('shadow-y').value = ss.shadow.y;
    document.getElementById('shadow-y-value').textContent = formatValue(ss.shadow.y) + 'px';

    // Frame/Border
    document.getElementById('frame-toggle').classList.toggle('active', ss.frame.enabled);
    document.getElementById('frame-color').value = ss.frame.color;
    document.getElementById('frame-color-hex').value = ss.frame.color;
    document.getElementById('frame-width').value = ss.frame.width;
    document.getElementById('frame-width-value').textContent = formatValue(ss.frame.width) + 'px';
    document.getElementById('frame-opacity').value = ss.frame.opacity;
    document.getElementById('frame-opacity-value').textContent = formatValue(ss.frame.opacity) + '%';

    // (Text-tab sync removed — headline/subheadline are text elements now.)

    // 3D mode
    const use3D = ss.use3D || false;
    const device3D = ss.device3D || 'iphone';
    const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
    document.querySelectorAll('#device-type-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === (use3D ? '3d' : '2d'));
    });
    document.querySelectorAll('#device-3d-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.model === device3D);
    });
    updateFrameColorSwatches(device3D, ss.frameColor);
    document.getElementById('rotation-3d-options').style.display = use3D ? 'block' : 'none';
    document.getElementById('rotation-3d-x').value = rotation3D.x;
    document.getElementById('rotation-3d-x-value').textContent = formatValue(rotation3D.x) + '°';
    document.getElementById('rotation-3d-y').value = rotation3D.y;
    document.getElementById('rotation-3d-y-value').textContent = formatValue(rotation3D.y) + '°';
    document.getElementById('rotation-3d-z').value = rotation3D.z;
    document.getElementById('rotation-3d-z-value').textContent = formatValue(rotation3D.z) + '°';
    if (typeof updatePoseChipActive === 'function') updatePoseChipActive();

    // Hide 2D-only settings in 3D mode, show 3D tip
    document.getElementById('2d-only-settings').style.display = use3D ? 'none' : 'block';
    document.getElementById('position-presets-section').style.display = use3D ? 'none' : 'block';
    document.getElementById('frame-color-section').style.display = use3D ? 'block' : 'none';
    const shadow3dSection = document.getElementById('shadow-3d-section');
    if (shadow3dSection) shadow3dSection.style.display = use3D ? 'block' : 'none';
    document.getElementById('3d-tip').style.display = use3D ? 'flex' : 'none';

    // Show/hide 3D renderer and switch model if needed
    if (typeof showThreeJS === 'function') {
        showThreeJS(use3D);
    }
    if (use3D && typeof switchPhoneModel === 'function') {
        switchPhoneModel(device3D);
    }

    // Elements / Popouts — only drop the selection if the selected item no longer
    // exists in this screenshot (e.g. after switching screenshots). Plain UI syncs
    // (like a timeline scrub) must NOT clear it, or you can't keyframe the selection.
    const screenshotForSel = getCurrentScreenshot();
    if (selectedElementId && !(screenshotForSel?.elements || []).some(e => e.id === selectedElementId)) {
        setSelectedElement(null);
    }
    updateElementsList();
    updateElementProperties();

    if (selectedPopoutId && !(screenshotForSel?.popouts || []).some(p => p.id === selectedPopoutId)) {
        selectedPopoutId = null;
    }
    updatePopoutsList();
    updatePopoutProperties();

    // Extra devices belong to the current screenshot — drop a stale selection that
    // doesn't exist here, then refresh the list + properties panel.
    if (selectedExtraDeviceId && !(screenshotForSel?.extraDevices || []).some(d => d.id === selectedExtraDeviceId)) {
        selectedExtraDeviceId = null;
    }
    updateExtraDevicesList();
    updateExtraDeviceProperties();

    // Groups are per-screenshot too — drop a selection that doesn't exist here.
    if (selectedGroupId && !(screenshotForSel?.groups || []).some(g => g.id === selectedGroupId)) {
        selectedGroupId = null;
    }
    if (typeof updateGroupsList === 'function') updateGroupsList();

    // Animation timeline panel (shows for any selected screenshot). Skip while the
    // timeline is actively playing to avoid rebuilding track DOM every frame.
    if (typeof updateTimelineVisibility === 'function'
        && !(typeof timeline !== 'undefined' && timeline.playing)) {
        updateTimelineVisibility();
    }

    updateAnimatedControlIndicators();
}

// ===== Elements Tab UI =====

function updateElementsList() {
    // Element set may have changed — keep the timeline track dropdown in sync.
    if (typeof populateAddTrackDropdown === 'function') populateAddTrackDropdown();
    // Groups live in the same tab and reference elements by id — keep them fresh.
    if (typeof updateGroupsList === 'function') updateGroupsList();

    const listEl = document.getElementById('elements-list');
    const emptyEl = document.getElementById('elements-empty');
    if (!listEl) return;

    const elements = getElements();

    // Remove old items (keep the empty message)
    listEl.querySelectorAll('.element-item').forEach(el => el.remove());

    if (elements.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    elements.forEach(el => {
        const item = document.createElement('div');
        item.className = 'element-item' + (el.id === selectedElementId ? ' selected' : '');
        item.dataset.elementId = el.id;

        const layerLabels = {
            'behind-screenshot': 'Behind',
            'above-screenshot': 'Middle',
            'above-text': 'Front'
        };

        let thumbContent;
        if (el.type === 'graphic' && el.image) {
            thumbContent = `<img src="${el.image.src}" alt="${el.name}">`;
        } else if (el.type === 'emoji') {
            thumbContent = `<span class="emoji-thumb">${el.emoji}</span>`;
        } else if (el.type === 'icon' && el.image) {
            thumbContent = `<img src="${el.image.src}" alt="${el.name}" style="padding: 4px; filter: var(--icon-thumb-filter, none);">`;
        } else {
            thumbContent = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
            </svg>`;
        }

        item.innerHTML = `
            <div class="element-item-thumb">${thumbContent}</div>
            <div class="element-item-info">
                <div class="element-item-name">${el.type === 'text' ? (getElementText(el) || 'Text') : el.type === 'emoji' ? `${el.emoji} ${el.name}` : el.name}</div>
                <div class="element-item-layer">${layerLabels[el.layer] || el.layer}</div>
            </div>
            <div class="element-item-actions">
                <button class="element-item-btn" data-action="move-up" title="Move up">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button class="element-item-btn" data-action="move-down" title="Move down">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button class="element-item-btn danger" data-action="delete" title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;

        // Click to select
        item.addEventListener('click', (e) => {
            if (e.target.closest('.element-item-btn')) return;
            setSelectedElement(el.id);
            updateElementsList();
            updateElementProperties();
        });

        // Action buttons
        item.querySelectorAll('.element-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'delete') deleteElement(el.id);
                else if (action === 'move-up') moveElementLayer(el.id, 'up');
                else if (action === 'move-down') moveElementLayer(el.id, 'down');
            });
        });

        listEl.appendChild(item);
    });
}

function updateElementProperties() {
    const propsEl = document.getElementById('element-properties');
    if (!propsEl) return;

    const el = getSelectedElement();
    if (!el) {
        propsEl.style.display = 'none';
        return;
    }

    propsEl.style.display = '';
    const titleMap = { text: 'Text Element', emoji: `${el.emoji} Emoji`, icon: `Icon: ${el.name}`, graphic: el.name || 'Graphic' };
    document.getElementById('element-properties-title').textContent = titleMap[el.type] || el.name || 'Element';

    document.getElementById('element-layer').value = el.layer;
    document.getElementById('element-x').value = el.x;
    document.getElementById('element-x-value').textContent = formatValue(el.x) + '%';
    document.getElementById('element-y').value = el.y;
    document.getElementById('element-y-value').textContent = formatValue(el.y) + '%';
    document.getElementById('element-width').value = el.width;
    document.getElementById('element-width-value').textContent = formatValue(el.width) + '%';
    document.getElementById('element-rotation').value = el.rotation;
    document.getElementById('element-rotation-value').textContent = formatValue(el.rotation) + '°';
    document.getElementById('element-opacity').value = el.opacity;
    document.getElementById('element-opacity-value').textContent = formatValue(el.opacity) + '%';

    // Type-specific properties
    const textProps = document.getElementById('element-text-properties');
    const iconProps = document.getElementById('element-icon-properties');

    // Hide all type-specific panels first
    textProps.style.display = 'none';
    if (iconProps) iconProps.style.display = 'none';

    if (el.type === 'text') {
        textProps.style.display = '';
        document.getElementById('element-text-input').value = getElementText(el);
        document.getElementById('element-font').value = el.font;
        updateElementFontPickerPreview(el);
        document.getElementById('element-font-size').value = el.fontSize;
        document.getElementById('element-font-color').value = el.fontColor;
        document.getElementById('element-font-weight').value = el.fontWeight;
        document.getElementById('element-italic-btn').classList.toggle('active', el.italic);
        document.getElementById('element-frame').value = el.frame || 'none';
        const frameOpts = document.getElementById('element-frame-options');
        frameOpts.style.display = el.frame && el.frame !== 'none' ? '' : 'none';
        if (el.frame && el.frame !== 'none') {
            document.getElementById('element-frame-color').value = el.frameColor;
            document.getElementById('element-frame-color-hex').value = el.frameColor;
            document.getElementById('element-frame-scale').value = el.frameScale;
            document.getElementById('element-frame-scale-value').textContent = formatValue(el.frameScale) + '%';
        }
        // Stroke / shadow / bubble / reveal controls for this text element.
        if (typeof syncElementTextEffectsUI === 'function') syncElementTextEffectsUI(el);
    } else if (el.type === 'icon' && iconProps) {
        iconProps.style.display = '';
        document.getElementById('element-icon-color').value = el.iconColor || '#ffffff';
        document.getElementById('element-icon-color-hex').value = el.iconColor || '#ffffff';
        document.getElementById('element-icon-stroke-width').value = el.iconStrokeWidth || 2;
        document.getElementById('element-icon-stroke-width-value').textContent = el.iconStrokeWidth || 2;
        // Shadow
        const shadow = el.iconShadow || { enabled: false, color: '#000000', blur: 20, opacity: 40, x: 0, y: 10 };
        const shadowToggle = document.getElementById('element-icon-shadow-toggle');
        const shadowOpts = document.getElementById('element-icon-shadow-options');
        const shadowRow = shadowToggle?.closest('.toggle-row');
        if (shadowToggle) shadowToggle.classList.toggle('active', shadow.enabled);
        if (shadowRow) shadowRow.classList.toggle('collapsed', !shadow.enabled);
        if (shadowOpts) shadowOpts.style.display = shadow.enabled ? '' : 'none';
        document.getElementById('element-icon-shadow-color').value = shadow.color;
        document.getElementById('element-icon-shadow-color-hex').value = shadow.color;
        document.getElementById('element-icon-shadow-blur').value = shadow.blur;
        document.getElementById('element-icon-shadow-blur-value').textContent = shadow.blur + 'px';
        document.getElementById('element-icon-shadow-opacity').value = shadow.opacity;
        document.getElementById('element-icon-shadow-opacity-value').textContent = shadow.opacity + '%';
        document.getElementById('element-icon-shadow-x').value = shadow.x;
        document.getElementById('element-icon-shadow-x-value').textContent = shadow.x + 'px';
        document.getElementById('element-icon-shadow-y').value = shadow.y;
        document.getElementById('element-icon-shadow-y-value').textContent = shadow.y + 'px';
    }
}

function setupElementEventListeners() {
    // Add Graphic button
    const addGraphicBtn = document.getElementById('add-graphic-btn');
    const graphicInput = document.getElementById('element-graphic-input');
    if (addGraphicBtn && graphicInput) {
        addGraphicBtn.addEventListener('click', () => graphicInput.click());
        graphicInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    addGraphicElement(img, ev.target.result, file.name);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            graphicInput.value = '';
        });
    }

    // Add Text button
    const addTextBtn = document.getElementById('add-text-element-btn');
    if (addTextBtn) {
        addTextBtn.addEventListener('click', () => addTextElement());
    }

    // Add Emoji button
    const addEmojiBtn = document.getElementById('add-emoji-btn');
    if (addEmojiBtn) {
        addEmojiBtn.addEventListener('click', () => showEmojiPicker());
    }

    // Add Icon button
    const addIconBtn = document.getElementById('add-icon-btn');
    if (addIconBtn) {
        addIconBtn.addEventListener('click', () => showIconPicker());
    }

    // Icon color picker
    const iconColor = document.getElementById('element-icon-color');
    const iconColorHex = document.getElementById('element-icon-color-hex');
    if (iconColor) {
        iconColor.addEventListener('input', () => {
            const el = getSelectedElement();
            if (el && el.type === 'icon') {
                el.iconColor = iconColor.value;
                if (iconColorHex) iconColorHex.value = iconColor.value;
                updateIconImage(el);
            }
        });
    }
    if (iconColorHex) {
        iconColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(iconColorHex.value)) {
                const el = getSelectedElement();
                if (el && el.type === 'icon') {
                    el.iconColor = iconColorHex.value;
                    if (iconColor) iconColor.value = iconColorHex.value;
                    updateIconImage(el);
                }
            }
        });
    }

    // Icon stroke width
    const iconStroke = document.getElementById('element-icon-stroke-width');
    const iconStrokeVal = document.getElementById('element-icon-stroke-width-value');
    if (iconStroke) {
        iconStroke.addEventListener('input', () => {
            const val = parseFloat(iconStroke.value);
            if (iconStrokeVal) iconStrokeVal.textContent = val;
            const el = getSelectedElement();
            if (el && el.type === 'icon') {
                el.iconStrokeWidth = val;
                updateIconImage(el);
            }
        });
    }

    // Icon shadow toggle
    const iconShadowToggle = document.getElementById('element-icon-shadow-toggle');
    if (iconShadowToggle) {
        iconShadowToggle.addEventListener('click', () => {
            const el = getSelectedElement();
            if (!el || el.type !== 'icon') return;
            if (!el.iconShadow) el.iconShadow = { enabled: false, color: '#000000', blur: 20, opacity: 40, x: 0, y: 10 };
            el.iconShadow.enabled = !el.iconShadow.enabled;
            updateElementProperties();
            updateCanvas();
        });
    }

    // Icon shadow property helpers
    const bindIconShadow = (inputId, prop, suffix) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(inputId + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const el = getSelectedElement();
            if (!el || el.type !== 'icon' || !el.iconShadow) return;
            el.iconShadow[prop] = parseFloat(input.value);
            if (valEl) valEl.textContent = input.value + suffix;
            updateCanvas();
        });
    };
    bindIconShadow('element-icon-shadow-blur', 'blur', 'px');
    bindIconShadow('element-icon-shadow-opacity', 'opacity', '%');
    bindIconShadow('element-icon-shadow-x', 'x', 'px');
    bindIconShadow('element-icon-shadow-y', 'y', 'px');

    // Icon shadow color
    const iconShadowColor = document.getElementById('element-icon-shadow-color');
    const iconShadowColorHex = document.getElementById('element-icon-shadow-color-hex');
    if (iconShadowColor) {
        iconShadowColor.addEventListener('input', () => {
            const el = getSelectedElement();
            if (el?.type === 'icon' && el.iconShadow) {
                el.iconShadow.color = iconShadowColor.value;
                if (iconShadowColorHex) iconShadowColorHex.value = iconShadowColor.value;
                updateCanvas();
            }
        });
    }
    if (iconShadowColorHex) {
        iconShadowColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(iconShadowColorHex.value)) {
                const el = getSelectedElement();
                if (el?.type === 'icon' && el.iconShadow) {
                    el.iconShadow.color = iconShadowColorHex.value;
                    if (iconShadowColor) iconShadowColor.value = iconShadowColorHex.value;
                    updateCanvas();
                }
            }
        });
    }

    // Property sliders
    const bindSlider = (id, prop, suffix, parser) => {
        const input = document.getElementById(id);
        const valueEl = document.getElementById(id + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parser ? parser(input.value) : parseFloat(input.value);
            if (valueEl) valueEl.textContent = formatValue(val) + suffix;
            if (selectedElementId) setElementProperty(selectedElementId, prop, val);
        });
    };

    bindSlider('element-x', 'x', '%');
    bindSlider('element-y', 'y', '%');
    bindSlider('element-width', 'width', '%');
    bindSlider('element-rotation', 'rotation', '°');
    bindSlider('element-opacity', 'opacity', '%');
    bindSlider('element-font-size', 'fontSize', '', parseInt);
    bindSlider('element-frame-scale', 'frameScale', '%');

    // Layer dropdown
    const layerSelect = document.getElementById('element-layer');
    if (layerSelect) {
        layerSelect.addEventListener('change', () => {
            if (selectedElementId) {
                setElementProperty(selectedElementId, 'layer', layerSelect.value);
            }
        });
    }

    // Text input
    const textInput = document.getElementById('element-text-input');
    if (textInput) {
        textInput.addEventListener('input', () => {
            if (!selectedElementId) return;
            const el = getSelectedElement();
            if (!el) return;
            if (!el.texts) el.texts = {};
            el.texts[state.currentLanguage] = textInput.value;
            el.text = textInput.value; // sync for backwards compat
            updateCanvas();
            updateElementsList();
        });
    }

    // Font color
    const fontColor = document.getElementById('element-font-color');
    if (fontColor) {
        fontColor.addEventListener('input', () => {
            if (selectedElementId) setElementProperty(selectedElementId, 'fontColor', fontColor.value);
        });
    }

    // Font weight
    const fontWeight = document.getElementById('element-font-weight');
    if (fontWeight) {
        fontWeight.addEventListener('change', () => {
            if (selectedElementId) setElementProperty(selectedElementId, 'fontWeight', fontWeight.value);
        });
    }

    // Italic button
    const italicBtn = document.getElementById('element-italic-btn');
    if (italicBtn) {
        italicBtn.addEventListener('click', () => {
            const el = getSelectedElement();
            if (el) {
                setElementProperty(el.id, 'italic', !el.italic);
                italicBtn.classList.toggle('active', el.italic);
            }
        });
    }

    // Frame dropdown
    const frameSelect = document.getElementById('element-frame');
    if (frameSelect) {
        frameSelect.addEventListener('change', () => {
            if (selectedElementId) {
                setElementProperty(selectedElementId, 'frame', frameSelect.value);
                document.getElementById('element-frame-options').style.display =
                    frameSelect.value !== 'none' ? '' : 'none';
            }
        });
    }

    // Frame color
    const frameColor = document.getElementById('element-frame-color');
    const frameColorHex = document.getElementById('element-frame-color-hex');
    if (frameColor) {
        frameColor.addEventListener('input', () => {
            if (selectedElementId) {
                setElementProperty(selectedElementId, 'frameColor', frameColor.value);
                if (frameColorHex) frameColorHex.value = frameColor.value;
            }
        });
    }
    if (frameColorHex) {
        frameColorHex.addEventListener('change', () => {
            if (selectedElementId && /^#[0-9a-fA-F]{6}$/.test(frameColorHex.value)) {
                setElementProperty(selectedElementId, 'frameColor', frameColorHex.value);
                if (frameColor) frameColor.value = frameColorHex.value;
            }
        });
    }

    // Canvas drag interaction for elements
    setupElementCanvasDrag();
}

function setupElementCanvasDrag() {
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const previewCanvas = document.getElementById('preview-canvas');
    if (!previewCanvas) return;

    // Snap guides state
    const SNAP_THRESHOLD = 1.5; // percentage units (of canvas width/height)
    let activeSnapGuides = { x: null, y: null }; // which guides are active

    function getCanvasCoords(e) {
        const rect = previewCanvas.getBoundingClientRect();
        const scaleX = previewCanvas.width / rect.width;
        const scaleY = previewCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function snapToGuides(x, y) {
        const snapped = { x, y };
        activeSnapGuides = { x: null, y: null };

        // Snap to horizontal center (x = 50%)
        if (Math.abs(x - 50) < SNAP_THRESHOLD) {
            snapped.x = 50;
            activeSnapGuides.x = 50;
        }

        // Snap to vertical middle (y = 50%)
        if (Math.abs(y - 50) < SNAP_THRESHOLD) {
            snapped.y = 50;
            activeSnapGuides.y = 50;
        }

        return snapped;
    }

    function hitTestPopouts(canvasX, canvasY) {
        const popouts = getPopouts();
        const dims = getCanvasDimensions();
        const screenshot = getCurrentScreenshot();
        if (!screenshot) return null;

        // Test in reverse order (topmost first)
        for (let i = popouts.length - 1; i >= 0; i--) {
            const p = popouts[i];
            const img = popoutSourceImage(p, screenshot); // each popout has its own source
            if (!img) continue;
            const cx = dims.width * (p.x / 100);
            const cy = dims.height * (p.y / 100);
            const displayW = dims.width * (p.width / 100);
            const sw = (p.cropWidth / 100) * img.width;
            const sh = (p.cropHeight / 100) * img.height;
            const cropAspect = sh / sw;
            const displayH = displayW * cropAspect;
            const halfW = displayW / 2;
            const halfH = displayH / 2;

            if (canvasX >= cx - halfW && canvasX <= cx + halfW &&
                canvasY >= cy - halfH && canvasY <= cy + halfH) {
                return p;
            }
        }
        return null;
    }

    function hitTestElements(canvasX, canvasY) {
        const elements = getElements();
        const dims = getCanvasDimensions();
        // Test in reverse order (topmost first)
        const layers = ['above-text', 'above-screenshot', 'behind-screenshot'];
        for (const layer of layers) {
            const layerEls = elements.filter(el => el.layer === layer).reverse();
            for (const el of layerEls) {
                const cx = dims.width * (el.x / 100);
                const cy = dims.height * (el.y / 100);
                const elWidth = dims.width * (el.width / 100);
                let elHeight;

                if (el.type === 'emoji' || el.type === 'icon') {
                    elHeight = elWidth; // square bounding box
                } else if (el.type === 'graphic' && el.image) {
                    elHeight = elWidth * (el.image.height / el.image.width);
                } else {
                    elHeight = el.fontSize * 1.5;
                }

                // Simple bounding box hit test (ignoring rotation for simplicity)
                const halfW = elWidth / 2;
                const halfH = elHeight / 2;

                if (canvasX >= cx - halfW && canvasX <= cx + halfW &&
                    canvasY >= cy - halfH && canvasY <= cy + halfH) {
                    return el;
                }
            }
        }
        return null;
    }

    // Topmost extra 3D device under the cursor, using each device's cached projected
    // screen rect (set during the last render). Reverse order so a device drawn later
    // (visually on top) wins. Returns the device object or null.
    function hitTestExtraDevices(canvasX, canvasY) {
        const devices = getExtraDevices();
        for (let i = devices.length - 1; i >= 0; i--) {
            const r = devices[i]._screenRect;
            if (r && canvasX >= r.x && canvasX <= r.x + r.w && canvasY >= r.y && canvasY <= r.y + r.h) {
                return devices[i];
            }
        }
        return null;
    }

    // (Headline/subheadline text-block drag removed — text is text elements now.)

    function applyDragMove(coords, shift) {
        // Whole-group drag (a named folder is selected and was grabbed on the canvas):
        // move / Alt=zoom / Ctrl=rotate ALL members together, per-frame increments.
        // Rotation is the rigid screen-space kind — positions orbit the group center
        // while each member spins (devices roll, elements/popouts rotate).
        if (draggingElement.isGroup) {
            const g = getGroups().find(gr => gr.id === draggingElement.id);
            if (!g) return;
            const members = resolveGroupMembers(g.members);
            const lastX = draggingElement._gLastX ?? draggingElement.startX;
            const lastY = draggingElement._gLastY ?? draggingElement.startY;
            const fdx = coords.x - lastX, fdy = coords.y - lastY;
            draggingElement._gLastX = coords.x;
            draggingElement._gLastY = coords.y;
            if (draggingElement.mode === 'zoom') {
                membersScaleBy(members, Math.max(0.5, 1 - (fdy / draggingElement.dims.height) * 1.5));
            } else if (draggingElement.mode === 'rotate') {
                const c = draggingElement.rotCenter;
                const a = Math.atan2(coords.y - c.y, coords.x - c.x);
                const prev = draggingElement._gLastAng ?? draggingElement.startAngle;
                draggingElement._gLastAng = a;
                membersRotate2DBy(members, _wrapDegF((a - prev) * 180 / Math.PI));
            } else {
                membersMoveBy(members, fdx, fdy);
            }
            updateCanvas();
            groupSyncUI();
            return;
        }

        // Extra-device drag. Modifier picks the mode (move / rotate / zoom), captured at
        // mousedown. Deltas are normalized by canvas size so the feel is resolution-
        // independent. Move uses POSITION_RANGE_FACTOR (0.85) so it tracks the cursor 1:1.
        if (draggingElement.isExtraDevice) {
            let dxPx = coords.x - draggingElement.startX;
            let dyPx = coords.y - draggingElement.startY;
            const W = draggingElement.dims.width, H = draggingElement.dims.height;
            const mode = draggingElement.mode || 'move';

            // Grouped: the gesture drives the WHOLE device arrangement. Uses per-frame
            // deltas (not from-start) since group ops are incremental.
            if (deviceGroupActive()) {
                const lastX = draggingElement._gLastX ?? draggingElement.startX;
                const lastY = draggingElement._gLastY ?? draggingElement.startY;
                const fdx = coords.x - lastX, fdy = coords.y - lastY;
                draggingElement._gLastX = coords.x;
                draggingElement._gLastY = coords.y;
                const members = allDeviceMembers();
                if (mode === 'move') {
                    membersMoveBy(members, fdx, fdy);
                } else if (mode === 'zoom') {
                    membersScaleBy(members, Math.max(0.5, 1 - (fdy / H) * 1.5));
                } else {
                    let lock = null;
                    if (shift) {
                        membersRotate3DBy(members, 'y', fdx * 180 / W);
                        membersRotate3DBy(members, 'x', fdy * 180 / H);
                    } else if (draggingElement.rotateZone === 'roll') {
                        const c = draggingElement.rotCenter;
                        const a = Math.atan2(coords.y - c.y, coords.x - c.x);
                        const prev = draggingElement._gLastAng ?? draggingElement.startAngle;
                        draggingElement._gLastAng = a;
                        membersRotate2DBy(members, _wrapDegF((a - prev) * 180 / Math.PI));
                        lock = 'roll';
                    } else if (draggingElement.rotateZone === 'tilt') {
                        membersRotate3DBy(members, 'x', fdy * 180 / H);
                        lock = 'tilt';
                    } else {
                        membersRotate3DBy(members, 'y', fdx * 180 / W);
                        lock = 'turn';
                    }
                    if (typeof showRotationHUD === 'function') {
                        const dev0 = getExtraDevices().find(d => d.id === draggingElement.id);
                        showRotationHUD((dev0 && dev0.rotation3D) || { x: 0, y: 0, z: 0 }, lock);
                    }
                }
                updateCanvas();
                groupSyncUI();
                return;
            }
            // Shift locks a MOVE to one axis, committed from the initial drag direction
            // and held for the gesture. (Rotation picks its axis from the grab zone.)
            if (shift && mode === 'move') {
                if (!draggingElement.lockedAxis && Math.max(Math.abs(dxPx), Math.abs(dyPx)) >= W * 0.01) {
                    draggingElement.lockedAxis = Math.abs(dxPx) >= Math.abs(dyPx) ? 'horizontal' : 'vertical';
                }
                if (draggingElement.lockedAxis === 'horizontal') dyPx = 0;
                else if (draggingElement.lockedAxis === 'vertical') dxPx = 0;
            } else if (mode === 'move') {
                draggingElement.lockedAxis = null;
            }
            const dev = getExtraDevices().find(d => d.id === draggingElement.id);
            if (dev) {
                if (mode === 'zoom') {
                    // Drag up → bigger. Full-height drag ≈ 150 scale units.
                    dev.scale = _clampN(draggingElement.origScale - (dyPx / H) * 150, 10, 150);
                } else if (mode === 'rotate') {
                    // Same scheme as the primary device — the grab zone picks the axis:
                    // corners ROLL (following the pointer's angle around the device
                    // center), top/bottom centers TILT (↕), middle/sides TURN (↔).
                    // Shift frees turn+tilt together. Full canvas-span drag ≈ 180°.
                    dev.rotation3D = dev.rotation3D || { x: 0, y: 0, z: 0 };
                    let lock = null;
                    if (shift) {
                        dev.rotation3D.y = _wrapDeg(draggingElement.origRotY + (dxPx / W) * 180);
                        dev.rotation3D.x = _wrapDeg(draggingElement.origRotX + (dyPx / H) * 180);
                    } else if (draggingElement.rotateZone === 'roll') {
                        const c = draggingElement.rotCenter;
                        const a = Math.atan2(coords.y - c.y, coords.x - c.x);
                        dev.rotation3D.z = _wrapDeg(draggingElement.origRotZ +
                            (a - draggingElement.startAngle) * 180 / Math.PI);
                        lock = 'roll';
                    } else if (draggingElement.rotateZone === 'tilt') {
                        dev.rotation3D.x = _wrapDeg(draggingElement.origRotX + (dyPx / H) * 180);
                        lock = 'tilt';
                    } else {
                        dev.rotation3D.y = _wrapDeg(draggingElement.origRotY + (dxPx / W) * 180);
                        lock = 'turn';
                    }
                    if (typeof showRotationHUD === 'function') showRotationHUD(dev.rotation3D, lock);
                } else {
                    const PRF = 0.85;
                    dev.x = draggingElement.origX + dxPx * 100 / (PRF * W);
                    dev.y = draggingElement.origY + dyPx * 100 / (PRF * H);
                }
                updateCanvas();
                if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
            }
            return;
        }
        const dx = coords.x - draggingElement.startX;
        const dy = coords.y - draggingElement.startY;
        const rawX = draggingElement.origX + (dx / draggingElement.dims.width) * 100;
        const rawY = draggingElement.origY + (dy / draggingElement.dims.height) * 100;

        const clamped = {
            x: Math.max(0, Math.min(100, rawX)),
            y: Math.max(0, Math.min(100, rawY))
        };
        const snapped = snapToGuides(clamped.x, clamped.y);

        if (draggingElement.isPopout) {
            const p = getPopouts().find(po => po.id === draggingElement.id);
            if (p) {
                p.x = snapped.x;
                p.y = snapped.y;
                updateCanvas();
                drawSnapGuides();
                updatePopoutProperties();
            }
        } else {
            const el = getElements().find(e => e.id === draggingElement.id);
            if (el) {
                el.x = snapped.x;
                el.y = snapped.y;
                // Auto-key the dragged position (same UX as drag-to-rotate / drag-to-move
                // on the 3D device — Auto-record captures it).
                if (typeof autoKeyTouch === 'function') {
                    autoKeyTouch(`elements.${el.id}.x`);
                    autoKeyTouch(`elements.${el.id}.y`);
                }
                updateCanvas();
                drawSnapGuides();
                updateElementProperties();
            }
        }
    }

    function clearDrag() {
        if (draggingTransform) {
            draggingTransform = null;
            canvasWrapper.classList.remove('element-dragging');
            saveState();
            updateCanvas();
        }
        if (draggingElement) {
            // Settle an extra-device rotate onto the nearest round angle (matches the
            // primary device's release snap in three-renderer.js). Skipped while
            // devices are grouped — per-device snapping would distort the arrangement's
            // relative offsets.
            if (draggingElement.isExtraDevice && draggingElement.mode === 'rotate' &&
                !deviceGroupActive() && typeof snapRotationDeg === 'function') {
                const dev = getExtraDevices().find(d => d.id === draggingElement.id);
                if (dev && dev.rotation3D) {
                    dev.rotation3D.x = snapRotationDeg(dev.rotation3D.x);
                    dev.rotation3D.y = snapRotationDeg(dev.rotation3D.y);
                    dev.rotation3D.z = snapRotationDeg(dev.rotation3D.z);
                    if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
                }
            }
            draggingElement = null;
            activeSnapGuides = { x: null, y: null };
            canvasWrapper.classList.remove('element-dragging');
            updateCanvas(); // redraw without guides
        }
    }

    // Clear all canvas selections and hide the selection box.
    function deselectAll() {
        if (!selectedElementId && !selectedPopoutId) return;
        setSelectedElement(null);
        selectedPopoutId = null;
        updateElementsList();
        updateElementProperties();
        updatePopoutsList();
        updatePopoutProperties();
        updateCanvas();
    }

    previewCanvas.addEventListener('mousedown', (e) => {
        const coords = getCanvasCoords(e);
        setRotateHint(null); // hover-only; clear when a gesture begins

        // Selected group (folder): a press inside its bounds grabs the WHOLE group —
        // plain drag moves, Alt+drag zooms, Ctrl/⌘+drag rotates. A press outside
        // deselects the group and falls through to normal item handling.
        if (selectedGroupId) {
            const g = getSelectedGroup();
            const b = g ? groupBoundsPx(g) : null;
            if (g && b && coords.x >= b.x && coords.x <= b.x + b.w &&
                coords.y >= b.y && coords.y <= b.y + b.h) {
                e.preventDefault();
                e.stopPropagation();
                const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
                draggingElement = {
                    isGroup: true,
                    id: g.id,
                    startX: coords.x,
                    startY: coords.y,
                    dims: getCanvasDimensions(),
                    mode: (typeof deviceDragModeForEvent === 'function') ? deviceDragModeForEvent(e) : 'move',
                    rotCenter: c,
                    startAngle: Math.atan2(coords.y - c.y, coords.x - c.x)
                };
                canvasWrapper.classList.add('element-dragging');
                return;
            }
            selectGroup(null);
        }

        // A transform handle of the current selection takes priority — it may sit outside
        // the selected item's body, and grabbing it must scale/rotate rather than re-select.
        const handleHit = hitTestSelectionHandle(coords);
        if (handleHit) {
            e.preventDefault();
            e.stopPropagation();
            startTransformDrag(handleHit, coords);
            return;
        }

        // Check popouts first (they render on top of elements above-screenshot)
        const popoutHit = hitTestPopouts(coords.x, coords.y);
        if (popoutHit) {
            e.preventDefault();
            e.stopPropagation();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: popoutHit.id,
                startX: coords.x,
                startY: coords.y,
                origX: popoutHit.x,
                origY: popoutHit.y,
                dims: dims,
                isPopout: true
            };
            selectedPopoutId = popoutHit.id;
            setSelectedElement(null);
            updatePopoutsList();
            updatePopoutProperties();
            updateElementsList();
            updateElementProperties();
            canvasWrapper.classList.add('element-dragging');

            const popoutsTab = document.querySelector('.tab[data-tab="popouts"]');
            if (popoutsTab && !popoutsTab.classList.contains('active')) {
                popoutsTab.click();
            }
            return;
        }

        const hit = hitTestElements(coords.x, coords.y);
        if (hit) {
            e.preventDefault();
            e.stopPropagation();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: hit.id,
                startX: coords.x,
                startY: coords.y,
                origX: hit.x,
                origY: hit.y,
                dims: dims,
                isPopout: false
            };
            setSelectedElement(hit.id);
            selectedPopoutId = null;
            updateElementsList();
            updateElementProperties();
            updatePopoutsList();
            updatePopoutProperties();
            canvasWrapper.classList.add('element-dragging');

            const elementsTab = document.querySelector('.tab[data-tab="elements"]');
            if (elementsTab && !elementsTab.classList.contains('active')) {
                elementsTab.click();
            }
        } else {
            // No element/popout hit — try the extra 3D devices (device bodies sit below
            // elements/text so those stay clickable on top).
            const devHit = hitTestExtraDevices(coords.x, coords.y);
            if (devHit) {
                e.preventDefault();
                e.stopPropagation();
                const dims = getCanvasDimensions();
                const rot0 = devHit.rotation3D || { x: 0, y: 0, z: 0 };
                const mode = (typeof deviceDragModeForEvent === 'function') ? deviceDragModeForEvent(e) : 'move';
                // Rotation axis comes from the grab zone (corners roll, top/bottom tilt,
                // middle turns); roll spins around the device's on-screen center.
                const dr = devHit._screenRect;
                const devCenter = dr ? { x: dr.x + dr.w / 2, y: dr.y + dr.h / 2 } : { x: coords.x, y: coords.y };
                draggingElement = {
                    id: devHit.id,
                    startX: coords.x,
                    startY: coords.y,
                    origX: devHit.x,
                    origY: devHit.y,
                    dims: dims,
                    isExtraDevice: true,
                    // plain → move, Ctrl/Cmd → rotate, Alt → zoom (same scheme as the primary).
                    mode: mode,
                    rotateZone: mode === 'rotate' ? deviceRotateZone(coords.x, coords.y, dr) : 'turn',
                    rotCenter: devCenter,
                    startAngle: Math.atan2(coords.y - devCenter.y, coords.x - devCenter.x),
                    origScale: devHit.scale,
                    origRotX: rot0.x,
                    origRotY: rot0.y,
                    origRotZ: rot0.z
                };
                selectExtraDevice(devHit.id);
                canvasWrapper.classList.add('element-dragging');
            } else {
                // Clicked empty canvas — clear the current selection (hides the box).
                deselectAll();
                if (selectedExtraDeviceId) selectExtraDevice(null);
            }
        }
    });

    // Double-click in 3D mode resets the pose: on an extra device, that device's
    // rotation; otherwise the primary device's — eased back to Front by the
    // rotation follower so the reset reads as a deliberate motion, not a glitch.
    previewCanvas.addEventListener('dblclick', (e) => {
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
        if (!ss || !ss.use3D) return;
        const coords = getCanvasCoords(e);
        // Elements and popouts own their double-clicks.
        if (hitTestPopouts(coords.x, coords.y) || hitTestElements(coords.x, coords.y)) return;
        // Linked devices: reset every device's pose together.
        if (deviceGroupActive()) {
            allDeviceMembers().forEach(m => { m.obj.rotation3D = { x: 0, y: 0, z: 0 }; });
            updateCanvas();
            groupSyncUI();
            return;
        }
        const devHit = hitTestExtraDevices(coords.x, coords.y);
        if (devHit) {
            devHit.rotation3D = { x: 0, y: 0, z: 0 };
            updateCanvas();
            if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
            return;
        }
        if (typeof animateDeviceRotationTo === 'function') animateDeviceRotationTo(0, 0, 0);
    });

    window.addEventListener('mousemove', (e) => {
        if (!draggingElement && !draggingTransform) {
            // Hover detection
            const coords = getCanvasCoords(e);
            const onHandle = !!hitTestSelectionHandle(coords);
            const popoutHit = hitTestPopouts(coords.x, coords.y);
            const hit = onHandle || popoutHit || hitTestElements(coords.x, coords.y);
            canvasWrapper.classList.toggle('element-hover', !!hit);
            // Rotate-axis hint while the rotate modifier is held over a device.
            _lastCanvasPointer = coords;
            const rotateMod = (e.ctrlKey || e.metaKey) && !e.altKey;
            setRotateHint((rotateMod && !hit) ? computeRotateHint(coords) : null);
            return;
        }
        e.preventDefault();
        if (draggingTransform) applyTransformMove(getCanvasCoords(e));
        else applyDragMove(getCanvasCoords(e), e.shiftKey);
    });

    window.addEventListener('mouseup', () => clearDrag());

    // Touch support
    previewCanvas.addEventListener('touchstart', (e) => {
        const coords = getCanvasCoords(e);

        const handleHit = hitTestSelectionHandle(coords);
        if (handleHit) {
            e.preventDefault();
            startTransformDrag(handleHit, coords);
            return;
        }

        const popoutHit = hitTestPopouts(coords.x, coords.y);
        if (popoutHit) {
            e.preventDefault();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: popoutHit.id,
                startX: coords.x,
                startY: coords.y,
                origX: popoutHit.x,
                origY: popoutHit.y,
                dims: dims,
                isPopout: true
            };
            selectedPopoutId = popoutHit.id;
            setSelectedElement(null);
            updatePopoutsList();
            updatePopoutProperties();
            return;
        }

        const hit = hitTestElements(coords.x, coords.y);
        if (hit) {
            e.preventDefault();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: hit.id,
                startX: coords.x,
                startY: coords.y,
                origX: hit.x,
                origY: hit.y,
                dims: dims,
                isPopout: false
            };
            setSelectedElement(hit.id);
            updateElementsList();
            updateElementProperties();
        } else {
            deselectAll();
        }
    }, { passive: false });

    previewCanvas.addEventListener('touchmove', (e) => {
        if (!draggingElement && !draggingTransform) return;
        e.preventDefault();
        if (draggingTransform) applyTransformMove(getCanvasCoords(e));
        else applyDragMove(getCanvasCoords(e));
    }, { passive: false });

    previewCanvas.addEventListener('touchend', () => clearDrag());
}

// Draw snap guide lines over the canvas when dragging near center/middle
function drawSnapGuides() {
    if (!draggingElement) return;

    const el = getSelectedElement();
    if (!el) return;

    const dims = getCanvasDimensions();
    // Scale relative to canvas so guides stay visible in the scaled-down preview
    const scale = dims.width / 400;

    ctx.save();
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.45)';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.setLineDash([12 * scale, 8 * scale]);

    // Vertical center line (x = 50%)
    if (Math.abs(el.x - 50) < 0.01) {
        const lineX = Math.round(dims.width * 0.5);
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, dims.height);
        ctx.stroke();
    }

    // Horizontal middle line (y = 50%)
    if (Math.abs(el.y - 50) < 0.01) {
        const lineY = Math.round(dims.height * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(dims.width, lineY);
        ctx.stroke();
    }

    ctx.restore();
}

// ============================================================================
// Selection box + transform handles
// ----------------------------------------------------------------------------
// A bounding box with drag handles, drawn on the #selection-overlay canvas (never
// on the export canvas). It works in INTERNAL canvas coordinates (dims.width ×
// dims.height); the overlay is drawn at display resolution by scaling internal →
// display via `disp`. Pointer hit-testing happens on #preview-canvas in internal
// coords (getCanvasCoords), so handle math is shared between draw + hit-test.
// ============================================================================

const SELECTION_ROTATE_GAP = 34; // gap (screen px) from top edge to the rotate handle

// Render-accurate width/height (internal px) of an element's bounding box, matching
// how drawElementsToContext lays each type out.
function getElementRenderSize(el, dims) {
    const w = dims.width * (el.width / 100);
    if (el.type === 'emoji' || el.type === 'icon') {
        return { w, h: w };
    }
    if (el.type === 'graphic' && el.image) {
        return { w, h: w * (el.image.height / el.image.width) };
    }
    if (el.type === 'text') {
        // Measure wrapped text height exactly like the renderer does.
        const elFontSize = el.fontSize; // dims here is full-res in the live path
        const prevFont = ctx.font;
        ctx.font = `${el.italic ? 'italic' : 'normal'} ${el.fontWeight} ${elFontSize}px ${el.font}`;
        const lines = wrapText(ctx, getElementText(el), w);
        ctx.font = prevFont;
        const lineHeight = elFontSize * 1.05;
        const h = (lines.length - 1) * lineHeight + elFontSize;
        return { w, h };
    }
    return { w, h: (el.fontSize || 60) * 1.5 };
}

// The box for a single element: center (internal px), size, rotation (deg).
function getElementBox(el, dims) {
    const { w, h } = getElementRenderSize(el, dims);
    return {
        kind: 'element',
        el,
        cx: dims.width * (el.x / 100),
        cy: dims.height * (el.y / 100),
        w, h,
        rotation: el.rotation || 0,
        handles: (el.type === 'text')
            ? ['nw', 'ne', 'se', 'sw', 'e', 'w', 'rotate']
            : ['nw', 'ne', 'se', 'sw', 'rotate']
    };
}

// The box for the current selection (a text/graphic/icon/emoji element), or null.
function getActiveSelectionBox(dims) {
    const el = getSelectedElement();
    if (el) return getElementBox(el, dims);
    return null;
}

// Rotate a local-frame point (lx,ly) about the box center into internal coords.
function boxLocalToInternal(box, lx, ly) {
    const r = box.rotation * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return {
        x: box.cx + lx * cos - ly * sin,
        y: box.cy + lx * sin + ly * cos
    };
}

// All handle points for a box in internal coords: { name, x, y }.
function selectionHandlePoints(box) {
    const hw = box.w / 2, hh = box.h / 2;
    const local = {
        nw: [-hw, -hh], n: [0, -hh], ne: [hw, -hh],
        e: [hw, 0], se: [hw, hh], s: [0, hh],
        sw: [-hw, hh], w: [-hw, 0]
    };
    const pts = [];
    box.handles.forEach(name => {
        if (name === 'rotate') return;
        const [lx, ly] = local[name];
        pts.push(Object.assign({ name }, boxLocalToInternal(box, lx, ly)));
    });
    return pts;
}

// The rotate handle point (internal coords), or null if this box has no rotate handle.
function selectionRotatePoint(box, dims) {
    if (!box.handles.includes('rotate')) return null;
    const disp = getOverlayDisp(dims);
    const gap = SELECTION_ROTATE_GAP / disp; // keep a constant on-screen gap
    return boxLocalToInternal(box, 0, -box.h / 2 - gap);
}

// Internal→display scale factor (display px per internal px).
function getOverlayDisp(dims) {
    const displayW = parseFloat(canvas.style.width) || dims.width;
    return displayW / dims.width;
}

// A double-headed arrow centered at (cx,cy), horizontal ('h') or vertical ('v').
function drawDoubleArrow(ctx, cx, cy, dir, half) {
    const head = 8;
    ctx.beginPath();
    if (dir === 'h') {
        ctx.moveTo(cx - half, cy); ctx.lineTo(cx + half, cy);
        ctx.moveTo(cx - half, cy); ctx.lineTo(cx - half + head, cy - head); ctx.moveTo(cx - half, cy); ctx.lineTo(cx - half + head, cy + head);
        ctx.moveTo(cx + half, cy); ctx.lineTo(cx + half - head, cy - head); ctx.moveTo(cx + half, cy); ctx.lineTo(cx + half - head, cy + head);
    } else {
        ctx.moveTo(cx, cy - half); ctx.lineTo(cx, cy + half);
        ctx.moveTo(cx, cy - half); ctx.lineTo(cx - head, cy - half + head); ctx.moveTo(cx, cy - half); ctx.lineTo(cx + head, cy - half + head);
        ctx.moveTo(cx, cy + half); ctx.lineTo(cx - head, cy + half - head); ctx.moveTo(cx, cy + half); ctx.lineTo(cx + head, cy + half - head);
    }
    ctx.stroke();
}

// A small curved double-arrow (roll affordance) at (px,py), bulging toward
// `outAngle` (radians) — drawn at the device's corners.
function drawRollGlyph(octx, px, py, outAngle) {
    const r = 9, span = 0.95, head = 5, spread = 0.55;
    octx.beginPath();
    octx.arc(px, py, r, outAngle - span, outAngle + span);
    octx.stroke();
    // Open arrowheads at both arc ends, wings trailing back along the arc.
    [[outAngle - span, outAngle - span + Math.PI / 2],
     [outAngle + span, outAngle + span - Math.PI / 2]].forEach(([a, back]) => {
        const ex = px + r * Math.cos(a), ey = py + r * Math.sin(a);
        octx.beginPath();
        octx.moveTo(ex + head * Math.cos(back - spread), ey + head * Math.sin(back - spread));
        octx.lineTo(ex, ey);
        octx.lineTo(ex + head * Math.cos(back + spread), ey + head * Math.sin(back + spread));
        octx.stroke();
    });
}

// Draw the rotate hint over a device while the rotate modifier is held: every
// grab zone shows its affordance — curved arrows at the corners (roll), ↕ at the
// top/bottom centers (tilt), ↔ in the middle (turn) — with the zone under the
// cursor accented, so a drag's effect is clear before you act.
function drawRotateHint(octx, disp, hint) {
    const r = hint.rect;
    const x = r.x * disp, y = r.y * disp, w = r.w * disp, h = r.h * disp;
    const cx = x + w / 2, cy = y + h / 2;
    const accent = '#3b82f6';
    const dim = 'rgba(100, 116, 139, 0.55)';
    const zone = hint.zone || 'turn';
    octx.save();
    octx.lineCap = 'round'; octx.lineJoin = 'round';

    // Faint outline of the device's grab area.
    octx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    octx.lineWidth = 1.25;
    octx.beginPath();
    octx.roundRect(x, y, w, h, Math.min(14, w * 0.08));
    octx.stroke();

    // Each glyph is drawn twice — a soft white halo underneath, then the colored
    // stroke — so it reads on the dark bezel and any background alike.
    const glyph = (active, draw) => {
        octx.strokeStyle = 'rgba(255,255,255,0.92)';
        octx.lineWidth = active ? 4.6 : 3.6;
        draw();
        octx.strokeStyle = active ? accent : dim;
        octx.lineWidth = active ? 2.4 : 1.7;
        draw();
    };

    // Corners → roll. Glyphs inset so they sit just inside the outline.
    const inset = Math.min(20, w * 0.16, h * 0.16);
    [[x + inset, y + inset, -2.356],          // top-left, bulge up-left (−135°)
     [x + w - inset, y + inset, -0.785],      // top-right (−45°)
     [x + w - inset, y + h - inset, 0.785],   // bottom-right (45°)
     [x + inset, y + h - inset, 2.356]        // bottom-left (135°)
    ].forEach(([px, py, a]) => glyph(zone === 'roll', () => drawRollGlyph(octx, px, py, a)));

    // Top/bottom centers → tilt (↕).
    glyph(zone === 'tilt', () => drawDoubleArrow(octx, cx, y + inset, 'v', 13));
    glyph(zone === 'tilt', () => drawDoubleArrow(octx, cx, y + h - inset, 'v', 13));

    // Middle → turn (↔).
    glyph(zone === 'turn', () => drawDoubleArrow(octx, cx, cy, 'h', 22));

    // Label pill naming the active zone, kept near center so it's always on-screen.
    const label = zone === 'roll' ? 'Roll · drag to spin'
                : zone === 'tilt' ? 'Tilt · drag ↕'
                : 'Turn · drag ↔';
    const ly = cy + 44;
    octx.font = "600 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif";
    octx.textAlign = 'center'; octx.textBaseline = 'middle';
    const tw = octx.measureText(label).width;
    octx.fillStyle = 'rgba(15,23,42,0.85)';
    octx.beginPath(); octx.roundRect(cx - tw / 2 - 9, ly - 11, tw + 18, 22, 11); octx.fill();
    octx.fillStyle = '#fff'; octx.fillText(label, cx, ly + 0.5);
    octx.restore();
}

// Recompute the rotate hint for a hover at canvas-pixel `coords` given whether the rotate
// modifier is held, and redraw the overlay if it changed. Hover-only (cleared on drag).
function computeRotateHint(coords) {
    const rect = deviceRectAt(coords.x, coords.y);
    return rect ? { rect, zone: deviceRotateZone(coords.x, coords.y, rect) } : null;
}
function setRotateHint(hint) {
    if (JSON.stringify(hint) === JSON.stringify(_rotateHint)) return;
    _rotateHint = hint;
    if (typeof drawSelectionOverlay === 'function') drawSelectionOverlay();
}

// Draw the selection chrome onto #selection-overlay. Cleared (and skipped) when nothing
// is selected or during playback. Works in both 2D and 3D device modes because both
// composite into #preview-canvas, which the overlay is aligned to.
function drawSelectionOverlay() {
    const overlay = document.getElementById('selection-overlay');
    if (!overlay) return;
    const octx = overlay.getContext('2d');

    const dims = getCanvasDimensions();
    const displayW = parseFloat(canvas.style.width) || dims.width;
    const displayH = parseFloat(canvas.style.height) || dims.height;
    const dpr = window.devicePixelRatio || 1;

    // Size/position the overlay to sit exactly over the main canvas.
    overlay.style.width = displayW + 'px';
    overlay.style.height = displayH + 'px';
    if (overlay.width !== Math.round(displayW * dpr) || overlay.height !== Math.round(displayH * dpr)) {
        overlay.width = Math.round(displayW * dpr);
        overlay.height = Math.round(displayH * dpr);
    }
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, displayW, displayH);

    const playing = (typeof timeline !== 'undefined' && timeline.playing);
    if (playing) return;

    // Drop-target highlight: while dragging an image file over the canvas, outline the
    // device that will receive it (green) so the drop is clearly per-device.
    if (_dropHighlightRect) {
        const disp = displayW / dims.width;
        const r = _dropHighlightRect;
        octx.save();
        octx.fillStyle = 'rgba(34, 197, 94, 0.16)';
        octx.fillRect(r.x * disp, r.y * disp, r.w * disp, r.h * disp);
        octx.lineWidth = 3;
        octx.strokeStyle = '#22c55e';
        octx.setLineDash([10, 6]);
        octx.strokeRect(r.x * disp, r.y * disp, r.w * disp, r.h * disp);
        octx.setLineDash([]);
        octx.restore();
    }

    // Rotate hint: shown while the rotate modifier is held over a device — an orbit
    // crosshair explaining that dragging turns (↔) and tilts (↕) the device.
    if (_rotateHint && _rotateHint.rect) {
        drawRotateHint(octx, displayW / dims.width, _rotateHint);
    }

    // Active-device rim: a faint ring hugging the TRUE silhouette of the device a
    // canvas gesture will act on (accumulated at render time in three-renderer.js
    // — see deviceHighlightCanvas). Pixel-accurate at any rotation, and invisible
    // to exports since it lives on this overlay.
    if (typeof deviceHighlightCanvas !== 'undefined' && deviceHighlightCanvas &&
        deviceHighlightTargetNow()) {
        octx.save();
        octx.globalAlpha = 0.6;
        octx.drawImage(deviceHighlightCanvas, 0, 0, displayW, displayH);
        octx.restore();
    }

    // Selected popout: the standard dashed outline (same language as element
    // selection), drawn at the popout's exact rect + rotation.
    const selPop = typeof getSelectedPopout === 'function' ? getSelectedPopout() : null;
    if (selPop) {
        const srcImg = popoutSourceImage(selPop, getCurrentScreenshot());
        if (srcImg) {
            const disp = displayW / dims.width;
            const pw = dims.width * (selPop.width / 100) * disp;
            const ph = pw * (((selPop.cropHeight / 100) * srcImg.height) / ((selPop.cropWidth / 100) * srcImg.width));
            const pcx = dims.width * (selPop.x / 100) * disp;
            const pcy = dims.height * (selPop.y / 100) * disp;
            octx.save();
            octx.translate(pcx, pcy);
            octx.rotate((selPop.rotation || 0) * Math.PI / 180);
            octx.strokeStyle = '#3b82f6';
            octx.lineWidth = 1.5;
            octx.setLineDash([6, 4]);
            octx.strokeRect(-pw / 2 - 3, -ph / 2 - 3, pw + 6, ph + 6);
            octx.setLineDash([]);
            octx.restore();
        }
    }

    // Selected group (folder): dashed box around the members' combined bounds with a
    // name chip — the visual handle for whole-group move / zoom / rotate.
    if (typeof getSelectedGroup === 'function') {
        const g = getSelectedGroup();
        const gb = g ? groupBoundsPx(g) : null;
        if (gb) {
            const disp = displayW / dims.width;
            octx.save();
            octx.strokeStyle = '#a855f7';
            octx.lineWidth = 2;
            octx.setLineDash([8, 6]);
            octx.strokeRect(gb.x * disp, gb.y * disp, gb.w * disp, gb.h * disp);
            octx.setLineDash([]);
            const label = '📁 ' + (g.name || 'Group');
            octx.font = '600 12px -apple-system, BlinkMacSystemFont, system-ui, sans-serif';
            const tw = octx.measureText(label).width;
            const lx = gb.x * disp + 10, ly = Math.max(12, gb.y * disp - 12);
            octx.fillStyle = 'rgba(168, 85, 247, 0.92)';
            octx.beginPath(); octx.roundRect(lx - 7, ly - 10, tw + 14, 20, 10); octx.fill();
            octx.fillStyle = '#fff';
            octx.textAlign = 'left';
            octx.textBaseline = 'middle';
            octx.fillText(label, lx, ly + 0.5);
            octx.restore();
        }
    }

    const box = getActiveSelectionBox(dims);
    if (!box) return;

    const disp = displayW / dims.width;
    const accent = '#3b82f6';

    octx.save();
    octx.translate(box.cx * disp, box.cy * disp);
    octx.rotate(box.rotation * Math.PI / 180);

    const hw = (box.w / 2) * disp, hh = (box.h / 2) * disp;

    // Bounding rectangle (subtle dashed, with a faint dark backing for contrast).
    octx.lineWidth = 1.5;
    octx.strokeStyle = accent;
    octx.setLineDash([6, 4]);
    octx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    octx.setLineDash([]);

    // Rotate handle: a stem up from the top edge + a round grip.
    if (box.handles.includes('rotate')) {
        const gap = SELECTION_ROTATE_GAP;
        octx.beginPath();
        octx.moveTo(0, -hh);
        octx.lineTo(0, -hh - gap);
        octx.strokeStyle = accent;
        octx.stroke();
        drawHandleDot(octx, 0, -hh - gap, 6, accent, true);
    }
    octx.restore();

    // Square resize handles (drawn unrotated-square but positioned on the rotated frame).
    selectionHandlePoints(box).forEach(p => {
        drawHandleDot(octx, p.x * disp, p.y * disp, 5, accent, false);
    });
}

// Which device should wear the selection rim, evaluated fresh each render:
//   'all'      — device link is on (gestures drive every device)
//   <dev id>   — a selected extra device
//   'primary'  — nothing selected in a multi-device scene (default gesture target)
//   null       — single-device scenes, or an element/popout/group owns the selection
// Called from three-renderer.js while compositing, so the rim is built from the
// device's actual render silhouette.
function deviceHighlightTargetNow() {
    const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
    if (!ss || !ss.use3D) return null;
    if (typeof getSelectedGroup === 'function' && getSelectedGroup()) return null;
    if (selectedElementId || selectedPopoutId) return null;
    if (typeof timeline !== 'undefined' && timeline.playing) return null;
    if (typeof deviceGroupActive === 'function' && deviceGroupActive()) return 'all';
    const sel = typeof getSelectedExtraDevice === 'function' ? getSelectedExtraDevice() : null;
    if (sel) return sel.id;
    return getExtraDevices().length ? 'primary' : null;
}

// A handle marker: filled white with an accent ring. `round` → circle (rotate), else square.
function drawHandleDot(octx, x, y, r, accent, round) {
    octx.save();
    octx.fillStyle = '#ffffff';
    octx.strokeStyle = accent;
    octx.lineWidth = 1.5;
    octx.beginPath();
    if (round) {
        octx.arc(x, y, r, 0, Math.PI * 2);
    } else {
        octx.rect(x - r, y - r, r * 2, r * 2);
    }
    octx.fill();
    octx.stroke();
    octx.restore();
}

// --- Transform-handle hit-testing + drag (scale / rotate via the selection box) -------

// Express a world point in the box's local (unrotated) frame, origin at box center.
function selectionWorldToLocal(box, x, y) {
    const r = box.rotation * Math.PI / 180;
    const cos = Math.cos(r), sin = Math.sin(r);
    const vx = x - box.cx, vy = y - box.cy;
    return { lx: vx * cos + vy * sin, ly: -vx * sin + vy * cos };
}

// Return the handle under the pointer for the active selection, or null.
function hitTestSelectionHandle(coords) {
    const dims = getCanvasDimensions();
    const box = getActiveSelectionBox(dims);
    if (!box) return null;
    const disp = getOverlayDisp(dims);
    const hitR = 12 / disp; // ~12 screen-px grab radius regardless of preview scale
    const rp = selectionRotatePoint(box, dims);
    if (rp && Math.hypot(coords.x - rp.x, coords.y - rp.y) <= hitR) {
        return { type: 'rotate', box };
    }
    for (const p of selectionHandlePoints(box)) {
        if (Math.hypot(coords.x - p.x, coords.y - p.y) <= hitR) {
            return { type: 'scale', handle: p.name, box };
        }
    }
    return null;
}

const SELECTION_CORNER_HANDLES = ['nw', 'ne', 'se', 'sw'];

function startTransformDrag(hit, coords) {
    const box = hit.box;
    const t = {
        mode: hit.type,           // 'scale' | 'rotate'
        handle: hit.handle,       // corner/edge name (scale only)
        kind: box.kind,           // 'element' | 'text'
        el: box.el || null,
        cx: box.cx, cy: box.cy,
        rotation: box.rotation,
        w0: box.w, h0: box.h
    };
    t.angle0 = Math.atan2(coords.y - box.cy, coords.x - box.cx);
    if (box.el) {
        t.origWidth = box.el.width;
        t.origFontSize = box.el.fontSize || 60;
        t.origRotation = box.el.rotation || 0;
    }
    draggingTransform = t;
    canvasWrapper.classList.add('element-dragging');
}

function applyTransformMove(coords) {
    const t = draggingTransform;
    if (!t) return;
    const dims = getCanvasDimensions();

    if (t.mode === 'rotate') {
        const cur = Math.atan2(coords.y - t.cy, coords.x - t.cx);
        let deg = t.origRotation + (cur - t.angle0) * 180 / Math.PI;
        deg = ((deg + 180) % 360 + 360) % 360 - 180; // wrap to [-180,180]
        deg = Math.round(deg);
        if (t.kind === 'element' && t.el) {
            t.el.rotation = deg;
            if (typeof autoKeyTouch === 'function') autoKeyTouch(`elements.${t.el.id}.rotation`);
        }
        updateCanvas();
        if (t.kind === 'element') updateElementProperties();
        return;
    }

    // Scale: measure the pointer in the box's local frame, derive a factor.
    const { lx, ly } = selectionWorldToLocal(t, coords.x, coords.y);
    const isCorner = SELECTION_CORNER_HANDLES.includes(t.handle);

    if (t.kind === 'element' && t.el) {
        if (isCorner) {
            const origDiag = Math.hypot(t.w0 / 2, t.h0 / 2) || 1;
            const factor = Math.hypot(lx, ly) / origDiag;
            if (t.el.type === 'text') {
                t.el.fontSize = Math.max(6, Math.min(2000, t.origFontSize * factor));
                if (typeof autoKeyTouch === 'function') autoKeyTouch(`elements.${t.el.id}.fontSize`);
            } else {
                t.el.width = Math.max(1, Math.min(300, t.origWidth * factor));
                if (typeof autoKeyTouch === 'function') autoKeyTouch(`elements.${t.el.id}.width`);
            }
        } else if (t.handle === 'e' || t.handle === 'w') {
            // Side handles on a text element change the wrap width.
            const newWidthPct = (Math.abs(lx) * 2 / dims.width) * 100;
            t.el.width = Math.max(2, Math.min(200, newWidthPct));
            if (typeof autoKeyTouch === 'function') autoKeyTouch(`elements.${t.el.id}.width`);
        }
        updateCanvas();
        updateElementProperties();
        return;
    }
}

// ===== Popouts Tab UI =====

function updatePopoutsList() {
    // Popouts appear in the sidebar layers tree too — keep it fresh.
    if (typeof updateGroupsList === 'function') updateGroupsList();
    const listEl = document.getElementById('popouts-list');
    const emptyEl = document.getElementById('popouts-empty');
    const addBtn = document.getElementById('add-popout-btn');
    if (!listEl) return;

    const popouts = getPopouts();
    const screenshot = getCurrentScreenshot();
    // Popouts can crop from ANY screen on this shot — enable the button when the
    // main device OR any extra device has an image (blank main + populated extras
    // is the normal multi-device case).
    const hasImage = screenshot && (
        getScreenshotImage(screenshot) ||
        (screenshot.extraDevices || []).some(d => d.image)
    );

    // Disable add button when nothing on the screen has an image yet
    if (addBtn) {
        addBtn.disabled = !hasImage;
        addBtn.style.opacity = hasImage ? '' : '0.4';
    }

    // Remove old items
    listEl.querySelectorAll('.popout-item').forEach(el => el.remove());

    if (popouts.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    popouts.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'popout-item' + (p.id === selectedPopoutId ? ' selected' : '');
        item.dataset.popoutId = p.id;

        // Generate crop preview thumbnail (from this popout's OWN source screen)
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 28;
        thumbCanvas.height = 28;
        const thumbCtx = thumbCanvas.getContext('2d');
        const img = popoutSourceImage(p, screenshot);
        if (img) {
            const sx = (p.cropX / 100) * img.width;
            const sy = (p.cropY / 100) * img.height;
            const sw = (p.cropWidth / 100) * img.width;
            const sh = (p.cropHeight / 100) * img.height;
            thumbCtx.drawImage(img, sx, sy, sw, sh, 0, 0, 28, 28);
        }

        item.innerHTML = `
            <div class="popout-item-thumb"></div>
            <div class="popout-item-info">
                <div class="popout-item-name">Popout ${idx + 1}</div>
                <div class="popout-item-crop">${Math.round(p.cropWidth)}% × ${Math.round(p.cropHeight)}%</div>
            </div>
            <div class="popout-item-actions">
                <button class="element-item-btn" data-action="move-up" title="Move up">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button class="element-item-btn" data-action="move-down" title="Move down">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button class="element-item-btn danger" data-action="delete" title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;

        // Insert thumbnail canvas
        const thumbHolder = item.querySelector('.popout-item-thumb');
        if (thumbHolder) thumbHolder.appendChild(thumbCanvas);

        item.addEventListener('click', (e) => {
            if (e.target.closest('.element-item-btn')) return;
            selectedPopoutId = p.id;
            updatePopoutsList();
            updatePopoutProperties();
        });

        item.querySelectorAll('.element-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'delete') deletePopout(p.id);
                else if (action === 'move-up') movePopout(p.id, 'up');
                else if (action === 'move-down') movePopout(p.id, 'down');
            });
        });

        listEl.appendChild(item);
    });
}

function updatePopoutProperties() {
    const propsEl = document.getElementById('popout-properties');
    if (!propsEl) return;

    const p = getSelectedPopout();
    if (!p) {
        propsEl.style.display = 'none';
        return;
    }
    propsEl.style.display = '';

    // Source screen: which device this popout crops from. Only shown when the
    // screen actually has extra devices to choose between.
    const srcGroup = document.getElementById('popout-source-group');
    const srcSel = document.getElementById('popout-source');
    if (srcGroup && srcSel) {
        const devs = getExtraDevices();
        srcGroup.style.display = devs.length ? 'block' : 'none';
        srcSel.innerHTML = '';
        const screenshot = getCurrentScreenshot();
        const addOpt = (value, label) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = label;
            srcSel.appendChild(o);
        };
        addOpt('primary', 'Main device' + (getScreenshotImage(screenshot) ? '' : ' (no image)'));
        devs.forEach((d, i) => {
            const name = d.name && d.name !== 'Device' ? d.name : `Device ${i + 2}`;
            addOpt(d.id, name + (d.image ? '' : ' (no image)'));
        });
        srcSel.value = p.source || 'primary';
    }

    // Crop region
    document.getElementById('popout-crop-x').value = p.cropX;
    document.getElementById('popout-crop-x-value').textContent = formatValue(p.cropX) + '%';
    document.getElementById('popout-crop-y').value = p.cropY;
    document.getElementById('popout-crop-y-value').textContent = formatValue(p.cropY) + '%';
    document.getElementById('popout-crop-width').value = p.cropWidth;
    document.getElementById('popout-crop-width-value').textContent = formatValue(p.cropWidth) + '%';
    document.getElementById('popout-crop-height').value = p.cropHeight;
    document.getElementById('popout-crop-height-value').textContent = formatValue(p.cropHeight) + '%';

    // Display
    document.getElementById('popout-x').value = p.x;
    document.getElementById('popout-x-value').textContent = formatValue(p.x) + '%';
    document.getElementById('popout-y').value = p.y;
    document.getElementById('popout-y-value').textContent = formatValue(p.y) + '%';
    document.getElementById('popout-width').value = p.width;
    document.getElementById('popout-width-value').textContent = formatValue(p.width) + '%';
    document.getElementById('popout-rotation').value = p.rotation;
    document.getElementById('popout-rotation-value').textContent = formatValue(p.rotation) + '°';
    document.getElementById('popout-opacity').value = p.opacity;
    document.getElementById('popout-opacity-value').textContent = formatValue(p.opacity) + '%';
    document.getElementById('popout-corner-radius').value = p.cornerRadius;
    document.getElementById('popout-corner-radius-value').textContent = formatValue(p.cornerRadius) + 'px';

    // Shadow
    const shadow = p.shadow || { enabled: false, color: '#000000', blur: 30, opacity: 40, x: 0, y: 15 };
    document.getElementById('popout-shadow-toggle').classList.toggle('active', shadow.enabled);
    const shadowRow = document.getElementById('popout-shadow-toggle')?.closest('.toggle-row');
    if (shadowRow) shadowRow.classList.toggle('collapsed', !shadow.enabled);
    document.getElementById('popout-shadow-options').style.display = shadow.enabled ? '' : 'none';
    document.getElementById('popout-shadow-color').value = shadow.color;
    document.getElementById('popout-shadow-color-hex').value = shadow.color;
    document.getElementById('popout-shadow-blur').value = shadow.blur;
    document.getElementById('popout-shadow-blur-value').textContent = formatValue(shadow.blur) + 'px';
    document.getElementById('popout-shadow-opacity').value = shadow.opacity;
    document.getElementById('popout-shadow-opacity-value').textContent = formatValue(shadow.opacity) + '%';
    document.getElementById('popout-shadow-x').value = shadow.x;
    document.getElementById('popout-shadow-x-value').textContent = formatValue(shadow.x) + 'px';
    document.getElementById('popout-shadow-y').value = shadow.y;
    document.getElementById('popout-shadow-y-value').textContent = formatValue(shadow.y) + 'px';

    // Border
    const border = p.border || { enabled: false, color: '#ffffff', width: 3, opacity: 100 };
    document.getElementById('popout-border-toggle').classList.toggle('active', border.enabled);
    const borderRow = document.getElementById('popout-border-toggle')?.closest('.toggle-row');
    if (borderRow) borderRow.classList.toggle('collapsed', !border.enabled);
    document.getElementById('popout-border-options').style.display = border.enabled ? '' : 'none';
    document.getElementById('popout-border-color').value = border.color;
    document.getElementById('popout-border-color-hex').value = border.color;
    document.getElementById('popout-border-width').value = border.width;
    document.getElementById('popout-border-width-value').textContent = formatValue(border.width) + 'px';
    document.getElementById('popout-border-opacity').value = border.opacity;
    document.getElementById('popout-border-opacity-value').textContent = formatValue(border.opacity) + '%';

    // Update crop preview
    updateCropPreview();
}

// Compute image-fit layout within the crop preview canvas (letterboxed)
function getCropPreviewLayout(previewCanvas, img) {
    const w = previewCanvas.width;
    const h = previewCanvas.height;
    const imgAspect = img.width / img.height;
    const canvasAspect = w / h;
    let drawW, drawH, drawX, drawY;
    if (imgAspect > canvasAspect) {
        drawW = w;
        drawH = w / imgAspect;
        drawX = 0;
        drawY = (h - drawH) / 2;
    } else {
        drawH = h;
        drawW = h * imgAspect;
        drawX = (w - drawW) / 2;
        drawY = 0;
    }
    return { drawX, drawY, drawW, drawH };
}

function updateCropPreview() {
    const previewCanvas = document.getElementById('popout-crop-preview');
    if (!previewCanvas) return;
    const p = getSelectedPopout();
    const screenshot = getCurrentScreenshot();
    if (!p || !screenshot) return;
    const img = popoutSourceImage(p, screenshot);
    if (!img) return;

    // Resize canvas to match sidebar width while keeping image aspect
    const containerWidth = previewCanvas.parentElement?.clientWidth || 280;
    const imgAspect = img.width / img.height;
    const canvasW = containerWidth * 2; // 2x for retina
    const canvasH = Math.round(canvasW / imgAspect);
    previewCanvas.width = canvasW;
    previewCanvas.height = canvasH;
    previewCanvas.style.width = containerWidth + 'px';
    previewCanvas.style.height = Math.round(containerWidth / imgAspect) + 'px';

    const ctx2 = previewCanvas.getContext('2d');
    const layout = getCropPreviewLayout(previewCanvas, img);
    const { drawX, drawY, drawW, drawH } = layout;

    ctx2.clearRect(0, 0, canvasW, canvasH);

    // Draw full image
    ctx2.drawImage(img, drawX, drawY, drawW, drawH);

    // Dim overlay outside crop region
    const rx = drawX + (p.cropX / 100) * drawW;
    const ry = drawY + (p.cropY / 100) * drawH;
    const rw = (p.cropWidth / 100) * drawW;
    const rh = (p.cropHeight / 100) * drawH;

    ctx2.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx2.fillRect(0, 0, canvasW, canvasH);

    // Clear crop region to show undimmed image
    ctx2.save();
    ctx2.beginPath();
    ctx2.rect(rx, ry, rw, rh);
    ctx2.clip();
    ctx2.clearRect(rx, ry, rw, rh);
    ctx2.drawImage(img, drawX, drawY, drawW, drawH);
    ctx2.restore();

    // Crop border
    ctx2.strokeStyle = 'rgba(10, 132, 255, 0.9)';
    ctx2.lineWidth = 2;
    ctx2.strokeRect(rx, ry, rw, rh);

    // Corner handles (vector editor style)
    const handleSize = 8;
    const handles = [
        { x: rx, y: ry },                     // top-left
        { x: rx + rw, y: ry },                // top-right
        { x: rx, y: ry + rh },                // bottom-left
        { x: rx + rw, y: ry + rh },           // bottom-right
    ];
    // Edge midpoint handles
    const midHandles = [
        { x: rx + rw / 2, y: ry },            // top-center
        { x: rx + rw / 2, y: ry + rh },       // bottom-center
        { x: rx, y: ry + rh / 2 },            // left-center
        { x: rx + rw, y: ry + rh / 2 },       // right-center
    ];

    ctx2.fillStyle = '#ffffff';
    ctx2.strokeStyle = 'rgba(10, 132, 255, 1)';
    ctx2.lineWidth = 1.5;
    [...handles, ...midHandles].forEach(h => {
        ctx2.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        ctx2.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    });
}

// ===== Interactive crop preview drag =====
let cropDragState = null;

function setupCropPreviewDrag() {
    const previewCanvas = document.getElementById('popout-crop-preview');
    if (!previewCanvas) return;

    function getCropCanvasCoords(e) {
        const rect = previewCanvas.getBoundingClientRect();
        const scaleX = previewCanvas.width / rect.width;
        const scaleY = previewCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function hitTestCropHandle(coords) {
        const p = getSelectedPopout();
        const screenshot = getCurrentScreenshot();
        if (!p || !screenshot) return null;
        const img = popoutSourceImage(p, screenshot);
        if (!img) return null;

        const layout = getCropPreviewLayout(previewCanvas, img);
        const { drawX, drawY, drawW, drawH } = layout;
        const rx = drawX + (p.cropX / 100) * drawW;
        const ry = drawY + (p.cropY / 100) * drawH;
        const rw = (p.cropWidth / 100) * drawW;
        const rh = (p.cropHeight / 100) * drawH;

        const hitR = 12; // hit radius
        const tests = [
            { x: rx, y: ry, handle: 'top-left' },
            { x: rx + rw, y: ry, handle: 'top-right' },
            { x: rx, y: ry + rh, handle: 'bottom-left' },
            { x: rx + rw, y: ry + rh, handle: 'bottom-right' },
            { x: rx + rw / 2, y: ry, handle: 'top' },
            { x: rx + rw / 2, y: ry + rh, handle: 'bottom' },
            { x: rx, y: ry + rh / 2, handle: 'left' },
            { x: rx + rw, y: ry + rh / 2, handle: 'right' },
        ];
        for (const t of tests) {
            if (Math.abs(coords.x - t.x) < hitR && Math.abs(coords.y - t.y) < hitR) {
                return t.handle;
            }
        }
        // Check if inside the crop region (move)
        if (coords.x >= rx && coords.x <= rx + rw && coords.y >= ry && coords.y <= ry + rh) {
            return 'move';
        }
        return null;
    }

    function startCropDrag(e) {
        const coords = getCropCanvasCoords(e);
        const handle = hitTestCropHandle(coords);
        if (!handle) return;

        e.preventDefault();
        const p = getSelectedPopout();
        if (!p) return;
        cropDragState = {
            handle,
            startX: coords.x,
            startY: coords.y,
            origCropX: p.cropX,
            origCropY: p.cropY,
            origCropW: p.cropWidth,
            origCropH: p.cropHeight
        };
    }

    function moveCropDrag(e) {
        if (!cropDragState) {
            // Update cursor based on hover
            const coords = getCropCanvasCoords(e);
            const handle = hitTestCropHandle(coords);
            const cursorMap = {
                'top-left': 'nwse-resize', 'bottom-right': 'nwse-resize',
                'top-right': 'nesw-resize', 'bottom-left': 'nesw-resize',
                'top': 'ns-resize', 'bottom': 'ns-resize',
                'left': 'ew-resize', 'right': 'ew-resize',
                'move': 'move'
            };
            previewCanvas.style.cursor = cursorMap[handle] || 'default';
            return;
        }
        e.preventDefault();
        const coords = getCropCanvasCoords(e);
        const p = getSelectedPopout();
        const screenshot = getCurrentScreenshot();
        if (!p || !screenshot) return;
        const img = popoutSourceImage(p, screenshot);
        if (!img) return;

        const layout = getCropPreviewLayout(previewCanvas, img);
        const { drawW, drawH } = layout;

        // Convert pixel delta to percentage
        const dxPct = ((coords.x - cropDragState.startX) / drawW) * 100;
        const dyPct = ((coords.y - cropDragState.startY) / drawH) * 100;
        const h = cropDragState.handle;
        const orig = cropDragState;

        let newX = orig.origCropX, newY = orig.origCropY;
        let newW = orig.origCropW, newH = orig.origCropH;

        if (h === 'move') {
            newX = Math.max(0, Math.min(100 - newW, orig.origCropX + dxPct));
            newY = Math.max(0, Math.min(100 - newH, orig.origCropY + dyPct));
        } else {
            if (h.includes('left')) { newX = orig.origCropX + dxPct; newW = orig.origCropW - dxPct; }
            if (h.includes('right') || h === 'right') { newW = orig.origCropW + dxPct; }
            if (h.includes('top')) { newY = orig.origCropY + dyPct; newH = orig.origCropH - dyPct; }
            if (h.includes('bottom') || h === 'bottom') { newH = orig.origCropH + dyPct; }

            // Enforce minimums
            if (newW < 5) { if (h.includes('left')) newX = orig.origCropX + orig.origCropW - 5; newW = 5; }
            if (newH < 5) { if (h.includes('top')) newY = orig.origCropY + orig.origCropH - 5; newH = 5; }

            // Clamp to canvas bounds
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);
            if (newX + newW > 100) newW = 100 - newX;
            if (newY + newH > 100) newH = 100 - newY;
        }

        p.cropX = newX;
        p.cropY = newY;
        p.cropWidth = newW;
        p.cropHeight = newH;
        updateCropPreview();
        updatePopoutProperties();
        updateCanvas();
    }

    function endCropDrag() {
        cropDragState = null;
    }

    previewCanvas.addEventListener('mousedown', startCropDrag);
    window.addEventListener('mousemove', moveCropDrag);
    window.addEventListener('mouseup', endCropDrag);
    previewCanvas.addEventListener('touchstart', startCropDrag, { passive: false });
    previewCanvas.addEventListener('touchmove', (e) => { if (cropDragState) moveCropDrag(e); }, { passive: false });
    previewCanvas.addEventListener('touchend', endCropDrag);
}

function setupPopoutEventListeners() {
    // Add Popout button
    const addBtn = document.getElementById('add-popout-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => addPopout());
    }

    // Crop sliders
    const bindPopoutSlider = (id, key, suffix) => {
        const input = document.getElementById(id);
        const valueEl = document.getElementById(id + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            if (valueEl) valueEl.textContent = formatValue(val) + suffix;
            if (selectedPopoutId) setPopoutProperty(selectedPopoutId, key, val);
            if (key.startsWith('crop')) updateCropPreview();
        });
    };

    // Source screen change: re-aim the popout's crop at another device's image.
    document.getElementById('popout-source')?.addEventListener('change', (e) => {
        const p = getSelectedPopout();
        if (!p) return;
        p.source = e.target.value;
        updateCropPreview();
        updateCanvas();
        saveState();
    });

    bindPopoutSlider('popout-crop-x', 'cropX', '%');
    bindPopoutSlider('popout-crop-y', 'cropY', '%');
    bindPopoutSlider('popout-crop-width', 'cropWidth', '%');
    bindPopoutSlider('popout-crop-height', 'cropHeight', '%');
    bindPopoutSlider('popout-x', 'x', '%');
    bindPopoutSlider('popout-y', 'y', '%');
    bindPopoutSlider('popout-width', 'width', '%');
    bindPopoutSlider('popout-rotation', 'rotation', '°');
    bindPopoutSlider('popout-opacity', 'opacity', '%');
    bindPopoutSlider('popout-corner-radius', 'cornerRadius', 'px');

    // Shadow toggle
    const shadowToggle = document.getElementById('popout-shadow-toggle');
    if (shadowToggle) {
        shadowToggle.addEventListener('click', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.shadow.enabled = !p.shadow.enabled;
            updatePopoutProperties();
            updateCanvas();
        });
    }

    // Shadow properties
    const bindPopoutShadow = (inputId, prop, suffix) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(inputId + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.shadow[prop] = parseFloat(input.value);
            if (valEl) valEl.textContent = formatValue(parseFloat(input.value)) + suffix;
            updateCanvas();
        });
    };
    bindPopoutShadow('popout-shadow-blur', 'blur', 'px');
    bindPopoutShadow('popout-shadow-opacity', 'opacity', '%');
    bindPopoutShadow('popout-shadow-x', 'x', 'px');
    bindPopoutShadow('popout-shadow-y', 'y', 'px');

    // Shadow color
    const shadowColor = document.getElementById('popout-shadow-color');
    const shadowColorHex = document.getElementById('popout-shadow-color-hex');
    if (shadowColor) {
        shadowColor.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (p) { p.shadow.color = shadowColor.value; if (shadowColorHex) shadowColorHex.value = shadowColor.value; updateCanvas(); }
        });
    }
    if (shadowColorHex) {
        shadowColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(shadowColorHex.value)) {
                const p = getSelectedPopout();
                if (p) { p.shadow.color = shadowColorHex.value; if (shadowColor) shadowColor.value = shadowColorHex.value; updateCanvas(); }
            }
        });
    }

    // Border toggle
    const borderToggle = document.getElementById('popout-border-toggle');
    if (borderToggle) {
        borderToggle.addEventListener('click', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.border.enabled = !p.border.enabled;
            updatePopoutProperties();
            updateCanvas();
        });
    }

    // Border properties
    const bindPopoutBorder = (inputId, prop, suffix) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(inputId + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.border[prop] = parseFloat(input.value);
            if (valEl) valEl.textContent = formatValue(parseFloat(input.value)) + suffix;
            updateCanvas();
        });
    };
    bindPopoutBorder('popout-border-width', 'width', 'px');
    bindPopoutBorder('popout-border-opacity', 'opacity', '%');

    // Border color
    const borderColor = document.getElementById('popout-border-color');
    const borderColorHex = document.getElementById('popout-border-color-hex');
    if (borderColor) {
        borderColor.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (p) { p.border.color = borderColor.value; if (borderColorHex) borderColorHex.value = borderColor.value; updateCanvas(); }
        });
    }
    if (borderColorHex) {
        borderColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(borderColorHex.value)) {
                const p = getSelectedPopout();
                if (p) { p.border.color = borderColorHex.value; if (borderColor) borderColor.value = borderColorHex.value; updateCanvas(); }
            }
        });
    }

    // Interactive crop preview drag handles
    setupCropPreviewDrag();
}

function setupEventListeners() {
    // Collapsible toggle rows
    document.querySelectorAll('.toggle-row.collapsible').forEach(row => {
        row.addEventListener('click', (e) => {
            // Don't collapse when clicking the toggle switch itself
            if (e.target.closest('.toggle')) return;

            const targetId = row.dataset.target;
            const target = document.getElementById(targetId);
            if (target) {
                row.classList.toggle('collapsed');
                target.style.display = row.classList.contains('collapsed') ? 'none' : 'block';
            }
        });
    });

    // Text effect controls (stroke / shadow-glow / bubble / reveal) for the selected text element.
    setupElementTextEffectControls();

    // Multiple-devices controls (add / select / pose / replace-image / delete).
    setupExtraDeviceControls();

    // Global undo/redo: Cmd/Ctrl+Z to undo, Cmd/Ctrl+Shift+Z or Ctrl+Y to redo.
    // Skipped while typing in a field so native text undo still works there.
    document.addEventListener('keydown', (e) => {
        const key = (e.key || '').toLowerCase();
        if ((key !== 'z' && key !== 'y') || !(e.metaKey || e.ctrlKey)) return;
        const t = e.target;
        const tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        else { e.preventDefault(); undo(); }
    }, true);

    // Keyboard nudging of the active device: arrows move, Alt+arrows rotate (Y/X),
    // [ ] roll (Z), -/+ zoom. Acts on the selected extra device, else the primary.
    document.addEventListener('keydown', (e) => {
        if (handleDeviceNudgeKey(e)) e.preventDefault();
    }, false);

    // Pressing/releasing the rotate modifier while hovering a device toggles the rotate
    // hint without needing to move the mouse.
    const refreshRotateHintFromKeys = (e) => {
        if (draggingElement || draggingTransform || !_lastCanvasPointer) return;
        const rotateMod = (e.ctrlKey || e.metaKey) && !e.altKey;
        setRotateHint(rotateMod ? computeRotateHint(_lastCanvasPointer) : null);
    };
    document.addEventListener('keydown', refreshRotateHintFromKeys);
    document.addEventListener('keyup', refreshRotateHintFromKeys);
    const canvasWrapperForHint = document.getElementById('canvas-wrapper');
    if (canvasWrapperForHint) canvasWrapperForHint.addEventListener('mouseleave', () => { _lastCanvasPointer = null; setRotateHint(null); });

    // File upload
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Add screenshots button
    document.getElementById('add-screenshots-btn').addEventListener('click', () => fileInput.click());

    // Add blank screen button
    document.getElementById('add-blank-btn').addEventListener('click', () => {
        createNewScreenshot(null, null, 'Blank Screen', null, state.outputDevice);
        state.selectedIndex = state.screenshots.length - 1;
        updateScreenshotList();
        syncUIWithState();
        updateGradientStopsUI();
        updateCanvas();
    });

    // Make the entire sidebar content area a drop zone
    const sidebarContent = screenshotList.closest('.sidebar-content');
    sidebarContent.addEventListener('dragover', (e) => {
        // Only handle file drops, not internal screenshot reordering
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            sidebarContent.classList.add('drop-active');
        }
    });
    sidebarContent.addEventListener('dragleave', (e) => {
        // Only remove class if leaving the area entirely
        if (!sidebarContent.contains(e.relatedTarget)) {
            sidebarContent.classList.remove('drop-active');
        }
    });
    sidebarContent.addEventListener('drop', (e) => {
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            sidebarContent.classList.remove('drop-active');
            handleFiles(e.dataTransfer.files);
        }
    });

    // Drop an image directly onto a DEVICE to set that device's screen, keeping its
    // position/pose/frame. With multiple devices, the drop is location-specific: the
    // device under the cursor is highlighted green and receives the image (the primary
    // device is the default when you're not over a specific extra device). Videos and
    // the no-screenshot case fall back to the normal "create new screenshot" path.
    const canvasWrapper = document.getElementById('canvas-wrapper');
    if (canvasWrapper) {
        const isFileDrag = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
        const clearDropHighlight = () => {
            canvasWrapper.classList.remove('drop-active');
            if (_dropHighlightRect) { _dropHighlightRect = null; if (typeof drawSelectionOverlay === 'function') drawSelectionOverlay(); }
        };
        canvasWrapper.addEventListener('dragover', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const hasScreenshot = state.screenshots.length && state.selectedIndex >= 0;
            if (!hasScreenshot) {
                // No screen yet → show the full-canvas "drop to add" affordance.
                canvasWrapper.classList.add('drop-active');
                return;
            }
            // Highlight the device that will receive the drop.
            const p = canvasPixelFromEvent(e);
            const target = p ? deviceDropTargetAt(p.x, p.y) : null;
            const newRect = target ? target.rect : null;
            const changed = JSON.stringify(newRect) !== JSON.stringify(_dropHighlightRect);
            _dropHighlightRect = newRect;
            if (changed && typeof drawSelectionOverlay === 'function') drawSelectionOverlay();
        });
        canvasWrapper.addEventListener('dragleave', (e) => {
            if (!canvasWrapper.contains(e.relatedTarget)) clearDropHighlight();
        });
        canvasWrapper.addEventListener('drop', (e) => {
            if (!isFileDrag(e)) return;
            e.preventDefault();
            clearDropHighlight();
            const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
            if (!files.length) return;
            const first = files[0];
            // In-place swap only makes sense for an existing screenshot with an image file.
            if (!state.screenshots.length || state.selectedIndex < 0 || !first.type.startsWith('image/')) {
                handleFiles(e.dataTransfer.files);
                return;
            }
            const p = canvasPixelFromEvent(e);
            const target = p ? deviceDropTargetAt(p.x, p.y) : null;
            if (target && target.kind === 'extra') replaceExtraDeviceImage(target.dev, first);
            else replaceCurrentScreenImage(first); // primary (or default when over empty space)
        });
    }

    // Set as Default button (commented out)
    // document.getElementById('set-as-default-btn').addEventListener('click', () => {
    //     if (state.screenshots.length === 0) return;
    //     setCurrentScreenshotAsDefault();
    //     // Show brief confirmation
    //     const btn = document.getElementById('set-as-default-btn');
    //     const originalText = btn.textContent;
    //     btn.textContent = 'Saved!';
    //     btn.style.borderColor = 'var(--accent)';
    //     btn.style.color = 'var(--accent)';
    //     setTimeout(() => {
    //         btn.textContent = originalText;
    //         btn.style.borderColor = '';
    //         btn.style.color = '';
    //     }, 1500);
    // });

    // Project dropdown
    const projectDropdown = document.getElementById('project-dropdown');
    const projectTrigger = document.getElementById('project-trigger');

    projectTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        projectDropdown.classList.toggle('open');
        // Close output size dropdown if open
        document.getElementById('output-size-dropdown').classList.remove('open');
    });

    // Close project dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!projectDropdown.contains(e.target)) {
            projectDropdown.classList.remove('open');
        }
    });

    document.getElementById('new-project-btn').addEventListener('click', () => {
        document.getElementById('project-modal-title').textContent = 'New Project';
        document.getElementById('project-name-input').value = '';
        document.getElementById('project-modal-confirm').textContent = 'Create';
        document.getElementById('project-modal').dataset.mode = 'new';

        const duplicateGroup = document.getElementById('duplicate-from-group');
        const duplicateSelect = document.getElementById('duplicate-from-select');
        if (projects.length > 0) {
            duplicateGroup.style.display = 'block';
            duplicateSelect.innerHTML = '<option value="">None (empty project)</option>';
            projects.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name + (p.screenshotCount ? ` (${p.screenshotCount} screenshots)` : '');
                duplicateSelect.appendChild(option);
            });
        } else {
            duplicateGroup.style.display = 'none';
        }

        document.getElementById('project-modal').classList.add('visible');
        document.getElementById('project-name-input').focus();
    });

    document.getElementById('duplicate-from-select').addEventListener('change', (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
            const selectedProject = projects.find(p => p.id === selectedId);
            if (selectedProject) {
                document.getElementById('project-name-input').value = selectedProject.name + ' (Copy)';
            }
        } else {
            document.getElementById('project-name-input').value = '';
        }
    });

    document.getElementById('rename-project-btn').addEventListener('click', () => {
        const project = projects.find(p => p.id === currentProjectId);
        document.getElementById('project-modal-title').textContent = 'Rename Project';
        document.getElementById('project-name-input').value = project ? project.name : '';
        document.getElementById('project-modal-confirm').textContent = 'Rename';
        document.getElementById('project-modal').dataset.mode = 'rename';
        document.getElementById('duplicate-from-group').style.display = 'none';
        document.getElementById('project-modal').classList.add('visible');
        document.getElementById('project-name-input').focus();
    });

    document.getElementById('delete-project-btn').addEventListener('click', async () => {
        if (projects.length <= 1) {
            await showAppAlert('Cannot delete the only project', 'info');
            return;
        }
        const project = projects.find(p => p.id === currentProjectId);
        document.getElementById('delete-project-message').textContent =
            `Are you sure you want to delete "${project ? project.name : 'this project'}"? This cannot be undone.`;
        document.getElementById('delete-project-modal').classList.add('visible');
    });

    // Project modal buttons
    document.getElementById('project-modal-cancel').addEventListener('click', () => {
        document.getElementById('project-modal').classList.remove('visible');
    });

    document.getElementById('project-modal-confirm').addEventListener('click', async () => {
        const name = document.getElementById('project-name-input').value.trim();
        if (!name) {
            await showAppAlert('Please enter a project name', 'info');
            return;
        }

        const mode = document.getElementById('project-modal').dataset.mode;
        if (mode === 'new') {
            const duplicateFromId = document.getElementById('duplicate-from-select').value;
            if (duplicateFromId) {
                await duplicateProject(duplicateFromId, name);
            } else {
                createProject(name);
            }
        } else if (mode === 'rename') {
            renameProject(name);
        }

        document.getElementById('project-modal').classList.remove('visible');
    });

    document.getElementById('project-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('project-modal-confirm').click();
        }
    });

    // Delete project modal buttons
    document.getElementById('delete-project-cancel').addEventListener('click', () => {
        document.getElementById('delete-project-modal').classList.remove('visible');
    });

    document.getElementById('delete-project-confirm').addEventListener('click', () => {
        deleteProject();
        document.getElementById('delete-project-modal').classList.remove('visible');
    });

    // Export project backup
    document.getElementById('export-project-btn').addEventListener('click', async () => {
        if (!db) return;
        try {
            const dump = {};
            for (const name of db.objectStoreNames) {
                const tx = db.transaction(name, 'readonly');
                const store = tx.objectStore(name);
                dump[name] = await new Promise((resolve) => {
                    const req = store.getAll();
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve([]);
                });
            }
            const json = JSON.stringify(dump, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'appscreen-backup-' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (e) {
            console.error('Export failed:', e);
            alert('Export failed: ' + e.message);
        }
    });

    // Import project backup
    const importInput = document.getElementById('import-project-input');
    document.getElementById('import-project-btn').addEventListener('click', () => {
        importInput.click();
    });
    importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file || !db) return;
        try {
            const text = await file.text();
            const dump = JSON.parse(text);
            for (const storeName of Object.keys(dump)) {
                if (!db.objectStoreNames.contains(storeName)) continue;
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                for (const record of dump[storeName]) {
                    store.put(record);
                }
                await new Promise((resolve, reject) => {
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
            }
            alert('Import complete! Reloading...');
            location.reload();
        } catch (e) {
            console.error('Import failed:', e);
            alert('Import failed: ' + e.message);
        }
        importInput.value = '';
    });

    // Apply style to all modal buttons
    document.getElementById('apply-style-cancel').addEventListener('click', () => {
        document.getElementById('apply-style-modal').classList.remove('visible');
    });

    document.getElementById('apply-style-confirm').addEventListener('click', () => {
        applyStyleToAll();
        document.getElementById('apply-style-modal').classList.remove('visible');
    });

    // Close modals on overlay click
    document.getElementById('project-modal').addEventListener('click', (e) => {
        if (e.target.id === 'project-modal') {
            document.getElementById('project-modal').classList.remove('visible');
        }
    });

    document.getElementById('delete-project-modal').addEventListener('click', (e) => {
        if (e.target.id === 'delete-project-modal') {
            document.getElementById('delete-project-modal').classList.remove('visible');
        }
    });

    document.getElementById('apply-style-modal').addEventListener('click', (e) => {
        if (e.target.id === 'apply-style-modal') {
            document.getElementById('apply-style-modal').classList.remove('visible');
        }
    });

    // Language picker events
    document.getElementById('language-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const menu = document.getElementById('language-menu');
        menu.classList.toggle('visible');
        if (menu.classList.contains('visible')) {
            // Position menu below button using fixed positioning
            const rect = btn.getBoundingClientRect();
            menu.style.top = (rect.bottom + 4) + 'px';
            menu.style.left = rect.left + 'px';
            updateLanguageMenu();
        }
    });

    // Close language menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.language-picker')) {
            document.getElementById('language-menu').classList.remove('visible');
        }
    });

    // Edit Languages button
    document.getElementById('edit-languages-btn').addEventListener('click', () => {
        openLanguagesModal();
    });

    // Translate All button
    document.getElementById('translate-all-btn').addEventListener('click', () => {
        document.getElementById('language-menu').classList.remove('visible');
        translateAllText();
    });

    // Magical Titles button (in header)
    document.getElementById('magical-titles-btn').addEventListener('click', () => {
        dismissMagicalTitlesTooltip();
        showMagicalTitlesDialog();
    });

    // Magical Titles modal events
    document.getElementById('magical-titles-cancel').addEventListener('click', hideMagicalTitlesDialog);
    document.getElementById('magical-titles-confirm').addEventListener('click', generateMagicalTitles);
    document.getElementById('magical-titles-modal').addEventListener('click', (e) => {
        if (e.target.id === 'magical-titles-modal') hideMagicalTitlesDialog();
    });

    // Languages modal events
    document.getElementById('languages-modal-close').addEventListener('click', closeLanguagesModal);
    document.getElementById('languages-modal-done').addEventListener('click', closeLanguagesModal);
    document.getElementById('languages-modal').addEventListener('click', (e) => {
        if (e.target.id === 'languages-modal') closeLanguagesModal();
    });

    document.getElementById('add-language-select').addEventListener('change', (e) => {
        if (e.target.value) {
            addProjectLanguage(e.target.value);
            e.target.value = '';
        }
    });

    // Screenshot translations modal events
    document.getElementById('screenshot-translations-modal-close').addEventListener('click', closeScreenshotTranslationsModal);
    document.getElementById('screenshot-translations-modal-done').addEventListener('click', closeScreenshotTranslationsModal);
    document.getElementById('screenshot-translations-modal').addEventListener('click', (e) => {
        if (e.target.id === 'screenshot-translations-modal') closeScreenshotTranslationsModal();
    });
    document.getElementById('translation-file-input').addEventListener('change', handleTranslationFileSelect);

    // Export language modal events
    document.getElementById('export-current-only').addEventListener('click', () => {
        closeExportLanguageDialog('current');
    });
    document.getElementById('export-all-languages').addEventListener('click', () => {
        closeExportLanguageDialog('all');
    });
    document.getElementById('export-language-modal-cancel').addEventListener('click', () => {
        closeExportLanguageDialog(null);
    });
    document.getElementById('export-language-modal').addEventListener('click', (e) => {
        if (e.target.id === 'export-language-modal') closeExportLanguageDialog(null);
    });

    // Duplicate screenshot dialog
    initDuplicateDialogListeners();
    document.getElementById('duplicate-screenshot-modal').addEventListener('click', (e) => {
        if (e.target.id === 'duplicate-screenshot-modal') closeDuplicateDialog('ignore');
    });

    // Translate button (text elements)
    document.getElementById('translate-element-btn').addEventListener('click', () => {
        openTranslateModal('element');
    });

    document.getElementById('translate-source-lang').addEventListener('change', (e) => {
        updateTranslateSourcePreview();
    });

    document.getElementById('translate-modal-cancel').addEventListener('click', () => {
        document.getElementById('translate-modal').classList.remove('visible');
    });

    document.getElementById('translate-modal-apply').addEventListener('click', () => {
        applyTranslations();
        document.getElementById('translate-modal').classList.remove('visible');
    });

    document.getElementById('ai-translate-btn').addEventListener('click', () => {
        aiTranslateAll();
    });

    document.getElementById('translate-modal').addEventListener('click', (e) => {
        if (e.target.id === 'translate-modal') {
            document.getElementById('translate-modal').classList.remove('visible');
        }
    });

    // About modal
    document.getElementById('about-btn').addEventListener('click', () => {
        document.getElementById('about-modal').classList.add('visible');
    });

    document.getElementById('about-modal-close').addEventListener('click', () => {
        document.getElementById('about-modal').classList.remove('visible');
    });

    document.getElementById('about-modal').addEventListener('click', (e) => {
        if (e.target.id === 'about-modal') {
            document.getElementById('about-modal').classList.remove('visible');
        }
    });

    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', () => {
        openSettingsModal();
    });

    document.getElementById('settings-modal-close').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('visible');
    });

    document.getElementById('settings-modal-cancel').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('visible');
    });

    document.getElementById('settings-modal-save').addEventListener('click', () => {
        saveSettings();
    });

    // Theme selector buttons
    document.querySelectorAll('#theme-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#theme-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTheme(btn.dataset.theme);
        });
    });

    // Provider radio buttons
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateProviderSection(e.target.value);
        });
    });

    // Show/hide key buttons for all providers
    document.querySelectorAll('.settings-show-key').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                input.type = input.type === 'password' ? 'text' : 'password';
            }
        });
    });

    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') {
            document.getElementById('settings-modal').classList.remove('visible');
        }
    });

    // Output size dropdown
    const outputDropdown = document.getElementById('output-size-dropdown');
    const outputTrigger = document.getElementById('output-size-trigger');

    outputTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        outputDropdown.classList.toggle('open');
        // Close project dropdown if open
        document.getElementById('project-dropdown').classList.remove('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!outputDropdown.contains(e.target)) {
            outputDropdown.classList.remove('open');
        }
    });

    // Device option selection
    document.querySelectorAll('.output-size-menu .device-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.output-size-menu .device-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            state.outputDevice = opt.dataset.device;

            // Update trigger text
            document.getElementById('output-size-name').textContent = opt.querySelector('.device-option-name').textContent;
            document.getElementById('output-size-dims').textContent = opt.querySelector('.device-option-size').textContent;

            // Show/hide custom inputs
            const customInputs = document.getElementById('custom-size-inputs');
            if (state.outputDevice === 'custom') {
                customInputs.classList.add('visible');
            } else {
                customInputs.classList.remove('visible');
                outputDropdown.classList.remove('open');
            }
            updateCanvas();
        });
    });

    // Custom size inputs
    document.getElementById('custom-width').addEventListener('input', (e) => {
        state.customWidth = parseInt(e.target.value) || 1290;
        document.getElementById('output-size-dims').textContent = `${state.customWidth} × ${state.customHeight}`;
        updateCanvas();
    });
    document.getElementById('custom-height').addEventListener('input', (e) => {
        state.customHeight = parseInt(e.target.value) || 2796;
        document.getElementById('output-size-dims').textContent = `${state.customWidth} × ${state.customHeight}`;
        updateCanvas();
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            // Save active tab to localStorage
            localStorage.setItem('activeTab', tab.dataset.tab);
        });
    });

    // Restore active tab from localStorage
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab) {
        const tabBtn = document.querySelector(`.tab[data-tab="${savedTab}"]`);
        if (tabBtn) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tabBtn.classList.add('active');
            document.getElementById('tab-' + savedTab).classList.add('active');
        }
    }

    // Background type selector
    document.querySelectorAll('#bg-type-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#bg-type-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setBackground('type', btn.dataset.type);

            document.getElementById('gradient-options').style.display = btn.dataset.type === 'gradient' ? 'block' : 'none';
            document.getElementById('solid-options').style.display = btn.dataset.type === 'solid' ? 'block' : 'none';
            document.getElementById('image-options').style.display = btn.dataset.type === 'image' ? 'block' : 'none';

            updateCanvas();
        });
    });

    // Gradient preset dropdown toggle
    const presetDropdown = document.getElementById('gradient-preset-dropdown');
    const presetTrigger = document.getElementById('gradient-preset-trigger');
    presetTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        presetDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!presetDropdown.contains(e.target)) {
            presetDropdown.classList.remove('open');
        }
    });

    // Position preset dropdown toggle
    const positionPresetDropdown = document.getElementById('position-preset-dropdown');
    const positionPresetTrigger = document.getElementById('position-preset-trigger');
    positionPresetTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        positionPresetDropdown.classList.toggle('open');
    });

    // Close position preset dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!positionPresetDropdown.contains(e.target)) {
            positionPresetDropdown.classList.remove('open');
        }
    });

    // Close screenshot menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.screenshot-menu-wrapper')) {
            document.querySelectorAll('.screenshot-menu.open').forEach(m => m.classList.remove('open'));
        }
    });

    // Gradient presets
    document.querySelectorAll('.preset-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');

            // Parse gradient from preset
            const gradientStr = swatch.dataset.gradient;
            const angleMatch = gradientStr.match(/(\d+)deg/);
            const colorMatches = gradientStr.matchAll(/(#[a-fA-F0-9]{6})\s+(\d+)%/g);

            if (angleMatch) {
                const angle = parseInt(angleMatch[1]);
                setBackground('gradient.angle', angle);
                document.getElementById('gradient-angle').value = angle;
                document.getElementById('gradient-angle-value').textContent = formatValue(angle) + '°';
            }

            const stops = [];
            for (const match of colorMatches) {
                stops.push({ color: match[1], position: parseInt(match[2]) });
            }
            if (stops.length >= 2) {
                setBackground('gradient.stops', stops);
                updateGradientStopsUI();
            }

            updateCanvas();
        });
    });

    // Gradient angle
    document.getElementById('gradient-angle').addEventListener('input', (e) => {
        setBackground('gradient.angle', parseInt(e.target.value));
        document.getElementById('gradient-angle-value').textContent = formatValue(e.target.value) + '°';
        // Deselect preset when manually changing angle
        document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
        updateCanvas();
    });

    // Add gradient stop
    document.getElementById('add-gradient-stop').addEventListener('click', () => {
        const bg = getBackground();
        const lastStop = bg.gradient.stops[bg.gradient.stops.length - 1];
        bg.gradient.stops.push({
            color: lastStop.color,
            position: Math.min(lastStop.position + 20, 100)
        });
        // Deselect preset when adding a stop
        document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
        updateGradientStopsUI();
        updateCanvas();
    });

    // Solid color
    document.getElementById('solid-color').addEventListener('input', (e) => {
        setBackground('solid', e.target.value);
        document.getElementById('solid-color-hex').value = e.target.value;
        updateCanvas();
    });
    document.getElementById('solid-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            setBackground('solid', e.target.value);
            document.getElementById('solid-color').value = e.target.value;
            updateCanvas();
        }
    });

    // Background image
    const bgImageUpload = document.getElementById('bg-image-upload');
    const bgImageInput = document.getElementById('bg-image-input');
    bgImageUpload.addEventListener('click', () => bgImageInput.click());
    bgImageInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    setBackground('image', img);
                    document.getElementById('bg-image-preview').src = event.target.result;
                    document.getElementById('bg-image-preview').style.display = 'block';
                    updateCanvas();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    document.getElementById('bg-image-fit').addEventListener('change', (e) => {
        setBackground('imageFit', e.target.value);
        updateCanvas();
    });

    document.getElementById('bg-blur').addEventListener('input', (e) => {
        setBackground('imageBlur', parseInt(e.target.value));
        document.getElementById('bg-blur-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('bg-overlay-color').addEventListener('input', (e) => {
        setBackground('overlayColor', e.target.value);
        document.getElementById('bg-overlay-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('bg-overlay-opacity').addEventListener('input', (e) => {
        setBackground('overlayOpacity', parseInt(e.target.value));
        document.getElementById('bg-overlay-opacity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // Noise toggle
    document.getElementById('noise-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const noiseEnabled = this.classList.contains('active');
        setBackground('noise', noiseEnabled);
        const row = this.closest('.toggle-row');
        if (noiseEnabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('noise-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('noise-options').style.display = 'none';
        }
        updateCanvas();
    });

    document.getElementById('noise-intensity').addEventListener('input', (e) => {
        setBackground('noiseIntensity', parseInt(e.target.value));
        document.getElementById('noise-intensity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // --- Effects tab -------------------------------------------------------
    const fxToggle = (toggleId, optionsId, key) => {
        const t = document.getElementById(toggleId);
        if (!t) return;
        t.addEventListener('click', function () {
            this.classList.toggle('active');
            const on = this.classList.contains('active');
            setEffect(key, on);
            const row = this.closest('.toggle-row');
            if (row) row.classList.toggle('collapsed', !on);
            const opts = document.getElementById(optionsId);
            if (opts) opts.style.display = on ? 'block' : 'none';
            updateCanvas();
        });
    };
    const fxRange = (id, key, suffix) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10);
            setEffect(key, v);
            const lab = document.getElementById(id + '-value');
            if (lab) lab.textContent = formatValue(v) + (suffix || '');
            updateCanvas();
        });
    };
    const fxChoice = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        const handler = (e) => { setEffect(key, e.target.value); updateCanvas(); };
        el.addEventListener('change', handler);
        if (el.type === 'color') el.addEventListener('input', handler); // live while dragging the picker
    };

    fxToggle('fx-colorgrade-toggle', 'fx-colorgrade-options', 'colorGrade.enabled');
    fxRange('fx-cg-temp', 'colorGrade.temperature', '');
    fxRange('fx-cg-tint', 'colorGrade.tint', '');
    fxRange('fx-cg-sat', 'colorGrade.saturation', '');
    fxRange('fx-cg-bright', 'colorGrade.brightness', '');
    fxRange('fx-cg-contrast', 'colorGrade.contrast', '');

    fxToggle('fx-gobo-toggle', 'fx-gobo-options', 'gobo.enabled');
    fxChoice('fx-gobo-pattern', 'gobo.pattern');
    fxRange('fx-gobo-intensity', 'gobo.intensity', '%');
    fxRange('fx-gobo-scale', 'gobo.scale', '%');
    fxRange('fx-gobo-angle', 'gobo.angle', '°');
    fxRange('fx-gobo-blur', 'gobo.blur', 'px');
    fxRange('fx-gobo-x', 'gobo.x', '%');
    fxRange('fx-gobo-y', 'gobo.y', '%');

    fxToggle('fx-bloom-toggle', 'fx-bloom-options', 'bloom.enabled');
    fxRange('fx-bloom-intensity', 'bloom.intensity', '%');
    fxRange('fx-bloom-threshold', 'bloom.threshold', '%');
    fxRange('fx-bloom-radius', 'bloom.radius', 'px');

    fxToggle('fx-leak-toggle', 'fx-leak-options', 'lightLeak.enabled');
    fxRange('fx-leak-intensity', 'lightLeak.intensity', '%');
    fxChoice('fx-leak-color', 'lightLeak.color');
    fxChoice('fx-leak-position', 'lightLeak.position');

    fxToggle('fx-vignette-toggle', 'fx-vignette-options', 'vignette.enabled');
    fxRange('fx-vignette-amount', 'vignette.amount', '%');
    fxRange('fx-vignette-softness', 'vignette.softness', '%');
    fxChoice('fx-vignette-color', 'vignette.color');

    fxToggle('fx-mblur-toggle', 'fx-mblur-options', 'motionBlur.enabled');
    fxRange('fx-mblur-amount', 'motionBlur.amount', '%');
    fxRange('fx-mblur-samples', 'motionBlur.samples', '');

    // Screenshot settings
    document.getElementById('screenshot-scale').addEventListener('input', (e) => {
        setScreenshotSetting('scale', parseInt(e.target.value));
        document.getElementById('screenshot-scale-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('screenshot-y').addEventListener('input', (e) => {
        setScreenshotSetting('y', parseInt(e.target.value));
        document.getElementById('screenshot-y-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('screenshot-x').addEventListener('input', (e) => {
        setScreenshotSetting('x', parseInt(e.target.value));
        document.getElementById('screenshot-x-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('corner-radius').addEventListener('input', (e) => {
        setScreenshotSetting('cornerRadius', parseInt(e.target.value));
        document.getElementById('corner-radius-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    const frameStyleSelect = document.getElementById('frame-style-select');
    if (frameStyleSelect) {
        frameStyleSelect.addEventListener('change', (e) => {
            setScreenshotSetting('frameStyle', e.target.value);
            updateCanvas();
        });
    }

    document.getElementById('screenshot-rotation').addEventListener('input', (e) => {
        setScreenshotSetting('rotation', parseInt(e.target.value));
        document.getElementById('screenshot-rotation-value').textContent = formatValue(e.target.value) + '°';
        updateCanvas();
    });

    // Shadow toggle
    document.getElementById('shadow-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const shadowEnabled = this.classList.contains('active');
        setScreenshotSetting('shadow.enabled', shadowEnabled);
        const row = this.closest('.toggle-row');
        if (shadowEnabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('shadow-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('shadow-options').style.display = 'none';
        }
        updateCanvas();
    });

    document.getElementById('shadow-style').addEventListener('change', (e) => {
        setScreenshotSetting('shadow.style', e.target.value);
        updateCanvas();
    });

    document.getElementById('shadow-color').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.color', e.target.value);
        document.getElementById('shadow-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('shadow-blur').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.blur', parseInt(e.target.value));
        document.getElementById('shadow-blur-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('shadow-opacity').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.opacity', parseInt(e.target.value));
        document.getElementById('shadow-opacity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('shadow-x').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.x', parseInt(e.target.value));
        document.getElementById('shadow-x-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('shadow-y').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.y', parseInt(e.target.value));
        document.getElementById('shadow-y-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    // 3D wall-shadow controls (reuse shadow.blur as softness, shadow.opacity as strength)
    document.getElementById('shadow-3d-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        setScreenshotSetting('shadow.enabled', this.classList.contains('active'));
        updateCanvas();
    });
    document.getElementById('shadow-3d-softness').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.blur', parseInt(e.target.value));
        document.getElementById('shadow-3d-softness-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });
    document.getElementById('shadow-3d-strength').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.opacity', parseInt(e.target.value));
        document.getElementById('shadow-3d-strength-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });
    setupLightDirectionPicker();

    // Frame toggle
    document.getElementById('frame-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const frameEnabled = this.classList.contains('active');
        setScreenshotSetting('frame.enabled', frameEnabled);
        const row = this.closest('.toggle-row');
        if (frameEnabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('frame-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('frame-options').style.display = 'none';
        }
        updateCanvas();
    });

    document.getElementById('frame-color').addEventListener('input', (e) => {
        setScreenshotSetting('frame.color', e.target.value);
        document.getElementById('frame-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('frame-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            setScreenshotSetting('frame.color', e.target.value);
            document.getElementById('frame-color').value = e.target.value;
            updateCanvas();
        }
    });

    document.getElementById('frame-width').addEventListener('input', (e) => {
        setScreenshotSetting('frame.width', parseInt(e.target.value));
        document.getElementById('frame-width-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('frame-opacity').addEventListener('input', (e) => {
        setScreenshotSetting('frame.opacity', parseInt(e.target.value));
        document.getElementById('frame-opacity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // (Headline/subheadline text-tab listeners removed — text is now text elements.)

    // Export buttons
    document.getElementById('export-current').addEventListener('click', exportCurrent);
    document.getElementById('export-all').addEventListener('click', exportAll);
    document.getElementById('export-video').addEventListener('click', exportVideo);

    // Position presets
    document.querySelectorAll('.position-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.position-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyPositionPreset(btn.dataset.preset);
        });
    });

    // Device type selector (2D/3D)
    document.querySelectorAll('#device-type-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#device-type-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const use3D = btn.dataset.type === '3d';
            setScreenshotSetting('use3D', use3D);
            document.getElementById('rotation-3d-options').style.display = use3D ? 'block' : 'none';

            // Hide 2D-only settings in 3D mode, show 3D tip
            document.getElementById('2d-only-settings').style.display = use3D ? 'none' : 'block';
            document.getElementById('position-presets-section').style.display = use3D ? 'none' : 'block';
            document.getElementById('frame-color-section').style.display = use3D ? 'block' : 'none';
            const shadow3dSec = document.getElementById('shadow-3d-section');
            if (shadow3dSec) shadow3dSec.style.display = use3D ? 'block' : 'none';
            document.getElementById('3d-tip').style.display = use3D ? 'flex' : 'none';

            if (typeof showThreeJS === 'function') {
                showThreeJS(use3D);
            }

            if (use3D && typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }

            updateCanvas();
        });
    });

    // 3D device model selector
    document.querySelectorAll('#device-3d-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#device-3d-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const device3D = btn.dataset.model;
            setScreenshotSetting('device3D', device3D);

            // Landscape devices (MacBook) read best dead-centered, so default their
            // position to 50/50 (center) rather than the phone-tuned offset that leaves
            // headline room at the top.
            if (device3D === 'macbook') {
                setScreenshotSetting('x', 50);
                setScreenshotSetting('y', 50);
            }

            // Reset frame color to first preset for new device
            const presets = typeof frameColorPresets !== 'undefined' ? frameColorPresets[device3D] : null;
            const defaultColor = presets ? presets[0].id : null;
            setScreenshotSetting('frameColor', defaultColor);
            updateFrameColorSwatches(device3D, defaultColor);

            if (typeof switchPhoneModel === 'function') {
                switchPhoneModel(device3D);
            }

            // Apply default frame color after model switch
            if (defaultColor && typeof setPhoneFrameColor === 'function') {
                setTimeout(() => setPhoneFrameColor(defaultColor, device3D), 100);
            }

            if (typeof syncUIWithState === 'function') syncUIWithState();
            updateCanvas();
        });
    });

    // HDR environment picker — swaps the scene's reflection map on the fly.
    const hdrSelect = document.getElementById('hdr-select');
    if (hdrSelect) {
        hdrSelect.addEventListener('change', (e) => {
            if (typeof setupEnvironment === 'function') {
                setupEnvironment(e.target.value);
            }
        });
    }

    // 3D rotation controls — one handler per axis, with a soft detent at 0° so the
    // neutral pose is easy to hit while scrubbing.
    ['x', 'y', 'z'].forEach(axis => {
        const slider = document.getElementById('rotation-3d-' + axis);
        slider.addEventListener('input', (e) => {
            const ss = getScreenshotSettings();
            if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
            let v = parseInt(e.target.value);
            if (Math.abs(v) <= 3) { v = 0; e.target.value = 0; } // 0° detent
            ss.rotation3D[axis] = v;
            document.getElementById('rotation-3d-' + axis + '-value').textContent = formatValue(v) + '°';
            if (typeof setThreeJSRotation === 'function') {
                setThreeJSRotation(ss.rotation3D.x, ss.rotation3D.y, ss.rotation3D.z);
            }
            if (typeof autoKeyTouch === 'function') autoKeyTouch('screenshot.rotation3D.' + axis);
            if (typeof updatePoseChipActive === 'function') updatePoseChipActive();
            updateCanvas(); // Keep export canvas in sync
        });
    });

    // Pose preset chips: one click eases the device into a curated marketing pose.
    document.querySelectorAll('#pose-chips button').forEach(btn => {
        btn.addEventListener('click', () => {
            const pose = DEVICE_POSES[btn.dataset.pose];
            if (!pose) return;
            if (typeof animateDeviceRotationTo === 'function') {
                animateDeviceRotationTo(pose.x, pose.y, pose.z);
            }
        });
    });

    // Custom pose prefabs: "+ Save Pose" stores the current Tilt/Turn/Roll under a
    // name; saved poses render as chips next to it (× on hover deletes).
    document.getElementById('save-pose-chip')?.addEventListener('click', () => {
        const ss = getScreenshotSettings();
        const r = ss?.rotation3D || { x: 0, y: 0, z: 0 };
        const name = prompt('Name this pose', 'My Pose ' + (getCustomPoses().length + 1));
        if (!name) return;
        const poses = getCustomPoses();
        poses.push({
            id: crypto.randomUUID(),
            name: name.trim().slice(0, 24) || 'My Pose',
            x: Math.round(r.x), y: Math.round(r.y), z: Math.round(r.z)
        });
        saveCustomPoses(poses);
        renderCustomPoseChips();
    });
    renderCustomPoseChips();
}

// ---- Custom pose prefabs (persisted across projects via localStorage) ----------
const CUSTOM_POSES_KEY = 'shotscraft-custom-poses';

function getCustomPoses() {
    try {
        const v = JSON.parse(localStorage.getItem(CUSTOM_POSES_KEY));
        return Array.isArray(v) ? v : [];
    } catch (_) { return []; }
}

function saveCustomPoses(poses) {
    try { localStorage.setItem(CUSTOM_POSES_KEY, JSON.stringify(poses)); } catch (_) {}
}

function renderCustomPoseChips() {
    const wrap = document.getElementById('custom-pose-chips');
    if (!wrap) return;
    wrap.querySelectorAll('.pose-custom').forEach(n => n.remove());
    const saveChip = document.getElementById('save-pose-chip');
    getCustomPoses().forEach(p => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'pose-custom';
        chip.dataset.customId = p.id;
        chip.title = `Tilt ${p.x}° · Turn ${p.y}° · Roll ${p.z}°`;
        chip.textContent = p.name;
        chip.addEventListener('click', () => {
            if (typeof animateDeviceRotationTo === 'function') {
                animateDeviceRotationTo(p.x, p.y, p.z);
            }
        });
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'pose-del';
        del.title = 'Delete this pose';
        del.textContent = '×';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            saveCustomPoses(getCustomPoses().filter(q => q.id !== p.id));
            renderCustomPoseChips();
        });
        chip.appendChild(del);
        wrap.insertBefore(chip, saveChip);
    });
    updatePoseChipActive();
}

// Curated device poses (degrees). Tuned for the 3D iPhone but they read well on
// every model; the chips in the Device tab animate the device to these.
const DEVICE_POSES = {
    'front':       { x: 0,  y: 0,   z: 0 },
    'angle-left':  { x: 2,  y: -24, z: 0 },
    'angle-right': { x: 2,  y: 24,  z: 0 },
    'hero-left':   { x: 12, y: -32, z: -6 },
    'hero-right':  { x: 12, y: 32,  z: 6 },
    'laid-back':   { x: 48, y: -14, z: -10 }
};

// Highlight the pose chip matching the current rotation (if any) — gives the
// chips a selected state and doubles as a readout of "you're on a known pose".
function updatePoseChipActive() {
    const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
    const r = ss?.rotation3D || { x: 0, y: 0, z: 0 };
    const matches = (p) => p && Math.abs(r.x - p.x) < 1 && Math.abs(r.y - p.y) < 1 && Math.abs(r.z - p.z) < 1;
    document.querySelectorAll('#pose-chips button').forEach(chip => {
        chip.classList.toggle('active', !!matches(DEVICE_POSES[chip.dataset.pose]));
    });
    const custom = (typeof getCustomPoses === 'function') ? getCustomPoses() : [];
    document.querySelectorAll('#custom-pose-chips .pose-custom').forEach(chip => {
        chip.classList.toggle('active', !!matches(custom.find(p => p.id === chip.dataset.customId)));
    });
}

// Per-screenshot mode is now always active (all settings are per-screenshot)
function isPerScreenshotTextMode() {
    return true;
}

// Global language picker functions
function updateLanguageMenu() {
    const container = document.getElementById('language-menu-items');
    container.innerHTML = '';

    state.projectLanguages.forEach(lang => {
        const btn = document.createElement('button');
        btn.className = 'language-menu-item' + (lang === state.currentLanguage ? ' active' : '');
        btn.innerHTML = `<span class="flag">${languageFlags[lang] || '🏳️'}</span> ${languageNames[lang] || lang.toUpperCase()}`;
        btn.onclick = () => {
            switchGlobalLanguage(lang);
            document.getElementById('language-menu').classList.remove('visible');
        };
        container.appendChild(btn);
    });
}

function updateLanguageButton() {
    const flag = languageFlags[state.currentLanguage] || '🏳️';
    document.getElementById('language-btn-flag').textContent = flag;
}

function switchGlobalLanguage(lang) {
    state.currentLanguage = lang;

    // Update all screenshots to use this language for display
    state.screenshots.forEach(screenshot => {
        screenshot.text.currentHeadlineLang = lang;
        screenshot.text.currentSubheadlineLang = lang;
    });

    // Update UI
    updateLanguageButton();
    syncUIWithState();
    updateCanvas();
    saveState();
}

// Languages modal functions
function openLanguagesModal() {
    document.getElementById('language-menu').classList.remove('visible');
    document.getElementById('languages-modal').classList.add('visible');
    updateLanguagesList();
    updateAddLanguageSelect();
}

function closeLanguagesModal() {
    document.getElementById('languages-modal').classList.remove('visible');
}

function updateLanguagesList() {
    const container = document.getElementById('languages-list');
    container.innerHTML = '';

    state.projectLanguages.forEach(lang => {
        const item = document.createElement('div');
        item.className = 'language-item';

        const flag = languageFlags[lang] || '🏳️';
        const name = languageNames[lang] || lang.toUpperCase();
        const isCurrent = lang === state.currentLanguage;
        const isOnly = state.projectLanguages.length === 1;

        item.innerHTML = `
            <span class="flag">${flag}</span>
            <span class="name">${name}</span>
            ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
            <button class="remove-btn" ${isOnly ? 'disabled' : ''} title="${isOnly ? 'Cannot remove the only language' : 'Remove language'}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        const removeBtn = item.querySelector('.remove-btn');
        if (!isOnly) {
            removeBtn.addEventListener('click', () => removeProjectLanguage(lang));
        }

        container.appendChild(item);
    });
}

function updateAddLanguageSelect() {
    const select = document.getElementById('add-language-select');
    select.innerHTML = '<option value="">Add a language...</option>';

    // Add all available languages that aren't already in the project
    Object.keys(languageNames).forEach(lang => {
        if (!state.projectLanguages.includes(lang)) {
            const flag = languageFlags[lang] || '🏳️';
            const name = languageNames[lang];
            const option = document.createElement('option');
            option.value = lang;
            option.textContent = `${flag} ${name}`;
            select.appendChild(option);
        }
    });
}

function addProjectLanguage(lang) {
    if (!lang || state.projectLanguages.includes(lang)) return;

    state.projectLanguages.push(lang);

    // Add the language to all screenshots' text settings
    state.screenshots.forEach(screenshot => {
        if (!screenshot.text.headlineLanguages.includes(lang)) {
            screenshot.text.headlineLanguages.push(lang);
            if (!screenshot.text.headlines) screenshot.text.headlines = { en: '' };
            screenshot.text.headlines[lang] = '';
        }
        if (!screenshot.text.subheadlineLanguages.includes(lang)) {
            screenshot.text.subheadlineLanguages.push(lang);
            if (!screenshot.text.subheadlines) screenshot.text.subheadlines = { en: '' };
            screenshot.text.subheadlines[lang] = '';
        }
    });

    // Also update defaults
    if (!state.defaults.text.headlineLanguages.includes(lang)) {
        state.defaults.text.headlineLanguages.push(lang);
        if (!state.defaults.text.headlines) state.defaults.text.headlines = { en: '' };
        state.defaults.text.headlines[lang] = '';
    }
    if (!state.defaults.text.subheadlineLanguages.includes(lang)) {
        state.defaults.text.subheadlineLanguages.push(lang);
        if (!state.defaults.text.subheadlines) state.defaults.text.subheadlines = { en: '' };
        state.defaults.text.subheadlines[lang] = '';
    }

    updateLanguagesList();
    updateAddLanguageSelect();
    updateLanguageMenu();
    saveState();
}

function removeProjectLanguage(lang) {
    if (state.projectLanguages.length <= 1) return; // Must have at least one language

    const index = state.projectLanguages.indexOf(lang);
    if (index > -1) {
        state.projectLanguages.splice(index, 1);

        // If removing the current language, switch to the first available
        if (state.currentLanguage === lang) {
            switchGlobalLanguage(state.projectLanguages[0]);
        }

        // Remove from all screenshots
        state.screenshots.forEach(screenshot => {
            const hIndex = screenshot.text.headlineLanguages.indexOf(lang);
            if (hIndex > -1) {
                screenshot.text.headlineLanguages.splice(hIndex, 1);
                delete screenshot.text.headlines[lang];
            }
            const sIndex = screenshot.text.subheadlineLanguages.indexOf(lang);
            if (sIndex > -1) {
                screenshot.text.subheadlineLanguages.splice(sIndex, 1);
                delete screenshot.text.subheadlines[lang];
            }
            if (screenshot.text.currentHeadlineLang === lang) {
                screenshot.text.currentHeadlineLang = state.projectLanguages[0];
            }
            if (screenshot.text.currentSubheadlineLang === lang) {
                screenshot.text.currentSubheadlineLang = state.projectLanguages[0];
            }
        });

        // Remove from defaults
        const dhIndex = state.defaults.text.headlineLanguages.indexOf(lang);
        if (dhIndex > -1) {
            state.defaults.text.headlineLanguages.splice(dhIndex, 1);
            delete state.defaults.text.headlines[lang];
        }
        const dsIndex = state.defaults.text.subheadlineLanguages.indexOf(lang);
        if (dsIndex > -1) {
            state.defaults.text.subheadlineLanguages.splice(dsIndex, 1);
            delete state.defaults.text.subheadlines[lang];
        }

        updateLanguagesList();
        updateAddLanguageSelect();
        updateLanguageMenu();
        updateLanguageButton();
        syncUIWithState();
        saveState();
    }
}

// Language helper functions
function addHeadlineLanguage(lang, flag) {
    const text = getTextSettings();
    if (!text.headlineLanguages.includes(lang)) {
        text.headlineLanguages.push(lang);
        if (!text.headlines) text.headlines = { en: '' };
        text.headlines[lang] = '';
        updateHeadlineLanguageUI();
        switchHeadlineLanguage(lang);
        saveState();
    }
}

function addSubheadlineLanguage(lang, flag) {
    const text = getTextSettings();
    if (!text.subheadlineLanguages.includes(lang)) {
        text.subheadlineLanguages.push(lang);
        if (!text.subheadlines) text.subheadlines = { en: '' };
        text.subheadlines[lang] = '';
        updateSubheadlineLanguageUI();
        switchSubheadlineLanguage(lang);
        saveState();
    }
}

function removeHeadlineLanguage(lang) {
    const text = getTextSettings();
    if (lang === 'en') return; // Can't remove default

    const index = text.headlineLanguages.indexOf(lang);
    if (index > -1) {
        text.headlineLanguages.splice(index, 1);
        delete text.headlines[lang];

        if (text.currentHeadlineLang === lang) {
            text.currentHeadlineLang = 'en';
        }

        updateHeadlineLanguageUI();
        switchHeadlineLanguage(text.currentHeadlineLang);
        saveState();
    }
}

function removeSubheadlineLanguage(lang) {
    const text = getTextSettings();
    if (lang === 'en') return; // Can't remove default

    const index = text.subheadlineLanguages.indexOf(lang);
    if (index > -1) {
        text.subheadlineLanguages.splice(index, 1);
        delete text.subheadlines[lang];

        if (text.currentSubheadlineLang === lang) {
            text.currentSubheadlineLang = 'en';
        }

        updateSubheadlineLanguageUI();
        switchSubheadlineLanguage(text.currentSubheadlineLang);
        saveState();
    }
}

function switchHeadlineLanguage(lang) {
    const text = getTextSettings();
    text.currentHeadlineLang = lang;
    text.currentLayoutLang = lang;

    // Sync text inputs and layout controls for this language
    updateTextUI(text);
    updateCanvas();
}

function switchSubheadlineLanguage(lang) {
    const text = getTextSettings();
    text.currentSubheadlineLang = lang;
    text.currentLayoutLang = lang;

    // Sync text inputs and layout controls for this language
    updateTextUI(text);
    updateCanvas();
}

function updateHeadlineLanguageUI() {
    // Language flag UI removed - translations now managed through translate modal
}

function updateSubheadlineLanguageUI() {
    // Language flag UI removed - translations now managed through translate modal
}

// Translate modal functions
let currentTranslateTarget = null;

const languageNames = {
    'en': 'English (US)', 'en-gb': 'English (UK)', 'de': 'German', 'fr': 'French',
    'es': 'Spanish', 'it': 'Italian', 'pt': 'Portuguese', 'pt-br': 'Portuguese (BR)',
    'nl': 'Dutch', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean',
    'zh': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)', 'ar': 'Arabic',
    'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'sv': 'Swedish',
    'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'th': 'Thai',
    'vi': 'Vietnamese', 'id': 'Indonesian', 'uk': 'Ukrainian'
};

function openTranslateModal(target) {
    currentTranslateTarget = target;
    const text = getTextSettings();
    const isHeadline = target === 'headline';
    const isElement = target === 'element';

    let languages, texts;
    if (isElement) {
        const el = getSelectedElement();
        if (!el || el.type !== 'text') return;
        document.getElementById('translate-target-type').textContent = 'Element Text';
        languages = state.projectLanguages;
        if (!el.texts) el.texts = {};
        texts = el.texts;
    } else {
        document.getElementById('translate-target-type').textContent = isHeadline ? 'Headline' : 'Subheadline';
        languages = isHeadline ? text.headlineLanguages : text.subheadlineLanguages;
        texts = isHeadline ? text.headlines : text.subheadlines;
    }

    // Populate source language dropdown (first language selected by default)
    const sourceSelect = document.getElementById('translate-source-lang');
    sourceSelect.innerHTML = '';
    languages.forEach((lang, index) => {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = `${languageFlags[lang]} ${languageNames[lang] || lang}`;
        if (index === 0) option.selected = true;
        sourceSelect.appendChild(option);
    });

    // Update source preview
    updateTranslateSourcePreview();

    // Populate target languages
    const targetsContainer = document.getElementById('translate-targets');
    targetsContainer.innerHTML = '';

    languages.forEach(lang => {
        const item = document.createElement('div');
        item.className = 'translate-target-item';
        item.dataset.lang = lang;
        item.innerHTML = `
            <div class="translate-target-header">
                <span class="flag">${languageFlags[lang]}</span>
                <span>${languageNames[lang] || lang}</span>
            </div>
            <textarea placeholder="Enter ${languageNames[lang] || lang} translation...">${texts[lang] || ''}</textarea>
        `;
        targetsContainer.appendChild(item);
    });

    document.getElementById('translate-modal').classList.add('visible');
}

function updateTranslateSourcePreview() {
    const sourceLang = document.getElementById('translate-source-lang').value;
    let sourceText;
    if (currentTranslateTarget === 'element') {
        const el = getSelectedElement();
        sourceText = el && el.texts ? (el.texts[sourceLang] || '') : '';
    } else {
        const text = getTextSettings();
        const isHeadline = currentTranslateTarget === 'headline';
        const texts = isHeadline ? text.headlines : text.subheadlines;
        sourceText = texts[sourceLang] || '';
    }

    document.getElementById('source-text-preview').textContent = sourceText || 'No text entered';
}

function applyTranslations() {
    const isElement = currentTranslateTarget === 'element';

    if (isElement) {
        const el = getSelectedElement();
        if (!el) return;
        if (!el.texts) el.texts = {};

        document.querySelectorAll('#translate-targets .translate-target-item').forEach(item => {
            const lang = item.dataset.lang;
            const textarea = item.querySelector('textarea');
            el.texts[lang] = textarea.value;
        });
        el.text = getElementText(el); // sync for backwards compat
        document.getElementById('element-text-input').value = getElementText(el);
    } else {
        const text = getTextSettings();
        const isHeadline = currentTranslateTarget === 'headline';
        const texts = isHeadline ? text.headlines : text.subheadlines;

        document.querySelectorAll('#translate-targets .translate-target-item').forEach(item => {
            const lang = item.dataset.lang;
            const textarea = item.querySelector('textarea');
            texts[lang] = textarea.value;
        });

        const currentLang = isHeadline ? text.currentHeadlineLang : text.currentSubheadlineLang;
        if (isHeadline) {
            document.getElementById('headline-text').value = texts[currentLang] || '';
        } else {
            document.getElementById('subheadline-text').value = texts[currentLang] || '';
            text.subheadlineEnabled = true;
            syncUIWithState();
        }
    }

    saveState();
    updateCanvas();
}

async function aiTranslateAll() {
    const sourceLang = document.getElementById('translate-source-lang').value;
    const isElement = currentTranslateTarget === 'element';
    let texts, languages, sourceText;
    if (isElement) {
        const el = getSelectedElement();
        if (!el) return;
        texts = el.texts || {};
        languages = state.projectLanguages;
        sourceText = texts[sourceLang] || '';
    } else {
        const text = getTextSettings();
        const isHeadline = currentTranslateTarget === 'headline';
        texts = isHeadline ? text.headlines : text.subheadlines;
        languages = isHeadline ? text.headlineLanguages : text.subheadlineLanguages;
        sourceText = texts[sourceLang] || '';
    }

    if (!sourceText.trim()) {
        setTranslateStatus('Please enter text in the source language first', 'error');
        return;
    }

    // Get target languages (all except source)
    const targetLangs = languages.filter(lang => lang !== sourceLang);

    if (targetLangs.length === 0) {
        setTranslateStatus('Add more languages to translate to', 'error');
        return;
    }

    // Get selected provider and API key
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = localStorage.getItem(providerConfig.storageKey);

    if (!apiKey) {
        setTranslateStatus(`Add your LLM API key in Settings to use AI translation.`, 'error');
        return;
    }

    const btn = document.getElementById('ai-translate-btn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4m-8-10h4m12 0h4m-5.66-5.66l-2.83 2.83m-5.66 5.66l-2.83 2.83m14.14 0l-2.83-2.83M6.34 6.34L3.51 3.51"/>
        </svg>
        <span>Translating...</span>
    `;

    setTranslateStatus(`Translating to ${targetLangs.length} language(s) with ${providerConfig.name}...`, '');

    // Mark all target items as translating
    targetLangs.forEach(lang => {
        const item = document.querySelector(`.translate-target-item[data-lang="${lang}"]`);
        if (item) item.classList.add('translating');
    });

    try {
        // Build the translation prompt
        const targetLangNames = targetLangs.map(lang => `${languageNames[lang]} (${lang})`).join(', ');

        const prompt = `You are a professional translator for App Store screenshot marketing copy. Translate the following text from ${languageNames[sourceLang]} to these languages: ${targetLangNames}.

The text is a short marketing headline/tagline for an app that must fit on a screenshot, so keep translations:
- SIMILAR LENGTH to the original - do NOT make it longer, as it must fit on screen
- Concise and punchy
- Marketing-focused and compelling
- Culturally appropriate for each target market
- Natural-sounding in each language

IMPORTANT: The translated text will be displayed on app screenshots with limited space. If the source text is short, the translation MUST also be short. Prioritize brevity over literal accuracy.

Source text (${languageNames[sourceLang]}):
"${sourceText}"

Respond ONLY with a valid JSON object mapping language codes to translations. Do not include any other text.
Example format:
{"de": "German translation", "fr": "French translation"}

Translate to these language codes: ${targetLangs.join(', ')}`;

        let responseText;

        if (provider === 'anthropic') {
            responseText = await translateWithAnthropic(apiKey, prompt);
        } else if (provider === 'openai') {
            responseText = await translateWithOpenAI(apiKey, prompt);
        } else if (provider === 'google') {
            responseText = await translateWithGoogle(apiKey, prompt);
        }

        // Clean up response - remove markdown code blocks if present
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        const translations = JSON.parse(responseText);

        // Apply translations to the textareas
        let translatedCount = 0;
        targetLangs.forEach(lang => {
            if (translations[lang]) {
                const item = document.querySelector(`.translate-target-item[data-lang="${lang}"]`);
                if (item) {
                    const textarea = item.querySelector('textarea');
                    textarea.value = translations[lang];
                    translatedCount++;
                }
            }
        });

        setTranslateStatus(`✓ Translated to ${translatedCount} language(s)`, 'success');

    } catch (error) {
        console.error('Translation error:', error);

        if (error.message === 'Failed to fetch') {
            setTranslateStatus('Connection failed. Check your API key in Settings.', 'error');
        } else if (error.message === 'AI_UNAVAILABLE' || error.message.includes('401') || error.message.includes('403')) {
            setTranslateStatus('Invalid API key. Update it in Settings (gear icon).', 'error');
        } else {
            setTranslateStatus('Translation failed: ' + error.message, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <span>Auto-translate with AI</span>
        `;

        // Remove translating state
        document.querySelectorAll('.translate-target-item').forEach(item => {
            item.classList.remove('translating');
        });
    }
}

// Helper function to show styled alert modal
function showAppAlert(message, type = 'info') {
    return new Promise((resolve) => {
        const iconBg = type === 'error' ? 'rgba(255, 69, 58, 0.2)' :
            type === 'success' ? 'rgba(52, 199, 89, 0.2)' :
                'rgba(10, 132, 255, 0.2)';
        const iconColor = type === 'error' ? '#ff453a' :
            type === 'success' ? '#34c759' :
                'var(--accent)';
        const iconPath = type === 'error' ? '<path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' :
            type === 'success' ? '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>' :
                '<path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay visible';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-icon" style="background: ${iconBg};">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: ${iconColor};">
                        ${iconPath}
                    </svg>
                </div>
                <p class="modal-message" style="margin: 16px 0;">${message}</p>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-confirm" style="background: var(--accent);">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const okBtn = overlay.querySelector('.modal-btn-confirm');
        const close = () => {
            overlay.remove();
            resolve();
        };
        okBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    });
}

// Helper function to show styled confirm modal
function showAppConfirm(message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay visible';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-icon" style="background: rgba(10, 132, 255, 0.2);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);">
                        <path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <p class="modal-message" style="margin: 16px 0; white-space: pre-line;">${message}</p>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-cancel">${cancelText}</button>
                    <button class="modal-btn modal-btn-confirm" style="background: var(--accent);">${confirmText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const confirmBtn = overlay.querySelector('.modal-btn-confirm');
        const cancelBtn = overlay.querySelector('.modal-btn-cancel');

        confirmBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        });
    });
}

// Show translate confirmation dialog with source language selector
function showTranslateConfirmDialog(providerName) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay visible';

        // Default to first project language
        const defaultLang = state.projectLanguages[0] || 'en';

        // Build language options
        const languageOptions = state.projectLanguages.map(lang => {
            const flag = languageFlags[lang] || '🏳️';
            const name = languageNames[lang] || lang.toUpperCase();
            const selected = lang === defaultLang ? 'selected' : '';
            return `<option value="${lang}" ${selected}>${flag} ${name}</option>`;
        }).join('');

        // Count texts for each language
        const getTextCount = (lang) => {
            let count = 0;
            state.screenshots.forEach(screenshot => {
                const text = screenshot.text || state.text;
                if (text.headlines?.[lang]?.trim()) count++;
                if (text.subheadlines?.[lang]?.trim()) count++;
            });
            return count;
        };

        const initialCount = getTextCount(defaultLang);
        const targetCount = state.projectLanguages.length - 1;

        overlay.innerHTML = `
            <div class="modal" style="max-width: 380px;">
                <div class="modal-icon" style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #764ba2;">
                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6"/>
                    </svg>
                </div>
                <h3 class="modal-title">Translate All Text</h3>
                <p class="modal-message" style="margin-bottom: 16px;">Translate headlines and subheadlines from one language to all other project languages.</p>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Source Language</label>
                    <select id="translate-source-lang" style="width: 100%; padding: 10px 12px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 14px; cursor: pointer;">
                        ${languageOptions}
                    </select>
                </div>

                <div style="background: var(--bg-tertiary); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                        <span style="color: var(--text-secondary);">Texts to translate:</span>
                        <span id="translate-text-count" style="color: var(--text-primary); font-weight: 500;">${initialCount}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                        <span style="color: var(--text-secondary);">Target languages:</span>
                        <span style="color: var(--text-primary); font-weight: 500;">${targetCount}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px;">
                        <span style="color: var(--text-secondary);">Provider:</span>
                        <span style="color: var(--text-primary); font-weight: 500;">${providerName}</span>
                    </div>
                </div>

                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-cancel" id="translate-cancel">Cancel</button>
                    <button class="modal-btn modal-btn-confirm" id="translate-confirm" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">Translate</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const select = document.getElementById('translate-source-lang');
        const countEl = document.getElementById('translate-text-count');
        const confirmBtn = document.getElementById('translate-confirm');
        const cancelBtn = document.getElementById('translate-cancel');

        // Update count when language changes
        select.addEventListener('change', () => {
            const count = getTextCount(select.value);
            countEl.textContent = count;
            confirmBtn.disabled = count === 0;
            if (count === 0) {
                confirmBtn.style.opacity = '0.5';
            } else {
                confirmBtn.style.opacity = '1';
            }
        });

        // Initial state
        if (initialCount === 0) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
        }

        confirmBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(select.value);
        });

        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    });
}

// Translate all text (headlines + subheadlines) from selected source language to all other project languages
async function translateAllText() {
    if (state.projectLanguages.length < 2) {
        await showAppAlert('Add more languages to your project first (via the language menu).', 'info');
        return;
    }

    // Get selected provider and API key
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = localStorage.getItem(providerConfig.storageKey);

    if (!apiKey) {
        await showAppAlert('Add your LLM API key in Settings to use AI translation.', 'error');
        return;
    }

    // Show confirmation dialog with source language selector
    const sourceLang = await showTranslateConfirmDialog(providerConfig.name);
    if (!sourceLang) return; // User cancelled

    const targetLangs = state.projectLanguages.filter(lang => lang !== sourceLang);

    // Collect all text-element strings that need translation (across every screenshot).
    const textsToTranslate = [];
    state.screenshots.forEach((screenshot, index) => {
        (screenshot.elements || []).forEach(el => {
            if (el.type !== 'text') return;
            const src = (el.texts && el.texts[sourceLang]) || '';
            if (src.trim()) {
                textsToTranslate.push({
                    elementId: el.id,
                    screenshotIndex: index,
                    text: src,
                    label: el.role ? (el.role.charAt(0).toUpperCase() + el.role.slice(1)) : (el.name || 'Text')
                });
            }
        });
    });

    if (textsToTranslate.length === 0) {
        await showAppAlert(`No text found in ${languageNames[sourceLang] || sourceLang}. Add text to your screenshots first.`, 'info');
        return;
    }

    // Create progress dialog with spinner
    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'modal-overlay visible';
    progressOverlay.id = 'translate-progress-overlay';
    progressOverlay.innerHTML = `
        <div class="modal" style="text-align: center; min-width: 320px;">
            <div class="modal-icon" style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #764ba2; animation: spin 1s linear infinite;">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
            </div>
            <h3 class="modal-title">Translating...</h3>
            <p class="modal-message" id="translate-progress-text">Sending to AI...</p>
            <p class="modal-message" id="translate-progress-detail" style="font-size: 11px; color: var(--text-tertiary); margin-top: 8px;"></p>
        </div>
        <style>
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        </style>
    `;
    document.body.appendChild(progressOverlay);

    const progressText = document.getElementById('translate-progress-text');
    const progressDetail = document.getElementById('translate-progress-detail');

    // Helper to update status
    const updateStatus = (text, detail = '') => {
        if (progressText) progressText.textContent = text;
        if (progressDetail) progressDetail.textContent = detail;
    };

    updateStatus('Sending to AI...', `${textsToTranslate.length} texts to ${targetLangs.length} languages using ${providerConfig.name}`);

    try {
        // Build a single prompt with all texts
        const targetLangNames = targetLangs.map(lang => `${languageNames[lang]} (${lang})`).join(', ');

        // Group texts by screenshot for a context-aware prompt
        const screenshotGroups = {};
        textsToTranslate.forEach((item, i) => {
            (screenshotGroups[item.screenshotIndex] = screenshotGroups[item.screenshotIndex] || []).push({ i, label: item.label, text: item.text });
        });

        // Build context-rich prompt showing screenshot groupings
        let contextualTexts = '';
        Object.keys(screenshotGroups).sort((a, b) => Number(a) - Number(b)).forEach(screenshotIdx => {
            const group = screenshotGroups[screenshotIdx];
            contextualTexts += `\nScreenshot ${Number(screenshotIdx) + 1}:\n`;
            group.forEach(it => {
                contextualTexts += `  [${it.i}] ${it.label}: "${it.text}"\n`;
            });
        });

        const prompt = `You are a professional translator for App Store screenshot marketing copy. Translate the following texts from ${languageNames[sourceLang]} to these languages: ${targetLangNames}.

CONTEXT: These are marketing texts for app store screenshots. Each screenshot has a headline and/or subheadline that work together as a pair. The subheadline typically elaborates on or supports the headline. When translating, ensure:
- Headlines and subheadlines on the same screenshot remain thematically consistent
- Translations across all screenshots maintain a cohesive marketing voice
- SIMILAR LENGTH to the originals - do NOT make translations longer, as they must fit on screen
- Marketing-focused and compelling language
- Culturally appropriate for each target market
- Natural-sounding in each language

IMPORTANT: The translated text will be displayed on app screenshots with limited space. If the source text is short, the translation MUST also be short. Prioritize brevity over literal accuracy.

Source texts (${languageNames[sourceLang]}):
${contextualTexts}

Respond ONLY with a valid JSON object. The structure should be:
{
  "0": {"de": "German translation", "fr": "French translation", ...},
  "1": {"de": "German translation", "fr": "French translation", ...}
}

Where the keys (0, 1, etc.) correspond to the text indices [N] shown above.
Translate to these language codes: ${targetLangs.join(', ')}`;

        let responseText;

        if (provider === 'anthropic') {
            responseText = await translateWithAnthropic(apiKey, prompt);
        } else if (provider === 'openai') {
            responseText = await translateWithOpenAI(apiKey, prompt);
        } else if (provider === 'google') {
            responseText = await translateWithGoogle(apiKey, prompt);
        }

        updateStatus('Processing response...', 'Parsing translations');

        // Clean up response - remove markdown code blocks and extract JSON
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Try to extract JSON object if there's extra text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            responseText = jsonMatch[0];
        }

        console.log('Translation response:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));

        let translations;
        try {
            translations = JSON.parse(responseText);
        } catch (parseError) {
            console.error('JSON parse error. Response was:', responseText);
            throw new Error('Failed to parse translation response. The AI may have returned incomplete text.');
        }

        updateStatus('Applying translations...', 'Updating screenshots');

        // Apply translations
        let appliedCount = 0;
        textsToTranslate.forEach((item, index) => {
            const itemTranslations = translations[index] || translations[String(index)];
            if (!itemTranslations) return;

            const screenshot = state.screenshots[item.screenshotIndex];
            const el = (screenshot.elements || []).find(e => e.id === item.elementId);
            if (!el) return;
            if (!el.texts) el.texts = {};

            targetLangs.forEach(lang => {
                if (itemTranslations[lang]) {
                    el.texts[lang] = itemTranslations[lang];
                    appliedCount++;
                }
            });
        });

        // Update UI
        syncUIWithState();
        updateCanvas();
        saveState();

        // Remove progress overlay
        progressOverlay.remove();

        await showAppAlert(`Successfully translated ${appliedCount} text(s)!`, 'success');

    } catch (error) {
        console.error('Translation error:', error);
        progressOverlay.remove();

        if (error.message === 'Failed to fetch') {
            await showAppAlert('Connection failed. Check your API key in Settings.', 'error');
        } else if (error.message === 'AI_UNAVAILABLE' || error.message.includes('401') || error.message.includes('403')) {
            await showAppAlert('Invalid API key. Update it in Settings (gear icon).', 'error');
        } else {
            await showAppAlert('Translation failed: ' + error.message, 'error');
        }
    }
}

// Provider-specific translation functions
async function translateWithAnthropic(apiKey, prompt) {
    const model = getSelectedModel('anthropic');
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

async function translateWithOpenAI(apiKey, prompt) {
    const model = getSelectedModel('openai');
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            max_completion_tokens: 16384,
            messages: [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        const errorBody = await response.json().catch(() => ({}));
        console.error('OpenAI API Error:', {
            status,
            model,
            error: errorBody
        });
        if (status === 401 || status === 403) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status} - ${errorBody.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function translateWithGoogle(apiKey, prompt) {
    const model = getSelectedModel('google');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403 || status === 400) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

function setTranslateStatus(message, type) {
    const status = document.getElementById('ai-translate-status');
    status.textContent = message;
    status.className = 'ai-translate-status' + (type ? ' ' + type : '');
}

// Settings modal functions
// LLM configuration is in llm.js (llmProviders, getSelectedModel, getSelectedProvider)

// Theme management
function applyTheme(preference) {
    if (preference === 'light' || preference === 'dark') {
        document.documentElement.dataset.theme = preference;
    } else {
        delete document.documentElement.dataset.theme;
    }
}

function initTheme() {
    const saved = localStorage.getItem('themePreference') || 'auto';
    applyTheme(saved);
}

// Apply theme immediately (before async init)
initTheme();

function openSettingsModal() {
    // Load saved provider
    const savedProvider = getSelectedProvider();
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
        radio.checked = radio.value === savedProvider;
    });

    // Show the correct API section
    updateProviderSection(savedProvider);

    // Load all saved API keys and models
    Object.entries(llmProviders).forEach(([provider, config]) => {
        const savedKey = localStorage.getItem(config.storageKey);
        const input = document.getElementById(`settings-api-key-${provider}`);
        if (input) {
            input.value = savedKey || '';
            input.type = 'password';
        }

        const status = document.getElementById(`settings-key-status-${provider}`);
        if (status) {
            if (savedKey) {
                status.textContent = '✓ API key is saved';
                status.className = 'settings-key-status success';
            } else {
                status.textContent = '';
                status.className = 'settings-key-status';
            }
        }

        // Populate and load saved model selection
        const modelSelect = document.getElementById(`settings-model-${provider}`);
        if (modelSelect) {
            // Populate options from llm.js config
            modelSelect.innerHTML = generateModelOptions(provider);
            // Set saved value
            const savedModel = localStorage.getItem(config.modelStorageKey) || config.defaultModel;
            modelSelect.value = savedModel;
        }
    });

    // Load saved theme preference
    const savedTheme = localStorage.getItem('themePreference') || 'auto';
    document.querySelectorAll('#theme-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === savedTheme);
    });

    document.getElementById('settings-modal').classList.add('visible');
}

function updateProviderSection(provider) {
    document.querySelectorAll('.settings-api-section').forEach(section => {
        section.style.display = section.dataset.provider === provider ? 'block' : 'none';
    });
}

function saveSettings() {
    // Save theme preference
    const activeThemeBtn = document.querySelector('#theme-selector button.active');
    const themePreference = activeThemeBtn ? activeThemeBtn.dataset.theme : 'auto';
    localStorage.setItem('themePreference', themePreference);
    applyTheme(themePreference);

    // Save selected provider
    const selectedProvider = document.querySelector('input[name="ai-provider"]:checked').value;
    localStorage.setItem('aiProvider', selectedProvider);

    // Save all API keys and models
    let allValid = true;
    Object.entries(llmProviders).forEach(([provider, config]) => {
        const input = document.getElementById(`settings-api-key-${provider}`);
        const status = document.getElementById(`settings-key-status-${provider}`);
        if (!input || !status) return;

        const key = input.value.trim();

        if (key) {
            // Validate key format
            if (key.startsWith(config.keyPrefix)) {
                localStorage.setItem(config.storageKey, key);
                status.textContent = '✓ API key saved';
                status.className = 'settings-key-status success';
            } else {
                status.textContent = `Invalid format. Should start with ${config.keyPrefix}...`;
                status.className = 'settings-key-status error';
                if (provider === selectedProvider) allValid = false;
            }
        } else {
            localStorage.removeItem(config.storageKey);
            status.textContent = '';
            status.className = 'settings-key-status';
        }

        // Save model selection
        const modelSelect = document.getElementById(`settings-model-${provider}`);
        if (modelSelect) {
            localStorage.setItem(config.modelStorageKey, modelSelect.value);
        }
    });

    if (allValid) {
        setTimeout(() => {
            document.getElementById('settings-modal').classList.remove('visible');
        }, 500);
    }
}

// Helper function to set text value for current screenshot
function setTextValue(key, value) {
    setTextSetting(key, value);
}

function setTextLanguageValue(key, value, lang = null) {
    const text = getTextSettings();
    if (!text.perLanguageLayout) {
        // Global mode - write directly to text
        text[key] = value;
        return;
    }
    const targetLang = lang || getTextLayoutLanguage(text);
    const settings = getTextLanguageSettings(text, targetLang);
    settings[key] = value;
    text.currentLayoutLang = targetLang;
}

// Helper function to get text settings for current screenshot
function getTextSettings() {
    return getText();
}

// Load text UI from current screenshot's settings
function loadTextUIFromScreenshot() {
    updateTextUI(getText());
}

// Load text UI from default settings
function loadTextUIFromGlobal() {
    updateTextUI(state.defaults.text);
}

// Update all text UI elements
function updateTextUI(text) { /* Text tab removed — headline/subheadline are text elements now. */ }

function applyPositionPreset(preset) {
    const presets = {
        'centered': { scale: 70, x: 50, y: 50, rotation: 0, perspective: 0 },
        'bleed-bottom': { scale: 85, x: 50, y: 120, rotation: 0, perspective: 0 },
        'bleed-top': { scale: 85, x: 50, y: -20, rotation: 0, perspective: 0 },
        'float-center': { scale: 60, x: 50, y: 50, rotation: 0, perspective: 0 },
        'tilt-left': { scale: 65, x: 50, y: 60, rotation: -8, perspective: 0 },
        'tilt-right': { scale: 65, x: 50, y: 60, rotation: 8, perspective: 0 },
        'perspective': { scale: 65, x: 50, y: 50, rotation: 0, perspective: 15 },
        'float-bottom': { scale: 55, x: 50, y: 70, rotation: 0, perspective: 0 }
    };

    const p = presets[preset];
    if (!p) return;

    setScreenshotSetting('scale', p.scale);
    setScreenshotSetting('x', p.x);
    setScreenshotSetting('y', p.y);
    setScreenshotSetting('rotation', p.rotation);
    setScreenshotSetting('perspective', p.perspective);

    // Update UI controls
    document.getElementById('screenshot-scale').value = p.scale;
    document.getElementById('screenshot-scale-value').textContent = formatValue(p.scale) + '%';
    document.getElementById('screenshot-x').value = p.x;
    document.getElementById('screenshot-x-value').textContent = formatValue(p.x) + '%';
    document.getElementById('screenshot-y').value = p.y;
    document.getElementById('screenshot-y-value').textContent = formatValue(p.y) + '%';
    document.getElementById('screenshot-rotation').value = p.rotation;
    document.getElementById('screenshot-rotation-value').textContent = formatValue(p.rotation) + '°';

    updateCanvas();
}

function handleFiles(files) {
    // Process files sequentially to handle duplicates one at a time
    processFilesSequentially(
        Array.from(files).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
    );
}

// Swap the selected screenshot's screen image (for the current language) with a
// dropped image file, leaving every positioning/styling setting untouched.
function replaceCurrentScreenImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const src = reader.result;
        const img = new Image();
        img.onload = () => {
            const lang = state.currentLanguage || 'en';
            // addLocalizedImage handles list refresh, updateCanvas, and saveState.
            addLocalizedImage(state.selectedIndex, lang, img, src, file.name);
            // Keep the legacy mirror in sync for code paths that still read ss.image.
            const ss = state.screenshots[state.selectedIndex];
            if (ss) { ss.image = img; ss.name = file.name; }
            // Refresh the 3D screen texture when the device is in 3D mode.
            if (ss && ss.use3D && typeof updateScreenTexture === 'function') updateScreenTexture();
        };
        img.src = src;
    };
    reader.readAsDataURL(file);
}

// Handle files from desktop app (receives array of {dataUrl, name})
function handleFilesFromDesktop(filesData) {
    processDesktopFilesSequentially(filesData);
}

async function processDesktopFilesSequentially(filesData) {
    for (const fileData of filesData) {
        await processDesktopImageFile(fileData);
    }
}

// Import screenshots via Tauri native file dialog
async function importScreenshotsFromTauri() {
    if (!window.__TAURI__) return;
    try {
        const selected = await window.__TAURI__.dialog.open({
            multiple: true,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const filePath of paths) {
            const bytes = await window.__TAURI__.fs.readFile(filePath);
            const blob = new Blob([bytes]);
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
            const name = filePath.split(/[\\/]/).pop();
            await handleFilesFromDesktop([{ dataUrl, name }]);
        }
    } catch (err) {
        console.error('Tauri import error:', err);
    }
}

async function processDesktopImageFile(fileData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
            // Detect device type based on aspect ratio
            const ratio = img.width / img.height;
            let deviceType = 'iPhone';
            if (ratio > 0.6) {
                deviceType = 'iPad';
            }

            // Detect language from filename
            const detectedLang = detectLanguageFromFilename(fileData.name);

            // Check if this is a localized version of an existing screenshot
            const existingIndex = findScreenshotByBaseFilename(fileData.name);

            if (existingIndex !== -1) {
                // Found a screenshot with matching base filename
                const existingScreenshot = state.screenshots[existingIndex];
                const hasExistingLangImage = existingScreenshot.localizedImages?.[detectedLang]?.image;

                if (hasExistingLangImage) {
                    // There's already an image for this language - show dialog
                    const choice = await showDuplicateDialog({
                        existingIndex: existingIndex,
                        detectedLang: detectedLang,
                        newImage: img,
                        newSrc: fileData.dataUrl,
                        newName: fileData.name
                    });

                    if (choice === 'replace') {
                        addLocalizedImage(existingIndex, detectedLang, img, fileData.dataUrl, fileData.name);
                    } else if (choice === 'create') {
                        createNewScreenshot(img, fileData.dataUrl, fileData.name, detectedLang, deviceType);
                    }
                } else {
                    // No image for this language yet - just add it silently
                    addLocalizedImage(existingIndex, detectedLang, img, fileData.dataUrl, fileData.name);
                }
            } else {
                createNewScreenshot(img, fileData.dataUrl, fileData.name, detectedLang, deviceType);
            }

            // Update 3D texture if in 3D mode
            const ss = getScreenshotSettings();
            if (ss.use3D && typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            updateCanvas();
            resolve();
        };
        img.src = fileData.dataUrl;
    });
}

async function processFilesSequentially(files) {
    const beforeCount = state.screenshots.length;
    for (const file of files) {
        if (file.type.startsWith('video/')) {
            await processVideoFile(file);
        } else {
            await processImageFile(file);
        }
    }
    // Auto-select & show the newly added screenshot so the import is immediately visible
    // (previously the item was added to the list but the canvas stayed on the old one).
    if (state.screenshots.length > beforeCount) {
        selectScreenshot(state.screenshots.length - 1);
        // Safety re-renders: if the 3D model/texture (or a video's first frame) wasn't ready at
        // select-time, repaint shortly after so a freshly added slide can never sit blank until
        // a manual reload. The 2D-fallback in updateCanvas already prevents a blank in the
        // meantime; these just make sure it upgrades to the final render.
        requestAnimationFrame(() => updateCanvas());
        setTimeout(() => updateCanvas(), 250);
    }
}

// Load a video file as an HTMLVideoElement ready for canvas/Three.js sampling.
async function processVideoFile(file) {
    return new Promise(async (resolve) => {
        const blobUrl = URL.createObjectURL(file);
        // Persist the raw blob so we can resurrect this video on next page load.
        const mediaKey = genMediaKey();
        await saveMediaBlob(mediaKey, file);
        const video = document.createElement('video');
        video.src = blobUrl;
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.loop = false;            // the timeline loops the whole composition, not the video itself
        video.playsInline = true;
        video.preload = 'auto';
        video.dataset.isVideo = 'true';
        video.dataset.blobUrl = blobUrl;
        video.dataset.mediaKey = mediaKey;

        video.addEventListener('loadedmetadata', async () => {
            // Existing renderers read img.width/img.height. On HTMLVideoElement those reflect
            // HTML attributes (often 0), not intrinsic dims — so mirror videoWidth/videoHeight
            // into the attributes so all the img.width/.height code paths Just Work.
            video.width = video.videoWidth;
            video.height = video.videoHeight;
            const ratio = video.videoWidth / video.videoHeight;
            const deviceType = ratio > 0.6 ? 'iPad' : 'iPhone';
            const detectedLang = detectLanguageFromFilename(file.name);
            const existingIndex = findScreenshotByBaseFilename(file.name);

            if (existingIndex !== -1) {
                const existing = state.screenshots[existingIndex];
                const hasExistingLangImage = existing.localizedImages?.[detectedLang]?.image;
                if (hasExistingLangImage) {
                    const choice = await showDuplicateDialog({
                        existingIndex, detectedLang,
                        newImage: video, newSrc: blobUrl, newName: file.name
                    });
                    if (choice === 'replace') {
                        addLocalizedImage(existingIndex, detectedLang, video, blobUrl, file.name);
                    } else if (choice === 'create') {
                        createNewScreenshot(video, blobUrl, file.name, detectedLang, deviceType);
                    }
                } else {
                    addLocalizedImage(existingIndex, detectedLang, video, blobUrl, file.name);
                }
            } else {
                createNewScreenshot(video, blobUrl, file.name, detectedLang, deviceType);
                // Auto-select the just-added video so the canvas + 3D texture switch to it
                // immediately. Without this, the previous screenshot stays visible and the
                // upload looks like it didn't take.
                state.selectedIndex = state.screenshots.length - 1;
                if (typeof updateScreenshotList === 'function') updateScreenshotList();
                if (typeof syncUIWithState === 'function') syncUIWithState();
            }

            // Don't autoplay — the video stays paused on its first frame until the timeline
            // plays it. The timeline playhead is the single clock so movements stay in sync.
            try { video.pause(); video.currentTime = 0; } catch (e) {}

            const ss = getScreenshotSettings();
            if (ss.use3D && typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            updateCanvas();
            updateVideoControlsVisibility();
            if (typeof updateTimelineVisibility === 'function') updateTimelineVisibility();
            resolve();
        }, { once: true });

        video.addEventListener('error', () => {
            console.error('Failed to load video:', file.name);
            URL.revokeObjectURL(blobUrl);
            resolve();
        }, { once: true });
    });
}

// Per-frame tick that re-renders the canvas while a video is on the current screenshot.
// Idle when no video is visible to avoid wasted work.
let _videoTickRunning = false;
// LEGACY: the video used to play on its own rAF loop. The animation timeline is now the
// single playback driver (its playhead sets video.currentTime + drives rendering), so this
// is intentionally a no-op. Leaving the function defined so existing callers don't break.
// Re-enabling it would double-render and desync the video from the timeline playhead.
function ensureVideoTickLoop() { /* disabled — timeline owns playback */ }

// ---- Video timeline UI ----
// Single, shared timeline below the canvas. Shows/hides based on whether the current
// screenshot is a video. Scrubbing pauses the video; releasing the scrubber resumes.

function getCurrentVideoMedia() {
    const screenshot = state.screenshots[state.selectedIndex];
    const media = screenshot ? getScreenshotImage(screenshot) : null;
    return (media && media.tagName === 'VIDEO') ? media : null;
}

function formatVideoTime(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateVideoControlsVisibility() {
    // The standalone video bar is superseded by the timeline panel (whose playhead drives
    // video playback + animation, and which now hosts mute/volume). Keep it permanently
    // hidden to avoid the confusing "double scrubber". Volume state is still applied so
    // the timeline's volume control works.
    const controls = document.getElementById('video-controls');
    if (controls) controls.hidden = true;
    applyVolumeToCurrent();
}

function setVideoPlayIconState(playing) {
    const playIcon = document.getElementById('video-play-icon');
    const pauseIcon = document.getElementById('video-pause-icon');
    if (!playIcon || !pauseIcon) return;
    playIcon.style.display = playing ? 'none' : '';
    pauseIcon.style.display = playing ? '' : 'none';
}

function syncVideoScrubUI(media) {
    const scrub = document.getElementById('video-scrub');
    const time = document.getElementById('video-time');
    if (!scrub || !time || !media) return;
    if (scrub.dataset.dragging === '1') return; // user is scrubbing, don't fight them
    const dur = isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
    const pos = dur > 0 ? (media.currentTime / dur) * 1000 : 0;
    scrub.value = String(Math.round(pos));
    time.textContent = `${formatVideoTime(media.currentTime)} / ${formatVideoTime(dur)}`;
}

// Last user-set volume (0–1). Persists across screenshot switches. Default 1 so the
// first time the user touches volume it actually plays sound (videos are muted on autoplay).
let _userVolume = 1;
let _userMuted = true; // start muted because autoplay requires it; flips on first volume interaction

function applyVolumeToCurrent() {
    const media = getCurrentVideoMedia();
    if (!media) return;
    media.volume = _userVolume;
    media.muted = _userMuted || _userVolume === 0;
    setVolumeIconState(media.muted);
}

function setVolumeIconState(muted) {
    const on = document.getElementById('video-vol-on-icon');
    const off = document.getElementById('video-vol-off-icon');
    if (!on || !off) return;
    on.style.display = muted ? 'none' : '';
    off.style.display = muted ? '' : 'none';
}

function initVideoControls() {
    const playBtn = document.getElementById('video-play-btn');
    const scrub = document.getElementById('video-scrub');
    const muteBtn = document.getElementById('video-mute-btn');
    const volume = document.getElementById('video-volume');
    if (!playBtn || !scrub) return;

    // Render the current (paused/scrubbed) video frame using the right pipeline for the
    // active mode. In 3D, calling drawScreenshot() would paint the flat 2D rect over the
    // phone — so refresh the screen-mesh texture and re-composite the 3D scene instead.
    const renderCurrentVideoFrame = () => {
        const ss = getScreenshotSettings();
        if (ss?.use3D) {
            if (typeof updateScreenTexture === 'function') updateScreenTexture();
            updateCanvas();
        } else if (typeof drawScreenshot === 'function') {
            drawScreenshot();
        }
    };

    playBtn.addEventListener('click', () => {
        const media = getCurrentVideoMedia();
        if (!media) return;
        if (media.paused) {
            media.play().catch(() => {});
            setVideoPlayIconState(true);
            ensureVideoTickLoop();
        } else {
            media.pause();
            setVideoPlayIconState(false);
            renderCurrentVideoFrame();
        }
    });

    let wasPlayingBeforeScrub = false;
    const beginScrub = () => {
        const media = getCurrentVideoMedia();
        if (!media) return;
        scrub.dataset.dragging = '1';
        wasPlayingBeforeScrub = !media.paused;
        if (wasPlayingBeforeScrub) media.pause();
    };
    const endScrub = () => {
        const media = getCurrentVideoMedia();
        scrub.dataset.dragging = '0';
        if (media && wasPlayingBeforeScrub) {
            media.play().catch(() => {});
            ensureVideoTickLoop();
        }
        setVideoPlayIconState(media && !media.paused);
    };

    scrub.addEventListener('mousedown', beginScrub);
    scrub.addEventListener('touchstart', beginScrub, { passive: true });
    scrub.addEventListener('mouseup', endScrub);
    scrub.addEventListener('touchend', endScrub);

    scrub.addEventListener('input', () => {
        const media = getCurrentVideoMedia();
        if (!media || !isFinite(media.duration)) return;
        const frac = parseInt(scrub.value, 10) / 1000;
        media.currentTime = media.duration * frac;
        // Redraw at the scrubbed frame (no tick loop while paused). Mode-aware so the
        // 2D rect never gets painted over the 3D phone.
        renderCurrentVideoFrame();
        const time = document.getElementById('video-time');
        if (time) time.textContent = `${formatVideoTime(media.currentTime)} / ${formatVideoTime(media.duration)}`;
    });

    if (muteBtn) {
        muteBtn.addEventListener('click', () => {
            _userMuted = !_userMuted;
            applyVolumeToCurrent();
        });
    }

    if (volume) {
        volume.addEventListener('input', () => {
            _userVolume = parseInt(volume.value, 10) / 100;
            // Touching the slider implies "I want to hear this" — unmute.
            if (_userVolume > 0) _userMuted = false;
            applyVolumeToCurrent();
        });
    }
}

async function processImageFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
                // Detect device type based on aspect ratio
                const ratio = img.width / img.height;
                let deviceType = 'iPhone';
                if (ratio > 0.6) {
                    deviceType = 'iPad';
                }

                // Detect language from filename
                const detectedLang = detectLanguageFromFilename(file.name);

                // Check if this is a localized version of an existing screenshot
                const existingIndex = findScreenshotByBaseFilename(file.name);

                if (existingIndex !== -1) {
                    // Found a screenshot with matching base filename
                    const existingScreenshot = state.screenshots[existingIndex];
                    const hasExistingLangImage = existingScreenshot.localizedImages?.[detectedLang]?.image;

                    if (hasExistingLangImage) {
                        // There's already an image for this language - show dialog
                        const choice = await showDuplicateDialog({
                            existingIndex: existingIndex,
                            detectedLang: detectedLang,
                            newImage: img,
                            newSrc: e.target.result,
                            newName: file.name
                        });

                        if (choice === 'replace') {
                            addLocalizedImage(existingIndex, detectedLang, img, e.target.result, file.name);
                        } else if (choice === 'create') {
                            createNewScreenshot(img, e.target.result, file.name, detectedLang, deviceType);
                        }
                        // 'ignore' does nothing
                    } else {
                        // No image for this language yet - just add it silently
                        addLocalizedImage(existingIndex, detectedLang, img, e.target.result, file.name);
                    }
                } else {
                    // No duplicate - create new screenshot
                    createNewScreenshot(img, e.target.result, file.name, detectedLang, deviceType);
                }

                // Update 3D texture if in 3D mode
                const ss = getScreenshotSettings();
                if (ss.use3D && typeof updateScreenTexture === 'function') {
                    updateScreenTexture();
                }
                updateCanvas();
                resolve();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// Select a screenshot by index and refresh everything that depends on the selection
// (list highlight, sidebar controls, 3D texture, canvas, video controls, timeline).
function selectScreenshot(index) {
    if (index < 0 || index >= state.screenshots.length) return;
    state.selectedIndex = index;
    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    const ss = getScreenshotSettings();
    if (ss && ss.use3D && typeof updateScreenTexture === 'function') updateScreenTexture();
    updateCanvas();
    if (typeof updateVideoControlsVisibility === 'function') updateVideoControlsVisibility();
    if (typeof updateTimelineVisibility === 'function') updateTimelineVisibility();
    if (typeof ensureVideoTickLoop === 'function') ensureVideoTickLoop();
}

function createNewScreenshot(img, src, name, lang, deviceType) {
    const localizedImages = {};
    if (img && src) {
        localizedImages[lang || 'en'] = {
            image: img,
            src: src,
            name: name
        };
    }

    // Auto-add language to project if not already present
    if (lang && !state.projectLanguages.includes(lang)) {
        addProjectLanguage(lang);
    }

    const textDefaults = normalizeTextSettings(state.defaults.text);
    state.defaults.text = textDefaults;

    // Inherit screen + background settings from the currently selected screenshot
    // (matches shots.so behavior: styling persists across uploads). Falls back to
    // global defaults when this is the first screenshot. Without this, dropping a
    // video while in 3D mode came in as flat 2D and looked broken.
    const sourceForInheritance = state.screenshots[state.selectedIndex];
    const screenSrc = sourceForInheritance?.screenshot || state.defaults.screenshot;
    const bgSrc = sourceForInheritance?.background || state.defaults.background;
    const fxSrc = sourceForInheritance?.effects || state.defaults.effects;

    state.screenshots.push({
        image: img || null, // Keep for legacy compatibility
        name: name || 'Blank Screen',
        deviceType: deviceType,
        localizedImages: localizedImages,
        background: JSON.parse(JSON.stringify(bgSrc)),
        screenshot: JSON.parse(JSON.stringify(screenSrc)),
        text: JSON.parse(JSON.stringify(textDefaults)),
        effects: fxSrc ? JSON.parse(JSON.stringify(fxSrc)) : (typeof cloneDefaultEffects === 'function' ? cloneDefaultEffects() : undefined),
        elements: JSON.parse(JSON.stringify(state.defaults.elements || [])),
        popouts: [],
        // Legacy overrides for backwards compatibility
        overrides: {}
    });

    updateScreenshotList();
    if (state.screenshots.length === 1) {
        state.selectedIndex = 0;
        // Show Magical Titles tooltip hint for first screenshot
        setTimeout(() => showMagicalTitlesTooltip(), 500);
    }
}

let draggedScreenshotIndex = null;

// Grab a still frame from a <video> as a data-URL for use as a list thumbnail.
// (A video's blob: src can't be shown in an <img>, which is why video rows showed
// a broken-image icon.) Returns null if the video hasn't decoded a frame yet.
function captureVideoFrameThumb(video, maxSize = 96) {
    try {
        if (!video || video.tagName !== 'VIDEO') return null;
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh || video.readyState < 2) return null;
        const scale = Math.min(maxSize / vw, maxSize / vh, 1);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(vw * scale));
        c.height = Math.max(1, Math.round(vh * scale));
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        return c.toDataURL('image/png');
    } catch (e) {
        return null; // tainted canvas / not ready
    }
}

function updateScreenshotList() {
    screenshotList.innerHTML = '';
    const isEmpty = state.screenshots.length === 0;
    noScreenshot.style.display = isEmpty ? 'block' : 'none';

    // Disable right sidebar and export buttons when no screenshots
    const rightSidebar = document.querySelector('.sidebar-right');
    if (rightSidebar) rightSidebar.classList.toggle('disabled', isEmpty);
    const exportCurrent = document.getElementById('export-current');
    const exportAll = document.getElementById('export-all');
    if (exportCurrent) { exportCurrent.disabled = isEmpty; exportCurrent.style.opacity = isEmpty ? '0.4' : ''; exportCurrent.style.pointerEvents = isEmpty ? 'none' : ''; }
    if (exportAll) { exportAll.disabled = isEmpty; exportAll.style.opacity = isEmpty ? '0.4' : ''; exportAll.style.pointerEvents = isEmpty ? 'none' : ''; }

    // Show transfer mode hint if active
    if (state.transferTarget !== null && state.screenshots.length > 1) {
        const hint = document.createElement('div');
        hint.className = 'transfer-hint';
        hint.innerHTML = `
            <span>Select a screenshot to copy style from</span>
            <button class="transfer-cancel" onclick="cancelTransfer()">Cancel</button>
        `;
        screenshotList.appendChild(hint);
    }

    state.screenshots.forEach((screenshot, index) => {
        const item = document.createElement('div');
        const isTransferTarget = state.transferTarget === index;
        const isTransferMode = state.transferTarget !== null;
        item.className = 'screenshot-item' +
            (index === state.selectedIndex ? ' selected' : '') +
            (isTransferTarget ? ' transfer-target' : '') +
            (isTransferMode && !isTransferTarget ? ' transfer-source-option' : '');

        // Enable drag and drop (disabled in transfer mode)
        if (!isTransferMode) {
            item.draggable = true;
            item.dataset.index = index;
        }

        // Show different UI in transfer mode
        const buttonsHtml = isTransferMode ? '' : `
            <div class="screenshot-menu-wrapper">
                <button class="screenshot-menu-btn" data-index="${index}" title="More options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2"/>
                        <circle cx="12" cy="12" r="2"/>
                        <circle cx="12" cy="19" r="2"/>
                    </svg>
                </button>
                <div class="screenshot-menu" data-index="${index}">
                    <button class="screenshot-menu-item screenshot-translations" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6"/>
                        </svg>
                        Manage Translations...
                    </button>
                    <button class="screenshot-menu-item screenshot-replace" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        Replace Screenshot...
                    </button>
                    <button class="screenshot-menu-item screenshot-transfer" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy style from...
                    </button>
                    <button class="screenshot-menu-item screenshot-apply-all" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            <path d="M14 14l2 2 4-4"/>
                        </svg>
                        Apply style to all...
                    </button>
                    <button class="screenshot-menu-item screenshot-duplicate" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Duplicate
                    </button>
                    <button class="screenshot-menu-item screenshot-delete danger" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                        Remove
                    </button>
                </div>
            </div>
        `;

        // Get localized thumbnail image
        const thumbImg = getScreenshotImage(screenshot);
        const thumbIsVideo = !!thumbImg && thumbImg.tagName === 'VIDEO';
        const videoFrame = thumbIsVideo ? captureVideoFrameThumb(thumbImg) : null;
        // A video's blob: src can't render in an <img>; use a captured frame instead.
        const thumbSrc = thumbIsVideo ? (videoFrame || '') : (thumbImg?.src || '');
        const isBlank = !thumbSrc && !thumbIsVideo;

        // Build language flags indicator
        const availableLangs = getAvailableLanguagesForScreenshot(screenshot);
        const isComplete = isScreenshotComplete(screenshot);
        let langFlagsHtml = '';
        if (state.projectLanguages.length > 1) {
            const flags = availableLangs.map(lang => languageFlags[lang] || '🏳️').join('');
            const checkmark = isComplete ? '<span class="screenshot-complete">✓</span>' : '';
            langFlagsHtml = `<span class="screenshot-lang-flags">${flags}${checkmark}</span>`;
        }

        let thumbHtml;
        if (isBlank) {
            thumbHtml = `<div class="screenshot-thumb blank-thumb">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
              </div>`;
        } else if (thumbIsVideo && !thumbSrc) {
            // Video hasn't decoded a frame yet — show a film icon, replaced with the
            // captured frame asynchronously once the video is ready (see below).
            thumbHtml = `<div class="screenshot-thumb blank-thumb">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3z"/>
                </svg>
              </div>`;
        } else {
            thumbHtml = `<img class="screenshot-thumb" src="${thumbSrc}" alt="${screenshot.name}">`;
        }

        item.innerHTML = `
            <div class="drag-handle">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/>
                    <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
                    <circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>
                </svg>
            </div>
            ${thumbHtml}
            <div class="screenshot-info">
                <div class="screenshot-name">${screenshot.name}</div>
                <div class="screenshot-device">${isTransferTarget ? 'Click source to copy style' : screenshot.deviceType}${langFlagsHtml}</div>
            </div>
            ${buttonsHtml}
        `;

        // If this is a video whose frame wasn't ready, swap in the captured frame once
        // the video has decoded one (replacing the film-icon placeholder).
        if (thumbIsVideo && !thumbSrc) {
            const fillVideoThumb = () => {
                const frame = captureVideoFrameThumb(thumbImg);
                if (!frame) return;
                const el = item.querySelector('.screenshot-thumb');
                if (el) {
                    const img = document.createElement('img');
                    img.className = 'screenshot-thumb';
                    img.src = frame;
                    img.alt = screenshot.name;
                    el.replaceWith(img);
                }
            };
            thumbImg.addEventListener('loadeddata', fillVideoThumb, { once: true });
            setTimeout(fillVideoThumb, 300); // for videos already decoded
        }

        // Drag and drop handlers
        item.addEventListener('dragstart', (e) => {
            draggedScreenshotIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedScreenshotIndex = null;
            // Remove all drag-over states
            document.querySelectorAll('.screenshot-item.drag-insert-after, .screenshot-item.drag-insert-before').forEach(el => {
                el.classList.remove('drag-insert-after', 'drag-insert-before');
            });
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedScreenshotIndex !== null && draggedScreenshotIndex !== index) {
                // Determine if cursor is in top or bottom half
                const rect = item.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                const isAbove = e.clientY < midpoint;

                // Clear all indicators first
                document.querySelectorAll('.screenshot-item.drag-insert-after, .screenshot-item.drag-insert-before').forEach(el => {
                    el.classList.remove('drag-insert-after', 'drag-insert-before');
                });

                // Show line on the item AFTER which the drop will occur
                if (isAbove && index === 0) {
                    // Dropping before the first item - show line above it
                    item.classList.add('drag-insert-before');
                } else if (isAbove && index > 0) {
                    // Dropping before this item = after the previous item
                    const items = screenshotList.querySelectorAll('.screenshot-item');
                    const prevItem = items[index - 1];
                    if (prevItem && !prevItem.classList.contains('dragging')) {
                        prevItem.classList.add('drag-insert-after');
                    }
                } else if (!isAbove) {
                    // Dropping after this item
                    item.classList.add('drag-insert-after');
                }
            }
        });

        item.addEventListener('dragleave', () => {
            // Don't remove here - let dragover on other items handle it
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();

            // Determine drop position based on cursor
            const rect = item.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const dropAbove = e.clientY < midpoint;

            document.querySelectorAll('.screenshot-item.drag-insert-after, .screenshot-item.drag-insert-before').forEach(el => {
                el.classList.remove('drag-insert-after', 'drag-insert-before');
            });

            if (draggedScreenshotIndex !== null && draggedScreenshotIndex !== index) {
                // Calculate target index based on drop position
                let targetIndex = dropAbove ? index : index + 1;

                // Adjust if dragging from before the target
                if (draggedScreenshotIndex < targetIndex) {
                    targetIndex--;
                }

                // Reorder screenshots
                const draggedItem = state.screenshots[draggedScreenshotIndex];
                state.screenshots.splice(draggedScreenshotIndex, 1);
                state.screenshots.splice(targetIndex, 0, draggedItem);

                // Update selected index to follow the selected item
                if (state.selectedIndex === draggedScreenshotIndex) {
                    state.selectedIndex = targetIndex;
                } else if (draggedScreenshotIndex < state.selectedIndex && targetIndex >= state.selectedIndex) {
                    state.selectedIndex--;
                } else if (draggedScreenshotIndex > state.selectedIndex && targetIndex <= state.selectedIndex) {
                    state.selectedIndex++;
                }

                updateScreenshotList();
                updateCanvas();
            }
        });

        item.addEventListener('click', (e) => {
            if (e.target.closest('.screenshot-menu-wrapper') || e.target.closest('.drag-handle')) {
                return;
            }

            // Handle transfer mode click
            if (state.transferTarget !== null) {
                if (index !== state.transferTarget) {
                    // Transfer style from clicked screenshot to target
                    transferStyle(index, state.transferTarget);
                }
                return;
            }

            // Normal selection
            selectScreenshot(index);
        });

        // Menu button handler
        const menuBtn = item.querySelector('.screenshot-menu-btn');
        const menu = item.querySelector('.screenshot-menu');
        if (menuBtn && menu) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close all other menus first
                document.querySelectorAll('.screenshot-menu.open').forEach(m => {
                    if (m !== menu) m.classList.remove('open');
                });
                menu.classList.toggle('open');
            });
        }

        // Manage Translations button handler
        const translationsBtn = item.querySelector('.screenshot-translations');
        if (translationsBtn) {
            translationsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                openScreenshotTranslationsModal(index);
            });
        }

        // Replace button handler
        const replaceBtn = item.querySelector('.screenshot-replace');
        if (replaceBtn) {
            replaceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                replaceScreenshot(index);
            });
        }

        // Transfer button handler
        const transferBtn = item.querySelector('.screenshot-transfer');
        if (transferBtn) {
            transferBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                state.transferTarget = index;
                updateScreenshotList();
            });
        }

        // Apply style to all button handler
        const applyAllBtn = item.querySelector('.screenshot-apply-all');
        if (applyAllBtn) {
            applyAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                showApplyStyleModal(index);
            });
        }

        const duplicateBtn = item.querySelector('.screenshot-duplicate');
        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                duplicateScreenshot(index);
            });
        }

        // Delete button handler
        const deleteBtn = item.querySelector('.screenshot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                state.screenshots.splice(index, 1);
                if (state.selectedIndex >= state.screenshots.length) {
                    state.selectedIndex = Math.max(0, state.screenshots.length - 1);
                }
                updateScreenshotList();
                syncUIWithState();
                updateGradientStopsUI();
                updateCanvas();
            });
        }

        screenshotList.appendChild(item);

        // Layers tree: under the ACTIVE screenshot card, list everything on that
        // screen — groups as folders, then ungrouped items — Figma-style, each row
        // selectable. Rebuilt by updateGroupsList(); container created here.
        if (index === state.selectedIndex && !isTransferMode) {
            const tree = document.createElement('div');
            tree.className = 'layers-panel';
            tree.innerHTML = '<div class="layers-tree" id="layers-tree"></div>' +
                '<div class="layers-footer">' +
                '<button type="button" class="layers-add-group" id="new-group-btn" title="Bundle items into a folder you can move, zoom and rotate as one">+ Group</button>' +
                '</div>' +
                '<div id="group-builder" style="display:none;"></div>';
            screenshotList.appendChild(tree);
            tree.querySelector('#new-group-btn').addEventListener('click', openGroupBuilder);
            updateGroupsList();
        }
    });

    // Hide add buttons during transfer mode
    const addButtonsContainer = document.querySelector('.sidebar-add-buttons');
    if (addButtonsContainer) {
        addButtonsContainer.style.display = state.transferTarget === null ? '' : 'none';
    }

    // Update project selector to reflect current screenshot count
    updateProjectSelector();
}

function cancelTransfer() {
    state.transferTarget = null;
    updateScreenshotList();
}

function transferStyle(sourceIndex, targetIndex) {
    const source = state.screenshots[sourceIndex];
    const target = state.screenshots[targetIndex];

    if (!source || !target) {
        state.transferTarget = null;
        updateScreenshotList();
        return;
    }

    // Deep copy background settings
    target.background = JSON.parse(JSON.stringify(source.background));
    // Handle background image separately (not JSON serializable)
    if (source.background.image) {
        target.background.image = source.background.image;
    }

    // Deep copy screenshot settings
    target.screenshot = JSON.parse(JSON.stringify(source.screenshot));

    // Deep copy post-composite effects
    if (source.effects) target.effects = JSON.parse(JSON.stringify(source.effects));

    // Copy text styling but preserve actual text content
    const targetHeadlines = target.text.headlines;
    const targetSubheadlines = target.text.subheadlines;
    target.text = JSON.parse(JSON.stringify(source.text));
    // Restore original text content
    target.text.headlines = targetHeadlines;
    target.text.subheadlines = targetSubheadlines;

    // Deep copy elements (reconstruct Image objects for graphics and icons)
    target.elements = (source.elements || []).map(el => {
        const copy = JSON.parse(JSON.stringify({ ...el, image: undefined }));
        if (el.type === 'graphic' && el.image) {
            copy.image = el.image;
        } else if (el.type === 'icon' && el.image) {
            copy.image = el.image;
        }
        copy.id = crypto.randomUUID();
        return copy;
    });

    // Explicitly skip popouts — crop regions are specific to each screenshot's source image

    // Reset transfer mode
    state.transferTarget = null;

    // Update UI
    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    updateCanvas();
}

// Track which screenshot to apply style from
let applyStyleSourceIndex = null;

function showApplyStyleModal(sourceIndex) {
    applyStyleSourceIndex = sourceIndex;
    document.getElementById('apply-style-modal').classList.add('visible');
}

function applyStyleToAll() {
    if (applyStyleSourceIndex === null) return;

    const source = state.screenshots[applyStyleSourceIndex];
    if (!source) {
        applyStyleSourceIndex = null;
        return;
    }

    // Apply style to all other screenshots
    state.screenshots.forEach((target, index) => {
        if (index === applyStyleSourceIndex) return; // Skip source

        // Deep copy background settings
        target.background = JSON.parse(JSON.stringify(source.background));
        // Handle background image separately (not JSON serializable)
        if (source.background.image) {
            target.background.image = source.background.image;
        }

        // Deep copy screenshot settings
        target.screenshot = JSON.parse(JSON.stringify(source.screenshot));

        // Copy text styling but preserve actual text content
        const targetHeadlines = target.text.headlines;
        const targetSubheadlines = target.text.subheadlines;
        target.text = JSON.parse(JSON.stringify(source.text));
        // Restore original text content
        target.text.headlines = targetHeadlines;
        target.text.subheadlines = targetSubheadlines;

        // Deep copy elements
        target.elements = (source.elements || []).map(el => {
            const copy = JSON.parse(JSON.stringify({ ...el, image: undefined }));
            if (el.type === 'graphic' && el.image) {
                copy.image = el.image;
            }
            copy.id = crypto.randomUUID();
            return copy;
        });

        // Explicitly skip popouts — crop regions are specific to each screenshot's source image
    });

    applyStyleSourceIndex = null;

    // Update UI
    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    updateCanvas();
}

// ===========================================================================
// Screenshot Templates
// ---------------------------------------------------------------------------
// A template carries a serializable *look* (background + device/position + text
// styling) plus an optional multi-frame "story set" of placeholder captions, and
// is layered onto the user's own screenshots — never overwriting their images,
// and only overwriting headline/subheadline content when "use captions" is on.
// Built-in templates live in templates-library.js; custom ones live in IndexedDB.
// ===========================================================================

let customTemplates = []; // user-saved templates loaded from IndexedDB

function getBuiltInTemplates() {
    return Array.isArray(window.SCREENSHOT_TEMPLATES) ? window.SCREENSHOT_TEMPLATES : [];
}

function getAllTemplates() {
    return getBuiltInTemplates().concat(customTemplates);
}

function findTemplateById(id) {
    return getAllTemplates().find(t => t.id === id) || null;
}

// Deep-merge `over` onto a clone of `base`. Plain objects merge recursively;
// arrays and primitives replace wholesale. Used to layer a frame's overrides
// onto the template's base style.
function templateDeepMerge(base, over) {
    if (over === undefined || over === null) return base === undefined ? over : base;
    if (typeof over !== 'object' || Array.isArray(over)) return JSON.parse(JSON.stringify(over));
    const out = (base && typeof base === 'object' && !Array.isArray(base)) ? Object.assign({}, base) : {};
    for (const k of Object.keys(over)) out[k] = templateDeepMerge(out[k], over[k]);
    return out;
}

// Complete shapes used to backfill any fields a template (especially an imported
// or generated one) leaves out, so applying it can never produce a half-formed
// background/screenshot object that breaks the render pipeline.
const BASE_TEMPLATE_BACKGROUND = {
    type: 'gradient',
    gradient: { angle: 135, stops: [{ color: '#667eea', position: 0 }, { color: '#764ba2', position: 100 }] },
    solid: '#1a1a2e', image: null, imageFit: 'cover', imageBlur: 0,
    overlayColor: '#000000', overlayOpacity: 0, noise: false, noiseIntensity: 10
};
const BASE_TEMPLATE_SCREENSHOT = {
    scale: 70, y: 60, x: 50, rotation: 0, perspective: 0, cornerRadius: 24, frameStyle: 'none',
    use3D: false, device3D: 'iphone', rotation3D: { x: 0, y: 0, z: 0 },
    placeholderDevice: true, // show a device mockup on blank frames (ignored once an image is added)
    shadow: { enabled: true, style: 'drop', color: '#000000', blur: 40, opacity: 30, x: 0, y: 20, lightAngle: 40, lightElev: 0.65 },
    frame: { enabled: false, color: '#1d1d1f', width: 12, opacity: 100 }
};

function completeTemplateBackground(bg) {
    const out = templateDeepMerge(JSON.parse(JSON.stringify(BASE_TEMPLATE_BACKGROUND)), bg || {});
    out.image = null;
    return out;
}

function completeTemplateScreenshot(ss) {
    return templateDeepMerge(JSON.parse(JSON.stringify(BASE_TEMPLATE_SCREENSHOT)), ss || {});
}

// Resolve the concrete style + caption for a frame index (wraps around the set).
function buildFrameStyle(template, frameIndex) {
    const frames = (template.frames && template.frames.length) ? template.frames : [{ headline: '', subheadline: '' }];
    const n = frames.length;
    const frame = frames[((frameIndex % n) + n) % n];
    const baseStyle = JSON.parse(JSON.stringify(template.style || {}));
    const style = frame.overrides ? templateDeepMerge(baseStyle, frame.overrides) : baseStyle;
    // Backfill complete background/screenshot shapes (text is completed via
    // normalizeTextSettings in applyTemplateTextStyle).
    style.background = completeTemplateBackground(style.background);
    style.screenshot = completeTemplateScreenshot(style.screenshot);
    return { frame, style };
}

function applyTemplateBackground(target, styleBg) {
    const bg = JSON.parse(JSON.stringify(styleBg));
    bg.image = null; // templates never carry a live image; gradient/solid only
    delete bg._imageLoading;
    target.background = bg;
}

const DEFAULT_TEXT_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Display'";
const _tclamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Build a text ELEMENT from a headline/subheadline-style config object (the same field
// names used by both template `style.text` and a screenshot's `text`). Shared by template
// application and the headlines→elements migration so they map identically.
//   textObj: object with headline*/subheadline*/position/offsetX/offsetY/stroke/shadow/…
//   role:    'headline' | 'subheadline'
//   textsObj: per-language strings ({ en: '…', de: '…' })
function buildTextElementFromTextObj(textObj, role, textsObj) {
    const Cap = role.charAt(0).toUpperCase() + role.slice(1);
    const size = textObj[role + 'Size'] || (role === 'headline' ? 100 : 50);
    const position = textObj.position || 'top';
    const offsetY = typeof textObj.offsetY === 'number' ? textObj.offsetY : 12;
    const offsetX = typeof textObj.offsetX === 'number' ? textObj.offsetX : 0;
    // Headlines anchor at the top/bottom edge; elements center at el.y. Approximate the
    // visual position (migrated/template text may need a small drag — the selection box
    // makes that easy). Subheadline sits a bit below the headline.
    let baseY = position === 'top' ? offsetY + 6 : 100 - offsetY - 6;
    if (role === 'subheadline') baseY = position === 'top' ? baseY + 13 : baseY + 13;
    const texts = JSON.parse(JSON.stringify(textsObj || {}));
    const firstText = texts[state.currentLanguage] || texts.en || Object.values(texts).find(v => v) || '';
    const cloneFx = (v, d) => (v ? JSON.parse(JSON.stringify(v)) : Object.assign({}, d));
    return {
        id: crypto.randomUUID(),
        type: 'text',
        role, // 'headline' | 'subheadline' — lets Magic Titles / translate find the right element
        _tpl: false, // tagged true by template application; migration leaves it false
        x: _tclamp(50 + offsetX, 4, 96),
        y: _tclamp(baseY, 4, 96),
        width: 84,
        rotation: 0,
        opacity: typeof textObj[role + 'Opacity'] === 'number' ? textObj[role + 'Opacity'] : (role === 'headline' ? 100 : 70),
        layer: 'above-text',
        text: firstText,
        texts,
        font: textObj[role + 'Font'] || textObj.headlineFont || DEFAULT_TEXT_FONT,
        fontSize: size,
        fontWeight: textObj[role + 'Weight'] || (role === 'headline' ? '600' : '400'),
        fontColor: textObj[role + 'Color'] || '#ffffff',
        italic: !!textObj[role + 'Italic'],
        frame: 'none', frameColor: '#ffffff', frameScale: 100,
        // Stroke/shadow are per-glyph (safe on both); bubble/reveal go on the headline only
        // so a two-part block doesn't draw two containers.
        stroke: cloneFx(textObj.stroke, DEFAULT_TEXT_STROKE),
        shadow: cloneFx(textObj.shadow, DEFAULT_TEXT_SHADOW),
        bubble: role === 'headline' ? cloneFx(textObj.bubble, DEFAULT_TEXT_BUBBLE) : Object.assign({}, DEFAULT_TEXT_BUBBLE),
        reveal: role === 'headline' ? cloneFx(textObj.reveal, DEFAULT_TEXT_REVEAL) : Object.assign({}, DEFAULT_TEXT_REVEAL),
        name: Cap
    };
}

// Find (or create) the screenshot's headline/subheadline text element and set its text for a
// language. Used by Magic Titles + batch translate now that headlines are text elements.
function setHeadlineElementText(screenshot, role, lang, value) {
    if (!screenshot) return null;
    if (!Array.isArray(screenshot.elements)) screenshot.elements = [];
    let el = screenshot.elements.find(e => e.type === 'text' && e.role === role);
    if (!el) {
        // Seed styling from the screenshot's (dormant) text settings or the global defaults.
        const styleSrc = screenshot.text || state.defaults.text || {};
        el = buildTextElementFromTextObj(styleSrc, role, { [lang]: value });
        screenshot.elements.push(el);
    }
    if (!el.texts) el.texts = {};
    el.texts[lang] = value;
    if (lang === (state.currentLanguage || 'en') || !el.text) el.text = value;
    return el;
}

// Apply a template's text as text ELEMENTS (headline + optional subheadline), tagged `_tpl`
// so re-applying a template replaces them while leaving the user's own elements alone.
function applyTemplateTextStyle(target, styleText, frame, opts) {
    const lang = (opts && opts.lang) || state.currentLanguage || 'en';
    if (!Array.isArray(target.elements)) target.elements = [];

    const headlineText = frame && typeof frame.headline === 'string' ? frame.headline : '';
    const subText = frame && typeof frame.subheadline === 'string' ? frame.subheadline : '';

    const newEls = [];
    if (styleText.headlineEnabled !== false && headlineText) {
        const el = buildTextElementFromTextObj(styleText, 'headline', { [lang]: headlineText, en: headlineText });
        el._tpl = true;
        newEls.push(el);
    }
    if (styleText.subheadlineEnabled && subText) {
        const el = buildTextElementFromTextObj(styleText, 'subheadline', { [lang]: subText, en: subText });
        el._tpl = true;
        newEls.push(el);
    }
    // Replace prior template text elements; keep the user's own + template decoration elements.
    target.elements = target.elements.filter(e => !(e._tpl && e.type === 'text')).concat(newEls);
}

// Template decoration elements (e.g. a star-rating badge). Tagged `_tpl` and added
// alongside the template's text elements + the user's own elements. Re-applying a
// template replaces prior template decorations but keeps user-added elements.
function applyTemplateElements(target, styleElements) {
    if (!Array.isArray(target.elements)) target.elements = [];
    // Drop prior NON-text template decorations (text ones are managed by applyTemplateTextStyle).
    target.elements = target.elements.filter(e => !(e._tpl && e.type !== 'text'));
    styleElements.forEach(spec => {
        const copy = JSON.parse(JSON.stringify(Object.assign({}, spec, { image: undefined })));
        copy.id = crypto.randomUUID();
        copy._tpl = true;
        if (copy.type === 'icon' && copy.iconName && typeof getLucideImage === 'function') {
            getLucideImage(copy.iconName, copy.iconColor || '#ffffff', copy.iconStrokeWidth || 2)
                .then(img => { copy.image = img; updateCanvas(); })
                .catch(() => {});
        } else if (copy.type === 'graphic' && copy.src) {
            const im = new Image();
            im.onload = () => { copy.image = im; updateCanvas(); };
            im.src = copy.src;
        }
        target.elements.push(copy);
    });
}

function applyTemplateToScreenshot(target, template, frameIndex, opts) {
    if (!target || !template) return;
    const { frame, style } = buildFrameStyle(template, frameIndex);
    if (style.background) applyTemplateBackground(target, style.background);
    if (style.screenshot) target.screenshot = JSON.parse(JSON.stringify(style.screenshot));
    if (style.text) applyTemplateTextStyle(target, style.text, frame, opts);
    if (Array.isArray(style.elements)) applyTemplateElements(target, style.elements);
    // Built-in reel animation (animated templates), applied relative to the look just
    // set, unless the user turned it off. template.animation is either a named-preset
    // id (string) or an inline { tour, poses } spec for a per-template custom motion.
    if (opts && opts.includeAnimation && template.animation) {
        if (typeof template.animation === 'string' && typeof window.applyAnimationPreset === 'function') {
            window.applyAnimationPreset(target, template.animation);
        } else if (typeof template.animation === 'object' && typeof window.applyAnimationSpec === 'function') {
            window.applyAnimationSpec(target, template.animation);
        }
    }
}

function afterTemplateApply() {
    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    if (typeof updateElementsList === 'function') updateElementsList();
    // Reflect any applied reel animation in the timeline UI.
    if (typeof renderTimelineTracks === 'function') renderTimelineTracks();
    if (typeof updateTourUI === 'function') updateTourUI();
    if (typeof updateTimelineVisibility === 'function') updateTimelineVisibility();
    updateCanvas();
    saveState();
}

function applyTemplateToAll(template, opts) {
    if (!template || !state.screenshots.length) return;
    state.screenshots.forEach((s, i) => applyTemplateToScreenshot(s, template, i, opts));
    afterTemplateApply();
}

function applyTemplateToSelected(template, opts) {
    const target = state.screenshots[state.selectedIndex];
    if (!template || !target) return;
    // A single "apply to current" uses the template's primary frame (0) — the
    // story-position mapping (frame = index % n) only makes sense for apply-to-all.
    applyTemplateToScreenshot(target, template, 0, opts);
    afterTemplateApply();
}

// Create one new (blank) screenshot per template frame, pre-styled with captions.
function createSetFromTemplate(template, opts) {
    if (!template) return;
    const lang = state.currentLanguage || 'en';
    if (opts && opts.setDevice && template.device && (deviceDimensions[template.device] || template.device === 'custom')) {
        setOutputDevice(template.device);
    }
    const frames = (template.frames && template.frames.length) ? template.frames : [{ headline: '', subheadline: '' }];
    const startIndex = state.screenshots.length;
    const applyCaptions = !opts || opts.applyCaptions !== false;
    const includeAnimation = !opts || opts.includeAnimation !== false;
    frames.forEach((frame, i) => {
        createNewScreenshot(null, null, frame.name || `Screen ${startIndex + i + 1}`, lang, state.outputDevice);
        const target = state.screenshots[state.screenshots.length - 1];
        applyTemplateToScreenshot(target, template, i, { applyCaptions, lang, includeAnimation });
    });
    state.selectedIndex = startIndex;
    afterTemplateApply();
}

function setOutputDevice(deviceKey) {
    if (deviceKey !== 'custom' && !deviceDimensions[deviceKey]) return;
    state.outputDevice = deviceKey;
    syncUIWithState();
    updateCanvas();
}

// Extract the serializable styling of a screenshot (no images, no text content).
function extractStyleSnapshot(index) {
    const s = state.screenshots[index];
    if (!s) return null;
    const bg = JSON.parse(JSON.stringify(sanitizeBackgroundForSave(s.background)));
    bg.image = null;
    const text = JSON.parse(JSON.stringify(s.text || {}));
    ['headlines', 'subheadlines', 'headlineLanguages', 'subheadlineLanguages',
     'currentHeadlineLang', 'currentSubheadlineLang', 'currentLayoutLang', 'languageSettings']
        .forEach(k => delete text[k]);
    const elements = (s.elements || []).map(el => JSON.parse(JSON.stringify(Object.assign({}, el, { image: undefined }))));
    return { background: bg, screenshot: JSON.parse(JSON.stringify(s.screenshot)), text, elements };
}

// ----- custom template persistence (IndexedDB 'templates' store) -----

async function loadCustomTemplates() {
    if (!db) { customTemplates = []; return; }
    return new Promise((resolve) => {
        try {
            const tx = db.transaction([TEMPLATES_STORE], 'readonly');
            const req = tx.objectStore(TEMPLATES_STORE).getAll();
            req.onsuccess = () => { customTemplates = (req.result || []).filter(Boolean); resolve(); };
            req.onerror = () => { customTemplates = []; resolve(); };
        } catch (e) { customTemplates = []; resolve(); }
    });
}

async function saveCustomTemplate(tpl) {
    if (!tpl || !tpl.id) return;
    tpl.custom = true;
    const existing = customTemplates.findIndex(t => t.id === tpl.id);
    if (existing > -1) customTemplates[existing] = tpl; else customTemplates.push(tpl);
    if (db) {
        try {
            const tx = db.transaction([TEMPLATES_STORE], 'readwrite');
            tx.objectStore(TEMPLATES_STORE).put(JSON.parse(JSON.stringify(tpl)));
        } catch (e) { console.error('Save template failed:', e); }
    }
    if (document.getElementById('templates-modal')?.classList.contains('visible')) renderTemplateGallery();
}

async function deleteCustomTemplate(id) {
    customTemplates = customTemplates.filter(t => t.id !== id);
    if (db) {
        try {
            const tx = db.transaction([TEMPLATES_STORE], 'readwrite');
            tx.objectStore(TEMPLATES_STORE).delete(id);
        } catch (e) { console.error('Delete template failed:', e); }
    }
    if (templatesSelectedId === id) templatesSelectedId = null;
    renderTemplateGallery();
}

async function saveCurrentAsCustomTemplate(name) {
    if (!state.screenshots.length) { await showAppAlert('Add a screenshot first, then save its style as a template.', 'info'); return; }
    const lang = state.currentLanguage || 'en';
    const baseSnap = extractStyleSnapshot(state.selectedIndex);
    const frames = state.screenshots.map((s, i) => {
        const t = s.text || {};
        const headline = (t.headlines && (t.headlines[lang] || t.headlines.en)) || '';
        const subheadline = (t.subheadlines && (t.subheadlines[lang] || t.subheadlines.en)) || '';
        const snap = extractStyleSnapshot(i);
        return {
            name: s.name || `Screen ${i + 1}`,
            headline, subheadline,
            overrides: { background: snap.background, screenshot: snap.screenshot, text: snap.text, elements: snap.elements }
        };
    });
    const tpl = {
        id: 'custom_' + Date.now(),
        name: name || 'My Template',
        category: 'My Templates',
        archetype: 'custom',
        description: 'Saved from your project.',
        device: state.outputDevice,
        accent: '#0a84ff',
        custom: true,
        style: baseSnap,
        frames
    };
    await saveCustomTemplate(tpl);
    templatesSelectedId = tpl.id;
    templatesActiveCategory = 'My Templates';
    renderTemplateGallery();
}

function exportTemplateToFile(tpl) {
    if (!tpl) return;
    const data = JSON.stringify(Object.assign({ _shotscraftTemplate: 1 }, tpl), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(tpl.name || 'template').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}.template.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function importTemplateFromFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed.style !== 'object' || Array.isArray(parsed.style)) {
            await showAppAlert('That file is not a valid template.', 'error');
            return;
        }
        // Normalize untrusted shape: frames must be a real array of frame objects.
        if (!Array.isArray(parsed.frames)) {
            parsed.frames = [{ name: 'Screen', headline: '', subheadline: '' }];
        } else {
            parsed.frames = parsed.frames.filter(f => f && typeof f === 'object' && !Array.isArray(f));
            if (!parsed.frames.length) parsed.frames = [{ name: 'Screen', headline: '', subheadline: '' }];
        }
        parsed.id = 'custom_' + Date.now();
        parsed.custom = true;
        parsed.category = typeof parsed.category === 'string' ? parsed.category : 'My Templates';
        parsed.name = typeof parsed.name === 'string' ? parsed.name : 'Imported Template';
        delete parsed._shotscraftTemplate;
        await saveCustomTemplate(parsed);
        templatesSelectedId = parsed.id;
        templatesActiveCategory = parsed.category;
        renderTemplateGallery();
    } catch (e) {
        await showAppAlert('Could not import template: ' + e.message, 'error');
    }
}

// ----- Templates modal UI -----

let templatesSelectedId = null;
let templatesActiveCategory = 'All';

function openTemplatesModal() {
    templatesActiveCategory = templatesActiveCategory || 'All';
    renderTemplateGallery();
    document.getElementById('templates-modal').classList.add('visible');
}

function closeTemplatesModal() {
    document.getElementById('templates-modal').classList.remove('visible');
}

function getTemplateCategories() {
    const cats = [];
    getAllTemplates().forEach(t => { if (t.category && !cats.includes(t.category)) cats.push(t.category); });
    return ['All'].concat(cats);
}

// Build a faithful-enough CSS preview of a template's first frame (background +
// device silhouette positioned/scaled/tilted + headline). Cheap, no canvas.
function renderTemplatePreview(template) {
    const wrap = document.createElement('div');
    wrap.className = 'tpl-preview';
    const { frame, style } = buildFrameStyle(template, 0);
    const bg = style.background || {};
    if (bg.type === 'solid') {
        wrap.style.background = bg.solid || '#1a1a2e';
    } else if (bg.gradient) {
        const stops = (bg.gradient.stops || []).map(s => `${s.color} ${s.position}%`).join(', ');
        wrap.style.background = `linear-gradient(${bg.gradient.angle || 135}deg, ${stops})`;
    }

    const ss = style.screenshot || {};
    const device = document.createElement('div');
    device.className = 'tpl-preview-device';
    const widthPct = Math.max(20, Math.min(96, (ss.scale || 70) * 0.92));
    device.style.width = widthPct + '%';
    device.style.left = (ss.x ?? 50) + '%';
    device.style.top = (ss.y ?? 60) + '%';
    // Hint the 3D camera angle in the thumbnail (templates render on the real 3D
    // device; reflect their yaw/pitch with a subtle CSS rotateY/rotateX).
    const r3 = ss.rotation3D || { x: 0, y: 0, z: 0 };
    const ry = ss.use3D ? (r3.y || 0) : 0;
    const rx = ss.use3D ? (r3.x || 0) : 0;
    device.style.transform = `translate(-50%, -50%) rotate(${ss.rotation || 0}deg) perspective(700px) rotateY(${ry}deg) rotateX(${rx}deg)`;
    device.style.borderRadius = Math.max(6, (ss.cornerRadius || 24) * 0.32) + 'px';
    if (ss.frame && ss.frame.enabled) {
        device.style.borderColor = ss.frame.color || '#1d1d1f';
        device.style.borderWidth = '3px';
        device.style.borderStyle = 'solid';
    }
    if (ss.shadow && ss.shadow.enabled) {
        device.style.boxShadow = `0 ${Math.max(2, (ss.shadow.y || 20) * 0.4)}px ${Math.max(6, (ss.shadow.blur || 40) * 0.4)}px rgba(0,0,0,${(ss.shadow.opacity || 30) / 100 * 0.9})`;
    }
    wrap.appendChild(device);

    const txt = style.text || {};
    if (txt.headlineEnabled !== false && frame && frame.headline) {
        const h = document.createElement('div');
        h.className = 'tpl-preview-headline';
        h.textContent = frame.headline.replace(/\n/g, ' ');
        h.style.color = txt.headlineColor || '#ffffff';
        h.style.fontFamily = txt.headlineFont || '';
        h.style.fontWeight = txt.headlineWeight || '700';
        h.style.fontStyle = txt.headlineItalic ? 'italic' : 'normal';
        h.style.fontSize = Math.max(8, Math.min(22, (txt.headlineSize || 100) * 0.13)) + 'px';
        const pos = txt.position || 'top';
        h.style.alignItems = pos === 'top' ? 'flex-start' : (pos === 'bottom' ? 'flex-end' : 'center');
        wrap.appendChild(h);
    }
    return wrap;
}

function renderTemplateGallery() {
    const tabsEl = document.getElementById('templates-tabs');
    const galleryEl = document.getElementById('templates-gallery');
    if (!tabsEl || !galleryEl) return;

    // Category tabs
    tabsEl.innerHTML = '';
    getTemplateCategories().forEach(cat => {
        const tab = document.createElement('button');
        tab.className = 'tpl-tab' + (cat === templatesActiveCategory ? ' active' : '');
        tab.textContent = cat;
        tab.addEventListener('click', () => { templatesActiveCategory = cat; renderTemplateGallery(); });
        tabsEl.appendChild(tab);
    });

    // Cards
    galleryEl.innerHTML = '';
    const list = getAllTemplates().filter(t => templatesActiveCategory === 'All' || t.category === templatesActiveCategory);
    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'tpl-empty';
        empty.textContent = templatesActiveCategory === 'My Templates'
            ? 'No saved templates yet. Style a screenshot, then "Save current as template".'
            : 'No templates in this category.';
        galleryEl.appendChild(empty);
    }
    list.forEach(tpl => {
        const card = document.createElement('div');
        card.className = 'tpl-card' + (tpl.id === templatesSelectedId ? ' selected' : '');
        card.dataset.id = tpl.id;

        card.appendChild(renderTemplatePreview(tpl));

        const meta = document.createElement('div');
        meta.className = 'tpl-card-meta';
        const frameCount = Math.max(1, Array.isArray(tpl.frames) ? tpl.frames.length : 1);
        // accent may come from an imported template (untrusted) — only allow a
        // hex/rgb/hsl/named color, else fall back, so it can't break out of the
        // style attribute.
        const accent = safeCssColor(tpl.accent) || 'var(--accent)';
        const animChip = tpl.animation ? `<span class="tpl-card-anim" title="Includes a built-in marketing animation">✨ Animated</span>` : '';
        meta.innerHTML = `
            <div class="tpl-card-name">${escapeHtmlSafe(tpl.name || 'Template')}</div>
            <div class="tpl-card-sub">
                <span class="tpl-card-chip" style="border-color:${escapeHtmlSafe(accent)}">${escapeHtmlSafe(tpl.category || '')}</span>
                <span class="tpl-card-frames">${frameCount} frame${frameCount === 1 ? '' : 's'}</span>
                ${animChip}
            </div>`;
        card.appendChild(meta);

        if (tpl.animation) {
            const badge = document.createElement('div');
            badge.className = 'tpl-card-anim-badge';
            badge.textContent = '✨';
            badge.title = 'Animated template';
            card.appendChild(badge);
        }

        if (tpl.custom) {
            const del = document.createElement('button');
            del.className = 'tpl-card-delete';
            del.title = 'Delete template';
            del.innerHTML = '&times;';
            del.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (await showAppConfirm(`Delete template "${tpl.name}"?`, 'Delete', 'Cancel')) deleteCustomTemplate(tpl.id);
            });
            card.appendChild(del);
        }

        card.addEventListener('click', () => {
            templatesSelectedId = tpl.id;
            renderTemplateGallery();
        });
        card.addEventListener('dblclick', () => {
            templatesSelectedId = tpl.id;
            templatesApply('all');
        });
        galleryEl.appendChild(card);
    });

    updateTemplateActionState();
}

function updateTemplateActionState() {
    const selected = !!findTemplateById(templatesSelectedId);
    const hasShots = state.screenshots.length > 0;
    const setEnabled = (id, on) => { const el = document.getElementById(id); if (el) el.disabled = !on; };
    setEnabled('templates-apply-selected', selected && hasShots);
    setEnabled('templates-apply-all', selected && hasShots);
    setEnabled('templates-create-set', selected);
    setEnabled('templates-export', selected);
}

function templatesApply(mode) {
    const tpl = findTemplateById(templatesSelectedId);
    if (!tpl) return;
    const applyCaptions = !!document.getElementById('templates-apply-captions')?.checked;
    const animEl = document.getElementById('templates-include-animation');
    const includeAnimation = animEl ? animEl.checked : true;
    const opts = { applyCaptions, includeAnimation };
    if (mode === 'all') applyTemplateToAll(tpl, opts);
    else if (mode === 'selected') applyTemplateToSelected(tpl, opts);
    else if (mode === 'set') createSetFromTemplate(tpl, Object.assign({ setDevice: true }, opts));
    closeTemplatesModal();
}

function escapeHtmlSafe(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Allow only simple, safe color tokens (hex / rgb[a] / hsl[a] / a–z named color).
function safeCssColor(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
    if (/^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/i.test(v)) return v;
    if (/^[a-z]+$/i.test(v)) return v;
    return null;
}

function setupTemplatesUI() {
    const openBtn = document.getElementById('templates-btn');
    if (openBtn) openBtn.addEventListener('click', openTemplatesModal);
    const startBtn = document.getElementById('start-from-template-btn');
    if (startBtn) startBtn.addEventListener('click', openTemplatesModal);

    const closeBtn = document.getElementById('templates-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeTemplatesModal);
    const overlay = document.getElementById('templates-modal');
    if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTemplatesModal(); });

    document.getElementById('templates-apply-all')?.addEventListener('click', () => templatesApply('all'));
    document.getElementById('templates-apply-selected')?.addEventListener('click', () => templatesApply('selected'));
    document.getElementById('templates-create-set')?.addEventListener('click', () => templatesApply('set'));

    document.getElementById('templates-export')?.addEventListener('click', () => {
        const tpl = findTemplateById(templatesSelectedId);
        if (tpl) exportTemplateToFile(tpl);
    });
    document.getElementById('templates-import')?.addEventListener('click', () => {
        document.getElementById('templates-import-input')?.click();
    });
    document.getElementById('templates-import-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importTemplateFromFile(file);
        e.target.value = '';
    });
    document.getElementById('templates-save-current')?.addEventListener('click', async () => {
        const name = await showAppPrompt('Name this template', 'My Template');
        if (name) saveCurrentAsCustomTemplate(name.trim());
    });
}

// Replace screenshot image via file picker
function replaceScreenshot(index) {
    const screenshot = state.screenshots[index];
    if (!screenshot) return;

    // Create a hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            document.body.removeChild(fileInput);
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Get the current language
                const lang = state.currentLanguage;

                // Update the localized image for the current language
                if (!screenshot.localizedImages) {
                    screenshot.localizedImages = {};
                }

                screenshot.localizedImages[lang] = {
                    image: img,
                    src: event.target.result,
                    name: file.name
                };

                // Also update legacy image field for compatibility
                screenshot.image = img;

                // Update displays
                updateScreenshotList();
                updateCanvas();
                saveState();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);

        document.body.removeChild(fileInput);
    });

    // Trigger file dialog
    fileInput.click();
}

function updateGradientStopsUI() {
    const container = document.getElementById('gradient-stops');
    container.innerHTML = '';

    const bg = getBackground();
    bg.gradient.stops.forEach((stop, index) => {
        const div = document.createElement('div');
        div.className = 'gradient-stop';
        div.innerHTML = `
            <input type="color" value="${stop.color}" data-stop="${index}">
            <input type="number" value="${stop.position}" min="0" max="100" data-stop="${index}">
            <span>%</span>
            ${index > 1 ? `<button class="screenshot-delete" data-stop="${index}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>` : ''}
        `;

        div.querySelector('input[type="color"]').addEventListener('input', (e) => {
            const currentBg = getBackground();
            currentBg.gradient.stops[index].color = e.target.value;
            // Deselect preset when manually changing colors
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            updateCanvas();
        });

        div.querySelector('input[type="number"]').addEventListener('input', (e) => {
            const currentBg = getBackground();
            currentBg.gradient.stops[index].position = parseInt(e.target.value);
            // Deselect preset when manually changing positions
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            updateCanvas();
        });

        const deleteBtn = div.querySelector('.screenshot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                const currentBg = getBackground();
                currentBg.gradient.stops.splice(index, 1);
                // Deselect preset when deleting a stop
                document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
                updateGradientStopsUI();
                updateCanvas();
            });
        }

        container.appendChild(div);
    });
}

function getCanvasDimensions() {
    if (state.outputDevice === 'custom') {
        return { width: state.customWidth, height: state.customHeight };
    }
    return deviceDimensions[state.outputDevice];
}

// Compute the preview's max display size from the actual available work area
// (instead of fixed 400x700), so the canvas fills the space and never gets cut
// off when the toolbar/timeline change the layout. Width is capped so adjacent
// screenshots can still peek in from the sides (carousel feel).
function getPreviewMaxSize() {
    const area = document.querySelector('.canvas-area');
    if (!area || !area.clientHeight) return { maxWidth: 400, maxHeight: 700 };
    const cs = getComputedStyle(area);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = area.clientWidth - padX;
    const availH = area.clientHeight - padY;
    return {
        maxWidth: Math.max(200, availW * 0.68),  // leave a little room for side-preview peeks
        maxHeight: Math.max(280, availH),
    };
}

function updateCanvas() {
    scheduleSave(); // Debounced persistence — avoids per-frame IndexedDB writes during drags/scrubbing
    noteHistoryActivity(); // Undo/redo: records a step at the settle boundary if content changed
    if (typeof ensureVideoTickLoop === 'function') ensureVideoTickLoop();
    const dims = getCanvasDimensions();
    canvas.width = dims.width;
    canvas.height = dims.height;

    // Scale for preview based on available work-area size
    const { maxWidth: maxPreviewWidth, maxHeight: maxPreviewHeight } = getPreviewMaxSize();
    const scale = Math.min(maxPreviewWidth / dims.width, maxPreviewHeight / dims.height);
    canvas.style.width = (dims.width * scale) + 'px';
    canvas.style.height = (dims.height * scale) + 'px';

    // Draw background
    drawBackground();

    // Draw noise overlay on background if enabled
    if (getBackground().noise) {
        drawNoise();
    }

    // Elements behind screenshot
    drawElements(ctx, dims, 'behind-screenshot');

    // Draw screenshot (2D mode) or 3D phone model
    if (state.screenshots.length > 0) {
        const screenshot = state.screenshots[state.selectedIndex];
        const img = screenshot ? getScreenshotImage(screenshot) : null;
        const ss = getScreenshotSettings();
        const use3D = ss.use3D || false;
        if (use3D && typeof renderThreeJSToCanvas === 'function' && phoneModelLoaded) {
            // In 3D mode, update the screen texture and render the phone model. The
            // device renders even with no uploaded image (blank template frames show
            // the 3D phone with a placeholder screen); updateScreenTexture handles both.
            if (typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            renderThreeJSToCanvas(canvas, dims.width, dims.height);
        } else {
            // Either 2D mode, OR 3D is selected but the phone model isn't ready yet (common
            // right after adding a screenshot/video — before the GLTF finishes loading, or
            // during a device-model swap). The 3D-not-ready case previously fell through to
            // NOTHING, so the active slide drew blank and stayed blank until a manual reload.
            // Draw the flat screenshot as a stand-in so the slide is never empty; once the
            // model loads, the load-completion hooks call updateCanvas() again and it upgrades
            // to the 3D device. (When the model IS loaded this branch isn't reached, so the
            // normal 3D look is unchanged.)
            drawScreenshot(use3D);   // forceFlat in the 3D-not-ready case (no 3D render to clobber)
            // Make sure the 3D pipeline is actually initializing/loading so it WILL upgrade —
            // updateSidePreviews() kicks this off too, but call it here so a 3D slide whose
            // model isn't loaded reliably triggers the load + re-render rather than sitting on
            // the 2D fallback.
            if (use3D && typeof showThreeJS === 'function') showThreeJS(true);
        }

        // Composite any extra 3D devices on top of the primary device (same layer,
        // below above-screenshot elements and text).
        drawExtraDevices(canvas, dims);
    }

    // Elements above screenshot but behind text
    drawElements(ctx, dims, 'above-screenshot');

    // Draw popouts (cropped regions from source image)
    drawPopouts(ctx, dims);

    // (Headline/subheadline are text elements now — drawn in the element layers below.)

    // Elements above text
    drawElements(ctx, dims, 'above-text');

    // Post-composite effects (bloom, vignette, gobo, …) over the whole frame.
    if (typeof applyEffects === 'function') applyEffects(ctx, canvas, dims, getEffects());

    // Update side previews
    updateSidePreviews();

    // Selection chrome (bounding box + transform handles) on its own overlay canvas.
    // Runs after the frame is composited so the box tracks live/animated geometry; it's
    // a separate canvas so it never appears in exports.
    if (typeof drawSelectionOverlay === 'function') drawSelectionOverlay();

    // Live motion-blur preview: when the playhead is parked/scrubbed on an animated
    // frame, accumulate sub-frames so the blur that exports produce is visible here.
    // Skipped during playback (kept sharp for speed) and while the blur pass itself
    // is re-rendering sub-frames (the _liveMBRendering guard prevents recursion).
    if (!_liveMBRendering && liveMotionBlurActive()) scheduleLiveMotionBlur();
}

function updateSidePreviews() {
    const dims = getCanvasDimensions();
    // Same scale as main preview
    const { maxWidth: maxPreviewWidth, maxHeight: maxPreviewHeight } = getPreviewMaxSize();
    const previewScale = Math.min(maxPreviewWidth / dims.width, maxPreviewHeight / dims.height);
    // Reduced-resolution render args for the (small) side previews.
    const { pdims, pscale } = sidePreviewDims(dims, previewScale);

    // Initialize Three.js if any screenshot uses 3D mode (needed for side previews).
    // Skip this preload pass mid-slide — slideToScreenshot already preloads the needed
    // models, and re-running it every slide is wasted work.
    const any3D = state.screenshots.some(s => s.screenshot?.use3D);
    if (any3D && !skipSidePreviewRender && typeof showThreeJS === 'function') {
        showThreeJS(true);

        // Preload phone models for adjacent screenshots to prevent flicker
        if (typeof loadCachedPhoneModel === 'function') {
            const adjacentIndices = [state.selectedIndex - 1, state.selectedIndex + 1]
                .filter(i => i >= 0 && i < state.screenshots.length);
            adjacentIndices.forEach(i => {
                const ss = state.screenshots[i]?.screenshot;
                if (ss?.use3D && ss?.device3D) {
                    loadCachedPhoneModel(ss.device3D);
                }
            });
        }
    }

    // Calculate main canvas display width and position side previews with 10px gap
    const mainCanvasWidth = dims.width * previewScale;
    const gap = 10;
    const sideOffset = mainCanvasWidth / 2 + gap;
    const farSideOffset = sideOffset + mainCanvasWidth + gap;

    // Previous screenshot (left, index - 1)
    const prevIndex = state.selectedIndex - 1;
    if (prevIndex >= 0 && state.screenshots.length > 1) {
        sidePreviewLeft.classList.remove('hidden');
        sidePreviewLeft.style.right = `calc(50% + ${sideOffset}px)`;
        // Skip render if already pre-rendered during slide transition
        if (!skipSidePreviewRender) {
            renderScreenshotToCanvas(prevIndex, canvasLeft, ctxLeft, pdims, pscale);
        }
        // Click to select previous with animation
        sidePreviewLeft.onclick = () => {
            if (isSliding) return;
            slideToScreenshot(prevIndex, 'left');
        };
    } else {
        sidePreviewLeft.classList.add('hidden');
    }

    // Far previous screenshot (far left, index - 2)
    const farPrevIndex = state.selectedIndex - 2;
    if (farPrevIndex >= 0 && state.screenshots.length > 2) {
        sidePreviewFarLeft.classList.remove('hidden');
        sidePreviewFarLeft.style.right = `calc(50% + ${farSideOffset}px)`;
        // Far previews are peripheral — skip them mid-slide for speed; the settle pass
        // re-renders them once scrolling stops.
        if (!skipSidePreviewRender) renderScreenshotToCanvas(farPrevIndex, canvasFarLeft, ctxFarLeft, pdims, pscale);
    } else {
        sidePreviewFarLeft.classList.add('hidden');
    }

    // Next screenshot (right, index + 1)
    const nextIndex = state.selectedIndex + 1;
    if (nextIndex < state.screenshots.length && state.screenshots.length > 1) {
        sidePreviewRight.classList.remove('hidden');
        sidePreviewRight.style.left = `calc(50% + ${sideOffset}px)`;
        // Skip render if already pre-rendered during slide transition
        if (!skipSidePreviewRender) {
            renderScreenshotToCanvas(nextIndex, canvasRight, ctxRight, pdims, pscale);
        }
        // Click to select next with animation
        sidePreviewRight.onclick = () => {
            if (isSliding) return;
            slideToScreenshot(nextIndex, 'right');
        };
    } else {
        sidePreviewRight.classList.add('hidden');
    }

    // Far next screenshot (far right, index + 2)
    const farNextIndex = state.selectedIndex + 2;
    if (farNextIndex < state.screenshots.length && state.screenshots.length > 2) {
        sidePreviewFarRight.classList.remove('hidden');
        sidePreviewFarRight.style.left = `calc(50% + ${farSideOffset}px)`;
        if (!skipSidePreviewRender) renderScreenshotToCanvas(farNextIndex, canvasFarRight, ctxFarRight, pdims, pscale);
    } else {
        sidePreviewFarRight.classList.add('hidden');
    }
}

function slideToScreenshot(newIndex, direction) {
    isSliding = true;
    previewStrip.classList.add('sliding');

    // Velocity-adaptive duration: rapid consecutive advances (fast scroll) use a shorter
    // slide so traversing many screenshots feels quick; a lone step stays smooth.
    const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Blow through a queued backlog quickly; smooth duration for single/paced steps.
    const backlog = (typeof pendingSteps === 'number') && Math.abs(pendingSteps) > 0;
    const slideMs = backlog ? 150 : ((_now - lastSlideAt) < 360 ? 175 : 185);
    lastSlideAt = _now;
    previewStrip.style.transition = `transform ${slideMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;

    const dims = getCanvasDimensions();
    const { maxWidth: maxPreviewWidth, maxHeight: maxPreviewHeight } = getPreviewMaxSize();
    const previewScale = Math.min(maxPreviewWidth / dims.width, maxPreviewHeight / dims.height);
    const slideDistance = dims.width * previewScale + 10; // canvas width + gap
    const { pdims, pscale } = sidePreviewDims(dims, previewScale);

    const newPrevIndex = newIndex - 1;
    const newNextIndex = newIndex + 1;

    // Collect model loading promises for new active AND adjacent screenshots
    const modelPromises = [];
    [newIndex, newPrevIndex, newNextIndex].forEach(index => {
        if (index >= 0 && index < state.screenshots.length) {
            const ss = state.screenshots[index]?.screenshot;
            if (ss?.use3D && ss?.device3D && typeof loadCachedPhoneModel === 'function') {
                modelPromises.push(loadCachedPhoneModel(ss.device3D).catch(() => null));
            }
        }
    });

    // Start loading models immediately (in parallel with animation)
    const modelsReady = modelPromises.length > 0 ? Promise.all(modelPromises) : Promise.resolve();

    // Slide the strip in the opposite direction of the click
    if (direction === 'right') {
        previewStrip.style.transform = `translateX(-${slideDistance}px)`;
    } else {
        previewStrip.style.transform = `translateX(${slideDistance}px)`;
    }

    // Wait for BOTH animation AND models to be ready (duration matches the slide above)
    const animationDone = new Promise(resolve => setTimeout(resolve, slideMs));
    Promise.all([animationDone, modelsReady]).then(() => {
        // Pre-render new side previews to temporary canvases NOW (models are loaded)
        const tempCanvases = [];

        const prerenderToTemp = (index, targetCanvas) => {
            if (index < 0 || index >= state.screenshots.length) return null;
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            renderScreenshotToCanvas(index, tempCanvas, tempCtx, pdims, pscale);
            return { tempCanvas, targetCanvas };
        };

        const leftPrerender = prerenderToTemp(newPrevIndex, canvasLeft);
        const rightPrerender = prerenderToTemp(newNextIndex, canvasRight);
        if (leftPrerender) tempCanvases.push(leftPrerender);
        if (rightPrerender) tempCanvases.push(rightPrerender);

        // Disable transition temporarily for instant reset
        previewStrip.style.transition = 'none';
        previewStrip.style.transform = 'translateX(0)';

        // Suppress updateCanvas calls from switchPhoneModel during sync
        window.suppressSwitchModelUpdate = true;

        // Update state
        state.selectedIndex = newIndex;
        updateScreenshotList();
        syncUIWithState();
        updateGradientStopsUI();

        // Copy pre-rendered canvases to actual canvases BEFORE updateCanvas
        // This prevents flicker by having content ready before the swap
        tempCanvases.forEach(({ tempCanvas, targetCanvas }) => {
            targetCanvas.width = tempCanvas.width;
            targetCanvas.height = tempCanvas.height;
            targetCanvas.style.width = tempCanvas.style.width;
            targetCanvas.style.height = tempCanvas.style.height;
            const targetCtx = targetCanvas.getContext('2d');
            targetCtx.drawImage(tempCanvas, 0, 0);
        });

        // Skip side preview re-render since we already pre-rendered them
        skipSidePreviewRender = true;

        // Now do a full updateCanvas for main preview, far sides, etc.
        // Side previews won't flicker because we already drew to them
        updateCanvas();

        // Reset flags
        skipSidePreviewRender = false;
        window.suppressSwitchModelUpdate = false;

        // Re-enable transition after the reset commits (single frame is enough; the
        // next chained slide sets its own transition explicitly anyway).
        requestAnimationFrame(() => {
            previewStrip.style.transition = '';
            previewStrip.classList.remove('sliding');
            isSliding = false;
            // Chain: if the user kept scrolling during this slide, advance again now.
            if (typeof tryAdvanceCarousel === 'function') tryAdvanceCarousel();
            if (typeof processPendingSteps === 'function') processPendingSteps();
            // If scrolling has stopped, schedule a settle pass to refresh far previews.
            if (!isSliding) scheduleSettleRender();
        });
    });
}

function renderScreenshotToCanvas(index, targetCanvas, targetCtx, dims, previewScale) {
    const screenshot = state.screenshots[index];
    if (!screenshot) return;

    // Get localized image for current language
    const img = getScreenshotImage(screenshot);

    // Set canvas size (this also clears the canvas)
    targetCanvas.width = dims.width;
    targetCanvas.height = dims.height;
    targetCanvas.style.width = (dims.width * previewScale) + 'px';
    targetCanvas.style.height = (dims.height * previewScale) + 'px';

    // Clear canvas explicitly
    targetCtx.clearRect(0, 0, dims.width, dims.height);

    // Draw background for this screenshot
    const bg = screenshot.background;
    drawBackgroundToContext(targetCtx, dims, bg);

    // Draw noise if enabled
    if (bg.noise) {
        drawNoiseToContext(targetCtx, dims, bg.noiseIntensity);
    }

    const elements = screenshot.elements || [];

    // Elements behind screenshot
    drawElementsToContext(targetCtx, dims, elements, 'behind-screenshot');

    // Draw screenshot - 3D if active for this screenshot, otherwise 2D
    const settings = screenshot.screenshot;
    const use3D = settings.use3D || false;

    if (use3D && typeof renderThreeJSForScreenshot === 'function' && phoneModelLoaded) {
        // Render 3D phone model for this screenshot (works even with no image —
        // blank 3D template frames still show the device).
        renderThreeJSForScreenshot(targetCanvas, dims.width, dims.height, index);
    } else if (img) {
        // Draw 2D screenshot using localized image
        drawScreenshotToContext(targetCtx, dims, img, settings);
    } else if (settings.placeholderDevice) {
        // 2D template/blank frame with no image: phone-shaped placeholder
        drawPlaceholderDevice(targetCtx, dims, settings);
    }

    // Elements above screenshot
    drawElementsToContext(targetCtx, dims, elements, 'above-screenshot');

    // Draw popouts
    const popouts = screenshot.popouts || [];
    drawPopoutsToContext(targetCtx, dims, popouts, img, settings, screenshot);

    // (Headline/subheadline are text elements now — drawn in the element layers.)

    // Elements above text
    drawElementsToContext(targetCtx, dims, elements, 'above-text');

    // Post-composite effects over the whole frame (side previews + exports).
    if (typeof applyEffects === 'function') {
        const fx = (typeof withEffectDefaults === 'function')
            ? withEffectDefaults(screenshot.effects)
            : screenshot.effects;
        applyEffects(targetCtx, targetCanvas, dims, fx);
    }
}

function drawBackgroundToContext(context, dims, bg) {
    // Lazily rebuild the background Image from its saved data-URL (e.g. after a
    // page reload, where the Image object can't be persisted). onload re-renders.
    if (bg.type === 'image' && !bg.image && bg.imageSrc) {
        reconstructBackgroundImage(bg);
    }
    if (bg.type === 'gradient') {
        const angle = bg.gradient.angle * Math.PI / 180;
        const x1 = dims.width / 2 - Math.cos(angle) * dims.width;
        const y1 = dims.height / 2 - Math.sin(angle) * dims.height;
        const x2 = dims.width / 2 + Math.cos(angle) * dims.width;
        const y2 = dims.height / 2 + Math.sin(angle) * dims.height;

        const gradient = context.createLinearGradient(x1, y1, x2, y2);
        bg.gradient.stops.forEach(stop => {
            gradient.addColorStop(stop.position / 100, stop.color);
        });

        context.fillStyle = gradient;
        context.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'solid') {
        context.fillStyle = bg.solid;
        context.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'image' && bg.image) {
        const img = bg.image;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        let dx = 0, dy = 0, dw = dims.width, dh = dims.height;

        if (bg.imageFit === 'cover') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
        } else if (bg.imageFit === 'contain') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                dh = dims.width / imgRatio;
                dy = (dims.height - dh) / 2;
            } else {
                dw = dims.height * imgRatio;
                dx = (dims.width - dw) / 2;
            }

            context.fillStyle = '#000';
            context.fillRect(0, 0, dims.width, dims.height);
        }

        if (bg.imageBlur > 0) {
            context.filter = `blur(${bg.imageBlur}px)`;
        }

        context.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        context.filter = 'none';

        if (bg.overlayOpacity > 0) {
            context.fillStyle = bg.overlayColor;
            context.globalAlpha = bg.overlayOpacity / 100;
            context.fillRect(0, 0, dims.width, dims.height);
            context.globalAlpha = 1;
        }
    }
}

function drawNoiseToContext(context, dims, intensity) {
    const imageData = context.getImageData(0, 0, dims.width, dims.height);
    const data = imageData.data;
    const noiseAmount = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * noiseAmount;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }

    context.putImageData(imageData, 0, 0);
}

// Draw the shadow cast by the device rect (x,y,w,h with corner radius). The
// `style` makes the device feel grounded in a 3D environment:
//   'drop'     – single offset drop shadow (classic; the original behavior)
//   'soft'     – layered: a wide diffuse cast + a tight contact shadow
//   'floating' – a soft elliptical ground shadow beneath, as if a light overhead
//                casts the device's shadow onto a floor below a hovering device
function drawDeviceShadow(context, x, y, w, h, radius, shadow) {
    if (!shadow || !shadow.enabled) return;
    const style = shadow.style || 'drop';
    const op = (shadow.opacity || 0) / 100;
    const blur = shadow.blur || 0;
    const ox = shadow.x || 0;
    const oy = shadow.y || 0;
    const colorAt = (o) => (typeof hexToRgba === 'function')
        ? hexToRgba(shadow.color, Math.min(1, o))
        : shadow.color + Math.round(Math.min(1, o) * 255).toString(16).padStart(2, '0');
    // Draw ONLY the canvas-shadow (no visible opaque silhouette) by placing the source
    // rect far off-screen and using shadowOffsetX to bring the shadow back to position.
    // This is what was making "soft" look like two stacked layers — the opaque fills
    // for each pass were visible. With this trick they cancel out and the passes blend
    // into one smooth falloff.
    const FAR = 100000;
    const shadowOnly = (blurPx, offX, offY, color) => {
        context.save();
        context.shadowColor = color;
        context.shadowBlur = blurPx;
        context.shadowOffsetX = offX + FAR;
        context.shadowOffsetY = offY;
        context.fillStyle = '#000';
        context.beginPath();
        context.roundRect(x - FAR, y, w, h, radius);
        context.fill();
        context.restore();
    };

    if (style === 'floating') {
        context.save();
        // Soft ground shadow: a blurred ellipse just below the device.
        const ellipseW = w * 0.94;
        const ellipseH = Math.max(h * 0.05, w * 0.04);
        const cx = x + w / 2 + ox * 0.5;
        const cy = y + h + Math.max(oy, 6) + ellipseH * 0.5;
        context.filter = `blur(${Math.max(blur, 24)}px)`;
        context.globalAlpha = Math.min(1, op);
        context.fillStyle = shadow.color;
        context.beginPath();
        context.ellipse(cx, cy, ellipseW / 2, ellipseH / 2, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
        return;
    }

    if (style === 'soft') {
        // Three softer overlapping passes that blend into a single continuous falloff:
        // a wide ambient cast, a medium body, and a tight contact shadow. With the
        // off-screen trick none of them leave a visible opaque silhouette, so they
        // melt into each other instead of stacking as distinct layers.
        shadowOnly(blur * 2.2,                ox,           Math.max(oy, blur * 0.6), colorAt(op * 0.45));
        shadowOnly(blur * 1.1,                ox * 0.7,     Math.max(oy * 0.7, blur * 0.35), colorAt(op * 0.55));
        shadowOnly(Math.max(blur * 0.45, 5),  ox * 0.3,     Math.max(oy * 0.3, 3),     colorAt(op * 0.6));
        return;
    }

    // 'drop' (default) — single pass; uses the off-screen trick too so no silhouette.
    shadowOnly(blur, ox, oy, colorAt(op));
}

function drawScreenshotToContext(context, dims, img, settings) {
    if (!img) return;

    // Use source aspect for both images and videos so nothing gets cropped. For a video,
    // .width/.height are the HTML attrs we mirrored from videoWidth/videoHeight on load.
    const isVideo = img.tagName === 'VIDEO';
    const srcW = isVideo ? (img.videoWidth || img.width) : img.width;
    const srcH = isVideo ? (img.videoHeight || img.height) : img.height;

    const scale = settings.scale / 100;
    let imgWidth = dims.width * scale;
    let imgHeight = (srcH / srcW) * imgWidth;
    if (imgHeight > dims.height * scale) {
        imgHeight = dims.height * scale;
        imgWidth = (srcW / srcH) * imgHeight;
    }

    // Ensure minimum movement range so position works even at 100% scale
    const moveX = Math.max(dims.width - imgWidth, dims.width * 0.15);
    const moveY = Math.max(dims.height - imgHeight, dims.height * 0.15);
    const x = (dims.width - imgWidth) / 2 + (settings.x / 100 - 0.5) * moveX;
    const y = (dims.height - imgHeight) / 2 + (settings.y / 100 - 0.5) * moveY;
    const centerX = x + imgWidth / 2;
    const centerY = y + imgHeight / 2;

    context.save();

    // Apply transformations
    context.translate(centerX, centerY);

    // Apply rotation
    if (settings.rotation !== 0) {
        context.rotate(settings.rotation * Math.PI / 180);
    }

    // Apply perspective (simulated with scale transform)
    if (settings.perspective !== 0) {
        context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
    }

    context.translate(-centerX, -centerY);

    const frameStyle = settings.frameStyle || 'none';
    const innerRadius = (settings.cornerRadius || 0) * (imgWidth / 400);

    if (frameStyle !== 'none') {
        drawFrameStyle(context, img, x, y, imgWidth, imgHeight, settings, frameStyle, innerRadius);
    } else {
        // Draw shadow first (needs a filled shape, not clipped)
        drawDeviceShadow(context, x, y, imgWidth, imgHeight, innerRadius, settings.shadow);

        context.beginPath();
        context.roundRect(x, y, imgWidth, imgHeight, innerRadius);
        context.clip();
        context.drawImage(img, x, y, imgWidth, imgHeight);
    }

    context.restore();

    // Draw device frame if enabled
    if (settings.frame && settings.frame.enabled) {
        context.save();
        context.translate(centerX, centerY);
        if (settings.rotation !== 0) {
            context.rotate(settings.rotation * Math.PI / 180);
        }
        if (settings.perspective !== 0) {
            context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
        }
        context.translate(-centerX, -centerY);
        drawDeviceFrameToContext(context, x, y, imgWidth, imgHeight, settings);
        context.restore();
    }
}

function drawDeviceFrameToContext(context, x, y, width, height, settings) {
    const frameColor = settings.frame.color;
    const frameWidth = settings.frame.width * (width / 400);
    const frameOpacity = settings.frame.opacity / 100;
    const radius = (settings.cornerRadius || 0) * (width / 400) + frameWidth;

    context.globalAlpha = frameOpacity;
    context.strokeStyle = frameColor;
    context.lineWidth = frameWidth;
    context.beginPath();
    context.roundRect(x - frameWidth / 2, y - frameWidth / 2, width + frameWidth, height + frameWidth, radius);
    context.stroke();
    context.globalAlpha = 1;
}

// Compute frame padding (top/right/bottom/left) for a given frame style.
// The user's drawn rect (x,y,width,height) is the OUTER frame envelope.
// The screenshot is drawn inset by these paddings.
function getFramePadding(style, width, height) {
    switch (style) {
        case 'browser-mac':
            return { top: Math.max(28, width * 0.045), right: 0, bottom: 0, left: 0 };
        case 'browser-chrome':
            return { top: Math.max(56, width * 0.085), right: 0, bottom: 0, left: 0 };
        case 'macbook': {
            const bezel = Math.max(10, width * 0.018);
            return { top: bezel, right: bezel, bottom: bezel, left: bezel };
        }
        case 'ipad': {
            const bezel = Math.max(12, width * 0.025);
            return { top: bezel, right: bezel, bottom: bezel, left: bezel };
        }
        default:
            return { top: 0, right: 0, bottom: 0, left: 0 };
    }
}

function drawFrameStyle(context, img, x, y, width, height, settings, style, innerRadius) {
    const pad = getFramePadding(style, width, height);
    const outerRadius = Math.max(innerRadius, Math.min(width, height) * 0.025);

    // Outer shadow (drawn behind the frame envelope)
    drawDeviceShadow(context, x, y, width, height, outerRadius, settings.shadow);

    // Clip to the outer rounded envelope so chrome corners stay rounded
    context.save();
    context.beginPath();
    context.roundRect(x, y, width, height, outerRadius);
    context.clip();

    if (style === 'browser-mac') {
        drawBrowserMacChrome(context, x, y, width, pad.top);
    } else if (style === 'browser-chrome') {
        drawBrowserChromeChrome(context, x, y, width, pad.top);
    } else if (style === 'macbook') {
        context.fillStyle = '#0c0c0e';
        context.fillRect(x, y, width, height);
    } else if (style === 'ipad') {
        context.fillStyle = '#111114';
        context.fillRect(x, y, width, height);
    }

    // Inner screenshot area
    const ix = x + pad.left;
    const iy = y + pad.top;
    const iw = width - pad.left - pad.right;
    const ih = height - pad.top - pad.bottom;

    // For browsers, no inner radius on top corners (flush with chrome divider);
    // bottom corners follow the outer radius.
    const bottomR = Math.max(0, outerRadius - Math.min(pad.left, pad.bottom));
    if (style === 'browser-mac' || style === 'browser-chrome') {
        context.fillStyle = '#ffffff';
        context.beginPath();
        roundedRectPath(context, ix, iy, iw, ih, [0, 0, bottomR, bottomR]);
        context.fill();

        context.save();
        context.beginPath();
        roundedRectPath(context, ix, iy, iw, ih, [0, 0, bottomR, bottomR]);
        context.clip();
        context.drawImage(img, ix, iy, iw, ih);
        context.restore();
    } else {
        const ir = Math.max(0, Math.min(innerRadius, Math.min(iw, ih) / 2));
        context.fillStyle = '#000';
        context.beginPath();
        context.roundRect(ix, iy, iw, ih, ir);
        context.fill();

        context.save();
        context.beginPath();
        context.roundRect(ix, iy, iw, ih, ir);
        context.clip();
        context.drawImage(img, ix, iy, iw, ih);
        context.restore();
    }

    context.restore();

    // Foreground elements drawn on top (camera dots, notch, keyboard base)
    if (style === 'macbook') {
        drawMacbookForeground(context, x, y, width, height);
    } else if (style === 'ipad') {
        drawIpadForeground(context, x, y, width, height);
    }
}

function roundedRectPath(context, x, y, w, h, radii) {
    // radii: [tl, tr, br, bl]
    const [tl, tr, br, bl] = radii;
    context.moveTo(x + tl, y);
    context.lineTo(x + w - tr, y);
    if (tr > 0) context.arcTo(x + w, y, x + w, y + tr, tr);
    context.lineTo(x + w, y + h - br);
    if (br > 0) context.arcTo(x + w, y + h, x + w - br, y + h, br);
    context.lineTo(x + bl, y + h);
    if (bl > 0) context.arcTo(x, y + h, x, y + h - bl, bl);
    context.lineTo(x, y + tl);
    if (tl > 0) context.arcTo(x, y, x + tl, y, tl);
}

function drawBrowserMacChrome(context, x, y, width, barHeight) {
    // Title bar gradient
    const grad = context.createLinearGradient(x, y, x, y + barHeight);
    grad.addColorStop(0, '#eceaea');
    grad.addColorStop(1, '#dad8d8');
    context.fillStyle = grad;
    context.fillRect(x, y, width, barHeight);

    // Bottom divider
    context.fillStyle = 'rgba(0,0,0,0.08)';
    context.fillRect(x, y + barHeight - 1, width, 1);

    // Traffic lights
    const dotR = Math.max(5, barHeight * 0.16);
    const dotY = y + barHeight / 2;
    const startX = x + barHeight * 0.55;
    const gap = dotR * 3.2;
    const colors = ['#ff5f57', '#febc2e', '#28c840'];
    colors.forEach((c, i) => {
        context.fillStyle = c;
        context.beginPath();
        context.arc(startX + i * gap, dotY, dotR, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = 'rgba(0,0,0,0.1)';
        context.lineWidth = 0.5;
        context.stroke();
    });

    // Centered URL pill
    const pillW = Math.min(width * 0.45, barHeight * 14);
    const pillH = barHeight * 0.55;
    const pillX = x + (width - pillW) / 2;
    const pillY = y + (barHeight - pillH) / 2;
    context.fillStyle = '#ffffff';
    context.beginPath();
    context.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    context.fill();
    context.strokeStyle = 'rgba(0,0,0,0.08)';
    context.lineWidth = 1;
    context.stroke();

    context.fillStyle = '#6b7280';
    context.font = `${Math.round(pillH * 0.5)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('example.com', pillX + pillW / 2, pillY + pillH / 2);
}

function drawBrowserChromeChrome(context, x, y, width, barHeight) {
    // Two stacked sections: tabs strip + toolbar
    const tabH = barHeight * 0.5;
    const toolH = barHeight - tabH;

    // Tabs strip background
    context.fillStyle = '#dee1e6';
    context.fillRect(x, y, width, tabH);

    // Active tab
    const tabW = Math.min(width * 0.28, barHeight * 6);
    const tabX = x + barHeight * 0.6;
    const tabR = Math.max(6, tabH * 0.25);
    context.fillStyle = '#ffffff';
    context.beginPath();
    roundedRectPath(context, tabX, y + tabH * 0.18, tabW, tabH - tabH * 0.18, [tabR, tabR, 0, 0]);
    context.fill();

    // Tab favicon dot
    context.fillStyle = '#9aa0a6';
    context.beginPath();
    context.arc(tabX + tabH * 0.5, y + tabH * 0.6, tabH * 0.13, 0, Math.PI * 2);
    context.fill();

    // Tab label
    context.fillStyle = '#3c4043';
    context.font = `${Math.round(tabH * 0.35)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText('New Tab', tabX + tabH * 0.85, y + tabH * 0.6);

    // Toolbar
    const toolY = y + tabH;
    context.fillStyle = '#ffffff';
    context.fillRect(x, toolY, width, toolH);
    context.fillStyle = 'rgba(0,0,0,0.06)';
    context.fillRect(x, toolY + toolH - 1, width, 1);

    // Nav circles (back/forward/refresh)
    const navR = toolH * 0.18;
    const navY = toolY + toolH / 2;
    [0, 1, 2].forEach(i => {
        context.fillStyle = '#5f6368';
        context.beginPath();
        context.arc(x + toolH * 0.5 + i * toolH * 0.7, navY, navR, 0, Math.PI * 2);
        context.fill();
    });

    // URL bar (omnibox)
    const urlX = x + toolH * 2.8;
    const urlH = toolH * 0.55;
    const urlY = toolY + (toolH - urlH) / 2;
    const urlW = width - (urlX - x) - toolH * 1.4;
    context.fillStyle = '#f1f3f4';
    context.beginPath();
    context.roundRect(urlX, urlY, urlW, urlH, urlH / 2);
    context.fill();

    context.fillStyle = '#5f6368';
    context.font = `${Math.round(urlH * 0.5)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText('example.com', urlX + urlH * 0.8, urlY + urlH / 2);
}

function drawMacbookForeground(context, x, y, width, height) {
    // Tiny notch indicator at top center
    const notchW = Math.max(30, width * 0.055);
    const notchH = Math.max(4, width * 0.006);
    const nx = x + (width - notchW) / 2;
    context.fillStyle = '#000';
    context.beginPath();
    context.roundRect(nx, y, notchW, notchH, notchH / 2);
    context.fill();

    // Thin trapezoid suggesting laptop base, below the screen
    const baseTopW = width * 1.04;
    const baseBotW = width * 1.1;
    const baseH = Math.max(10, width * 0.022);
    const baseY = y + height + Math.max(4, width * 0.008);
    const cx = x + width / 2;

    const grad = context.createLinearGradient(0, baseY, 0, baseY + baseH);
    grad.addColorStop(0, '#3a3a3d');
    grad.addColorStop(0.5, '#222225');
    grad.addColorStop(1, '#0e0e10');
    context.fillStyle = grad;
    context.beginPath();
    context.moveTo(cx - baseTopW / 2, baseY);
    context.lineTo(cx + baseTopW / 2, baseY);
    context.lineTo(cx + baseBotW / 2, baseY + baseH);
    context.lineTo(cx - baseBotW / 2, baseY + baseH);
    context.closePath();
    context.fill();

    // Hinge notch indent
    const notchIndentW = width * 0.16;
    const notchIndentH = baseH * 0.45;
    context.fillStyle = '#0a0a0c';
    context.beginPath();
    context.moveTo(cx - notchIndentW / 2, baseY);
    context.quadraticCurveTo(cx, baseY + notchIndentH, cx + notchIndentW / 2, baseY);
    context.closePath();
    context.fill();
}

function drawIpadForeground(context, x, y, width, height) {
    // Tiny camera dot at the top center of the bezel
    const camR = Math.max(2, width * 0.0035);
    const camY = y + Math.max(6, width * 0.012);
    context.fillStyle = '#2a2a2e';
    context.beginPath();
    context.arc(x + width / 2, camY, camR, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#4a4a4e';
    context.beginPath();
    context.arc(x + width / 2, camY, camR * 0.4, 0, Math.PI * 2);
    context.fill();
}

// Draw elements for the current screenshot at a specific layer
function drawElements(context, dims, layer) {
    const elements = getElements();
    drawElementsToContext(context, dims, elements, layer);
}

// Draw elements to any context (for side previews and export)
function drawElementsToContext(context, dims, elements, layer) {
    const filtered = elements.filter(el => el.layer === layer);
    filtered.forEach(el => {
        context.save();
        context.globalAlpha = el.opacity / 100;

        const cx = dims.width * (el.x / 100);
        const cy = dims.height * (el.y / 100);
        const elWidth = dims.width * (el.width / 100);

        context.translate(cx, cy);
        if (el.rotation !== 0) {
            context.rotate(el.rotation * Math.PI / 180);
        }

        if (el.type === 'emoji' && el.emoji) {
            const emojiSize = elWidth * 0.85;
            context.font = `${emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(el.emoji, 0, 0);
        } else if (el.type === 'icon' && el.image) {
            // Shadow
            if (el.iconShadow?.enabled) {
                const s = el.iconShadow;
                const hex = s.color || '#000000';
                const r = parseInt(hex.slice(1,3), 16);
                const g = parseInt(hex.slice(3,5), 16);
                const b = parseInt(hex.slice(5,7), 16);
                context.shadowColor = `rgba(${r},${g},${b},${(s.opacity || 0) / 100})`;
                context.shadowBlur = s.blur || 0;
                context.shadowOffsetX = s.x || 0;
                context.shadowOffsetY = s.y || 0;
            }
            // Icons are square (1:1)
            context.drawImage(el.image, -elWidth / 2, -elWidth / 2, elWidth, elWidth);
            // Reset shadow
            if (el.iconShadow?.enabled) {
                context.shadowColor = 'transparent';
                context.shadowBlur = 0;
                context.shadowOffsetX = 0;
                context.shadowOffsetY = 0;
            }
        } else if (el.type === 'graphic' && el.image) {
            const aspect = el.image.height / el.image.width;
            const elHeight = elWidth * aspect;
            context.drawImage(el.image, -elWidth / 2, -elHeight / 2, elWidth, elHeight);
        } else if (el.type === 'text') {
            const elText = getElementText(el);
            if (!elText) { context.restore(); return; }
            // Scale absolute font px to the render resolution (side previews render reduced),
            // matching how headline/subheadline text is scaled. 1.0 at full res.
            const elFontSize = el.fontSize * (dims.width / (getCanvasDimensions().width || dims.width));
            const fontStyle = el.italic ? 'italic' : 'normal';
            context.font = `${fontStyle} ${el.fontWeight} ${elFontSize}px ${el.font}`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';

            // Word-wrap text within element width (respects manual line breaks)
            const lines = wrapText(context, elText, elWidth);
            const lineHeight = elFontSize * 1.05;
            const totalHeight = (lines.length - 1) * lineHeight + elFontSize;
            const startY = -(totalHeight / 2) + elFontSize / 2;

            // Text effects (graceful defaults for elements saved before these existed).
            const stroke = resolveTextStroke(el.stroke);
            const shadow = resolveTextShadow(el.shadow);
            const bubble = resolveTextBubble(el.bubble);
            const reveal = revealActiveForRender() ? getTextReveal(el.reveal) : null;

            // Background container behind the text (local element coords, centered at 0).
            if (bubble.style !== 'none') {
                const maxW = Math.max(...lines.map(l => context.measureText(l).width));
                const localBox = {
                    minX: -maxW / 2, maxX: maxW / 2,
                    minY: startY - elFontSize / 2,
                    maxY: startY + (lines.length - 1) * lineHeight + elFontSize / 2
                };
                drawTextBubble(context, { box: localBox, items: [{ fontSize: elFontSize }] }, bubble, dims);
            }

            // Draw decorative frame (laurel/badge) behind text if enabled
            if (el.frame && el.frame !== 'none') {
                drawElementFrame(context, el, dims, elWidth, totalHeight);
            }

            const fill = (bubble.style !== 'none' && bubble.textColor) ? bubble.textColor : el.fontColor;
            const mods = revealLineMods({ items: lines.map(l => ({ line: l })) }, reveal);
            lines.forEach((line, i) => {
                const m = mods[i];
                if (!m || m.skip) return;
                context.save();
                if (m.alpha < 1) context.globalAlpha *= m.alpha;
                const text = (m.text != null) ? m.text : line;
                drawTextLineFx(context, text, 0, startY + i * lineHeight + (m.dy || 0), fill, stroke, shadow, elFontSize);
                context.restore();
            });
        }

        context.restore();
    });
}

// ===== Popout rendering =====
function drawPopouts(context, dims) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    // Don't require a primary image — popouts may source an extra device's screen.
    const img = getScreenshotImage(screenshot);
    const popouts = screenshot.popouts || [];
    const ss = getScreenshotSettings();
    drawPopoutsToContext(context, dims, popouts, img, ss, screenshot);
}

// `img` is the primary screen image (the default source); `screenshotObj` lets each
// popout resolve its own source device's image (multi-device screens).
function drawPopoutsToContext(context, dims, popouts, img, screenshotSettings, screenshotObj) {
    if (!popouts || popouts.length === 0) return;

    popouts.forEach(p => {
        const srcImg = screenshotObj ? popoutSourceImage(p, screenshotObj) : img;
        if (!srcImg) return; // source has no image (yet)
        context.save();
        context.globalAlpha = p.opacity / 100;

        // Crop from source image (percentages -> pixels)
        const sx = (p.cropX / 100) * srcImg.width;
        const sy = (p.cropY / 100) * srcImg.height;
        const sw = (p.cropWidth / 100) * srcImg.width;
        const sh = (p.cropHeight / 100) * srcImg.height;

        // Display position and size (percentages -> canvas pixels)
        const displayW = dims.width * (p.width / 100);
        const cropAspect = sh / sw;
        const displayH = displayW * cropAspect;
        const cx = dims.width * (p.x / 100);
        const cy = dims.height * (p.y / 100);

        context.translate(cx, cy);

        // Apply popout's own rotation only (no 3D transform inheritance)
        if (p.rotation !== 0) {
            context.rotate(p.rotation * Math.PI / 180);
        }

        const halfW = displayW / 2;
        const halfH = displayH / 2;
        const radius = p.cornerRadius * (displayW / 300);

        // Draw shadow
        if (p.shadow && p.shadow.enabled) {
            const shadowOpacity = p.shadow.opacity / 100;
            const hex = p.shadow.color || '#000000';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            context.shadowColor = `rgba(${r},${g},${b},${shadowOpacity})`;
            context.shadowBlur = p.shadow.blur;
            context.shadowOffsetX = p.shadow.x;
            context.shadowOffsetY = p.shadow.y;

            context.fillStyle = '#000';
            context.beginPath();
            context.roundRect(-halfW, -halfH, displayW, displayH, radius);
            context.fill();

            context.shadowColor = 'transparent';
            context.shadowBlur = 0;
            context.shadowOffsetX = 0;
            context.shadowOffsetY = 0;
        }

        // Draw border behind the image
        if (p.border && p.border.enabled) {
            const bw = p.border.width;
            context.save();
            context.globalAlpha = (p.opacity / 100) * (p.border.opacity / 100);
            context.fillStyle = p.border.color;
            context.beginPath();
            context.roundRect(-halfW - bw, -halfH - bw, displayW + bw * 2, displayH + bw * 2, radius + bw);
            context.fill();
            context.restore();
        }

        // Clip and draw cropped image
        context.beginPath();
        context.roundRect(-halfW, -halfH, displayW, displayH, radius);
        context.clip();
        context.drawImage(srcImg, sx, sy, sw, sh, -halfW, -halfH, displayW, displayH);

        context.restore();
    });
}

// Draw decorative frames around text elements
function drawElementFrame(context, el, dims, textWidth, textHeight) {
    const scale = el.frameScale / 100;
    const padding = el.fontSize * 0.4 * scale;
    // Measure the widest line (using wrapText to match rendering)
    const elWidth = dims.width * (el.width / 100);
    const lines = wrapText(context, getElementText(el), elWidth);
    const maxLineW = Math.max(...lines.map(l => context.measureText(l).width));
    const frameW = maxLineW + padding * 2;
    const frameH = textHeight + padding * 2;

    context.save();
    context.strokeStyle = el.frameColor;
    context.fillStyle = 'none';
    context.lineWidth = Math.max(2, el.fontSize * 0.04) * scale;

    const isLaurel = el.frame.startsWith('laurel-');
    const hasStar = el.frame.endsWith('-star');

    if (isLaurel) {
        const variant = el.frame.includes('detailed') ? 'laurel-detailed-left' : 'laurel-simple-left';
        drawLaurelSVG(context, variant, frameW, frameH, scale, el.frameColor);
        if (hasStar) {
            drawStar(context, 0, -frameH / 2 - el.fontSize * 0.2 * scale, el.fontSize * 0.3 * scale, el.frameColor);
        }
    } else if (el.frame === 'badge-circle') {
        context.beginPath();
        const radius = Math.max(frameW, frameH) / 2 + padding * 0.5;
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.stroke();
    } else if (el.frame === 'badge-ribbon') {
        const sw = frameW + padding;
        const sh = frameH + padding * 1.5;
        context.beginPath();
        context.moveTo(-sw / 2, -sh / 2);
        context.lineTo(sw / 2, -sh / 2);
        context.lineTo(sw / 2, sh / 2 - padding);
        context.lineTo(0, sh / 2);
        context.lineTo(-sw / 2, sh / 2 - padding);
        context.closePath();
        context.stroke();
    }

    context.restore();
}

// Draw laurel wreath using SVG image — left branch + mirrored right branch
function drawLaurelSVG(context, variant, w, h, scale, color) {
    const img = laurelImages[variant];
    if (!img || !img.complete || !img.naturalWidth) return;

    // Scale SVG branch to match the frame height
    const branchH = h * 1.1 * scale;
    const aspect = img.naturalWidth / img.naturalHeight;
    const branchW = branchH * aspect;

    // The SVG is black fill — use a temp canvas to recolor it
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(branchW);
    tmp.height = Math.ceil(branchH);
    const tctx = tmp.getContext('2d');

    // Draw the SVG scaled into the temp canvas
    tctx.drawImage(img, 0, 0, branchW, branchH);

    // Recolor: draw color on top using source-in composite
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, branchW, branchH);

    // Position: left branch sits to the left of the text area
    const gap = 2 * scale;
    const leftX = -w / 2 - branchW - gap;
    const topY = -branchH / 2;

    // Draw left branch
    context.drawImage(tmp, leftX, topY, branchW, branchH);

    // Draw right branch (mirrored horizontally)
    context.save();
    context.scale(-1, 1);
    context.drawImage(tmp, leftX, topY, branchW, branchH);
    context.restore();
}

// Draw a 5-point star
function drawStar(context, cx, cy, size, color) {
    context.save();
    context.fillStyle = color;
    context.beginPath();
    for (let i = 0; i < 5; i++) {
        const outer = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const inner = outer + Math.PI / 5;
        const ox = cx + Math.cos(outer) * size;
        const oy = cy + Math.sin(outer) * size;
        const ix = cx + Math.cos(inner) * size * 0.4;
        const iy = cy + Math.sin(inner) * size * 0.4;
        if (i === 0) context.moveTo(ox, oy);
        else context.lineTo(ox, oy);
        context.lineTo(ix, iy);
    }
    context.closePath();
    context.fill();
    context.restore();
}

function drawBackground() {
    const dims = getCanvasDimensions();
    const bg = getBackground();

    // Lazily rebuild the background Image from its saved data-URL after a reload
    // (the Image object itself can't be persisted to IndexedDB). onload re-renders.
    if (bg.type === 'image' && !bg.image && bg.imageSrc) {
        reconstructBackgroundImage(bg);
    }

    if (bg.type === 'gradient') {
        const angle = bg.gradient.angle * Math.PI / 180;
        const x1 = dims.width / 2 - Math.cos(angle) * dims.width;
        const y1 = dims.height / 2 - Math.sin(angle) * dims.height;
        const x2 = dims.width / 2 + Math.cos(angle) * dims.width;
        const y2 = dims.height / 2 + Math.sin(angle) * dims.height;

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        bg.gradient.stops.forEach(stop => {
            gradient.addColorStop(stop.position / 100, stop.color);
        });

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'solid') {
        ctx.fillStyle = bg.solid;
        ctx.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'image' && bg.image) {
        const img = bg.image;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        let dx = 0, dy = 0, dw = dims.width, dh = dims.height;

        if (bg.imageFit === 'cover') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
        } else if (bg.imageFit === 'contain') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                dh = dims.width / imgRatio;
                dy = (dims.height - dh) / 2;
            } else {
                dw = dims.height * imgRatio;
                dx = (dims.width - dw) / 2;
            }

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, dims.width, dims.height);
        }

        if (bg.imageBlur > 0) {
            ctx.filter = `blur(${bg.imageBlur}px)`;
        }

        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.filter = 'none';

        // Overlay
        if (bg.overlayOpacity > 0) {
            ctx.fillStyle = bg.overlayColor;
            ctx.globalAlpha = bg.overlayOpacity / 100;
            ctx.fillRect(0, 0, dims.width, dims.height);
            ctx.globalAlpha = 1;
        }
    }
}

// Draw a phone-shaped placeholder where the screenshot will go, so a template
// layout still reads as a real device shot before the user drops in their image.
// Mirrors the 2D screenshot positioning math (scale/x/y/rotation/perspective);
// uses the canvas aspect since a full-screen screenshot fills the device screen.
function drawPlaceholderDevice(context, dims, settings) {
    if (!settings) return;
    const scale = (settings.scale || 70) / 100;
    const w = dims.width * scale;
    const h = dims.height * scale;
    const moveX = Math.max(dims.width - w, dims.width * 0.15);
    const moveY = Math.max(dims.height - h, dims.height * 0.15);
    const x = (dims.width - w) / 2 + ((settings.x ?? 50) / 100 - 0.5) * moveX;
    const y = (dims.height - h) / 2 + ((settings.y ?? 60) / 100 - 0.5) * moveY;
    const cx = x + w / 2, cy = y + h / 2;
    const radius = (settings.cornerRadius || 24) * (w / 400);

    context.save();
    context.translate(cx, cy);
    if (settings.rotation) context.rotate(settings.rotation * Math.PI / 180);
    if (settings.perspective) context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
    context.translate(-cx, -cy);

    // Drop shadow under the device
    const sh = settings.shadow;
    if (sh && sh.enabled) {
        context.save();
        context.shadowColor = hexToRgba(sh.color || '#000000', (sh.opacity ?? 30) / 100);
        context.shadowBlur = sh.blur ?? 40;
        context.shadowOffsetX = sh.x ?? 0;
        context.shadowOffsetY = sh.y ?? 20;
        context.fillStyle = '#000';
        context.beginPath(); context.roundRect(x, y, w, h, radius); context.fill();
        context.restore();
    }

    // Thin device body/bezel so the placeholder clearly reads as a phone
    const bezel = Math.max(2, w * 0.012);
    context.fillStyle = (settings.frame && settings.frame.color) || '#0c0c0e';
    context.beginPath();
    context.roundRect(x - bezel, y - bezel, w + bezel * 2, h + bezel * 2, radius + bezel);
    context.fill();

    // Light screen with a subtle vertical gradient + a centered "drop here" hint
    context.save();
    context.beginPath(); context.roundRect(x, y, w, h, radius); context.clip();
    const g = context.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#f7f9fc');
    g.addColorStop(1, '#e2e7ef');
    context.fillStyle = g;
    context.fillRect(x, y, w, h);

    // Dynamic-island pill
    const pillW = w * 0.32, pillH = Math.max(6, h * 0.018);
    context.fillStyle = 'rgba(10,12,18,0.88)';
    context.beginPath(); context.roundRect(cx - pillW / 2, y + h * 0.02, pillW, pillH, pillH / 2); context.fill();

    // Framed-image glyph + label
    const hint = 'rgba(70,82,104,0.42)';
    const gw = w * 0.16, gh = gw * 0.8, gx = cx - gw / 2, gy = cy - h * 0.055 - gh;
    context.strokeStyle = hint;
    context.lineWidth = Math.max(2, w * 0.006);
    context.beginPath(); context.roundRect(gx, gy, gw, gh, gw * 0.08); context.stroke();
    context.beginPath();
    context.moveTo(gx + gw * 0.12, gy + gh * 0.80);
    context.lineTo(gx + gw * 0.42, gy + gh * 0.46);
    context.lineTo(gx + gw * 0.60, gy + gh * 0.66);
    context.lineTo(gx + gw * 0.80, gy + gh * 0.38);
    context.lineTo(gx + gw * 0.90, gy + gh * 0.50);
    context.stroke();
    context.fillStyle = hint;
    context.beginPath();
    context.arc(gx + gw * 0.30, gy + gh * 0.32, gw * 0.07, 0, Math.PI * 2);
    context.fill();
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `600 ${Math.max(14, w * 0.05)}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`;
    context.fillText('Your screenshot', cx, cy + h * 0.02);
    context.restore();

    context.restore();

    // Explicit frame stroke when the template enables one (matches a real framed shot)
    if (settings.frame && settings.frame.enabled) {
        context.save();
        context.translate(cx, cy);
        if (settings.rotation) context.rotate(settings.rotation * Math.PI / 180);
        if (settings.perspective) context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
        context.translate(-cx, -cy);
        const fw = settings.frame.width * (w / 400);
        context.globalAlpha = (settings.frame.opacity ?? 100) / 100;
        context.strokeStyle = settings.frame.color || '#1d1d1f';
        context.lineWidth = fw;
        context.beginPath();
        context.roundRect(x - fw / 2, y - fw / 2, w + fw, h + fw, radius + fw);
        context.stroke();
        context.globalAlpha = 1;
        context.restore();
    }
}

// Canvas-pixel rect (x,y,w,h) of the primary device's screen, for drop hit-testing.
// 3D uses the projected bounding box; 2D computes the placed image rect (same math as
// drawScreenshotToContext, ignoring rotation/perspective — good enough to aim a drop).
function primaryDeviceScreenRect() {
    const ss = getScreenshotSettings();
    if (!ss) return null;
    if (ss.use3D && typeof computeDeviceScreenRect === 'function' && phoneModelLoaded) {
        // Prefer the rect cached during the last composite render — the pivot's
        // live transform between renders is stale (scale/position are applied
        // transiently in renderThreeJSToCanvas and restored afterwards).
        if (typeof lastPrimaryDeviceRect !== 'undefined' && lastPrimaryDeviceRect) {
            return lastPrimaryDeviceRect;
        }
        return computeDeviceScreenRect(canvas);
    }
    const screenshot = getCurrentScreenshot();
    const img = screenshot ? getScreenshotImage(screenshot) : null;
    if (!img) return null;
    const dims = getCanvasDimensions();
    const isVideo = img.tagName === 'VIDEO';
    const srcW = isVideo ? (img.videoWidth || img.width) : img.width;
    const srcH = isVideo ? (img.videoHeight || img.height) : img.height;
    const scale = ss.scale / 100;
    let w = dims.width * scale;
    let h = (srcH / srcW) * w;
    if (h > dims.height * scale) { h = dims.height * scale; w = (srcW / srcH) * h; }
    const moveX = Math.max(dims.width - w, dims.width * 0.15);
    const moveY = Math.max(dims.height - h, dims.height * 0.15);
    const x = (dims.width - w) / 2 + (ss.x / 100 - 0.5) * moveX;
    const y = (dims.height - h) / 2 + (ss.y / 100 - 0.5) * moveY;
    return { x, y, w, h };
}

// The device that should receive a drop at canvas-pixel (cx,cy): the topmost extra
// device under the point, else the primary if the point is on it, else the primary as
// the default target (so a drop on empty space still has a clear, highlighted home).
// Returns { kind:'extra'|'primary', dev?, rect } or null when there's no device at all.
function deviceDropTargetAt(cx, cy) {
    const devices = getExtraDevices();
    for (let i = devices.length - 1; i >= 0; i--) {
        const r = devices[i]._screenRect;
        if (r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
            return { kind: 'extra', dev: devices[i], rect: r };
        }
    }
    const pr = primaryDeviceScreenRect();
    if (!pr) return null;
    // Over the primary, or anywhere else → primary is the default target.
    return { kind: 'primary', rect: pr };
}

// Canvas-pixel coordinates from a drag/drop event (preview-canvas is full-res).
function canvasPixelFromEvent(e) {
    const pc = document.getElementById('preview-canvas');
    if (!pc) return null;
    const r = pc.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: (e.clientX - r.left) * (pc.width / r.width), y: (e.clientY - r.top) * (pc.height / r.height) };
}

// Which rotation a grab at canvas-pixel (cx,cy) drives, by position within a device's
// screen rect (Photoshop/Figma free-transform style):
//   corners            → ROLL  (Z — spin around the device's on-screen center)
//   top/bottom centers → TILT  (X — drag ↕)
//   middle & sides     → TURN  (Y — drag ↔)
const ROTATE_ZONE_EDGE = 0.6; // |normalized| beyond this counts as an edge band
function deviceRotateZone(cx, cy, rect) {
    if (!rect || !rect.w || !rect.h) return 'turn';
    const nx = (cx - (rect.x + rect.w / 2)) / (rect.w / 2);
    const ny = (cy - (rect.y + rect.h / 2)) / (rect.h / 2);
    const ex = Math.abs(nx) > ROTATE_ZONE_EDGE;
    const ey = Math.abs(ny) > ROTATE_ZONE_EDGE;
    if (ex && ey) return 'roll';
    if (ey) return 'tilt';
    return 'turn';
}

// Strict: the screen rect of the device under a canvas-pixel point, or null (topmost
// extra device first, then the primary). Unlike deviceDropTargetAt this does NOT fall
// back to the primary when the point is on empty canvas.
function deviceRectAt(cx, cy) {
    const inR = (r) => r && cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    const devices = getExtraDevices();
    for (let i = devices.length - 1; i >= 0; i--) { if (inR(devices[i]._screenRect)) return devices[i]._screenRect; }
    const pr = primaryDeviceScreenRect();
    return inR(pr) ? pr : null;
}

// Canvas-pixel rect of the device currently targeted by a drag-over, drawn as a green
// highlight on the selection overlay. Null hides it.
let _dropHighlightRect = null;

// While the rotate modifier is held and the pointer is over a device, this holds the
// device rect + the zone under the cursor so drawSelectionOverlay can show which axis a
// rotate would use. Null hides the hint.
let _rotateHint = null;        // { rect } of the hovered device
let _lastCanvasPointer = null; // last hover position in canvas px, for key-toggle refresh

// ---- Keyboard nudging of the active device (move / zoom / rotate) ----------
// The "active device" is the selected extra device, or the primary device when none is
// selected. All edits flow through updateCanvas(), so undo/redo captures each burst.
function activeDeviceTarget() {
    const dev = getSelectedExtraDevice();
    if (dev) return { kind: 'extra', dev };
    if (getCurrentScreenshot()) return { kind: 'primary', ss: getScreenshotSettings() };
    return null;
}
function _clampN(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _wrapDeg(d) { return Math.round(((d + 180) % 360 + 360) % 360 - 180); }

// Lightweight refresh of just the primary device's sliders after a keyboard nudge
// (cheaper than a full syncUIWithState on every keypress).
function syncPrimaryDeviceSliders() {
    const ss = getScreenshotSettings(); if (!ss) return;
    const set = (id, val, fmt) => {
        const el = document.getElementById(id); if (el) el.value = val;
        const lbl = document.getElementById(id + '-value'); if (lbl) lbl.textContent = fmt(val);
    };
    const pct = v => Math.round(v) + '%';
    const deg = v => Math.round(v) + '°';
    set('screenshot-x', ss.x, pct);
    set('screenshot-y', ss.y, pct);
    set('screenshot-scale', ss.scale, pct);
    set('screenshot-rotation', ss.rotation || 0, deg);
    const r = ss.rotation3D || { x: 0, y: 0, z: 0 };
    set('rotation-3d-x', r.x, deg); set('rotation-3d-y', r.y, deg); set('rotation-3d-z', r.z, deg);
}

// Apply a move/zoom/rotate delta to the active device. Returns false if there's nothing
// to act on. Position is in slider % units; rotation in degrees; scale in %.
function nudgeActiveDevice(d) {
    const t = activeDeviceTarget();
    if (!t) return false;
    // Linked devices: keyboard nudges drive the whole arrangement.
    if (deviceGroupActive()) {
        const dims = getCanvasDimensions();
        const members = allDeviceMembers();
        if (d.dx || d.dy) {
            // d.dx/d.dy are device-% steps; 1% of device travel = 0.85·W/100 canvas px.
            membersMoveBy(members, (d.dx || 0) * 0.0085 * dims.width, (d.dy || 0) * 0.0085 * dims.height);
        }
        if (d.dScale) membersScaleBy(members, 1 + d.dScale / 100);
        if (d.dRotX) membersRotate3DBy(members, 'x', d.dRotX);
        if (d.dRotY) membersRotate3DBy(members, 'y', d.dRotY);
        if (d.dRotZ) membersRotate2DBy(members, d.dRotZ);
        updateCanvas();
        groupSyncUI();
        return true;
    }
    if (t.kind === 'extra') {
        const o = t.dev;
        if (d.dx) o.x = _clampN((o.x ?? 50) + d.dx, -80, 180);
        if (d.dy) o.y = _clampN((o.y ?? 50) + d.dy, -80, 180);
        if (d.dScale) o.scale = _clampN((o.scale ?? 55) + d.dScale, 10, 150);
        if (d.dRotX || d.dRotY || d.dRotZ) {
            o.rotation3D = o.rotation3D || { x: 0, y: 0, z: 0 };
            if (d.dRotX) o.rotation3D.x = _wrapDeg(o.rotation3D.x + d.dRotX);
            if (d.dRotY) o.rotation3D.y = _wrapDeg(o.rotation3D.y + d.dRotY);
            if (d.dRotZ) o.rotation3D.z = _wrapDeg(o.rotation3D.z + d.dRotZ);
        }
        updateCanvas();
        updateExtraDeviceProperties();
    } else {
        const ss = t.ss;
        if (d.dx) ss.x = _clampN((ss.x ?? 50) + d.dx, -80, 180);
        if (d.dy) ss.y = _clampN((ss.y ?? 50) + d.dy, -80, 180);
        if (d.dScale) ss.scale = _clampN((ss.scale ?? 70) + d.dScale, 30, 400);
        if (d.dRotX || d.dRotY || d.dRotZ) {
            if (ss.use3D) {
                ss.rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
                if (d.dRotX) ss.rotation3D.x = _wrapDeg(ss.rotation3D.x + d.dRotX);
                if (d.dRotY) ss.rotation3D.y = _wrapDeg(ss.rotation3D.y + d.dRotY);
                if (d.dRotZ) ss.rotation3D.z = _wrapDeg(ss.rotation3D.z + d.dRotZ);
            } else {
                // The 2D device has a single rotation axis.
                ss.rotation = _wrapDeg((ss.rotation || 0) + (d.dRotY || d.dRotZ || d.dRotX));
            }
        }
        updateCanvas();
        syncPrimaryDeviceSliders();
    }
    return true;
}

// Map a keyboard event to a device nudge. Returns true if it consumed the key.
//   Move:   ← ↑ ↓ →            (Shift = larger step)
//   Rotate: Alt+arrows (Y/X),  [ ] for Z-roll
//   Zoom:   -  /  =(+)
function handleDeviceNudgeKey(e) {
    if (e.metaKey || e.ctrlKey) return false; // leave Cmd/Ctrl combos (undo, …) alone
    const tgt = e.target, tag = tgt && tgt.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tgt && tgt.isContentEditable)) return false;
    if (!getCurrentScreenshot()) return false;
    const big = e.shiftKey;
    const move = big ? 5 : 1;
    const zoom = big ? 10 : 2;
    const rot = big ? 10 : 2;
    const alt = e.altKey;
    switch (e.code) {
        case 'ArrowLeft':  return alt ? nudgeActiveDevice({ dRotY: -rot }) : nudgeActiveDevice({ dx: -move });
        case 'ArrowRight': return alt ? nudgeActiveDevice({ dRotY:  rot }) : nudgeActiveDevice({ dx:  move });
        case 'ArrowUp':    return alt ? nudgeActiveDevice({ dRotX: -rot }) : nudgeActiveDevice({ dy: -move });
        case 'ArrowDown':  return alt ? nudgeActiveDevice({ dRotX:  rot }) : nudgeActiveDevice({ dy:  move });
        case 'BracketLeft':  return nudgeActiveDevice({ dRotZ: -rot });
        case 'BracketRight': return nudgeActiveDevice({ dRotZ:  rot });
        case 'Minus':  return nudgeActiveDevice({ dScale: -zoom });
        case 'Equal':  return nudgeActiveDevice({ dScale:  zoom });
        default: return false;
    }
}

// Composite the current screenshot's extra 3D devices over the primary device.
// Each is rendered independently via renderDeviceObjectToCanvas; its projected
// screen rect is cached on the device (._screenRect) for canvas hit-testing.
function drawExtraDevices(canvas, dims) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    const devices = getExtraDevices(screenshot);
    if (!devices.length || typeof renderDeviceObjectToCanvas !== 'function') return;
    // Extra devices are always 3D. If the model pipeline isn't up yet, kick it off;
    // load-completion calls updateCanvas() again, which will then render them.
    if (!phoneModelLoaded) {
        if (typeof showThreeJS === 'function') showThreeJS(true);
        return;
    }
    for (const dev of devices) {
        dev._screenRect = renderDeviceObjectToCanvas(canvas, dims.width, dims.height, dev, dev.image || null);
    }
}

function drawScreenshot(forceFlat) {
    const dims = getCanvasDimensions();
    const screenshot = state.screenshots[state.selectedIndex];
    if (!screenshot) return;

    // Hard guard: drawScreenshot() paints the flat 2D rect directly onto the main canvas.
    // In 3D mode that would overwrite the composited 3D phone, causing the "2D pops over
    // 3D" flicker, so normally we bail and let renderThreeJSToCanvas own the device.
    // EXCEPTION: forceFlat — the model-not-ready fallback in updateCanvas. There, the 3D
    // pipeline ISN'T drawing anything (the phone model hasn't loaded), so painting the flat
    // image is the correct stand-in and there's no 3D render to clobber.
    const _ss = getScreenshotSettings();
    if (_ss && _ss.use3D && !forceFlat) return;

    // Use localized image based on current language
    const img = getScreenshotImage(screenshot);
    if (!img) {
        // Template/blank frame with no uploaded image: show a phone-shaped
        // placeholder so the layout still reads as a device shot.
        if (_ss && _ss.placeholderDevice) drawPlaceholderDevice(ctx, dims, _ss);
        return;
    }

    const settings = getScreenshotSettings();
    const scale = settings.scale / 100;
    const isVideo = img.tagName === 'VIDEO';
    const srcW = isVideo ? (img.videoWidth || img.width) : img.width;
    const srcH = isVideo ? (img.videoHeight || img.height) : img.height;

    // Calculate scaled dimensions at source aspect ratio (no cropping for videos).
    let imgWidth = dims.width * scale;
    let imgHeight = (srcH / srcW) * imgWidth;
    if (imgHeight > dims.height * scale) {
        imgHeight = dims.height * scale;
        imgWidth = (srcW / srcH) * imgHeight;
    }

    // Ensure minimum movement range so position works even at 100% scale
    const moveX = Math.max(dims.width - imgWidth, dims.width * 0.15);
    const moveY = Math.max(dims.height - imgHeight, dims.height * 0.15);
    const x = (dims.width - imgWidth) / 2 + (settings.x / 100 - 0.5) * moveX;
    const y = (dims.height - imgHeight) / 2 + (settings.y / 100 - 0.5) * moveY;

    // Center point for transformations
    const centerX = x + imgWidth / 2;
    const centerY = y + imgHeight / 2;

    ctx.save();

    // Apply transformations
    ctx.translate(centerX, centerY);

    // Apply rotation
    if (settings.rotation !== 0) {
        ctx.rotate(settings.rotation * Math.PI / 180);
    }

    // Apply perspective (simulated with scale transform)
    if (settings.perspective !== 0) {
        const perspectiveScale = 1 - Math.abs(settings.perspective) * 0.005;
        ctx.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
    }

    ctx.translate(-centerX, -centerY);

    const frameStyle = settings.frameStyle || 'none';
    const radius = settings.cornerRadius * (imgWidth / 400);

    if (frameStyle !== 'none') {
        drawFrameStyle(ctx, img, x, y, imgWidth, imgHeight, settings, frameStyle, radius);
    } else {
        if (settings.shadow.enabled) {
            const shadowColor = hexToRgba(settings.shadow.color, settings.shadow.opacity / 100);
            ctx.shadowColor = shadowColor;
            ctx.shadowBlur = settings.shadow.blur;
            ctx.shadowOffsetX = settings.shadow.x;
            ctx.shadowOffsetY = settings.shadow.y;

            ctx.fillStyle = '#000';
            ctx.beginPath();
            roundRect(ctx, x, y, imgWidth, imgHeight, radius);
            ctx.fill();

            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
        }

        ctx.beginPath();
        roundRect(ctx, x, y, imgWidth, imgHeight, radius);
        ctx.clip();
        ctx.drawImage(img, x, y, imgWidth, imgHeight);
    }

    ctx.restore();

    // Draw device frame if enabled (needs separate transform context)
    if (settings.frame.enabled) {
        ctx.save();
        ctx.translate(centerX, centerY);
        if (settings.rotation !== 0) {
            ctx.rotate(settings.rotation * Math.PI / 180);
        }
        if (settings.perspective !== 0) {
            ctx.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
        }
        ctx.translate(-centerX, -centerY);
        drawDeviceFrame(x, y, imgWidth, imgHeight);
        ctx.restore();
    }
}

function drawDeviceFrame(x, y, width, height) {
    const settings = getScreenshotSettings();
    const frameColor = settings.frame.color;
    const frameWidth = settings.frame.width * (width / 400); // Scale with image
    const frameOpacity = settings.frame.opacity / 100;
    const radius = settings.cornerRadius * (width / 400) + frameWidth;

    ctx.globalAlpha = frameOpacity;
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = frameWidth;
    ctx.beginPath();
    roundRect(ctx, x - frameWidth / 2, y - frameWidth / 2, width + frameWidth, height + frameWidth, radius);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// ============================================================================
// Text effects (stroke / shadow-glow / bubble / reveal) — used by text ELEMENTS via
// drawElementsToContext (main canvas + side previews + export). Effect magnitudes are
// expressed as a percentage of the font size so they scale identically across the
// preview's reduced resolution and full-res exports.
// ============================================================================

const DEFAULT_TEXT_STROKE = { enabled: false, color: '#000000', width: 8 };       // width = % of font size
const DEFAULT_TEXT_SHADOW = { enabled: false, color: '#000000', blur: 14, x: 0, y: 8, opacity: 60 }; // blur/x/y = % of font size
// Background container behind text. style: none | pill | box | bubble (speech bubble w/ tail).
const DEFAULT_TEXT_BUBBLE = { style: 'none', color: '#2563eb', opacity: 100, padding: 38, radius: 50, tail: 'bottom-left', textColor: '', shadow: false, shadowColor: '#000000', shadowBlur: 30, shadowOpacity: 35, shadowY: 12 };
// Intro reveal driven by the timeline playhead. type: none | typewriter | word | fade | slide | pop.
const DEFAULT_TEXT_REVEAL = { type: 'none', duration: 1.2, delay: 0 };

function resolveTextStroke(fx) { return Object.assign({}, DEFAULT_TEXT_STROKE, fx || {}); }
function resolveTextShadow(fx) { return Object.assign({}, DEFAULT_TEXT_SHADOW, fx || {}); }
function resolveTextBubble(fx) { return Object.assign({}, DEFAULT_TEXT_BUBBLE, fx || {}); }

// Configure context shadow from a shadow/glow spec scaled to the given font size.
function setTextShadowOnContext(context, sh, fontSizePx) {
    const a = (typeof sh.opacity === 'number' ? sh.opacity : 60) / 100;
    const k = fontSizePx / 100; // params are % of font size
    context.shadowColor = hexToRgba(sh.color || '#000000', a);
    context.shadowBlur = (sh.blur || 0) * k;
    context.shadowOffsetX = (sh.x || 0) * k;
    context.shadowOffsetY = (sh.y || 0) * k;
}
function clearTextShadow(context) {
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
}

// Draw a single text line with optional stroke (outline) and shadow/glow. The shadow is
// cast by the outermost shape only (stroke if present, else fill) to avoid a doubled
// shadow. Caller has already set context.font / textAlign / textBaseline.
function drawTextLineFx(context, line, x, y, fillStyle, strokeFx, shadowFx, fontSizePx) {
    const hasStroke = strokeFx && strokeFx.enabled && strokeFx.width > 0;
    const hasShadow = shadowFx && shadowFx.enabled;
    context.save();
    if (hasShadow) setTextShadowOnContext(context, shadowFx, fontSizePx);
    if (hasStroke) {
        context.lineJoin = 'round';
        context.miterLimit = 2;
        context.lineWidth = fontSizePx * (strokeFx.width / 100);
        context.strokeStyle = strokeFx.color;
        context.strokeText(line, x, y);
        if (hasShadow) clearTextShadow(context); // fill should not re-cast the shadow
    }
    context.fillStyle = fillStyle;
    context.fillText(line, x, y);
    context.restore();
}


// Draw the background container (pill / rounded box / speech bubble) behind a text plan.
function drawTextBubble(context, plan, bubble, dims) {
    if (!bubble || bubble.style === 'none' || !plan.box) return;
    const b = plan.box;
    const refFont = plan.items[0] ? plan.items[0].fontSize : dims.width * 0.05;
    const padX = refFont * (bubble.padding / 100) * 1.25;
    const padY = refFont * (bubble.padding / 100);
    const x = b.minX - padX, y = b.minY - padY;
    const w = (b.maxX - b.minX) + padX * 2;
    const h = (b.maxY - b.minY) + padY * 2;
    let radius;
    if (bubble.style === 'pill') radius = h / 2;
    // box & bubble honor the Corner Radius slider: 0 = square, 100 = fully rounded
    // (a pill). Scaling to h/2 lets even tall/multi-line boxes round all the way.
    else radius = (bubble.radius / 100) * (h / 2);

    context.save();
    context.globalAlpha *= (bubble.opacity / 100);
    // Optional drop shadow cast by the container. Cleared before the tail so the
    // shadow isn't doubled. Params are % of font size, matching the other text fx.
    if (bubble.shadow) {
        const k = refFont / 100;
        context.shadowColor = hexToRgba(bubble.shadowColor || '#000000', (bubble.shadowOpacity ?? 35) / 100);
        context.shadowBlur = (bubble.shadowBlur ?? 30) * k;
        context.shadowOffsetX = 0;
        context.shadowOffsetY = (bubble.shadowY ?? 12) * k;
    }
    context.fillStyle = bubble.color;
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
    context.fill();
    if (bubble.shadow) clearTextShadow(context);

    // Speech-bubble tail: a small triangle on the chosen lower corner (iMessage-style).
    if (bubble.style === 'bubble') {
        const t = refFont * 0.5;
        const onRight = (bubble.tail || 'bottom-left').includes('right');
        const baseX = onRight ? x + w - radius * 0.8 : x + radius * 0.8;
        const dir = onRight ? 1 : -1;
        const baseY = y + h - t * 0.4;
        context.beginPath();
        context.moveTo(baseX, baseY - t * 0.5);
        context.lineTo(baseX + dir * t, baseY + t * 0.7);
        context.lineTo(baseX + dir * t * 0.1, baseY + t * 0.2);
        context.closePath();
        context.fill();
    }
    context.restore();
}

// Per-item draw modifiers for an intro/reveal animation. Returns one entry per plan item:
//   { skip?:bool, alpha:0..1, dy:px, text?:string-override }
// `reveal` = { type, progress(0..1) }. progress is derived from the timeline playhead by
// the caller, so the same math drives the live preview and frame-by-frame export.
function revealLineMods(plan, reveal) {
    const n = plan.items.length;
    const full = () => plan.items.map(() => ({ alpha: 1, dy: 0 }));
    if (!reveal || !reveal.type || reveal.type === 'none') return full();
    const p = Math.max(0, Math.min(1, reveal.progress));
    if (p >= 1) return full();

    if (reveal.type === 'typewriter') {
        const total = plan.items.reduce((s, it) => s + it.line.length, 0) || 1;
        let visible = Math.floor(p * total);
        return plan.items.map(it => {
            const len = it.line.length;
            if (visible <= 0) return { skip: true, alpha: 0, dy: 0 };
            const shown = Math.min(len, visible);
            visible -= shown;
            return shown >= len
                ? { alpha: 1, dy: 0 }
                : { alpha: 1, dy: 0, text: it.line.slice(0, shown) };
        });
    }

    if (reveal.type === 'word') {
        const words = plan.items.map(it => it.line.split(/(\s+)/));
        const total = words.reduce((s, w) => s + w.filter(t => t.trim()).length, 0) || 1;
        let visible = Math.floor(p * total);
        return plan.items.map((it, i) => {
            const toks = words[i];
            let out = '', remaining = visible;
            let usedAny = false;
            for (const tok of toks) {
                if (tok.trim()) {
                    if (remaining <= 0) break;
                    remaining--; usedAny = true; out += tok;
                } else out += tok;
            }
            visible = remaining;
            if (!usedAny && !out.trim()) return { skip: true, alpha: 0, dy: 0 };
            return out.length >= it.line.length ? { alpha: 1, dy: 0 } : { alpha: 1, dy: 0, text: out.replace(/\s+$/, '') };
        });
    }

    // Block-wide easing reveals.
    const ease = p * p * (3 - 2 * p); // smoothstep
    if (reveal.type === 'fade') return plan.items.map(() => ({ alpha: ease, dy: 0 }));
    if (reveal.type === 'slide') {
        const lift = (1 - ease) * (plan.items[0] ? plan.items[0].fontSize * 0.8 : 40);
        return plan.items.map(() => ({ alpha: ease, dy: lift }));
    }
    if (reveal.type === 'pop') {
        // Approximate a pop with a small overshoot drop + fade (true scale needs a transform).
        const drop = (1 - ease) * (plan.items[0] ? -plan.items[0].fontSize * 0.25 : -15);
        return plan.items.map(() => ({ alpha: ease, dy: drop }));
    }
    return full();
}

// Reveals are time-based, so they only make sense while an animation is in play — otherwise
// a typewriter parked at t=0 would hide the text during normal (static) editing/export. Apply
// reveals only when the timeline is playing or the current screenshot is actually animated.
function revealActiveForRender() {
    if (typeof timeline === 'undefined') return false;
    if (timeline.playing) return true;
    const ss = (typeof getCurrentScreenshot === 'function') ? getCurrentScreenshot() : null;
    const anim = ss && ss.animation;
    return !!(anim && ((anim.tracks && anim.tracks.length) || anim.duration));
}

// Current reveal spec for a text block ({type, progress}) given the timeline playhead, or
// null when no reveal is configured. Progress ramps 0→1 over `duration` after `delay`.
function getTextReveal(revealCfg) {
    if (!revealCfg || !revealCfg.type || revealCfg.type === 'none') return null;
    const t = (typeof timeline !== 'undefined' && typeof timeline.time === 'number') ? timeline.time : 0;
    const delay = revealCfg.delay || 0;
    const dur = Math.max(0.01, revealCfg.duration || 1.2);
    const progress = Math.max(0, Math.min(1, (t - delay) / dur));
    return { type: revealCfg.type, progress };
}


const TEXT_BUBBLE_PRESETS = {
    'imessage-received': { style: 'bubble', color: '#e9e9eb', textColor: '#000000', tail: 'bottom-left' },
    'imessage-sent': { style: 'bubble', color: '#0b93f6', textColor: '#ffffff', tail: 'bottom-right' }
};


// --- Element text-effects UI (Elements tab: same stroke/shadow/bubble/reveal as headlines,
//     but scoped to the selected text element via el.stroke/shadow/bubble/reveal) ---------

// Ensure the selected element has an effect group, then return it (lazy default upgrade).
function currentElFx(group) {
    const el = getSelectedElement();
    if (!el) return null;
    const defs = { stroke: DEFAULT_TEXT_STROKE, shadow: DEFAULT_TEXT_SHADOW, bubble: DEFAULT_TEXT_BUBBLE, reveal: DEFAULT_TEXT_REVEAL };
    if (!el[group]) el[group] = Object.assign({}, defs[group]);
    return el[group];
}

// Reflect the selected text element's effects into the element-tab controls.
function syncElementTextEffectsUI(el) {
    if (!el) return;
    const stroke = resolveTextStroke(el.stroke);
    const shadow = resolveTextShadow(el.shadow);
    const bubble = resolveTextBubble(el.bubble);
    const reveal = Object.assign({}, DEFAULT_TEXT_REVEAL, el.reveal || {});
    const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
    const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const setToggle = (id, on, optId) => {
        const e = document.getElementById(id); if (!e) return;
        e.classList.toggle('active', !!on);
        const row = e.closest('.toggle-row'); if (row) row.classList.toggle('collapsed', !on);
        const opts = document.getElementById(optId); if (opts) opts.style.display = on ? 'block' : 'none';
    };

    setToggle('el-stroke-toggle', stroke.enabled, 'el-stroke-options');
    set('el-stroke-color', stroke.color); set('el-stroke-color-hex', stroke.color);
    set('el-stroke-width', stroke.width); setText('el-stroke-width-value', formatValue(stroke.width));

    setToggle('el-shadow-toggle', shadow.enabled, 'el-shadow-options');
    set('el-shadow-color', shadow.color); set('el-shadow-color-hex', shadow.color);
    set('el-shadow-blur', shadow.blur); setText('el-shadow-blur-value', formatValue(shadow.blur));
    set('el-shadow-opacity', shadow.opacity); setText('el-shadow-opacity-value', formatValue(shadow.opacity) + '%');
    set('el-shadow-x', shadow.x); setText('el-shadow-x-value', formatValue(shadow.x));
    set('el-shadow-y', shadow.y); setText('el-shadow-y-value', formatValue(shadow.y));

    set('el-bubble-style', bubble.style);
    set('el-bubble-color', bubble.color); set('el-bubble-color-hex', bubble.color);
    if (bubble.textColor) set('el-bubble-textcolor', bubble.textColor);
    set('el-bubble-textcolor-hex', bubble.textColor || '');
    set('el-bubble-opacity', bubble.opacity); setText('el-bubble-opacity-value', formatValue(bubble.opacity) + '%');
    set('el-bubble-padding', bubble.padding); setText('el-bubble-padding-value', formatValue(bubble.padding));
    set('el-bubble-radius', bubble.radius); setText('el-bubble-radius-value', formatValue(bubble.radius));
    set('el-bubble-tail', bubble.tail);
    const tg = document.getElementById('el-bubble-tail-group');
    if (tg) tg.style.display = bubble.style === 'bubble' ? 'block' : 'none';

    setToggle('el-bubble-shadow-toggle', bubble.shadow, 'el-bubble-shadow-options');
    set('el-bubble-shadow-color', bubble.shadowColor); set('el-bubble-shadow-color-hex', bubble.shadowColor);
    set('el-bubble-shadow-blur', bubble.shadowBlur); setText('el-bubble-shadow-blur-value', formatValue(bubble.shadowBlur));
    set('el-bubble-shadow-opacity', bubble.shadowOpacity); setText('el-bubble-shadow-opacity-value', formatValue(bubble.shadowOpacity) + '%');
    set('el-bubble-shadow-y', bubble.shadowY); setText('el-bubble-shadow-y-value', formatValue(bubble.shadowY));

    set('el-reveal-type', reveal.type);
    set('el-reveal-duration', reveal.duration); setText('el-reveal-duration-value', formatValue(reveal.duration) + 's');
    set('el-reveal-delay', reveal.delay); setText('el-reveal-delay-value', formatValue(reveal.delay) + 's');
}

// Wire the element-tab effect controls once at init. Writes into the selected element's
// effect groups and re-renders. (Effects aren't keyframable, so no autoKey here.)
function setupElementTextEffectControls() {
    const byId = id => document.getElementById(id);
    const onRange = (id, group, key, fmt) => {
        const el = byId(id); if (!el) return;
        el.addEventListener('input', e => {
            const fx = currentElFx(group); if (!fx) return;
            const v = parseFloat(e.target.value);
            fx[key] = v;
            const lbl = byId(id + '-value'); if (lbl) lbl.textContent = fmt ? fmt(v) : formatValue(v);
            updateCanvas();
        });
    };
    const onColor = (id, group, key) => {
        const pick = byId(id), hex = byId(id + '-hex');
        if (pick) pick.addEventListener('input', e => {
            const fx = currentElFx(group); if (!fx) return;
            fx[key] = e.target.value; if (hex) hex.value = e.target.value; updateCanvas();
        });
        if (hex) hex.addEventListener('input', e => {
            if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                const fx = currentElFx(group); if (!fx) return;
                fx[key] = e.target.value; if (pick) pick.value = e.target.value; updateCanvas();
            }
        });
    };
    const onToggle = (id, group, optId) => {
        const el = byId(id); if (!el) return;
        el.addEventListener('click', function () {
            const fx = currentElFx(group); if (!fx) return;
            this.classList.toggle('active');
            const on = this.classList.contains('active');
            fx.enabled = on;
            const row = this.closest('.toggle-row'); if (row) row.classList.toggle('collapsed', !on);
            const opts = byId(optId); if (opts) opts.style.display = on ? 'block' : 'none';
            updateCanvas();
        });
    };

    onToggle('el-stroke-toggle', 'stroke', 'el-stroke-options');
    onColor('el-stroke-color', 'stroke', 'color');
    onRange('el-stroke-width', 'stroke', 'width');

    onToggle('el-shadow-toggle', 'shadow', 'el-shadow-options');
    onColor('el-shadow-color', 'shadow', 'color');
    onRange('el-shadow-blur', 'shadow', 'blur');
    onRange('el-shadow-opacity', 'shadow', 'opacity', v => formatValue(v) + '%');
    onRange('el-shadow-x', 'shadow', 'x');
    onRange('el-shadow-y', 'shadow', 'y');

    const styleSel = byId('el-bubble-style');
    if (styleSel) styleSel.addEventListener('change', e => {
        const fx = currentElFx('bubble'); if (!fx) return;
        fx.style = e.target.value;
        const tg = byId('el-bubble-tail-group'); if (tg) tg.style.display = e.target.value === 'bubble' ? 'block' : 'none';
        updateCanvas();
    });
    const presetSel = byId('el-bubble-preset');
    if (presetSel) presetSel.addEventListener('change', e => {
        const preset = TEXT_BUBBLE_PRESETS[e.target.value];
        const fx = currentElFx('bubble');
        if (preset && fx) { Object.assign(fx, preset); syncElementTextEffectsUI(getSelectedElement()); updateCanvas(); }
    });
    onColor('el-bubble-color', 'bubble', 'color');
    onColor('el-bubble-textcolor', 'bubble', 'textColor');
    onRange('el-bubble-opacity', 'bubble', 'opacity', v => formatValue(v) + '%');
    onRange('el-bubble-padding', 'bubble', 'padding');
    onRange('el-bubble-radius', 'bubble', 'radius');
    const tailSel = byId('el-bubble-tail');
    if (tailSel) tailSel.addEventListener('change', e => { const fx = currentElFx('bubble'); if (fx) { fx.tail = e.target.value; updateCanvas(); } });

    // Container drop shadow. Toggle writes bubble.shadow (a flag on the bubble group,
    // not a separate fx.enabled), so it can't reuse onToggle.
    const bubbleShadowToggle = byId('el-bubble-shadow-toggle');
    if (bubbleShadowToggle) bubbleShadowToggle.addEventListener('click', function () {
        const fx = currentElFx('bubble'); if (!fx) return;
        this.classList.toggle('active');
        const on = this.classList.contains('active');
        fx.shadow = on;
        const row = this.closest('.toggle-row'); if (row) row.classList.toggle('collapsed', !on);
        const opts = byId('el-bubble-shadow-options'); if (opts) opts.style.display = on ? 'block' : 'none';
        updateCanvas();
    });
    onColor('el-bubble-shadow-color', 'bubble', 'shadowColor');
    onRange('el-bubble-shadow-blur', 'bubble', 'shadowBlur');
    onRange('el-bubble-shadow-opacity', 'bubble', 'shadowOpacity', v => formatValue(v) + '%');
    onRange('el-bubble-shadow-y', 'bubble', 'shadowY');

    const revealSel = byId('el-reveal-type');
    if (revealSel) revealSel.addEventListener('change', e => { const fx = currentElFx('reveal'); if (fx) { fx.type = e.target.value; updateCanvas(); } });
    onRange('el-reveal-duration', 'reveal', 'duration', v => formatValue(v) + 's');
    onRange('el-reveal-delay', 'reveal', 'delay', v => formatValue(v) + 's');
}


function drawNoise() {
    const dims = getCanvasDimensions();
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    const data = imageData.data;
    const intensity = getBackground().noiseIntensity / 100 * 50;

    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * intensity;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }

    ctx.putImageData(imageData, 0, 0);
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const rawLines = String(text).split(/\r?\n/);

    rawLines.forEach((rawLine) => {
        if (rawLine === '') {
            lines.push('');
            return;
        }

        const words = rawLine.split(' ');
        let currentLine = '';

        words.forEach(word => {
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });

        if (currentLine) {
            lines.push(currentLine);
        }

    });

    return lines;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function exportCurrent() {
    if (state.screenshots.length === 0) {
        await showAppAlert('Please upload a screenshot first', 'info');
        return;
    }

    // Ensure canvas is up-to-date (especially important for 3D mode)
    updateCanvas();

    const link = document.createElement('a');
    link.download = `screenshot-${state.selectedIndex + 1}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

// Export the composition to a video/GIF file. MP4 (H.264) and WebM (VP9) are encoded
// natively in-browser via WebCodecs + Mediabunny; GIF via gifenc — all client-side, no
// CDN. Opens the export-options modal (format dropdown + duration); the actual frame
// rendering + encoding runs in runVideoExport() once the user clicks Export.
async function exportVideo() {
    if (state.screenshots.length === 0) {
        await showAppAlert('Please upload a screenshot or video first', 'info');
        return;
    }
    const screenshot = state.screenshots[state.selectedIndex];
    const media = getScreenshotImage(screenshot);
    const isVideo = media && media.tagName === 'VIDEO';
    const hasAnim = typeof getAnimation === 'function' && getAnimation(screenshot)?.tracks?.length > 0;
    const defaultSeconds = hasAnim
        ? getAnimation(screenshot).duration
        : (isVideo && isFinite(media.duration) ? Math.min(media.duration, 30) : 5);

    const modal = document.getElementById('export-video-modal');
    const durInput = document.getElementById('export-duration-input');
    if (durInput) durInput.value = String(Math.round(defaultSeconds * 10) / 10);

    // Default the export motion-blur controls from the Effects-tab Motion Blur setting,
    // so the two stay in sync (the dialog can still be overridden per export).
    const fx = (typeof getEffects === 'function') ? getEffects() : null;
    if (fx && fx.motionBlur) {
        const mbCheck = document.getElementById('export-motionblur');
        if (mbCheck) mbCheck.checked = !!fx.motionBlur.enabled;
        const mbSamples = document.getElementById('export-motionblur-samples');
        if (mbSamples) {
            const opts = [...mbSamples.options].map(o => parseInt(o.value, 10));
            const target = fx.motionBlur.samples || 6;
            const closest = opts.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a, opts[0]);
            mbSamples.value = String(closest);
        }
    }

    updateExportFormatNote();
    if (modal) modal.classList.add('visible');
}

// Per-format helper text shown in the modal. Also enables/disables the audio toggles
// — GIF has no audio support, so the checkboxes are greyed out when GIF is selected.
function updateExportFormatNote() {
    const sel = document.getElementById('export-format-select');
    const note = document.getElementById('export-format-note');
    if (!sel || !note) return;
    const notes = {
        mp4: 'H.264 MP4, encoded natively in your browser (fast, no download). Best for social platforms.',
        webm: 'VP9 WebM, encoded natively. Great for web & YouTube; not accepted by Instagram/X.',
        gif: 'Animated GIF (no audio). Larger files; good for quick previews and chat.'
    };
    note.textContent = notes[sel.value] || '';

    const isGif = sel.value === 'gif';
    const incl = document.getElementById('export-include-audio');
    const split = document.getElementById('export-split-audio');
    [incl, split].forEach(el => {
        if (!el) return;
        el.disabled = isGif;
        const label = el.closest('label');
        if (label) label.style.opacity = isGif ? '0.5' : '';
    });
}

// Wire the export modal's controls. Called once at init.
function initExportModal() {
    const sel = document.getElementById('export-format-select');
    if (sel) sel.addEventListener('change', updateExportFormatNote);
    const cancel = document.getElementById('export-video-cancel');
    if (cancel) cancel.addEventListener('click', () => {
        document.getElementById('export-video-modal')?.classList.remove('visible');
    });
    const confirm = document.getElementById('export-video-confirm');
    if (confirm) confirm.addEventListener('click', async () => {
        const fmt = document.getElementById('export-format-select')?.value || 'mp4';
        const durationSec = Math.max(0.5, Math.min(60,
            parseFloat(document.getElementById('export-duration-input')?.value) || 6));
        const motionBlur = !!document.getElementById('export-motionblur')?.checked;
        const motionBlurSamples = parseInt(document.getElementById('export-motionblur-samples')?.value, 10) || 6;
        // GIF can't carry audio, so silently ignore the checkboxes when GIF is selected.
        const isGif = fmt === 'gif';
        const audioOpts = {
            include: !isGif && !!document.getElementById('export-include-audio')?.checked,
            split:   !isGif && !!document.getElementById('export-split-audio')?.checked,
        };
        document.getElementById('export-video-modal')?.classList.remove('visible');
        await runVideoExport(fmt, durationSec, motionBlur, motionBlurSamples, audioOpts);
    });

    // Cancel button on the progress overlay → ask for confirmation first.
    const cancelBtn = document.getElementById('export-cancel-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        document.getElementById('export-cancel-confirm')?.classList.add('visible');
    });
    const keepBtn = document.getElementById('export-cancel-keep');
    if (keepBtn) keepBtn.addEventListener('click', () => {
        document.getElementById('export-cancel-confirm')?.classList.remove('visible');
    });
    const confirmCancel = document.getElementById('export-cancel-confirm-btn');
    if (confirmCancel) confirmCancel.addEventListener('click', () => {
        document.getElementById('export-cancel-confirm')?.classList.remove('visible');
        cancelExportJob();
    });
}

// Holds references so the Cancel button can abort an in-flight export.
let _exportJob = { active: false, cancelled: false, recorder: null, progressTimer: null, waitResolve: null, waitTimer: null };

function cancelExportJob() {
    if (!_exportJob.active) return;
    _exportJob.cancelled = true;
    if (_exportJob.waitTimer) { clearTimeout(_exportJob.waitTimer); _exportJob.waitTimer = null; }
    if (_exportJob.waitResolve) { const r = _exportJob.waitResolve; _exportJob.waitResolve = null; r(); }
    if (_exportJob.progressTimer) { clearInterval(_exportJob.progressTimer); _exportJob.progressTimer = null; }
    try { if (_exportJob.recorder && _exportJob.recorder.state !== 'inactive') _exportJob.recorder.stop(); } catch (e) {}
    if (typeof timelinePause === 'function') timelinePause();
    if (typeof hideExportProgress === 'function') hideExportProgress();
}

// Vendored, same-origin ESM libs (no CDN): Mediabunny muxes WebCodecs-encoded H.264/VP9
// into MP4/WebM; gifenc encodes GIFs. Dynamically imported on first export and cached.
let _mediabunny = null, _gifenc = null;
async function loadMediabunny() {
    if (!_mediabunny) _mediabunny = await import(new URL('./vendor/mediabunny.min.mjs', document.baseURI).href);
    return _mediabunny;
}
async function loadGifenc() {
    if (!_gifenc) _gifenc = await import(new URL('./vendor/gifenc.esm.js', document.baseURI).href);
    return _gifenc;
}

// Seek a <video> to time t and resolve once the frame is actually decoded ('seeked'),
// so the exported frame matches the playhead. Safety-timed so it can't hang.
function seekVideoFrame(media, t) {
    return new Promise((resolve) => {
        if (!media || media.tagName !== 'VIDEO') { resolve(); return; }
        const target = Math.min(t, isFinite(media.duration) ? media.duration : t);
        if (Math.abs(media.currentTime - target) < 0.001) { resolve(); return; }
        let done = false;
        const finish = () => { if (done) return; done = true; media.removeEventListener('seeked', finish); resolve(); };
        media.addEventListener('seeked', finish);
        try { media.currentTime = target; } catch (e) { finish(); }
        setTimeout(finish, 250);
    });
}

// Put the composition into the exact state for time t (animation playhead + video frame),
// then render the export canvas. Shared by every frame of every output format.
async function renderExportFrame(screenshot, media, isVideo, hasAnim, t) {
    if (hasAnim && typeof applyAnimationAtTime === 'function') {
        if (typeof timeline !== 'undefined') timeline.time = t;
        applyAnimationAtTime(screenshot, t);
    }
    if (isVideo) await seekVideoFrame(media, t);
    updateCanvas(); // draws the full-resolution frame to `canvas` synchronously
}

async function runVideoExport(fmt, durationSec, motionBlur, motionBlurSamples, audioOpts) {
    const screenshot = state.screenshots[state.selectedIndex];
    const media = getScreenshotImage(screenshot);
    const isVideo = media && media.tagName === 'VIDEO';
    const hasAnim = typeof getAnimation === 'function' && getAnimation(screenshot)?.tracks?.length > 0;

    const fps = fmt === 'gif' ? 20 : 30;
    const frameCount = Math.max(1, Math.round(durationSec * fps));
    const stamp = Date.now();
    // Motion blur only helps when something actually moves, and we only do it for the
    // video formats (not GIF). Samples-per-frame: more = smoother but slower.
    const chosenSamples = Math.max(2, Math.min(32, motionBlurSamples || 6));
    const blurSamples = (motionBlur && hasAnim && fmt !== 'gif') ? chosenSamples : 1;
    // Audio is only available if (a) the source is a video, (b) it has an audio track,
    // and (c) the chosen format supports audio (i.e. not GIF). Defaults: include for
    // backwards-compat callers that don't pass audioOpts.
    const opts = audioOpts || { include: true, split: false };
    const wantAudio = isVideo && fmt !== 'gif' && !!opts.include;
    const splitAudio = isVideo && fmt !== 'gif' && !!opts.split;

    // Restore the editor to its pre-export state afterwards.
    const restoreTime = (typeof timeline !== 'undefined') ? timeline.time : 0;
    const restoreVideoTime = isVideo ? media.currentTime : 0;

    _exportJob = { active: true, cancelled: false, recorder: null, progressTimer: null, waitResolve: null, waitTimer: null };
    if (typeof showExportProgress === 'function') showExportProgress(`Encoding ${fmt.toUpperCase()}…`, 'Preparing…', 0);

    try {
        if (fmt === 'gif') {
            await exportGif(screenshot, media, isVideo, hasAnim, fps, frameCount, durationSec, stamp);
        } else {
            await exportWithMediabunny(fmt, screenshot, media, isVideo, hasAnim, fps, frameCount, durationSec, stamp, blurSamples, wantAudio);
            if (splitAudio && !_exportJob.cancelled) {
                await exportAudioOnly(fmt, media, durationSec, stamp);
            }
        }
    } catch (err) {
        if (!_exportJob.cancelled) {
            console.error(`${fmt} export failed:`, err);
            if (typeof hideExportProgress === 'function') hideExportProgress();
            await showAppAlert(`${fmt.toUpperCase()} export failed. Check the console for details.`, 'info');
        }
    } finally {
        _exportJob.active = false;
        if (typeof hideExportProgress === 'function') hideExportProgress();
        // Restore editor state
        if (typeof timeline !== 'undefined') timeline.time = restoreTime;
        if (isVideo) { try { media.currentTime = restoreVideoTime; } catch (e) {} }
        if (hasAnim && typeof applyAnimationAtTime === 'function') applyAnimationAtTime(screenshot, restoreTime);
        updateCanvas();
    }
}

// Render one output frame with accumulation motion blur: render `samples` sub-frames
// spread across the frame's time slice and average them onto `canvas`. During holds the
// sub-frames are identical (stays sharp); during fast moves they differ (→ blur).
let _mbAccum = null, _mbScratchCanvas = null;
async function renderBlurredFrame(screenshot, media, isVideo, hasAnim, t0, frameDur, samples) {
    const w = canvas.width, h = canvas.height, n = w * h * 4;
    if (!_mbAccum || _mbAccum.length !== n) _mbAccum = new Float32Array(n);
    else _mbAccum.fill(0);
    for (let s = 0; s < samples; s++) {
        const ts = t0 + ((s + 0.5) / samples) * frameDur; // even exposure across the frame
        await renderExportFrame(screenshot, media, isVideo, hasAnim, ts);
        const px = ctx.getImageData(0, 0, w, h).data;
        for (let p = 0; p < n; p++) _mbAccum[p] += px[p];
    }
    const out = ctx.createImageData(w, h);
    const inv = 1 / samples;
    for (let p = 0; p < n; p++) out.data[p] = _mbAccum[p] * inv;
    ctx.putImageData(out, 0, 0);
}

// --- Live motion-blur preview ---------------------------------------------------------
// Reuses the export accumulation (renderBlurredFrame) to show motion blur on the live
// canvas while the playhead is parked/scrubbed. _liveMBRendering guards against the
// re-entrancy that would otherwise occur (renderBlurredFrame → renderExportFrame →
// updateCanvas → … ). Debounced so active scrubbing stays responsive (sharp) and the
// blur lands once motion settles.
let _liveMBRendering = false;
let _liveMBTimer = null;

function liveMotionBlurActive() {
    if (_liveMBRendering) return false;
    if (typeof timeline === 'undefined' || timeline.playing) return false;
    const fx = (typeof getEffects === 'function') ? getEffects() : null;
    if (!fx || !fx.motionBlur || !fx.motionBlur.enabled) return false;
    const ss = getCurrentScreenshot();
    if (!ss) return false;
    const media = getScreenshotImage(ss);
    const isVideo = !!(media && media.tagName === 'VIDEO');
    const hasAnim = typeof getAnimation === 'function' && getAnimation(ss)?.tracks?.length > 0;
    return hasAnim || isVideo;
}

function scheduleLiveMotionBlur() {
    if (_liveMBTimer) clearTimeout(_liveMBTimer);
    _liveMBTimer = setTimeout(() => { _liveMBTimer = null; renderLiveMotionBlur(); }, 110);
}

async function renderLiveMotionBlur() {
    if (!liveMotionBlurActive()) return;
    const ss = getCurrentScreenshot();
    const media = getScreenshotImage(ss);
    const isVideo = !!(media && media.tagName === 'VIDEO');
    const hasAnim = typeof getAnimation === 'function' && getAnimation(ss)?.tracks?.length > 0;
    const fx = getEffects();
    const samples = Math.max(2, Math.min(24, fx.motionBlur.samples || 6));
    // Shutter window as a fraction of a 30fps frame (matches the export look at 100%).
    const windowSec = Math.max(0.0001, (fx.motionBlur.amount / 100) * (1 / 30));
    const t = timeline.time;

    const prevSkip = skipSidePreviewRender;
    _liveMBRendering = true;
    skipSidePreviewRender = true; // side previews stay sharp; don't re-render them per sub-frame
    try {
        await renderBlurredFrame(ss, media, isVideo, hasAnim, Math.max(0, t - windowSec / 2), windowSec, samples);
        // Restore animation + video state to the exact playhead time WITHOUT redrawing,
        // so the accumulated blur remains on the canvas.
        timeline.time = t;
        if (hasAnim && typeof applyAnimationAtTime === 'function') applyAnimationAtTime(ss, t);
        if (isVideo && typeof seekVideoFrame === 'function') await seekVideoFrame(media, t);
    } catch (e) {
        console.warn('live motion blur failed:', e);
    } finally {
        _liveMBRendering = false;
        skipSidePreviewRender = prevSkip;
    }
}

// MP4 / WebM via WebCodecs + Mediabunny. Renders each frame deterministically and feeds
// it to the browser's native (hardware) encoder, then muxes to the container in-memory.
// When `wantAudio` is true and the source <video> has an audio track, the original audio
// is decoded from the persisted source blob and re-encoded into the output (AAC for MP4,
// Opus for WebM) — we go through decoded samples rather than packet-copy so the codec
// always matches the chosen container.
async function exportWithMediabunny(fmt, screenshot, media, isVideo, hasAnim, fps, frameCount, durationSec, stamp, blurSamples, wantAudio) {
    const mb = await loadMediabunny();
    if (_exportJob.cancelled) return;

    const format = fmt === 'webm' ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
    const codec = fmt === 'webm' ? 'vp9' : 'avc'; // VP9 for WebM, H.264 for MP4
    const output = new mb.Output({ format, target: new mb.BufferTarget() });
    const source = new mb.CanvasSource(canvas, { codec, bitrate: mb.QUALITY_HIGH });
    output.addVideoTrack(source, { frameRate: fps });

    // Try to attach an audio track from the source video. If anything goes wrong
    // (no audio track, undecodable codec, missing blob, …) we just skip — the video
    // still exports successfully, only without sound.
    let audioCtx = null;
    if (wantAudio) {
        audioCtx = await prepareAudioTrack(mb, output, fmt, media);
    }

    await output.start();

    const frameDur = 1 / fps;
    const samples = Math.max(1, blurSamples || 1);
    for (let i = 0; i < frameCount; i++) {
        if (_exportJob.cancelled) { try { await output.cancel(); } catch (e) {} return; }
        if (samples > 1) {
            await renderBlurredFrame(screenshot, media, isVideo, hasAnim, i / fps, frameDur, samples);
        } else {
            await renderExportFrame(screenshot, media, isVideo, hasAnim, i / fps);
        }
        await source.add(i / fps, frameDur);
        if (typeof showExportProgress === 'function') {
            const pct = Math.round(((i + 1) / frameCount) * 100);
            showExportProgress(`Encoding ${fmt.toUpperCase()}${samples > 1 ? ' (motion blur)' : ''}…`, `Frame ${i + 1} / ${frameCount}`, pct);
        }
    }
    source.close();

    if (audioCtx) {
        if (typeof showExportProgress === 'function') {
            showExportProgress(`Encoding ${fmt.toUpperCase()}…`, 'Encoding audio…', 100);
        }
        await streamAudioIntoSource(audioCtx, durationSec);
    }

    await output.finalize();
    if (_exportJob.cancelled) return;

    const mime = fmt === 'webm' ? 'video/webm' : 'video/mp4';
    const ext = fmt === 'webm' ? '.webm' : '.mp4';
    if (typeof hideExportProgress === 'function') hideExportProgress();
    await saveBlob(new Blob([output.target.buffer], { type: mime }), `shotscraft-${stamp}${ext}`, mime, ext);
}

// Open a Mediabunny Input over the source video's persisted blob and attach a matching
// audio track to `output`. Returns a context object the caller passes to
// streamAudioIntoSource() once it's ready to push audio, or null if no audio is available.
async function prepareAudioTrack(mb, output, fmt, media) {
    try {
        const mediaKey = media?.dataset?.mediaKey;
        if (!mediaKey || typeof loadMediaBlob !== 'function') return null;
        const blob = await loadMediaBlob(mediaKey);
        if (!blob) return null;
        const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(blob) });
        const track = await input.getPrimaryAudioTrack();
        if (!track) return null;
        if (typeof track.canDecode === 'function' && !(await track.canDecode())) return null;

        // AAC for MP4 (universally supported), Opus for WebM (the canonical pairing).
        const audioCodec = fmt === 'webm' ? 'opus' : 'aac';
        const audioSource = new mb.AudioBufferSource({ codec: audioCodec, bitrate: mb.QUALITY_HIGH });
        output.addAudioTrack(audioSource);
        const sink = new mb.AudioSampleSink(track);
        return { input, sink, audioSource };
    } catch (err) {
        console.warn('Audio track unavailable, exporting silently:', err);
        return null;
    }
}

// Drain decoded audio samples from `[0, durationSec]` into the output's AudioBufferSource.
// Each AudioSample is converted to a Web Audio AudioBuffer; Mediabunny stitches the
// timeline together. Errors here are swallowed so a bad audio frame doesn't kill the
// whole export — the user still gets a video file.
async function streamAudioIntoSource(audioCtx, durationSec) {
    const { sink, audioSource } = audioCtx;
    try {
        for await (const sample of sink.samples(0, durationSec)) {
            if (_exportJob.cancelled) break;
            const buf = sample.toAudioBuffer();
            await audioSource.add(buf);
            // AudioSample owns a WebCodecs AudioData under the hood; close it promptly so
            // long clips don't pile up native handles.
            if (typeof sample.close === 'function') sample.close();
        }
    } catch (err) {
        console.warn('Audio encoding stopped early:', err);
    } finally {
        try { audioSource.close(); } catch (e) {}
    }
}

// Export just the source video's audio as a standalone file. Power-user option for
// users who want to edit / re-mix the soundtrack independently. M4A for MP4 exports,
// WebA for WebM — keeps the same codec (AAC/Opus) the embedded track uses.
async function exportAudioOnly(fmt, media, durationSec, stamp) {
    const mb = await loadMediabunny();
    if (_exportJob.cancelled) return;
    if (typeof showExportProgress === 'function') {
        showExportProgress('Encoding audio…', 'Extracting soundtrack…', 0);
    }
    try {
        const format = fmt === 'webm' ? new mb.WebMOutputFormat() : new mb.Mp4OutputFormat({ fastStart: 'in-memory' });
        const output = new mb.Output({ format, target: new mb.BufferTarget() });
        const ctx = await prepareAudioTrack(mb, output, fmt, media);
        if (!ctx) {
            console.warn('No decodable audio track found; skipping split-audio export.');
            return;
        }
        await output.start();
        await streamAudioIntoSource(ctx, durationSec);
        await output.finalize();
        if (_exportJob.cancelled) return;
        const mime = fmt === 'webm' ? 'audio/webm' : 'audio/mp4';
        const ext  = fmt === 'webm' ? '.weba'      : '.m4a';
        await saveBlob(new Blob([output.target.buffer], { type: mime }), `shotscraft-${stamp}-audio${ext}`, mime, ext);
    } catch (err) {
        console.warn('Split-audio export failed:', err);
    } finally {
        if (typeof hideExportProgress === 'function') hideExportProgress();
    }
}

// Animated GIF via gifenc. Frames are drawn to a downscaled canvas (GIFs balloon at full
// res), quantized to a 256-colour palette, and LZW-encoded — all client-side.
async function exportGif(screenshot, media, isVideo, hasAnim, fps, frameCount, durationSec, stamp) {
    const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
    if (_exportJob.cancelled) return;

    // Downscale to <=640px on the long edge to keep GIF size reasonable.
    const maxEdge = 640;
    const scale = Math.min(1, maxEdge / Math.max(canvas.width, canvas.height));
    const gw = Math.max(1, Math.round(canvas.width * scale));
    const gh = Math.max(1, Math.round(canvas.height * scale));
    const gifCanvas = document.createElement('canvas');
    gifCanvas.width = gw; gifCanvas.height = gh;
    const gctx = gifCanvas.getContext('2d', { willReadFrequently: true });

    const enc = GIFEncoder();
    const delay = Math.round(1000 / fps);
    for (let i = 0; i < frameCount; i++) {
        if (_exportJob.cancelled) return;
        await renderExportFrame(screenshot, media, isVideo, hasAnim, i / fps);
        gctx.drawImage(canvas, 0, 0, gw, gh);
        const { data } = gctx.getImageData(0, 0, gw, gh);
        const palette = quantize(data, 256);
        const index = applyPalette(data, palette);
        enc.writeFrame(index, gw, gh, { palette, delay });
        if (typeof showExportProgress === 'function') {
            const pct = Math.round(((i + 1) / frameCount) * 100);
            showExportProgress('Encoding GIF…', `Frame ${i + 1} / ${frameCount}`, pct);
        }
    }
    enc.finish();
    if (_exportJob.cancelled) return;
    if (typeof hideExportProgress === 'function') hideExportProgress();
    await saveBlob(new Blob([enc.bytes()], { type: 'image/gif' }), `shotscraft-${stamp}.gif`, 'image/gif', '.gif');
}

// Save a Blob letting the user choose the destination folder + filename via the File
// System Access API (Chrome/Edge). Falls back to a normal download (browser's default
// download folder) where that API isn't available (Safari/Firefox).
async function saveBlob(blob, suggestedName, mime, ext) {
    if (typeof window.showSaveFilePicker === 'function') {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName,
                types: [{ description: suggestedName.split('.').pop().toUpperCase() + ' file', accept: { [mime]: [ext] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return; // user cancelled the picker
            console.warn('Save picker failed, falling back to download:', err);
        }
    }
    downloadBlob(blob, suggestedName);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function showAppPrompt(message, defaultValue) {
    return window.prompt(message, defaultValue);
}

async function exportAll() {
    if (state.screenshots.length === 0) {
        await showAppAlert('Please upload screenshots first', 'info');
        return;
    }

    // Check if project has multiple languages configured
    const hasMultipleLanguages = state.projectLanguages.length > 1;

    if (hasMultipleLanguages) {
        // Show language choice dialog
        showExportLanguageDialog(async (choice) => {
            if (choice === 'current') {
                await exportAllForLanguage(state.currentLanguage);
            } else if (choice === 'all') {
                await exportAllLanguages();
            }
        });
    } else {
        // Only one language, export directly
        await exportAllForLanguage(state.currentLanguage);
    }
}

// Show export progress modal
function showExportProgress(status, detail, percent) {
    const modal = document.getElementById('export-progress-modal');
    const statusEl = document.getElementById('export-progress-status');
    const detailEl = document.getElementById('export-progress-detail');
    const fillEl = document.getElementById('export-progress-fill');

    if (modal) modal.classList.add('visible');
    if (statusEl) statusEl.textContent = status;
    if (detailEl) detailEl.textContent = detail || '';
    if (fillEl) fillEl.style.width = `${percent}%`;
}

// Hide export progress modal
function hideExportProgress() {
    const modal = document.getElementById('export-progress-modal');
    if (modal) modal.classList.remove('visible');
}

// Export all screenshots for a specific language
async function exportAllForLanguage(lang) {
    const originalIndex = state.selectedIndex;
    const originalLang = state.currentLanguage;
    const zip = new JSZip();
    const total = state.screenshots.length;

    // Show progress
    const langName = languageNames[lang] || lang.toUpperCase();
    showExportProgress('Exporting...', `Preparing ${langName} screenshots`, 0);

    // Save original text languages for each screenshot
    const originalTextLangs = state.screenshots.map(s => ({
        headline: s.text.currentHeadlineLang,
        subheadline: s.text.currentSubheadlineLang
    }));

    // Temporarily switch to the target language (images and text)
    state.currentLanguage = lang;
    state.screenshots.forEach(s => {
        s.text.currentHeadlineLang = lang;
        s.text.currentSubheadlineLang = lang;
    });

    for (let i = 0; i < state.screenshots.length; i++) {
        state.selectedIndex = i;
        updateCanvas();

        // Update progress
        const percent = Math.round(((i + 1) / total) * 90); // Reserve 10% for ZIP generation
        showExportProgress('Exporting...', `Screenshot ${i + 1} of ${total}`, percent);

        await new Promise(resolve => setTimeout(resolve, 100));

        // Get canvas data as base64, strip the data URL prefix
        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

        zip.file(`screenshot-${i + 1}.png`, base64Data, { base64: true });
    }

    // Restore original settings
    state.selectedIndex = originalIndex;
    state.currentLanguage = originalLang;
    state.screenshots.forEach((s, i) => {
        s.text.currentHeadlineLang = originalTextLangs[i].headline;
        s.text.currentSubheadlineLang = originalTextLangs[i].subheadline;
    });
    updateCanvas();

    // Generate ZIP
    showExportProgress('Generating ZIP...', '', 95);
    const content = await zip.generateAsync({ type: 'blob' });

    showExportProgress('Complete!', '', 100);
    await new Promise(resolve => setTimeout(resolve, 1500));
    hideExportProgress();

    const link = document.createElement('a');
    link.download = `screenshots_${state.outputDevice}_${lang}.zip`;
    link.href = URL.createObjectURL(content);
    link.click();
    URL.revokeObjectURL(link.href);
}

// Export all screenshots for all languages (separate folders)
async function exportAllLanguages() {
    const originalIndex = state.selectedIndex;
    const originalLang = state.currentLanguage;
    const zip = new JSZip();

    const totalLangs = state.projectLanguages.length;
    const totalScreenshots = state.screenshots.length;
    const totalItems = totalLangs * totalScreenshots;
    let completedItems = 0;

    // Show progress
    showExportProgress('Exporting...', 'Preparing all languages', 0);

    // Save original text languages for each screenshot
    const originalTextLangs = state.screenshots.map(s => ({
        headline: s.text.currentHeadlineLang,
        subheadline: s.text.currentSubheadlineLang
    }));

    for (let langIdx = 0; langIdx < state.projectLanguages.length; langIdx++) {
        const lang = state.projectLanguages[langIdx];
        const langName = languageNames[lang] || lang.toUpperCase();

        // Temporarily switch to this language (images and text)
        state.currentLanguage = lang;
        state.screenshots.forEach(s => {
            s.text.currentHeadlineLang = lang;
            s.text.currentSubheadlineLang = lang;
        });

        for (let i = 0; i < state.screenshots.length; i++) {
            state.selectedIndex = i;
            updateCanvas();

            completedItems++;
            const percent = Math.round((completedItems / totalItems) * 90); // Reserve 10% for ZIP
            showExportProgress('Exporting...', `${langName}: Screenshot ${i + 1} of ${totalScreenshots}`, percent);

            await new Promise(resolve => setTimeout(resolve, 100));

            // Get canvas data as base64, strip the data URL prefix
            const dataUrl = canvas.toDataURL('image/png');
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

            // Use language code as folder name
            zip.file(`${lang}/screenshot-${i + 1}.png`, base64Data, { base64: true });
        }
    }

    // Restore original settings
    state.selectedIndex = originalIndex;
    state.currentLanguage = originalLang;
    state.screenshots.forEach((s, i) => {
        s.text.currentHeadlineLang = originalTextLangs[i].headline;
        s.text.currentSubheadlineLang = originalTextLangs[i].subheadline;
    });
    updateCanvas();

    // Generate ZIP
    showExportProgress('Generating ZIP...', '', 95);
    const content = await zip.generateAsync({ type: 'blob' });

    showExportProgress('Complete!', '', 100);
    await new Promise(resolve => setTimeout(resolve, 1500));
    hideExportProgress();

    const link = document.createElement('a');
    link.download = `screenshots_${state.outputDevice}_all-languages.zip`;
    link.href = URL.createObjectURL(content);
    link.click();
    URL.revokeObjectURL(link.href);
}

// ===== Emoji Picker (inline dropdown) =====

let emojiPickerInitialized = false;

function showEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    const iconPicker = document.getElementById('icon-picker');
    if (!picker) return;

    // Close icon picker if open
    if (iconPicker) iconPicker.style.display = 'none';

    // Toggle
    if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        return;
    }

    picker.style.display = '';
    const searchInput = document.getElementById('emoji-search');
    if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 50);
    }

    // Reset to popular category
    document.querySelectorAll('#emoji-categories .picker-cat').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === 'popular');
    });
    renderEmojiGrid('popular');

    if (!emojiPickerInitialized) {
        emojiPickerInitialized = true;

        // Category tabs
        document.querySelectorAll('#emoji-categories .picker-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#emoji-categories .picker-cat').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const searchVal = document.getElementById('emoji-search').value.trim();
                if (searchVal) {
                    renderEmojiSearchResults(searchVal);
                } else {
                    renderEmojiGrid(btn.dataset.category);
                }
            });
        });

        // Search
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const val = searchInput.value.trim().toLowerCase();
                if (val) {
                    renderEmojiSearchResults(val);
                } else {
                    const active = document.querySelector('#emoji-categories .picker-cat.active');
                    renderEmojiGrid(active?.dataset.category || 'popular');
                }
            });
        }
    }
}

function renderEmojiGrid(category) {
    const grid = document.getElementById('emoji-grid');
    if (!grid || typeof EMOJI_DATA === 'undefined') return;
    const emojis = EMOJI_DATA[category] || [];
    grid.innerHTML = emojis.map(e =>
        `<div class="picker-grid-item emoji-grid-item" data-emoji="${e.emoji}" data-name="${e.name}" title="${e.name}">${e.emoji}</div>`
    ).join('');
    wireEmojiClicks(grid);
}

function renderEmojiSearchResults(query) {
    const grid = document.getElementById('emoji-grid');
    if (!grid || typeof EMOJI_DATA === 'undefined') return;
    const results = [];
    for (const cat of Object.values(EMOJI_DATA)) {
        for (const e of cat) {
            if (e.name.toLowerCase().includes(query) ||
                e.keywords.some(k => k.includes(query))) {
                if (!results.find(r => r.emoji === e.emoji)) results.push(e);
            }
        }
    }
    grid.innerHTML = results.map(e =>
        `<div class="picker-grid-item emoji-grid-item" data-emoji="${e.emoji}" data-name="${e.name}" title="${e.name}">${e.emoji}</div>`
    ).join('');
    wireEmojiClicks(grid);
}

function wireEmojiClicks(grid) {
    grid.querySelectorAll('.emoji-grid-item').forEach(item => {
        item.onclick = () => {
            addEmojiElement(item.dataset.emoji, item.dataset.name);
            document.getElementById('emoji-picker').style.display = 'none';
        };
    });
}

// ===== Icon Picker (inline dropdown) =====

let iconPickerInitialized = false;
let iconSearchTimeout = null;

const iconImageObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const item = entry.target;
            const name = item.dataset.iconName;
            if (name && !item.dataset.loaded) {
                item.dataset.loaded = 'true';
                loadIconPreview(item, name);
            }
            iconImageObserver.unobserve(item);
        }
    });
}, { root: document.getElementById('icon-grid'), rootMargin: '50px' }) : null;

async function loadIconPreview(item, name) {
    try {
        const svgText = await fetchLucideSVG(name);
        const colorized = colorizeLucideSVG(svgText, 'currentColor', 2);
        item.innerHTML = colorized;
        const svg = item.querySelector('svg');
        if (svg) {
            svg.style.width = '20px';
            svg.style.height = '20px';
        }
    } catch (e) {
        item.innerHTML = `<span style="font-size: 9px; color: var(--text-tertiary);">${name}</span>`;
    }
}

function showIconPicker() {
    const picker = document.getElementById('icon-picker');
    const emojiPicker = document.getElementById('emoji-picker');
    if (!picker) return;

    // Close emoji picker if open
    if (emojiPicker) emojiPicker.style.display = 'none';

    // Toggle
    if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        return;
    }

    picker.style.display = '';
    const searchInput = document.getElementById('icon-search');
    if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 50);
    }

    // Reset to popular category
    document.querySelectorAll('#icon-categories .picker-cat').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === 'popular');
    });
    renderIconGrid('popular');

    if (!iconPickerInitialized) {
        iconPickerInitialized = true;

        // Category tabs
        document.querySelectorAll('#icon-categories .picker-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#icon-categories .picker-cat').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const searchVal = document.getElementById('icon-search').value.trim();
                if (searchVal) {
                    renderIconSearchResults(searchVal);
                } else {
                    renderIconGrid(btn.dataset.category);
                }
            });
        });

        // Debounced search
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(iconSearchTimeout);
                iconSearchTimeout = setTimeout(() => {
                    const val = searchInput.value.trim().toLowerCase();
                    if (val) {
                        renderIconSearchResults(val);
                    } else {
                        const active = document.querySelector('#icon-categories .picker-cat.active');
                        renderIconGrid(active?.dataset.category || 'popular');
                    }
                }, 200);
            });
        }
    }
}

function renderIconGrid(category) {
    const grid = document.getElementById('icon-grid');
    if (!grid) return;
    const icons = category === 'popular' ? (typeof LUCIDE_POPULAR !== 'undefined' ? LUCIDE_POPULAR : []) :
                                            (typeof LUCIDE_ALL !== 'undefined' ? LUCIDE_ALL : []);
    grid.innerHTML = icons.map(name =>
        `<div class="picker-grid-item icon-grid-item" data-icon-name="${name}" title="${name}"><div class="icon-placeholder"></div></div>`
    ).join('');
    wireIconClicks(grid);
    if (iconImageObserver) {
        grid.querySelectorAll('.icon-grid-item').forEach(item => {
            iconImageObserver.observe(item);
        });
    }
}

function renderIconSearchResults(query) {
    const grid = document.getElementById('icon-grid');
    if (!grid) return;
    const allIcons = typeof LUCIDE_ALL !== 'undefined' ? LUCIDE_ALL : [];
    const results = allIcons.filter(name => name.includes(query));
    grid.innerHTML = results.map(name =>
        `<div class="picker-grid-item icon-grid-item" data-icon-name="${name}" title="${name}"><div class="icon-placeholder"></div></div>`
    ).join('');
    wireIconClicks(grid);
    if (iconImageObserver) {
        grid.querySelectorAll('.icon-grid-item').forEach(item => {
            iconImageObserver.observe(item);
        });
    }
}

function wireIconClicks(grid) {
    grid.querySelectorAll('.icon-grid-item').forEach(item => {
        item.onclick = () => {
            addIconElement(item.dataset.iconName);
            document.getElementById('icon-picker').style.display = 'none';
        };
    });
}

// Initialize the app
initSync();