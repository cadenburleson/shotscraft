// Three.js 3D Renderer for iPhone mockups

let threeRenderer = null;
let threeScene = null;
let threeCamera = null;
let phoneModel = null;
let phonePivot = null;  // Pivot group for rotation around screen center
let screenMesh = null;
let customScreenPlane = null;
// When useExistingScreenMesh is set, this holds the mesh in the loaded GLB whose
// material we mutate to display the user's video/screenshot.
let existingScreenMesh = null;
let orbitControls = null;
let isThreeJSInitialized = false;
let phoneModelLoaded = false;
let phoneModelLoading = false;

// Screen texture for the screenshot
let screenTexture = null;

// Store original model scale
let baseModelScale = 1;

// Store base position offset to keep model centered after screen alignment
let basePositionOffset = { x: 0, y: 0, z: 0 };

// Current device model type
let currentDeviceModel = 'iphone';

// Cache for loaded phone models (for rendering different devices in side previews)
let phoneModelCache = {};  // { deviceType: { model, pivot, screenPlane, baseScale, loaded } }

// Wall-shadow scene objects (created once in setupWallShadow)
let shadowLight = null;
let shadowCatcher = null;       // vertical wall behind the device
let shadowFloorCatcher = null;  // horizontal floor below the device

// Device-specific configurations
const deviceConfigs = {
    iphone: {
        // Default iPhone is now the HD model (Polyman iPhone 15 Pro Max): a realistic
        // body with a built-in glass screen mesh + reflections. The older low-poly
        // flat-screen-plane model (iphone-15-pro-max.glb) was retired — it looked
        // noticeably worse and is no longer referenced.
        modelPath: 'models/apple_iphone_15_pro_max_black.glb',
        aspectRatio: 1290 / 2796,
        screenOffset: { x: 0, y: 0, z: 0 },
        positionOffsetFactor: 0.81,
        cornerRadiusFactor: 0.16,
        modelRotation: { x: 0, y: 0, z: 0 },
        // Polyman geometry faces +Z by default; bake a 180° Y flip so the screen
        // faces the camera. Render the screenshot onto the model's own screen mesh
        // (glass layer renders on top) and strip back-panel normal maps (UV1 issues).
        bakedYRotation: 180,
        skipPivotShift: true,
        useExistingScreenMesh: true,
        stripBackNormalMaps: true
    },
    // New: Polyman Studio iPhone 15 Pro Max. Different author → different mesh hierarchy,
    // so screenOffset / modelRotation will need calibration from console logs after first load.
    // Starting values copied from iphone; tune via the in-app device picker.
    'iphone-polyman': {
        modelPath: 'models/apple_iphone_15_pro_max_black.glb',
        aspectRatio: 1290 / 2796,
        screenOffset: { x: 0, y: 0, z: 0 },
        positionOffsetFactor: 0.81,
        cornerRadiusFactor: 0.16,
        modelRotation: { x: 0, y: 0, z: 0 },
        // Polyman geometry has camera-bump face at +Z by default; bake a 180° Y flip
        // directly on phoneModel so its screen face naturally points at the camera.
        bakedYRotation: 180,
        skipPivotShift: true,
        // Apply video texture to the model's BUILT-IN screen mesh (identified by PBR
        // signature: emissiveMap + roughness ≈ 0 + near front face) instead of overlaying
        // our own plane. The model's own glass layer then renders on top with full
        // reflections — no transparency hacks needed.
        useExistingScreenMesh: true,
        // The model's normal maps reference UV channel 1 which the r128 GLTFLoader
        // doesn't apply correctly, producing visible artifacts on the back panel.
        // Strip normal maps from non-front meshes to clean up the look.
        stripBackNormalMaps: true
    },
    samsung: {
        modelPath: 'models/samsung-galaxy-s25-ultra.glb',
        aspectRatio: 1440 / 3120,
        screenHeightFactor: 0.66,
        screenOffset: { x: 0, y: 0.0, z: 0.08},  // Will need adjustment
        positionOffsetFactor: 0.5,
        cornerRadiusFactor: 0.04,
        modelRotation: { x: 0, y: 0, z: 0 }  // Adjust to correct model tilt (in degrees)
    },
    // MacBook Pro 16" M3 (jackbaeten, CC-BY-4.0). Landscape laptop with an open lid.
    // Uses the model's built-in screen mesh (flat) so the recording shows with a smooth
    // glass reflection. screenRoughnessMax relaxes the screen-finder for this model's
    // glossier (rough≈0.1) display. Orientation/scale tuned from console logs after load.
    macbook: {
        modelPath: 'models/macbook-pro-16.glb',
        aspectRatio: 3456 / 2234,           // 16" MBP display
        isLandscape: true,
        screenHeightFactor: 1.0,
        screenOffset: { x: 0, y: 0, z: 0 },
        positionOffsetFactor: 0.5,
        cornerRadiusFactor: 0.0,
        modelRotation: { x: 0, y: 0, z: 0 },  // tuned in-browser
        useExistingScreenMesh: true,
        screenRoughnessMax: 0.2,
        centerOnGeometry: true,   // frame + rotate about the laptop's geometric center
        framingOffset: { x: 0, y: 0, z: 0 },
        cameraDistance: 22        // pull camera well back → near-orthographic → scaling stays visually centered
    }
};

// Frame color presets per device (real device colors)
// Using var so it's accessible from app.js
var frameColorPresets = {
    iphone: [
        { id: 'natural', label: 'Natural Titanium', swatch: '#9d927f',
          materials: { backpanel: '#9d927f', metalframe: '#5f5950', gray: '#221f1b' } },
        { id: 'blue', label: 'Blue Titanium', swatch: '#3d4d5c',
          materials: { backpanel: '#394d5f', metalframe: '#3a4553', gray: '#1a1f24' } },
        { id: 'white', label: 'White Titanium', swatch: '#e3ddd4',
          materials: { backpanel: '#e3ddd4', metalframe: '#c4bdb4', gray: '#2a2825' } },
        { id: 'black', label: 'Black Titanium', swatch: '#3a3632',
          materials: { backpanel: '#3a3632', metalframe: '#2a2725', gray: '#1a1918' } },
        { id: 'desert', label: 'Desert Titanium', swatch: '#c4a882',
          materials: { backpanel: '#c4a882', metalframe: '#8a7560', gray: '#2a2218' } },
        { id: 'deep-purple', label: 'Deep Purple', swatch: '#5b4a6e',
          materials: { backpanel: '#5b4a6e', metalframe: '#3d3348', gray: '#1e1825' } },
        { id: 'gold', label: 'Gold', swatch: '#e3c8a0',
          materials: { backpanel: '#e3c8a0', metalframe: '#c9a96e', gray: '#2a2418' } },
        { id: 'red', label: 'Product Red', swatch: '#c1272d',
          materials: { backpanel: '#c1272d', metalframe: '#8a1c20', gray: '#1a0a0a' } },
    ],
    // Reuse the same color set for the Polyman iPhone. Material names in that GLB
    // differ, so setPhoneFrameColor() may silently no-op until we discover the
    // material names from the console (one quick traverse log). Listed here so the
    // color UI still renders.
    'iphone-polyman': [
        { id: 'black', label: 'Black Titanium', swatch: '#3a3632',
          materials: { backpanel: '#3a3632', metalframe: '#2a2725', gray: '#1a1918' } },
        { id: 'natural', label: 'Natural Titanium', swatch: '#9d927f',
          materials: { backpanel: '#9d927f', metalframe: '#5f5950', gray: '#221f1b' } },
        { id: 'blue', label: 'Blue Titanium', swatch: '#3d4d5c',
          materials: { backpanel: '#394d5f', metalframe: '#3a4553', gray: '#1a1f24' } },
        { id: 'white', label: 'White Titanium', swatch: '#e3ddd4',
          materials: { backpanel: '#e3ddd4', metalframe: '#c4bdb4', gray: '#2a2825' } },
    ],
    samsung: [
        { id: 'gray', label: 'Titanium Gray', swatch: '#8a8a8a',
          materials: { back_glass: '#4c4c4c', frame: '#cdcdcd', antenna: '#707070' } },
        { id: 'black', label: 'Titanium Black', swatch: '#2a2a2a',
          materials: { back_glass: '#1a1a1a', frame: '#3a3a3a', antenna: '#2a2a2a' } },
        { id: 'silverblue', label: 'Titanium Silverblue', swatch: '#a8b8c8',
          materials: { back_glass: '#8a9eb0', frame: '#b8c8d4', antenna: '#7a8ea0' } },
        { id: 'whitesilver', label: 'Titanium Whitesilver', swatch: '#e8e4df',
          materials: { back_glass: '#d8d4cf', frame: '#e8e4df', antenna: '#c0bcb7' } },
        { id: 'pinkgold', label: 'Titanium Pinkgold', swatch: '#d4a89a',
          materials: { back_glass: '#c89888', frame: '#d4b0a0', antenna: '#b08878' } },
        { id: 'jadegreen', label: 'Titanium Jadegreen', swatch: '#9aaa9c',
          materials: { back_glass: '#7a9a7c', frame: '#a8b8aa', antenna: '#6a8a6c' } },
        { id: 'jetblack', label: 'Titanium Jetblack', swatch: '#404040',
          materials: { back_glass: '#2a2a2a', frame: '#484848', antenna: '#353535' } },
    ]
};

// Store original material colors for the current model
let originalMaterialColors = {};

// Apply a frame color preset to the phone model
function setPhoneFrameColor(presetId, deviceType) {
    if (!phoneModel) return;

    deviceType = deviceType || currentDeviceModel;
    const presets = frameColorPresets[deviceType];
    if (!presets) return;

    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    phoneModel.traverse((child) => {
        if (child.isMesh && child.material) {
            const matName = (child.material.name || '').toLowerCase();
            if (preset.materials[matName]) {
                child.material.color.set(preset.materials[matName]);
            }
        }
    });

    requestThreeJSRender();
}

// Apply frame color to a cached model (for side previews)
function setCachedModelFrameColor(presetId, deviceType) {
    const cached = phoneModelCache[deviceType];
    if (!cached?.loaded) return;

    const presets = frameColorPresets[deviceType];
    if (!presets) return;

    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    cached.model.traverse((child) => {
        if (child.isMesh && child.material) {
            const matName = (child.material.name || '').toLowerCase();
            if (preset.materials[matName]) {
                child.material.color.set(preset.materials[matName]);
            }
        }
    });
}

// Initialize Three.js scene
// Create the wall-shadow rig: a shadow-only directional light and a transparent
// shadow-catcher plane positioned behind the phone. Only the shadow is drawn (the
// plane is otherwise transparent), so it composites onto the 2D backdrop.
// (Previously this created WebGL shadow-catcher planes — a vertical wall behind and
// a horizontal floor below — receiving directional-light shadow maps. That approach
// produced visible plane edges at side/front-light angles, hard clipping where the
// shadow camera frustum ended, and a giant gray trapezoid on the MacBook. Replaced
// with a 2D contact shadow drawn from the projected device footprint — always clean,
// works at any rotation, on any device. The function name is kept so callers don't
// need to change.)
function setupWallShadow() {
    // Nothing to set up in the WebGL scene anymore. Shadow rendering happens on the
    // 2D target canvas in renderThreeJSToCanvas via drawProductShadow3D().
}

// Apply the current screenshot's shadow settings to the 3D wall shadow:
//   shadow.enabled    → catcher visible
//   shadow.opacity    → shadow strength (catcher darkness)
//   shadow.blur       → softness (VSM blur radius; 0 = crisp, high = soft)
//   shadow.lightAngle → direction (azimuth of the casting light; sweeps the shadow)
// Kept as no-ops so existing call sites don't break; the actual shadow work happens
// in drawProductShadow3D() below, called per-render.
function applyWallShadowSettings(_ss) { /* no-op — see drawProductShadow3D */ }
function applyShadowCasting(_root)    { /* no-op — no WebGL shadow maps anymore */ }

// Project the active device's world-space bounding box onto the target canvas and
// return the screen-space rect. Used as the "footprint" the contact shadow sits under.
function computeDeviceScreenRect(targetCanvas) {
    if (!phoneModel || !threeCamera || !phonePivot) return null;
    phonePivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(phoneModel);
    if (box.isEmpty()) return null;

    const w = targetCanvas.width, h = targetCanvas.height;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity;
    const corner = new THREE.Vector3();
    const C = [
        [box.min.x, box.min.y, box.min.z], [box.max.x, box.min.y, box.min.z],
        [box.min.x, box.max.y, box.min.z], [box.max.x, box.max.y, box.min.z],
        [box.min.x, box.min.y, box.max.z], [box.max.x, box.min.y, box.max.z],
        [box.min.x, box.max.y, box.max.z], [box.max.x, box.max.y, box.max.z]
    ];
    for (const c of C) {
        corner.set(c[0], c[1], c[2]).project(threeCamera);
        const sx = (corner.x * 0.5 + 0.5) * w;
        const sy = (-corner.y * 0.5 + 0.5) * h;
        if (sx < minX) minX = sx; if (sy < minY) minY = sy;
        if (sx > maxX) maxX = sx; if (sy > maxY) maxY = sy;
        if (corner.z < minZ) minZ = corner.z;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// The primary device's projected screen rect from the LAST composite render —
// the only moment its pivot carries the true on-screen scale/position (they're
// restored right after rendering). Consumers (rotate zones, drop targeting,
// hover hints in app.js) read this instead of re-projecting a stale transform.
let lastPrimaryDeviceRect = null;

// ---- Selected-device rim ---------------------------------------------------
// The selection indicator for devices is a thin rim that hugs the device's TRUE
// rendered silhouette (any rotation), not a bounding box. While compositing,
// each highlighted device expands its alpha silhouette into a ring which is
// accumulated here at export resolution; drawSelectionOverlay (app.js) blits it
// onto the overlay canvas — so it never leaks into exports, which read the main
// canvas. app.js decides the target via deviceHighlightTargetNow().
let deviceHighlightCanvas = null;
let _rimSilCanvas = null; // reused tinted-silhouette scratch

function _resetHighlightRim(w, h) {
    if (!deviceHighlightCanvas) deviceHighlightCanvas = document.createElement('canvas');
    if (deviceHighlightCanvas.width !== w || deviceHighlightCanvas.height !== h) {
        deviceHighlightCanvas.width = w;
        deviceHighlightCanvas.height = h;
    } else {
        deviceHighlightCanvas.getContext('2d').clearRect(0, 0, w, h);
    }
}

// Stamp `srcCanvas`'s silhouette as an accent-colored ring into the accumulator.
function _accumulateHighlightRim(srcCanvas, w, h) {
    if (!deviceHighlightCanvas || srcCanvas.width < 2) return;
    if (!_rimSilCanvas) _rimSilCanvas = document.createElement('canvas');
    if (_rimSilCanvas.width !== w || _rimSilCanvas.height !== h) {
        _rimSilCanvas.width = w;
        _rimSilCanvas.height = h;
    }
    const sctx = _rimSilCanvas.getContext('2d');
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(srcCanvas, 0, 0, w, h);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#3b82f6';
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';

    const ctx = deviceHighlightCanvas.getContext('2d');
    const r = Math.max(2, w * 0.0035); // rim thickness scales with resolution
    for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        ctx.drawImage(_rimSilCanvas, Math.cos(a) * r, Math.sin(a) * r);
    }
    // Knock the device's own interior back out, leaving only the outside ring.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(srcCanvas, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
}

// Reused offscreen canvas for the device's tinted silhouette — keeps allocations off
// the hot path.
let _shadowSilCanvas = null;

// Draw a TRUE drop shadow of the rendered 3D device: take the just-rendered phone (on
// a transparent background), tint every opaque pixel to the shadow colour to get the
// silhouette, then blur + offset it onto the target canvas. The shadow has the actual
// shape of whatever's on screen (closed/open MacBook, tilted phone, etc.) — simulated
// in 3D by the light-direction picker, drawn as a 2D drop shadow.
function drawDeviceDropShadow(ctx, sourceCanvas, rect, shadow) {
    if (!ctx || !sourceCanvas || !shadow || !shadow.enabled) return;
    const w = sourceCanvas.width, h = sourceCanvas.height;
    if (w < 2 || h < 2) return;

    const op = Math.max(0, Math.min(1, (shadow.opacity || 0) / 100));
    if (op <= 0.01) return;

    // Picker → screen-space light vector. Shadow falls OPPOSITE the light.
    const angle = ((typeof shadow.lightAngle === 'number') ? shadow.lightAngle : 40) * Math.PI / 180;
    const elev = (typeof shadow.lightElev === 'number') ? shadow.lightElev : 0.65;
    const sxDir = -Math.sin(angle);
    const syDir =  Math.cos(angle);

    // Offset distance scales with elev AND the device's footprint, so small devices
    // get small offsets and big ones get bigger — feels right at any scale.
    const refSize = rect ? Math.min(rect.w, rect.h) : Math.min(w, h) * 0.4;
    const offMag = elev * refSize * 0.42;
    const offX = sxDir * offMag;
    const offY = syDir * offMag;

    // Build the silhouette: draw the rendered phone, then `source-in` fill with the
    // shadow colour to recolour every opaque pixel while preserving the alpha shape.
    if (!_shadowSilCanvas || _shadowSilCanvas.width !== w || _shadowSilCanvas.height !== h) {
        _shadowSilCanvas = document.createElement('canvas');
        _shadowSilCanvas.width = w; _shadowSilCanvas.height = h;
    }
    const sctx = _shadowSilCanvas.getContext('2d');
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(sourceCanvas, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = shadow.color || '#000000';
    sctx.fillRect(0, 0, w, h);
    sctx.globalCompositeOperation = 'source-over';

    // Softness slider → blur radius in CSS pixels. Scaled with device size so a "soft"
    // setting reads the same across small and large compositions.
    const blurPx = Math.max(2, ((shadow.blur || 0) / 100) * refSize * 0.25);

    ctx.save();
    ctx.filter = `blur(${blurPx}px)`;
    ctx.globalAlpha = Math.min(0.9, op);
    ctx.drawImage(_shadowSilCanvas, offX, offY, w, h);
    ctx.restore();
}

function initThreeJS() {
    if (isThreeJSInitialized) return;

    const container = document.getElementById('threejs-container');
    if (!container) return;

    // Create scene with a gradient background color (we'll update this dynamically)
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x667eea); // Default gradient start color

    // Create camera
    const aspect = 400 / 700;
    threeCamera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
    threeCamera.position.set(0, 0, 6);

    // Create renderer - disable antialiasing for faster interactive performance
    // Quality rendering is done at export time with higher resolution
    threeRenderer = new THREE.WebGLRenderer({
        antialias: false,  // Disable for better performance
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
    });
    threeRenderer.setSize(400, 700);
    // Use device pixel ratio of 1 for fastest interactive rendering
    threeRenderer.setPixelRatio(1);
    threeRenderer.outputEncoding = THREE.sRGBEncoding;
    threeRenderer.toneMapping = THREE.NoToneMapping;
    // Disable automatic clearing - we control this manually
    threeRenderer.autoClear = false;
    // WebGL shadow mapping is disabled — the device shadow is rendered as a 2D
    // contact shadow on the target canvas (clean at any rotation, no plane artifacts).
    threeRenderer.shadowMap.enabled = false;

    container.appendChild(threeRenderer.domElement);

    // Environment: load a real HDR for proper high-dynamic-range reflections (gives
    // sharp specular highlights on the glass at grazing angles). Fall back to a
    // synthetic RoomEnvironment if the HDR fetch fails (offline, CORS, etc.).
    setupEnvironment();

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    threeScene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(2, 3, 4);
    threeScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-2, 1, 2);
    threeScene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, -2, -3);
    threeScene.add(rimLight);

    // Wall shadow: a dedicated shadow-casting light (intensity 0 so it doesn't
    // change the lighting/look) plus a transparent catcher plane behind the phone.
    // The catcher renders only the shadow, which composites onto the 2D backdrop,
    // making the phone look like it's sitting in front of a wall.
    setupWallShadow();

    // Add orbit controls (disabled - we use custom drag handling for better performance)
    // orbitControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    // orbitControls.enableDamping = true;
    // orbitControls.dampingFactor = 0.05;
    // orbitControls.enableZoom = false;
    // orbitControls.enablePan = false;
    // orbitControls.rotateSpeed = 0.5;
    // orbitControls.minPolarAngle = Math.PI / 4;
    // orbitControls.maxPolarAngle = Math.PI * 3 / 4;
    // orbitControls.minAzimuthAngle = -Math.PI / 3;
    // orbitControls.maxAzimuthAngle = Math.PI / 3;

    isThreeJSInitialized = true;

    // Load the phone model - check state for which device to use
    let deviceToLoad = 'iphone';
    if (typeof state !== 'undefined' && typeof getScreenshotSettings === 'function') {
        const ss = getScreenshotSettings();
        if (ss?.device3D) {
            deviceToLoad = ss.device3D;
        }
    }
    currentDeviceModel = deviceToLoad;
    loadPhoneModel();

    // Start animation loop
    animateThreeJS();
}

// Load the phone 3D model based on currentDeviceModel
function loadPhoneModel() {
    if (phoneModelLoading) return; // Prevent double loading
    phoneModelLoading = true;

    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const loader = new THREE.GLTFLoader();

    loader.load(
        config.modelPath,
        (gltf) => {
            phoneModelLoading = false;
            phoneModel = gltf.scene;

            // Center and scale the model. Box3.setFromObject can underreport on freshly-loaded
            // GLBs because nested matrices aren't propagated yet — do a forced matrix update
            // first, then a correction pass after scaling. Required for models like the Polyman
            // iPhone 15 Pro Max which has deeply nested transforms.
            phoneModel.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());

            phoneModel.position.sub(center);

            // Target world-space max dim of 3.75. Some GLBs (e.g. Polyman iPhone) have nested
            // transforms that confuse Box3 — they get a scaleMultiplier in deviceConfigs to correct.
            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 3.75 / maxDim;
            const cfgMult = (deviceConfigs[currentDeviceModel] || deviceConfigs.iphone).scaleMultiplier;
            if (typeof cfgMult === 'number') baseModelScale *= cfgMult;
            phoneModel.scale.setScalar(baseModelScale);

            // Re-centre after final scale
            phoneModel.updateMatrixWorld(true);
            const box3 = new THREE.Box3().setFromObject(phoneModel);
            const center3 = box3.getCenter(new THREE.Vector3());
            phoneModel.position.sub(center3);

            // Log all meshes to help identify the screen
            console.log('Phone model meshes:');
            let blackMeshes = [];
            phoneModel.traverse((child) => {
                if (child.isMesh) {
                    console.log('  Mesh:', child.name, '| Material:', child.material?.name);

                    // Look for screen mesh - in this model it's likely "black" material
                    const name = (child.name || '').toLowerCase();
                    const matName = (child.material?.name || '').toLowerCase();

                    if (matName === 'black') {
                        blackMeshes.push(child);
                    }

                    if (name.includes('screen') || name.includes('display') ||
                        matName.includes('screen') || matName.includes('display') ||
                        matName.includes('emission') || matName.includes('emissive')) {
                        screenMesh = child;
                        console.log('  -> Identified as screen mesh');
                    }
                }
            });

            // Find the front glass - that's where the screen actually is
            // Don't use black meshes, those are small elements like notch/dynamic island
            let glassMeshes = [];
            phoneModel.traverse((child) => {
                if (child.isMesh) {
                    const matName = (child.material?.name || '').toLowerCase();
                    if (matName === 'glass') {
                        child.geometry.computeBoundingBox();
                        const box = child.geometry.boundingBox;
                        const size = new THREE.Vector3();
                        box.getSize(size);
                        const area = size.x * size.y;
                        glassMeshes.push({ mesh: child, area, size });
                        console.log('  Glass mesh:', child.name, 'size:', size.x.toFixed(3), 'x', size.y.toFixed(3), 'area:', area.toFixed(3));
                    }
                }
            });

            // Use the largest glass mesh (front screen glass)
            if (glassMeshes.length > 0) {
                glassMeshes.sort((a, b) => b.area - a.area);
                screenMesh = glassMeshes[0].mesh;
                console.log('  -> Using largest glass mesh as screen:', screenMesh.name);
            }

            // Create a pivot group for rotation around screen center
            const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
            const screenOffset = config.screenOffset;

            phonePivot = new THREE.Group();
            // YXZ = turntable order (turn first, then tilt). With the default XYZ
            // order a combined tilt+turn skews the device off its visual axes.
            phonePivot.rotation.order = 'YXZ';

            if (typeof config.bakedYRotation === 'number') {
                phoneModel.rotation.y = config.bakedYRotation * Math.PI / 180;
            }

            if (config.centerOnGeometry) {
                // Keep the loader's geometric recenter (model bounds centered on the
                // pivot origin) so the device is framed centered and rotates about its
                // own center — used for the MacBook, whose model origin isn't its center.
            } else if (config.skipPivotShift) {
                phoneModel.position.set(0, 0, 0);
            } else {
                phoneModel.position.set(
                    -screenOffset.x * baseModelScale,
                    -screenOffset.y * baseModelScale,
                    -screenOffset.z * baseModelScale
                );
            }

            phonePivot.add(phoneModel);
            threeScene.add(phonePivot);

            // Create a custom screen plane overlay since the model's UV mapping may be incorrect
            createScreenOverlay();

            phoneModelLoaded = true;

            // Apply initial settings from state
            if (typeof state !== 'undefined') {
                updateThreeJSBackground();
                const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
                const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
                setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);

                // Apply frame color
                if (ss?.frameColor) {
                    setPhoneFrameColor(ss.frameColor, currentDeviceModel);
                }

                // Apply screenshot texture
                if (state.screenshots.length > 0) {
                    updateScreenTexture();
                }

                // Refresh canvas now that model is loaded (needed for side previews too)
                if (typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            }

            console.log('Phone model loaded successfully');
        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading phone model... ' + percent + '%');
        },
        (error) => {
            console.error('Error loading phone model:', error);
        }
    );
}

// Switch to a different phone model
function switchPhoneModel(deviceType) {
    if (!deviceConfigs[deviceType]) {
        console.error('Unknown device type:', deviceType);
        return;
    }

    // Skip if same device and already loaded or loading
    if (currentDeviceModel === deviceType && (phoneModelLoaded || phoneModelLoading)) {
        return;
    }

    // Update current device type
    currentDeviceModel = deviceType;
    phoneModelLoading = false; // Reset so we can load the new one

    // Remove current pivot (which contains the model) from scene
    if (phonePivot && threeScene) {
        threeScene.remove(phonePivot);
        phonePivot.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                child.material?.dispose();
            }
        });
        phonePivot = null;
        phoneModel = null;
    }

    // Clean up screen plane
    if (customScreenPlane) {
        if (customScreenPlane.parent) {
            customScreenPlane.parent.remove(customScreenPlane);
        }
        customScreenPlane.geometry?.dispose();
        customScreenPlane.material?.dispose();
        customScreenPlane = null;
    }

    screenMesh = null;
    phoneModelLoaded = false;

    // Load new model using the config
    const config = deviceConfigs[currentDeviceModel];
    const loader = new THREE.GLTFLoader();

    loader.load(
        config.modelPath,
        (gltf) => {
            phoneModel = gltf.scene;

            // Center and scale. Per-config scaleMultiplier corrects models whose autoscale
            // lands wrong (e.g. Polyman iPhone GLB with nested transforms).
            phoneModel.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(phoneModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            phoneModel.position.sub(center);

            const maxDim = Math.max(size.x, size.y, size.z);
            baseModelScale = 3.75 / maxDim;
            if (typeof config.scaleMultiplier === 'number') baseModelScale *= config.scaleMultiplier;
            phoneModel.scale.setScalar(baseModelScale);

            phoneModel.updateMatrixWorld(true);
            const box3 = new THREE.Box3().setFromObject(phoneModel);
            const center3 = box3.getCenter(new THREE.Vector3());
            phoneModel.position.sub(center3);

            // Create a pivot group for rotation around screen center
            const screenOffset = config.screenOffset;
            phonePivot = new THREE.Group();
            phonePivot.rotation.order = 'YXZ'; // turntable order — see loadPhoneModel

            if (typeof config.bakedYRotation === 'number') {
                phoneModel.rotation.y = config.bakedYRotation * Math.PI / 180;
            }

            if (config.skipPivotShift) {
                phoneModel.position.set(0, 0, 0);
            } else {
                phoneModel.position.set(
                    -screenOffset.x * baseModelScale,
                    -screenOffset.y * baseModelScale,
                    -screenOffset.z * baseModelScale
                );
            }

            phonePivot.add(phoneModel);
            threeScene.add(phonePivot);

            // Create screen overlay for this device
            createScreenOverlay();

            phoneModelLoaded = true;

            // Apply settings
            if (typeof state !== 'undefined') {
                updateThreeJSBackground();
                const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
                const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
                setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);

                // Apply frame color
                if (ss?.frameColor) {
                    setPhoneFrameColor(ss.frameColor, currentDeviceModel);
                }

                if (state.screenshots.length > 0) {
                    updateScreenTexture();
                }

                // Only call updateCanvas if not suppressed (e.g., during slide transitions)
                if (typeof updateCanvas === 'function' && !window.suppressSwitchModelUpdate) {
                    updateCanvas();
                }
            }

            console.log(deviceType + ' model loaded successfully');
        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading ' + deviceType + ' model... ' + percent + '%');
        },
        (error) => {
            console.error('Error loading ' + deviceType + ' model:', error);
        }
    );
}

// Load a phone model into the cache (for side preview rendering with different devices)
function loadCachedPhoneModel(deviceType) {
    if (!deviceConfigs[deviceType]) return Promise.reject('Unknown device type');

    // Already loaded or loading
    if (phoneModelCache[deviceType]?.loaded) {
        return Promise.resolve(phoneModelCache[deviceType]);
    }
    if (phoneModelCache[deviceType]?.loading) {
        return phoneModelCache[deviceType].loadingPromise;
    }

    const config = deviceConfigs[deviceType];
    const loader = new THREE.GLTFLoader();

    phoneModelCache[deviceType] = { loading: true, loaded: false };

    phoneModelCache[deviceType].loadingPromise = new Promise((resolve, reject) => {
        loader.load(
            config.modelPath,
            (gltf) => {
                const model = gltf.scene;

                // Center and scale (per-config scaleMultiplier; see loadPhoneModel).
                model.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(model);
                const center = box.getCenter(new THREE.Vector3());
                const size = box.getSize(new THREE.Vector3());
                model.position.sub(center);

                const maxDim = Math.max(size.x, size.y, size.z);
                let modelBaseScale = 3.75 / maxDim;
                if (typeof config.scaleMultiplier === 'number') modelBaseScale *= config.scaleMultiplier;
                model.scale.setScalar(modelBaseScale);

                model.updateMatrixWorld(true);
                const box3 = new THREE.Box3().setFromObject(model);
                const center3 = box3.getCenter(new THREE.Vector3());
                model.position.sub(center3);

                // Create pivot for this model
                const screenOffset = config.screenOffset;
                const pivot = new THREE.Group();
                pivot.rotation.order = 'YXZ'; // turntable order — see loadPhoneModel

                // Mirror loadPhoneModel's orientation EXACTLY so cached models (used for
                // side previews of a device other than the active one) face the same way
                // as the active model. Without bakedYRotation the HD iPhone renders its
                // back in side previews.
                if (typeof config.bakedYRotation === 'number') {
                    model.rotation.y = config.bakedYRotation * Math.PI / 180;
                }
                if (config.centerOnGeometry) {
                    // Keep the loader's geometric recenter (e.g. MacBook).
                } else if (config.skipPivotShift) {
                    model.position.set(0, 0, 0);
                } else {
                    // Shift so the screen sits at the pivot origin.
                    model.position.set(
                        -screenOffset.x * modelBaseScale,
                        -screenOffset.y * modelBaseScale,
                        -screenOffset.z * modelBaseScale
                    );
                }

                pivot.add(model);

                // Create an overlay screen plane ONLY for models that need one. Models
                // with useExistingScreenMesh (HD iPhone, MacBook) render onto their own
                // built-in screen mesh, so a plane here is both unused and — lacking
                // screenHeightFactor — produces a NaN-sized geometry (THREE warning).
                let screenPlane = null;
                if (!config.useExistingScreenMesh && typeof config.screenHeightFactor === 'number') {
                    const aspectRatio = config.aspectRatio;
                    const planeHeight = 4.3 * config.screenHeightFactor;
                    const planeWidth = planeHeight * aspectRatio;

                    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
                    const material = new THREE.MeshBasicMaterial({
                        color: 0x111111,
                        side: THREE.DoubleSide
                    });

                    screenPlane = new THREE.Mesh(geometry, material);
                    screenPlane.position.set(screenOffset.x, screenOffset.y, screenOffset.z);

                    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
                    screenPlane.rotation.set(
                        -modelRot.x * Math.PI / 180,
                        -modelRot.y * Math.PI / 180,
                        -modelRot.z * Math.PI / 180
                    );

                    model.add(screenPlane);
                }

                // For useExistingScreenMesh devices, bind the cached model's own screen
                // mesh so side previews can texture it per-screenshot (parallels the
                // active model's existingScreenMesh).
                const cachedScreenMesh = config.useExistingScreenMesh ? findAndPrepScreenMesh(model, config) : null;

                phoneModelCache[deviceType] = {
                    model: model,
                    pivot: pivot,
                    screenPlane: screenPlane,
                    screenMesh: cachedScreenMesh,
                    baseScale: modelBaseScale,
                    loaded: true,
                    loading: false
                };

                console.log('Cached ' + deviceType + ' model for side previews');
                resolve(phoneModelCache[deviceType]);
            },
            undefined,
            (error) => {
                console.error('Error loading cached ' + deviceType + ' model:', error);
                phoneModelCache[deviceType] = { loading: false, loaded: false };
                reject(error);
            }
        );
    });

    return phoneModelCache[deviceType].loadingPromise;
}

// Preload all device models for side previews
function preloadAllPhoneModels() {
    const deviceTypes = Object.keys(deviceConfigs);
    return Promise.all(deviceTypes.map(type => loadCachedPhoneModel(type).catch(() => null)));
}

// Available HDR environments. Keys must match the dropdown <option value="..."> in HTML.
// Files are pulled from polyhaven via CORS-friendly jsdelivr mirror of their CDN.
const HDR_LIBRARY = {
    royal_esplanade_1k:    'https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/textures/equirectangular/royal_esplanade_1k.hdr',
    venice_sunset_1k:      'https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/textures/equirectangular/venice_sunset_1k.hdr',
    quarry_01_1k:          'https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/textures/equirectangular/quarry_01_1k.hdr',
    studio_small_03_1k:    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_03_1k.hdr',
    spruit_sunrise_1k:     'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/spruit_sunrise_1k.hdr',
    pedestrian_overpass_1k:'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/pedestrian_overpass_1k.hdr'
};
let currentEnvKey = 'royal_esplanade_1k';
const _hdrCache = {};  // key → PMREM texture, so re-selecting is instant

function setupEnvironment(key) {
    if (!key) key = currentEnvKey;
    currentEnvKey = key;

    const applyEnv = (envTexture) => {
        threeScene.environment = envTexture;
        requestThreeJSRender();
        if (typeof updateCanvas === 'function') updateCanvas();
    };

    // Cache hit
    if (_hdrCache[key]) {
        applyEnv(_hdrCache[key]);
        return;
    }

    const pmrem = new THREE.PMREMGenerator(threeRenderer);
    pmrem.compileEquirectangularShader();

    // 'room' = synthetic RoomEnvironment (no network), the rest are HDR fetches.
    if (key === 'room' || !HDR_LIBRARY[key]) {
        if (typeof THREE.RoomEnvironment === 'function') {
            const envRT = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04);
            _hdrCache[key] = envRT.texture;
            applyEnv(envRT.texture);
        }
        pmrem.dispose();
        return;
    }

    if (typeof THREE.RGBELoader !== 'function') {
        console.warn('RGBELoader not available');
        pmrem.dispose();
        return;
    }

    new THREE.RGBELoader()
        .setDataType(THREE.HalfFloatType)
        .load(HDR_LIBRARY[key], (hdrTex) => {
            hdrTex.mapping = THREE.EquirectangularReflectionMapping;
            const envRT = pmrem.fromEquirectangular(hdrTex);
            _hdrCache[key] = envRT.texture;
            applyEnv(envRT.texture);
            hdrTex.dispose();
            pmrem.dispose();
            console.log('HDR loaded:', key);
        }, undefined, (err) => {
            console.warn('HDR load failed:', key, err);
            pmrem.dispose();
            // Fallback to room
            if (typeof THREE.RoomEnvironment === 'function') {
                const pm2 = new THREE.PMREMGenerator(threeRenderer);
                const envRT = pm2.fromScene(new THREE.RoomEnvironment(), 0.04);
                _hdrCache[key] = envRT.texture;
                applyEnv(envRT.texture);
                pm2.dispose();
            }
        });
}

// Find the model's built-in screen mesh and store a reference for later texture swaps.
// Strategy: identify by PBR signature — screens in well-authored phone models are emissive
// (so the wallpaper "glows") and have roughness near 0 (display surface).
// Also optionally strips problematic back-panel normal maps (r128 GLTFLoader doesn't
// support UV channel 1, which Polyman uses for the back-panel normals).
// Locate a model's built-in screen mesh (works for the active model OR a cached one,
// so side previews can texture cached models too) and prep its material. Returns the
// mesh or null.
function findAndPrepScreenMesh(model, config) {
    if (!model) return null;
    model.updateMatrixWorld(true);
    const roughnessMax = config.screenRoughnessMax || 0.05;
    const candidates = [];
    model.traverse((child) => {
        if (!child.isMesh || !child.material) return;
        const mat = child.material;
        if (!mat.emissiveMap) return;                       // screens carry the wallpaper as emissive
        if (typeof mat.roughness !== 'number' || mat.roughness > roughnessMax) return;
        const box = new THREE.Box3().setFromObject(child);
        const size = box.getSize(new THREE.Vector3());
        candidates.push({ mesh: child, maxZ: box.max.z, area: size.x * size.y });
    });
    // Largest near the front face
    candidates.sort((a, b) => b.maxZ - a.maxZ || b.area - a.area);
    if (candidates.length === 0) {
        console.warn('No screen mesh found in model — falling back to overlay plane');
        return null;
    }
    const mesh = candidates[0].mesh;
    // Boost emissive so the texture displays at full brightness (otherwise it's only
    // visible under direct lighting and looks dim).
    mesh.material.emissive = new THREE.Color(0xffffff);
    mesh.material.emissiveIntensity = 1;

    if (config.stripBackNormalMaps) {
        const frontMaxZ = candidates[0].maxZ;
        model.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const m = child.material;
            // GLB's PBR maps use UV channel 1 which r128 GLTFLoader silently maps to UV0,
            // producing visible noise/sparkle on the back panel. Strip ALL of these maps
            // (normal/metalness/roughness/AO) — not just normalMap — from back-facing meshes.
            if (!(m.normalMap || m.metalnessMap || m.roughnessMap || m.aoMap)) return;
            const childBox = new THREE.Box3().setFromObject(child);
            if (childBox.max.z < frontMaxZ - 0.05) {
                m.normalMap = null;
                m.metalnessMap = null;
                m.roughnessMap = null;
                m.aoMap = null;
                // Without metalness/roughness maps the values fall back to scalar — pick
                // ones that look like real titanium: moderately metallic, slightly satin.
                m.metalness = 0.7;
                m.roughness = 0.35;
                m.needsUpdate = true;
            }
        });
    }

    // No separate transparent-glass tweak. The screen mesh's own MeshStandardMaterial
    // (emissive=video + metalness=1 + low roughness) provides BOTH video display and
    // HDR reflections in one surface.
    mesh.renderOrder = 0;
    return mesh;
}

function bindExistingScreenMesh() {
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    existingScreenMesh = findAndPrepScreenMesh(phoneModel, config);
    if (existingScreenMesh) console.log('Bound screen mesh:', existingScreenMesh.name);
}

// Create a custom screen plane overlay with correct UV mapping
function createScreenOverlay() {
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;

    // When the device config says to use the model's built-in screen mesh, locate it
    // here and bail out — no overlay plane needed; updateScreenTexture() will write
    // the user's screenshot/video texture directly into the model's screen material.
    if (config.useExistingScreenMesh) {
        // Dispose any previously created overlay (if we're hot-switching device types)
        if (customScreenPlane) {
            if (customScreenPlane.parent) customScreenPlane.parent.remove(customScreenPlane);
            customScreenPlane.geometry.dispose();
            customScreenPlane.material.dispose();
            customScreenPlane = null;
        }
        bindExistingScreenMesh();
        return;
    }

    // Overlay path: clear any screen mesh bound by a previous device (e.g. switching
    // from the MacBook back to the iPhone). Otherwise updateScreenTexture() would take
    // the "existing mesh" fast path and texture the wrong (stale) mesh, leaving this
    // device's overlay plane at its grey default.
    existingScreenMesh = null;

    if (customScreenPlane) {
        if (customScreenPlane.parent) {
            customScreenPlane.parent.remove(customScreenPlane);
        }
        customScreenPlane.geometry.dispose();
        customScreenPlane.material.dispose();
    }

    const aspectRatio = config.aspectRatio;

    // Plane size: legacy formula assumed every model lands at the same world height
    // (~5.2 units). That's true for MajdyModels but not Polyman. If `useBodyBounds`
    // is set on the config, size the plane to ACTUAL model bounds so the screen
    // sits inside the body bezel, not over it.
    let planeHeight, planeWidth;
    if (config.useBodyBounds) {
        phoneModel.updateMatrixWorld(true);
        const bodyBox = new THREE.Box3().setFromObject(phoneModel);
        // The screen overlay itself may have been added previously and counted in the
        // box — but we just disposed it above, so phoneModel only contains body meshes.
        const bodyHeight = bodyBox.getSize(new THREE.Vector3()).y;
        // screenHeightFactor is now the fraction of body height the screen occupies
        // (e.g. 0.95 = small uniform bezel). Divided by baseModelScale because the
        // plane is added as a child of phoneModel (which is scaled by baseModelScale)
        // so the geometry value must be in pre-scale local units.
        planeHeight = (bodyHeight * config.screenHeightFactor) / baseModelScale;
        planeWidth = planeHeight * aspectRatio;
    } else {
        planeHeight = 4.3 * config.screenHeightFactor;
        planeWidth = planeHeight * aspectRatio;
    }

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: THREE.DoubleSide
    });

    customScreenPlane = new THREE.Mesh(geometry, material);

    // Position: legacy path uses screenOffset directly. When useBodyBounds is on, we
    // compute the local-Z that lands the overlay just past the body's front face in
    // world coords. Combined with bakedYRotation=180, that puts the screen on the
    // camera-facing side automatically — no manual screenOffset tuning needed.
    const screenOffset = config.screenOffset;
    let localX = screenOffset.x, localY = screenOffset.y, localZ = screenOffset.z;
    if (config.useBodyBounds) {
        phoneModel.updateMatrixWorld(true);
        const bodyBox = new THREE.Box3().setFromObject(phoneModel);
        const frontFaceWorldZ = bodyBox.max.z;
        const insetWorld = 0.005;
        const overlayWorldZ = frontFaceWorldZ - insetWorld;
        localZ = overlayWorldZ / baseModelScale;
    }
    customScreenPlane.position.set(localX, localY, localZ);

    // Counter-rotate the screen to cancel out the model's base rotation
    // This keeps the screen facing forward when the pivot applies the base rotation
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    // Also counter the baked rotation so the overlay's normal faces the camera.
    const bakedY = (config.bakedYRotation || 0) * Math.PI / 180;
    customScreenPlane.rotation.set(
        -modelRot.x * Math.PI / 180,
        -modelRot.y * Math.PI / 180 - bakedY,
        -modelRot.z * Math.PI / 180
    );

    // Add directly to phoneModel so it moves with it
    phoneModel.add(customScreenPlane);

    // basePositionOffset is no longer needed since we use pivot-based rotation
    basePositionOffset.y = 0;

    console.log('Created screen overlay for ' + currentDeviceModel + ' at:', customScreenPlane.position);
    console.log('Plane size:', planeWidth.toFixed(4), 'x', planeHeight.toFixed(4));
}

// Create a rounded corner version of the screenshot
function createRoundedScreenImage(image, cornerRadius) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');

    // Draw rounded rectangle path
    const w = canvas.width;
    const h = canvas.height;
    const r = cornerRadius;

    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();

    // Clip to rounded rectangle and draw image
    ctx.clip();
    ctx.drawImage(image, 0, 0);

    return canvas;
}

// Per-frame updater set when current screenshot is a video. Cleared otherwise.
// Called from requestThreeJSRender right before the scene render so the rounded
// video frame is re-rasterized once per frame without redoing texture setup.
let _videoTextureUpdater = null;

// Update the screen texture with current screenshot
// Build a neutral light "drop your screenshot here" screen used when a 3D frame
// has no uploaded image yet (e.g. a freshly applied template set), so the device
// shows a clean placeholder display instead of the model's default dark screen.
function _buildPlaceholderScreenCanvasRaw(aspectOverride) {
    // Size to the active device's screen aspect so a landscape device (MacBook)
    // gets a landscape placeholder rather than a stretched portrait one.
    const cfg = (typeof deviceConfigs === 'object' && deviceConfigs[currentDeviceModel]) || null;
    const aspect = (typeof aspectOverride === 'number' && aspectOverride > 0)
        ? aspectOverride
        : (cfg && cfg.aspectRatio ? cfg.aspectRatio : (1290 / 2796)); // w/h
    let w, h;
    if (aspect >= 1) { w = 2400; h = Math.round(w / aspect); }
    else { h = 2796; w = Math.round(h * aspect); }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f7f9fc');
    g.addColorStop(1, '#e2e7ef');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);

    const hint = 'rgba(70,82,104,0.40)';
    const glyphBase = Math.min(w, h);
    const gw = glyphBase * 0.30, gh = gw * 0.78, gx = (w - gw) / 2, gy = h * 0.36;
    x.strokeStyle = hint;
    x.lineWidth = glyphBase * 0.012;
    x.beginPath(); x.roundRect(gx, gy, gw, gh, gw * 0.08); x.stroke();
    x.beginPath();
    x.moveTo(gx + gw * 0.12, gy + gh * 0.80);
    x.lineTo(gx + gw * 0.42, gy + gh * 0.46);
    x.lineTo(gx + gw * 0.60, gy + gh * 0.66);
    x.lineTo(gx + gw * 0.80, gy + gh * 0.38);
    x.lineTo(gx + gw * 0.90, gy + gh * 0.52);
    x.stroke();
    x.fillStyle = hint;
    x.beginPath(); x.arc(gx + gw * 0.30, gy + gh * 0.32, gw * 0.07, 0, Math.PI * 2); x.fill();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `600 ${Math.round(glyphBase * 0.052)}px -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif`;
    x.fillText('Your screenshot', w / 2, gy + gh + glyphBase * 0.05);
    return c;
}

// Memoized by screen aspect — the placeholder is identical for a given aspect, and
// reusing one canvas lets getScreenEmissiveTexture cache its texture (so blank side
// previews don't rebuild a texture every frame during playback).
const _placeholderCanvasByAspect = {};
function buildPlaceholderScreenCanvas() {
    const cfg = (typeof deviceConfigs === 'object' && deviceConfigs[currentDeviceModel]) || null;
    const aspect = cfg && cfg.aspectRatio ? cfg.aspectRatio : (1290 / 2796);
    const key = aspect.toFixed(4);
    if (!_placeholderCanvasByAspect[key]) {
        _placeholderCanvasByAspect[key] = _buildPlaceholderScreenCanvasRaw(aspect);
    }
    return _placeholderCanvasByAspect[key];
}

// Per-image THREE.Texture cache for side-preview screen meshes. Keyed (WeakMap) by the
// source image/video/canvas element so a texture is built once and reused every frame —
// keeping side-preview rendering cheap during playback. Video entries refresh the
// current frame on each call.
const _screenTexCache = new WeakMap();
function getScreenEmissiveTexture(image) {
    if (!image) return null;
    const isVideo = image.tagName === 'VIDEO';
    let entry = _screenTexCache.get(image);
    if (!entry) {
        const w = Math.max(1, isVideo ? (image.videoWidth || image.width || 1290) : (image.width || 1290));
        const h = Math.max(1, isVideo ? (image.videoHeight || image.height || 2796) : (image.height || 2796));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const tex = new THREE.Texture(canvas);
        tex.encoding = THREE.sRGBEncoding;
        tex.flipY = true;
        entry = { tex, canvas, isVideo };
        _screenTexCache.set(image, entry);
        try { canvas.getContext('2d').drawImage(image, 0, 0, w, h); } catch (e) { /* not decoded yet */ }
        tex.needsUpdate = true;
    } else if (isVideo && image.readyState >= 2) {
        // Refresh the current video frame for the preview.
        try { entry.canvas.getContext('2d').drawImage(image, 0, 0, entry.canvas.width, entry.canvas.height); entry.tex.needsUpdate = true; } catch (e) {}
    }
    return entry.tex;
}

function updateScreenTexture() {
    if (!phoneModel) return;
    if (typeof state === 'undefined' || !state.screenshots.length) return;

    const screenshot = state.screenshots[state.selectedIndex];
    if (!screenshot) return;
    // Use getScreenshotImage() for localized image support
    let screenshotImage = typeof getScreenshotImage === 'function'
        ? getScreenshotImage(screenshot)
        : screenshot?.image;
    if (!screenshotImage) {
        // No uploaded image (blank 3D template frame): show a neutral placeholder
        // screen so the device doesn't render as a dark "off" display.
        screenshotImage = buildPlaceholderScreenCanvas();
    }

    const isVideo = screenshotImage.tagName === 'VIDEO';

    // Fast path: write directly to the model's existing screen mesh material.
    // Use the source image/video as-is (the model's UV maps it onto the screen area
    // already, and the model's own glass mesh renders on top for reflections).
    if (existingScreenMesh) {
        if (screenTexture) screenTexture.dispose();
        // Use a 2D canvas as the texture source, blit the image/video into it each
        // frame. THREE.VideoTexture has been unreliable in r128 with some H.264 streams
        // — the texture exists but never uploads frames. The canvas approach always works.
        const srcW = isVideo ? screenshotImage.videoWidth : screenshotImage.width;
        const srcH = isVideo ? screenshotImage.videoHeight : screenshotImage.height;
        const off = document.createElement('canvas');
        off.width = srcW;
        off.height = srcH;
        const offCtx = off.getContext('2d');
        if (!isVideo) {
            offCtx.drawImage(screenshotImage, 0, 0, srcW, srcH);
        }
        screenTexture = new THREE.Texture(off);
        screenTexture.encoding = THREE.sRGBEncoding;
        screenTexture.flipY = true;
        screenTexture.needsUpdate = true;

        const mat = existingScreenMesh.material;
        // MeshStandardMaterial so the screen has BOTH an emissive video layer (glows at
        // full brightness regardless of lighting) AND a glass-like reflective layer (env
        // map sampled via metalness/roughness). The video shows through; the HDR
        // reflections add on top — same surface, both behaviors.
        const fresh = new THREE.MeshStandardMaterial({
            emissiveMap: screenTexture,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: 1,
            color: 0x000000,            // black base so non-emissive diffuse doesn't tint the video
            metalness: 1,               // fully metallic = env map dominates the specular term
            roughness: 0.06,            // not perfect mirror — slight haze, like real OLED glass
            envMapIntensity: 1.3,       // reflections visible but don't wash out video
            side: THREE.DoubleSide,
            transparent: false,
            toneMapped: false
        });
        if (mat && mat !== fresh && mat.userData && mat.userData._shotsCraftReplaced) {
            mat.dispose();
        }
        fresh.userData._shotsCraftReplaced = true;
        existingScreenMesh.material = fresh;
        console.log('Screen texture applied:', isVideo ? 'video' : 'image', 'size:', `${srcW}x${srcH}`);

        if (isVideo) {
            _videoTextureUpdater = () => {
                if (screenshotImage.readyState < 2) return;
                offCtx.drawImage(screenshotImage, 0, 0, srcW, srcH);
                screenTexture.needsUpdate = true;
            };
        } else {
            _videoTextureUpdater = null;
        }
        requestThreeJSRender();
        return;
    }

    // Create texture from screenshot
    if (screenTexture) {
        screenTexture.dispose();
    }

    // Create rounded corner version of the image using device-specific corner radius
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const srcW = isVideo ? screenshotImage.videoWidth : screenshotImage.width;
    const cornerRadius = Math.round(srcW * config.cornerRadiusFactor);
    const roundedImage = createRoundedScreenImage(screenshotImage, cornerRadius);

    screenTexture = new THREE.Texture(roundedImage);
    screenTexture.needsUpdate = true;
    screenTexture.encoding = THREE.sRGBEncoding;
    screenTexture.flipY = true;

    if (isVideo) {
        // Reuse the same offscreen canvas + texture across frames; just redraw the
        // current video frame inside the rounded mask each tick. Cheaper than rebuilding
        // the texture, and keeps GPU upload to one canvas-texture sync per frame.
        const roundedCtx = roundedImage.getContext('2d');
        const w = roundedImage.width, h = roundedImage.height, r = cornerRadius;
        _videoTextureUpdater = () => {
            if (screenshotImage.readyState < 2) return; // not enough data yet
            roundedCtx.save();
            roundedCtx.clearRect(0, 0, w, h);
            roundedCtx.beginPath();
            roundedCtx.moveTo(r, 0);
            roundedCtx.lineTo(w - r, 0);
            roundedCtx.quadraticCurveTo(w, 0, w, r);
            roundedCtx.lineTo(w, h - r);
            roundedCtx.quadraticCurveTo(w, h, w - r, h);
            roundedCtx.lineTo(r, h);
            roundedCtx.quadraticCurveTo(0, h, 0, h - r);
            roundedCtx.lineTo(0, r);
            roundedCtx.quadraticCurveTo(0, 0, r, 0);
            roundedCtx.closePath();
            roundedCtx.clip();
            roundedCtx.drawImage(screenshotImage, 0, 0, w, h);
            roundedCtx.restore();
            screenTexture.needsUpdate = true;
        };
    } else {
        _videoTextureUpdater = null;
    }

    // Create a material for the screen with transparency for rounded corners
    const screenMaterial = new THREE.MeshBasicMaterial({
        map: screenTexture,
        side: THREE.FrontSide,
        transparent: true
    });

    // Apply to custom screen plane (preferred)
    if (customScreenPlane) {
        customScreenPlane.material.dispose();
        customScreenPlane.material = screenMaterial;
        console.log('Applied rounded texture to custom screen plane');
    }

    // Trigger render update
    requestThreeJSRender();
}

// Set 3D rotation from sliders (in degrees)
function setThreeJSRotation(rotX, rotY, rotZ) {
    if (!phonePivot) return;

    // Add the device's base model rotation to the user's rotation
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };

    // Rotate the pivot (which rotates around the screen center)
    phonePivot.rotation.x = (rotX + modelRot.x) * Math.PI / 180;
    phonePivot.rotation.y = (rotY + modelRot.y) * Math.PI / 180;
    phonePivot.rotation.z = (rotZ + modelRot.z) * Math.PI / 180;

    // Trigger render update
    requestThreeJSRender();
}

// Set 3D scale
function setThreeJSScale(scale) {
    if (!phoneModel) return;

    phoneModel.scale.setScalar(baseModelScale * (scale / 100));

    // Trigger render update
    requestThreeJSRender();
}

// Render on demand instead of continuous animation loop
let renderRequested = false;

function requestThreeJSRender() {
    if (renderRequested) return;
    renderRequested = true;
    requestAnimationFrame(() => {
        renderRequested = false;
        if (_videoTextureUpdater) _videoTextureUpdater();
        if (threeRenderer && threeScene && threeCamera) {
            applyShadowCasting(phonePivot);
            threeRenderer.clear();
            threeRenderer.render(threeScene, threeCamera);
        }
    });
}

// Legacy function name for compatibility - now triggers on-demand render
function animateThreeJS() {
    requestThreeJSRender();
}

// How far (in world units) the device may travel from center for position 0↔100.
// A fixed fraction of the visible half-extent at the device plane — scale-independent
// so positioning is consistent at any zoom. Assumes threeCamera.position.z is already
// set to the active device's distance.
const POSITION_RANGE_FACTOR = 0.85;
function positionRange(dims) {
    const halfVisH = Math.tan((threeCamera.fov / 2) * Math.PI / 180) * threeCamera.position.z;
    const halfVisW = halfVisH * (dims.width / dims.height);
    return { x: halfVisW * POSITION_RANGE_FACTOR, y: halfVisH * POSITION_RANGE_FACTOR };
}

// Render 3D phone only (with transparent background) to be composited
function renderThreeJSToCanvas(targetCanvas, width, height) {
    if (!threeRenderer || !threeScene || !threeCamera || !phonePivot) return;

    applyShadowCasting(phonePivot);
    const dims = { width: width || 1290, height: height || 2796 };

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = phonePivot.position.clone();
    const originalScale = phonePivot.scale.clone();
    const originalRotation = phonePivot.rotation.clone();

    // Apply position, scale, and rotation from screenshot settings
    if (typeof state !== 'undefined') {
        // Use getScreenshotSettings() helper if available, otherwise fall back to defaults
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        if (ss) {
            // Scale: use screenshot.scale to adjust model size. Landscape devices (e.g.
            // MacBook) are sized to the canvas WIDTH so the same scale% fills a consistent
            // fraction of the frame in any aspect — otherwise a fixed world size looks huge
            // in a portrait canvas and tiny in a landscape one.
            const normScale = ss.scale / 100;            // 0–1, used for the position math
            const cfgScale = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
            let visualScale = normScale;
            // Camera distance per device: pull back for a deep laptop so perspective
            // foreshortening is mild and scaling reads as a clean, uniform zoom.
            threeCamera.position.z = cfgScale.cameraDistance || 6;
            if (cfgScale.isLandscape) {
                // Size to fill a fraction of canvas WIDTH (consistent across aspects AND
                // camera distance), so the camera pull-back doesn't change the laptop size.
                const aspect = dims.width / dims.height;
                const halfFovTan = Math.tan((threeCamera.fov / 2) * Math.PI / 180);
                const fillFrac = (cfgScale.widthFillFactor || 0.6) * normScale;
                visualScale = fillFrac * (2 * halfFovTan * threeCamera.position.z * aspect) / 3.75;
            }
            phonePivot.scale.setScalar(visualScale);

            // Position range = a fixed fraction of the visible extent at the device plane,
            // independent of scale. Scale-independent so the device scales in place (no
            // drift) AND the sliders move it meaningfully across the whole frame (0 → left/
            // top edge area, 50 → center, 100 → right/bottom edge area; the slider's
            // extended ±range pushes it off-frame).
            const { x: availableSpaceX, y: availableSpaceY } = positionRange(dims);
            const xOffset = ((ss.x - 50) / 50) * availableSpaceX;
            const yOffset = -((ss.y - 50) / 50) * availableSpaceY; // Inverted for 3D
            // Optional framing nudge (world units), e.g. to center a model whose bounding
            // box center isn't its visual center. Moves pivot+model together so rotation
            // still happens about the model's own center.
            const framing = cfgScale.framingOffset || { x: 0, y: 0, z: 0 };
            phonePivot.position.set(
                xOffset + basePositionOffset.x + (framing.x || 0),
                yOffset + basePositionOffset.y + (framing.y || 0),
                basePositionOffset.z + (framing.z || 0)
            );

            // Rotation: apply 3D rotation from current screenshot settings + model base rotation
            const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
            const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
            const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
            phonePivot.rotation.set(
                (rotation3D.x + modelRot.x) * Math.PI / 180,
                (rotation3D.y + modelRot.y) * Math.PI / 180,
                (rotation3D.z + modelRot.z) * Math.PI / 180
            );

            applyWallShadowSettings(ss);
        }
    }

    // Set transparent background for compositing
    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0); // Fully transparent clear color

    // Temporarily resize renderer
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Clear the renderer before drawing (ensures clean transparency)
    threeRenderer.clear();

    // Defensive cleanup: side-preview rendering (renderThreeJSForScreenshot) adds
    // cached pivots to the scene and is supposed to remove them. If that path errors
    // or races, we end up with a stale duplicate pivot in the scene that visually
    // overlays the active phone. Strip any Group that isn't our active phonePivot.
    for (let i = threeScene.children.length - 1; i >= 0; i--) {
        const c = threeScene.children[i];
        if (c.type === 'Group' && c !== phonePivot) {
            threeScene.remove(c);
        }
    }

    // Blit the current video frame into the screen-mesh's texture canvas BEFORE we
    // render. Without this, the per-frame video render loop in app.js would call us
    // but the texture stays stuck on the last drawn frame.
    if (_videoTextureUpdater) _videoTextureUpdater();

    // Render with transparency
    threeRenderer.render(threeScene, threeCamera);

    // Project the device's on-screen rect NOW, while the pivot still carries the
    // rendered scale/position (they're restored below). Cached for hit-testing
    // (rotate zones, drop targeting, hover hints) between renders — projecting
    // lazily later would use the restored (stale) transform.
    lastPrimaryDeviceRect = computeDeviceScreenRect(targetCanvas);

    // Selection rim: the primary renders first each composite, so reset the
    // accumulator here, then add this device's ring if it's the gesture target.
    {
        const hlTarget = (typeof deviceHighlightTargetNow === 'function') ? deviceHighlightTargetNow() : null;
        _resetHighlightRim(dims.width, dims.height);
        if (hlTarget === 'primary' || hlTarget === 'all') {
            _accumulateHighlightRim(threeRenderer.domElement, dims.width, dims.height);
        }
    }

    // Draw to target canvas. First lay down the silhouette drop shadow (so the device
    // renders on top of it), then composite the 3D phone.
    const ctx = targetCanvas.getContext('2d');
    {
        const ssNow = typeof state !== 'undefined' && typeof getScreenshotSettings === 'function'
            ? getScreenshotSettings()
            : null;
        if (ssNow && ssNow.shadow) {
            drawDeviceDropShadow(ctx, threeRenderer.domElement, lastPrimaryDeviceRect, ssNow.shadow);
        }
    }
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);

    // Restore size, background, and model transforms
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    phonePivot.position.copy(originalPosition);
    phonePivot.scale.copy(originalScale);
    phonePivot.rotation.copy(originalRotation);
}

// Render 3D for a specific screenshot index (used for side previews)
function renderThreeJSForScreenshot(targetCanvas, width, height, screenshotIndex) {
    if (!threeRenderer || !threeScene || !threeCamera) return;
    if (typeof state === 'undefined' || !state.screenshots[screenshotIndex]) return;

    const screenshot = state.screenshots[screenshotIndex];
    const ss = screenshot.screenshot;
    const dims = { width: width || 1290, height: height || 2796 };

    // Determine which device model this screenshot uses
    const screenshotDeviceType = ss.device3D || 'iphone';
    const config = deviceConfigs[screenshotDeviceType] || deviceConfigs.iphone;

    // Check if this screenshot uses the same device as currently active
    const useCurrentModel = screenshotDeviceType === currentDeviceModel && phonePivot;

    // Get the model to use (either current or from cache)
    let pivotToUse, screenPlaneToUse, screenMeshToUse;

    if (useCurrentModel) {
        // Use the currently loaded model
        pivotToUse = phonePivot;
        screenPlaneToUse = customScreenPlane;
        screenMeshToUse = existingScreenMesh;
    } else {
        // Use cached model for different device
        const cached = phoneModelCache[screenshotDeviceType];
        if (!cached?.loaded) {
            // Model not cached yet - trigger loading and skip this render
            loadCachedPhoneModel(screenshotDeviceType).then(() => {
                // Trigger a re-render once model is loaded
                if (typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            });
            return;
        }
        pivotToUse = cached.pivot;
        screenPlaneToUse = cached.screenPlane;
        screenMeshToUse = cached.screenMesh || null;

        // Add cached pivot to scene temporarily
        threeScene.add(pivotToUse);
    }

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = pivotToUse.position.clone();
    const originalScale = pivotToUse.scale.clone();
    const originalRotation = pivotToUse.rotation.clone();

    // Hide the current model if we're using a different one
    if (!useCurrentModel && phonePivot) {
        phonePivot.visible = false;
    }

    // Apply THIS screenshot's texture so the side preview shows its OWN content (not
    // the active screenshot, and not the model's default dark screen). Falls back to
    // the light placeholder when the frame has no image yet.
    const screenshotImage = typeof getScreenshotImage === 'function'
        ? getScreenshotImage(screenshot)
        : screenshot?.image;
    const previewSource = screenshotImage
        || (typeof buildPlaceholderScreenCanvas === 'function' ? buildPlaceholderScreenCanvas() : null);
    const oldMaterial = screenPlaneToUse ? screenPlaneToUse.material : null;
    if (config.useExistingScreenMesh && screenMeshToUse && previewSource) {
        // Built-in screen mesh (HD iPhone, MacBook): swap just the emissive map. Cheap
        // (texture is cached per image) and the main render re-applies the active
        // texture on the next frame, so no restore needed here.
        const tex = getScreenEmissiveTexture(previewSource);
        if (tex) {
            const m = screenMeshToUse.material;
            m.emissiveMap = tex;
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveIntensity = 1;
            m.needsUpdate = true;
        }
    } else if (screenPlaneToUse && previewSource) {
        // Overlay-plane devices (e.g. Samsung).
        const srcW = previewSource.width || previewSource.videoWidth || 1290;
        const cornerRadius = Math.round(srcW * config.cornerRadiusFactor);
        const roundedImage = createRoundedScreenImage(previewSource, cornerRadius);
        const newTexture = new THREE.Texture(roundedImage);
        newTexture.needsUpdate = true;
        newTexture.encoding = THREE.sRGBEncoding;
        newTexture.flipY = true;

        screenPlaneToUse.material = new THREE.MeshBasicMaterial({
            map: newTexture,
            side: THREE.FrontSide,
            transparent: true
        });
    }

    // Apply frame color for this screenshot
    if (ss.frameColor) {
        if (useCurrentModel) {
            setPhoneFrameColor(ss.frameColor, screenshotDeviceType);
        } else {
            setCachedModelFrameColor(ss.frameColor, screenshotDeviceType);
        }
    }

    // Apply rotation for this screenshot + model base rotation
    const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    pivotToUse.rotation.set(
        (rotation3D.x + modelRot.x) * Math.PI / 180,
        (rotation3D.y + modelRot.y) * Math.PI / 180,
        (rotation3D.z + modelRot.z) * Math.PI / 180
    );

    // Apply scale and position (matching 2D behavior). Landscape devices size to width.
    const normScale = ss.scale / 100;
    let visualScale = normScale;
    threeCamera.position.z = config.cameraDistance || 6;
    if (config.isLandscape) {
        const aspect = dims.width / dims.height;
        const halfFovTan = Math.tan((threeCamera.fov / 2) * Math.PI / 180);
        const fillFrac = (config.widthFillFactor || 0.6) * normScale;
        visualScale = fillFrac * (2 * halfFovTan * threeCamera.position.z * aspect) / 3.75;
    }
    pivotToUse.scale.setScalar(visualScale);
    const { x: availableSpaceX, y: availableSpaceY } = positionRange(dims);
    const xOffset = ((ss.x - 50) / 50) * availableSpaceX;
    const yOffset = -((ss.y - 50) / 50) * availableSpaceY;
    const framing = config.framingOffset || { x: 0, y: 0, z: 0 };
    pivotToUse.position.set(
        xOffset + basePositionOffset.x + (framing.x || 0),
        yOffset + basePositionOffset.y + (framing.y || 0),
        basePositionOffset.z + (framing.z || 0)
    );

    // Set transparent background for compositing
    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0); // Fully transparent clear color

    // Temporarily resize renderer
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Clear the renderer before drawing (ensures clean transparency)
    threeRenderer.clear();

    applyShadowCasting(pivotToUse);

    // Render with transparency
    threeRenderer.render(threeScene, threeCamera);

    // Draw to target canvas: silhouette drop shadow first (under the device), then composite.
    const ctx = targetCanvas.getContext('2d');
    {
        const sh = screenshot && screenshot.screenshot && screenshot.screenshot.shadow;
        if (sh) {
            // Side preview uses the (possibly cached) pivotToUse; temporarily swap it
            // in for phoneModel so the screen-rect projection sees the right transform.
            const savedModel = phoneModel;
            const inferredModel = (pivotToUse && pivotToUse.children && pivotToUse.children[0]) || phoneModel;
            phoneModel = inferredModel;
            drawDeviceDropShadow(ctx, threeRenderer.domElement, computeDeviceScreenRect(targetCanvas), sh);
            phoneModel = savedModel;
        }
    }
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);

    // Restore everything
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    pivotToUse.position.copy(originalPosition);
    pivotToUse.scale.copy(originalScale);
    pivotToUse.rotation.copy(originalRotation);

    // Restore original material
    if (oldMaterial && screenPlaneToUse) {
        // Dispose the temporary material
        if (screenPlaneToUse.material !== oldMaterial) {
            screenPlaneToUse.material.map?.dispose();
            screenPlaneToUse.material.dispose();
        }
        screenPlaneToUse.material = oldMaterial;
    }

    // Restore frame color on current model if we changed it
    if (useCurrentModel && ss.frameColor && typeof state !== 'undefined') {
        const currentSS = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
        if (currentSS?.frameColor) {
            setPhoneFrameColor(currentSS.frameColor, currentDeviceModel);
        }
    }

    // Clean up: remove cached model from scene and restore current model visibility
    if (!useCurrentModel) {
        threeScene.remove(pivotToUse);
        if (phonePivot) {
            phonePivot.visible = true;
        }
    }
}

// Render ONE extra device described by an explicit settings object + image, compositing
// it onto targetCanvas over whatever is already drawn there. This is the multi-device
// building block: updateCanvas() draws the primary device, then calls this once per
// entry in screenshot.extraDevices so several independently-posed 3D devices share one
// frame. It mirrors renderThreeJSForScreenshot's swap→render→blit→restore dance, but is
// driven by `dev` (a device-settings object: scale, x, y, rotation3D, device3D,
// frameColor, shadow) and `image` rather than a screenshot index.
//   dev: same shape as screenshot.screenshot's device fields
//   image: the device's own screen Image/Video (null → light placeholder)
// Returns the device's projected screen rect {x,y,w,h} for hit-testing, or null.
function renderDeviceObjectToCanvas(targetCanvas, width, height, dev, image) {
    if (!threeRenderer || !threeScene || !threeCamera || !dev) return null;

    const dims = { width: width || 1290, height: height || 2796 };
    const deviceType = dev.device3D || 'iphone';
    const config = deviceConfigs[deviceType] || deviceConfigs.iphone;
    const useCurrentModel = deviceType === currentDeviceModel && phonePivot;

    let pivotToUse, screenPlaneToUse, screenMeshToUse;
    if (useCurrentModel) {
        pivotToUse = phonePivot;
        screenPlaneToUse = customScreenPlane;
        screenMeshToUse = existingScreenMesh;
    } else {
        const cached = phoneModelCache[deviceType];
        if (!cached?.loaded) {
            // Kick off the load and re-render when ready; skip this device for now.
            loadCachedPhoneModel(deviceType).then(() => {
                if (typeof updateCanvas === 'function') updateCanvas();
            });
            return null;
        }
        pivotToUse = cached.pivot;
        screenPlaneToUse = cached.screenPlane;
        screenMeshToUse = cached.screenMesh || null;
        threeScene.add(pivotToUse);
    }

    const originalBackground = threeScene.background;
    const originalPosition = pivotToUse.position.clone();
    const originalScale = pivotToUse.scale.clone();
    const originalRotation = pivotToUse.rotation.clone();
    if (!useCurrentModel && phonePivot) phonePivot.visible = false;

    // This device's own screen content.
    const previewSource = image
        || (typeof buildPlaceholderScreenCanvas === 'function' ? buildPlaceholderScreenCanvas() : null);
    const oldMaterial = screenPlaneToUse ? screenPlaneToUse.material : null;
    if (config.useExistingScreenMesh && screenMeshToUse && previewSource) {
        const tex = getScreenEmissiveTexture(previewSource);
        if (tex) {
            const m = screenMeshToUse.material;
            m.emissiveMap = tex;
            m.emissive = new THREE.Color(0xffffff);
            m.emissiveIntensity = 1;
            m.needsUpdate = true;
        }
    } else if (screenPlaneToUse && previewSource) {
        const srcW = previewSource.width || previewSource.videoWidth || 1290;
        const cornerRadius = Math.round(srcW * config.cornerRadiusFactor);
        const roundedImage = createRoundedScreenImage(previewSource, cornerRadius);
        const newTexture = new THREE.Texture(roundedImage);
        newTexture.needsUpdate = true;
        newTexture.encoding = THREE.sRGBEncoding;
        newTexture.flipY = true;
        screenPlaneToUse.material = new THREE.MeshBasicMaterial({ map: newTexture, side: THREE.FrontSide, transparent: true });
    }

    if (dev.frameColor) {
        if (useCurrentModel) setPhoneFrameColor(dev.frameColor, deviceType);
        else setCachedModelFrameColor(dev.frameColor, deviceType);
    }

    // Transform (same mapping as the primary device).
    const rotation3D = dev.rotation3D || { x: 0, y: 0, z: 0 };
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    pivotToUse.rotation.set(
        (rotation3D.x + modelRot.x) * Math.PI / 180,
        (rotation3D.y + modelRot.y) * Math.PI / 180,
        (rotation3D.z + modelRot.z) * Math.PI / 180
    );
    const normScale = (dev.scale || 70) / 100;
    let visualScale = normScale;
    threeCamera.position.z = config.cameraDistance || 6;
    if (config.isLandscape) {
        const aspect = dims.width / dims.height;
        const halfFovTan = Math.tan((threeCamera.fov / 2) * Math.PI / 180);
        const fillFrac = (config.widthFillFactor || 0.6) * normScale;
        visualScale = fillFrac * (2 * halfFovTan * threeCamera.position.z * aspect) / 3.75;
    }
    pivotToUse.scale.setScalar(visualScale);
    const { x: availableSpaceX, y: availableSpaceY } = positionRange(dims);
    const xOffset = (((dev.x ?? 50) - 50) / 50) * availableSpaceX;
    const yOffset = -(((dev.y ?? 50) - 50) / 50) * availableSpaceY;
    const framing = config.framingOffset || { x: 0, y: 0, z: 0 };
    pivotToUse.position.set(
        xOffset + basePositionOffset.x + (framing.x || 0),
        yOffset + basePositionOffset.y + (framing.y || 0),
        basePositionOffset.z + (framing.z || 0)
    );

    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0);
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();
    threeRenderer.clear();
    applyShadowCasting(pivotToUse);
    threeRenderer.render(threeScene, threeCamera);

    // Composite: drop shadow under the device, then the device itself.
    let screenRect = null;
    const ctx = targetCanvas.getContext('2d');
    {
        const savedModel = phoneModel;
        const inferredModel = (pivotToUse && pivotToUse.children && pivotToUse.children[0]) || phoneModel;
        phoneModel = inferredModel;
        screenRect = computeDeviceScreenRect(targetCanvas);
        if (dev.shadow) drawDeviceDropShadow(ctx, threeRenderer.domElement, screenRect, dev.shadow);
        phoneModel = savedModel;
    }
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);

    // Selection rim: add this device's silhouette ring if it's the gesture target.
    {
        const hlTarget = (typeof deviceHighlightTargetNow === 'function') ? deviceHighlightTargetNow() : null;
        if (hlTarget === 'all' || (dev.id && hlTarget === dev.id)) {
            _accumulateHighlightRim(threeRenderer.domElement, dims.width, dims.height);
        }
    }

    // Restore renderer + pivot transform.
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    pivotToUse.position.copy(originalPosition);
    pivotToUse.scale.copy(originalScale);
    pivotToUse.rotation.copy(originalRotation);
    if (oldMaterial && screenPlaneToUse && screenPlaneToUse.material !== oldMaterial) {
        screenPlaneToUse.material.map?.dispose();
        screenPlaneToUse.material.dispose();
        screenPlaneToUse.material = oldMaterial;
    }
    // Restore the active model's frame color if we borrowed it.
    if (useCurrentModel && dev.frameColor && typeof getScreenshotSettings === 'function') {
        const currentSS = getScreenshotSettings();
        if (currentSS?.frameColor) setPhoneFrameColor(currentSS.frameColor, currentDeviceModel);
    }
    if (!useCurrentModel) {
        threeScene.remove(pivotToUse);
        if (phonePivot) phonePivot.visible = true;
    }
    return screenRect;
}

// Show/hide Three.js container
function showThreeJS(show) {
    const container = document.getElementById('threejs-container');
    const canvas = document.getElementById('preview-canvas');

    // In 3D mode, we show the 2D canvas (which composites everything)
    // The Three.js container is hidden but used for rendering
    if (container) {
        container.style.display = 'none'; // Always hidden - we render to 2D canvas
    }
    if (canvas) {
        canvas.style.display = 'block'; // Always visible
    }

    if (show && !isThreeJSInitialized) {
        initThreeJS();
    }

    // Apply current rotation and background
    if (show && typeof state !== 'undefined') {
        updateThreeJSBackground();
        if (phoneModel) {
            const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
            const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
            setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);
            updateScreenTexture();
        }
    }
}

// Get Three.js canvas for export
function getThreeJSCanvas() {
    return threeRenderer ? threeRenderer.domElement : null;
}

// Update Three.js scene background from state
function updateThreeJSBackground() {
    if (!threeScene || typeof state === 'undefined') return;

    // Use getBackground() helper if available, otherwise fall back to defaults
    const bg = typeof getBackground === 'function' ? getBackground() : state.defaults?.background;
    if (!bg) return;

    if (bg.type === 'solid') {
        threeScene.background = new THREE.Color(bg.solid);
    } else if (bg.type === 'gradient') {
        // Use the first gradient color as background (Three.js doesn't support gradients natively)
        const firstStop = bg.gradient.stops[0];
        if (firstStop) {
            threeScene.background = new THREE.Color(firstStop.color);
        }
    } else {
        // For image backgrounds, use a neutral color
        threeScene.background = new THREE.Color(0x1a1a2e);
    }

    // Trigger render update
    requestThreeJSRender();
}

// Cleanup
function disposeThreeJS() {
    if (screenTexture) {
        screenTexture.dispose();
    }
    if (threeRenderer) {
        threeRenderer.dispose();
    }
    isThreeJSInitialized = false;
    phoneModelLoaded = false;
}

// Interactive rotation/movement for 2D canvas in 3D mode
let isDragging3D = false;
let dragMode3D = 'move';
let lastMouseX = 0;
let lastMouseY = 0;
let dragStartX3D = 0;   // gesture origin, for Shift axis-locking
let dragStartY3D = 0;
let lockedAxis3D = null; // 'horizontal' | 'vertical' once Shift commits a MOVE axis
let rotateZone3D = 'turn';                 // 'turn' | 'tilt' | 'roll', from the grab zone
let rollCenter3D = { x: 0, y: 0 };         // device center in client px (roll pivot)
let rollLastAngle3D = 0;                   // last pointer angle around that center (deg)
let dragUpdatePending = false;
let hovering3D = false; // pointer is over the 3D preview canvas

// ---- Smooth rotation engine (primary device) --------------------------------
// Rotation edits no longer jump the device straight to the new angles. A target
// pose is set and the displayed rotation glides toward it each frame with an
// exponential ease — drags feel damped, and pose presets / double-click reset
// get a soft animated transition. The follower writes into the CURRENT
// screenshot's rotation3D, keeps the sliders in sync, and re-renders through
// the same rAF-throttled updateCanvas path the drag handlers already use.

const ROTATION_SNAP_ANGLES = [-180, -135, -90, -60, -45, -30, -15, 0, 15, 30, 45, 60, 90, 135, 180];
const ROTATION_SNAP_TOLERANCE = 2.5;
function snapRotationDeg(v) {
    for (const a of ROTATION_SNAP_ANGLES) {
        if (Math.abs(v - a) <= ROTATION_SNAP_TOLERANCE) return a;
    }
    return v;
}

function _normDeg180(d) { return ((d + 180) % 360 + 360) % 360 - 180; }

let _rotFollower = null; // { target:{x,y,z}, rate, raf, lastT, hud }

function _rotFollowerSS() {
    return (typeof getScreenshotSettings === 'function') ? getScreenshotSettings() : null;
}

// Begin (or retarget) the glide toward `target` (degrees, partial axes allowed).
// rate = responsiveness in 1/s — high (~18) for tight drag-following, low (~9)
// for the softer cinematic ease used by pose presets.
function setRotationTarget(target, opts) {
    opts = opts || {};
    const ss = _rotFollowerSS();
    if (!ss) return;
    if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
    const cur = ss.rotation3D;
    // Approach each axis the short way round (170° → -170° shouldn't whip past 0).
    const wrapTo = (from, to) => from + _normDeg180(to - from);
    const prev = _rotFollower;
    _rotFollower = {
        target: {
            x: wrapTo(cur.x, (target.x ?? cur.x)),
            y: wrapTo(cur.y, (target.y ?? cur.y)),
            z: wrapTo(cur.z, (target.z ?? cur.z))
        },
        rate: opts.rate || 14,
        hud: opts.hud !== false,
        ssRef: ss,             // abort if the active screenshot changes mid-glide
        raf: prev ? prev.raf : null,
        lastT: performance.now()
    };
    if (!_rotFollower.raf) _rotFollower.raf = requestAnimationFrame(_rotFollowerStep);
}

function _rotFollowerStep(now) {
    const f = _rotFollower;
    if (!f) return;
    f.raf = null;
    const ss = _rotFollowerSS();
    if (!ss || !ss.use3D || !ss.rotation3D || ss !== f.ssRef) { _rotFollower = null; return; }
    const dt = Math.min(0.1, (now - f.lastT) / 1000);
    f.lastT = now;
    const k = 1 - Math.exp(-f.rate * dt);
    const cur = ss.rotation3D;
    let maxDiff = 0;
    const touched = [];
    for (const ax of ['x', 'y', 'z']) {
        const diff = f.target[ax] - cur[ax];
        maxDiff = Math.max(maxDiff, Math.abs(diff));
        if (Math.abs(diff) > 0.01) {
            cur[ax] += diff * k;
            touched.push(ax);
        }
    }
    const stillDraggingRotate = isDragging3D && dragMode3D === 'rotate';
    const converged = maxDiff < 0.08;
    if (converged) {
        cur.x = _normDeg180(f.target.x);
        cur.y = _normDeg180(f.target.y);
        cur.z = _normDeg180(f.target.z);
    }
    setThreeJSRotation(cur.x, cur.y, cur.z);
    syncRotation3DSliders(cur);
    if (f.hud) showRotationHUD(cur, f.lockLabel);
    // Auto-key only axes that actually moved this frame.
    if (typeof autoKeyTouch === 'function') {
        touched.forEach(ax => autoKeyTouch('screenshot.rotation3D.' + ax));
    }
    if (!dragUpdatePending) {
        dragUpdatePending = true;
        requestAnimationFrame(() => {
            dragUpdatePending = false;
            if (typeof updateCanvas === 'function') updateCanvas();
        });
    }
    if (!converged) {
        f.raf = requestAnimationFrame(_rotFollowerStep);
    } else if (stillDraggingRotate) {
        // Caught up mid-drag: go idle (no rAF burn) — the next rotate mousemove
        // nudges the target and restarts the loop.
    } else {
        _rotFollower = null;
    }
}

// Animate the primary device to an absolute pose — used by the pose presets and
// double-click-to-reset. Safe to call any time in 3D mode.
function animateDeviceRotationTo(x, y, z) {
    setRotationTarget({ x: x, y: y, z: z }, { rate: 9 });
}

// Keep the three rotation sliders + labels in lockstep with an animated rotation.
function syncRotation3DSliders(r) {
    const set = (id, v) => {
        const el = document.getElementById(id);
        const rounded = Math.round(_normDeg180(v));
        if (el) el.value = rounded;
        const lbl = document.getElementById(id + '-value');
        if (lbl) lbl.textContent = rounded + '°';
    };
    set('rotation-3d-x', r.x);
    set('rotation-3d-y', r.y);
    set('rotation-3d-z', r.z);
    if (typeof updatePoseChipActive === 'function') updatePoseChipActive();
}

// Translucent pill over the canvas showing the live pose while it changes —
// the UI explains the rotation as you make it. Auto-fades shortly after the
// last update.
let _rotHUDEl = null;
let _rotHUDTimer = null;
// `lock` names the axis a gesture is committed to ('turn' | 'tilt' | 'roll'),
// so the readout shows just that axis while it's the only one changing.
function showRotationHUD(rot, lock) {
    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;
    if (!_rotHUDEl || !_rotHUDEl.isConnected) {
        _rotHUDEl = document.createElement('div');
        _rotHUDEl.id = 'rotation-hud';
        wrapper.appendChild(_rotHUDEl);
    }
    const x = Math.round(_normDeg180(rot.x));
    const y = Math.round(_normDeg180(rot.y));
    const z = Math.round(_normDeg180(rot.z));
    let text;
    if (lock === 'turn')      text = 'Turn ' + y + '°';
    else if (lock === 'tilt') text = 'Tilt ' + x + '°';
    else if (lock === 'roll') text = 'Roll ' + z + '°';
    else if (x === 0 && y === 0 && z === 0) text = 'Front';
    else text = 'Tilt ' + x + '° · Turn ' + y + '°' + (z ? ' · Roll ' + z + '°' : '');
    _rotHUDEl.textContent = text;
    _rotHUDEl.classList.add('visible');
    if (_rotHUDTimer) clearTimeout(_rotHUDTimer);
    _rotHUDTimer = setTimeout(() => {
        if (_rotHUDEl) _rotHUDEl.classList.remove('visible');
    }, 900);
}

// Custom rotate cursors (CSS has no built-in ones). Each is a white-halo + dark
// glyph SVG so it reads on any background; hotspot at center. One per rotate
// zone: circular arrow = roll (corners), curved ↔ = turn, curved ↕ = tilt.
function _cursorFromSvg(svg) {
    return "url(\"data:image/svg+xml," + svg.replace(/ /g, '%20').replace(/'/g, '%27') + "\") 15 15, grab";
}
const ROTATE_CURSOR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'>" +
    "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M23 15a8 8 0 1 1-2.3-5.6' stroke='%23fff' stroke-width='4.5'/>" +
    "<path d='M21 5v5h-5' stroke='%23fff' stroke-width='4.5'/>" +
    "<path d='M23 15a8 8 0 1 1-2.3-5.6' stroke='%23151515' stroke-width='2.2'/>" +
    "<path d='M21 5v5h-5' stroke='%23151515' stroke-width='2.2'/>" +
    "</g></svg>";
const TURN_CURSOR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'>" +
    "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M5 18 Q15 10 25 18' stroke='%23fff' stroke-width='4.5'/>" +
    "<path d='M9.5 13.5 L5 18 L10.5 20.5 M20.5 13.5 L25 18 L19.5 20.5' stroke='%23fff' stroke-width='4.5'/>" +
    "<path d='M5 18 Q15 10 25 18' stroke='%23151515' stroke-width='2.2'/>" +
    "<path d='M9.5 13.5 L5 18 L10.5 20.5 M20.5 13.5 L25 18 L19.5 20.5' stroke='%23151515' stroke-width='2.2'/>" +
    "</g></svg>";
const TILT_CURSOR_SVG =
    "<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'>" +
    "<g fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    "<path d='M18 5 Q10 15 18 25' stroke='%23fff' stroke-width='4.5'/>" +
    "<path d='M13.5 9.5 L18 5 L20.5 10.5 M13.5 20.5 L18 25 L20.5 19.5' stroke='%23fff' stroke-width='4.5'/>" +
    "<path d='M18 5 Q10 15 18 25' stroke='%23151515' stroke-width='2.2'/>" +
    "<path d='M13.5 9.5 L18 5 L20.5 10.5 M13.5 20.5 L18 25 L20.5 19.5' stroke='%23151515' stroke-width='2.2'/>" +
    "</g></svg>";
const ROTATE_CURSOR = _cursorFromSvg(ROTATE_CURSOR_SVG);
const TURN_CURSOR = _cursorFromSvg(TURN_CURSOR_SVG);
const TILT_CURSOR = _cursorFromSvg(TILT_CURSOR_SVG);

// Modifier → drag mode, shared by the primary device (here) and extra devices (app.js):
//   plain drag → move, Ctrl/Cmd+drag → rotate, Alt/Option+drag → zoom.
// (Shift constrains a move to one axis / frees a rotate; it is NOT a mode key here.)
function deviceDragModeForEvent(e) {
    if (e && e.altKey) return 'zoom';
    if (e && (e.metaKey || e.ctrlKey)) return 'rotate';
    return 'move';
}

// Rotate zone + the device's on-screen center (roll pivot) for a pointer event
// over the preview canvas. Falls back to 'turn' when nothing is resolvable.
function rotateZoneInfoForEvent(e) {
    const pc = document.getElementById('preview-canvas');
    const fallback = { zone: 'turn', center: { x: (e && e.clientX) || 0, y: (e && e.clientY) || 0 } };
    if (!pc || !e || typeof e.clientX !== 'number') return fallback;
    const r = pc.getBoundingClientRect();
    if (!r.width || !r.height) return fallback;
    const cpx = (e.clientX - r.left) * (pc.width / r.width);
    const cpy = (e.clientY - r.top) * (pc.height / r.height);
    // Use the render-time cached rect — see lastPrimaryDeviceRect.
    const rect = lastPrimaryDeviceRect ||
        ((typeof computeDeviceScreenRect === 'function') ? computeDeviceScreenRect(pc) : null);
    if (!rect) return { zone: 'turn', center: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
    const zone = (typeof deviceRotateZone === 'function') ? deviceRotateZone(cpx, cpy, rect) : 'turn';
    const sx = r.width / pc.width, sy = r.height / pc.height;
    return {
        zone,
        center: { x: r.left + (rect.x + rect.w / 2) * sx, y: r.top + (rect.y + rect.h / 2) * sy }
    };
}

// Cursor previewing what a drag will do given the held modifiers — for rotates,
// the cursor tracks the zone under the pointer (roll / turn / tilt).
function cursorForModifiers(e) {
    const m = deviceDragModeForEvent(e);
    if (m === 'zoom') return 'zoom-in';
    if (m === 'rotate') {
        const zone = rotateZoneInfoForEvent(e).zone;
        if (zone === 'roll') return ROTATE_CURSOR;
        if (zone === 'tilt') return TILT_CURSOR;
        return TURN_CURSOR;
    }
    return 'move';
}

function getUse3D() {
    if (typeof getScreenshotSettings === 'function') {
        const ss = getScreenshotSettings();
        return ss?.use3D || false;
    }
    return state.defaults?.screenshot?.use3D || false;
}

function setup3DCanvasInteraction() {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;

    // The drag itself is handled on `document` (listeners attached on mousedown, removed on
    // mouseup) so a move/rotate keeps tracking the mouse even after it leaves the canvas.
    // Previously these lived on the canvas and `mouseleave` aborted the drag — so pushing the
    // device toward a frame edge (where the cursor naturally exits the canvas) cut the gesture
    // off and you couldn't drag it any farther.
    function onDrag3DMove(e) {
        if (!isDragging3D) return;
        if (typeof state === 'undefined' || !getUse3D()) return;
        // Don't move/rotate the device while an element is being dragged on the canvas.
        const wrapper = document.getElementById('canvas-wrapper');
        if (wrapper && wrapper.classList.contains('element-dragging')) { end3DDrag(); return; }

        let deltaX = e.clientX - lastMouseX;
        let deltaY = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        // Shift constrains a MOVE to one axis, committed from the initial drag
        // direction (past a small threshold) and held for the whole gesture.
        // (Rotation picks its axis from the grab ZONE instead — see the rotate branch.)
        if (e.shiftKey && dragMode3D === 'move') {
            if (!lockedAxis3D) {
                const totDX = Math.abs(e.clientX - dragStartX3D);
                const totDY = Math.abs(e.clientY - dragStartY3D);
                if (Math.max(totDX, totDY) >= 5) lockedAxis3D = totDX >= totDY ? 'horizontal' : 'vertical';
            }
            if (lockedAxis3D === 'horizontal') deltaY = 0;
            else if (lockedAxis3D === 'vertical') deltaX = 0;
        } else if (dragMode3D === 'move') {
            lockedAxis3D = null;
        }

        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        if (!ss) return;

        // Linked devices ("Group — transform together"): this gesture drives the whole
        // arrangement via the group core in app.js, then falls through to the shared
        // throttled updateCanvas. Move/zoom/rotate semantics mirror the single-device
        // branches below; roll rigidly rotates the layout (positions orbit the center).
        if (typeof deviceGroupActive === 'function' && deviceGroupActive()) {
            const members = allDeviceMembers();
            const r = canvas.getBoundingClientRect();
            const kx = canvas.width / Math.max(1, r.width);
            const ky = canvas.height / Math.max(1, r.height);
            if (dragMode3D === 'move') {
                membersMoveBy(members, deltaX * kx, deltaY * ky);
            } else if (dragMode3D === 'zoom') {
                membersScaleBy(members, Math.max(0.5, 1 - deltaY * 0.004));
            } else {
                const sens = 220 / Math.max(320, r.width || 320);
                let lock = null;
                if (e.shiftKey) {
                    membersRotate3DBy(members, 'y', deltaX * sens);
                    membersRotate3DBy(members, 'x', deltaY * sens);
                } else if (rotateZone3D === 'roll') {
                    const a = Math.atan2(e.clientY - rollCenter3D.y, e.clientX - rollCenter3D.x) * 180 / Math.PI;
                    const d = ((a - rollLastAngle3D + 540) % 360) - 180;
                    rollLastAngle3D = a;
                    membersRotate2DBy(members, d);
                    lock = 'roll';
                } else if (rotateZone3D === 'tilt') {
                    membersRotate3DBy(members, 'x', deltaY * sens);
                    lock = 'tilt';
                } else {
                    membersRotate3DBy(members, 'y', deltaX * sens);
                    lock = 'turn';
                }
                showRotationHUD(ss.rotation3D || { x: 0, y: 0, z: 0 }, lock);
            }
            if (typeof groupSyncUI === 'function') groupSyncUI();
        } else if (dragMode3D === 'move') {
            // Plain drag: translate position (x, y). Clamp to the position sliders' OWN range
            // (which extends past 0–100 so the device can sit partly off-frame), NOT a hard
            // 0–100 — that hard cap made the device stick the instant it reached an edge.
            const xs = document.getElementById('screenshot-x');
            const ys = document.getElementById('screenshot-y');
            const xMin = xs ? parseFloat(xs.min) : -80, xMax = xs ? parseFloat(xs.max) : 180;
            const yMin = ys ? parseFloat(ys.min) : -80, yMax = ys ? parseFloat(ys.max) : 180;
            ss.x = Math.max(xMin, Math.min(xMax, ss.x + deltaX * 0.2));
            ss.y = Math.max(yMin, Math.min(yMax, ss.y + deltaY * 0.2));

            if (xs) { xs.value = ss.x; const l = document.getElementById('screenshot-x-value'); if (l) l.textContent = Math.round(ss.x) + '%'; }
            if (ys) { ys.value = ss.y; const l = document.getElementById('screenshot-y-value'); if (l) l.textContent = Math.round(ss.y) + '%'; }

            // Auto-key the dragged position (drag-to-move on the canvas).
            if (typeof autoKeyTouch === 'function') { autoKeyTouch('screenshot.x'); autoKeyTouch('screenshot.y'); }
        } else if (dragMode3D === 'zoom') {
            // Alt+drag: scale. Drag up → bigger, down → smaller.
            const sc = document.getElementById('screenshot-scale');
            const sMin = sc ? parseFloat(sc.min) : 30, sMax = sc ? parseFloat(sc.max) : 400;
            ss.scale = Math.max(sMin, Math.min(sMax, ss.scale - deltaY * 0.4));
            if (sc) { sc.value = ss.scale; const l = document.getElementById('screenshot-scale-value'); if (l) l.textContent = Math.round(ss.scale) + '%'; }
            if (typeof autoKeyTouch === 'function') autoKeyTouch('screenshot.scale');
        } else {
            // Ctrl/Cmd+drag: rotate the device, ONE axis at a time, picked by where
            // you grabbed (Photoshop/Figma free-transform style — see deviceRotateZone):
            //   corners            → ROLL, following the pointer's angle around the
            //                        device center, like physically spinning it
            //   top/bottom centers → TILT (drag ↕)
            //   middle & sides     → TURN (drag ↔)
            // Hold Shift to free-orbit turn+tilt together. The follower smooths the
            // motion and soft-snaps to round angles on release.
            if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
            if (!_rotFollower) setRotationTarget(ss.rotation3D, { rate: 18 });

            // Resolution-independent feel: dragging across the full canvas ≈ 220°.
            const rect = canvas.getBoundingClientRect();
            const sens = 220 / Math.max(320, rect.width || 320);

            const t = _rotFollower.target;
            if (e.shiftKey) {
                t.y = Math.max(-180, Math.min(180, t.y + deltaX * sens));
                t.x = Math.max(-180, Math.min(180, t.x + deltaY * sens));
                _rotFollower.lockLabel = null;
            } else if (rotateZone3D === 'roll') {
                const a = Math.atan2(e.clientY - rollCenter3D.y, e.clientX - rollCenter3D.x) * 180 / Math.PI;
                const d = ((a - rollLastAngle3D + 540) % 360) - 180;
                rollLastAngle3D = a;
                t.z = Math.max(-180, Math.min(180, t.z + d));
                _rotFollower.lockLabel = 'roll';
            } else if (rotateZone3D === 'tilt') {
                t.x = Math.max(-180, Math.min(180, t.x + deltaY * sens));
                _rotFollower.lockLabel = 'tilt';
            } else {
                t.y = Math.max(-180, Math.min(180, t.y + deltaX * sens));
                _rotFollower.lockLabel = 'turn';
            }
            if (!_rotFollower.raf) {
                _rotFollower.lastT = performance.now();
                _rotFollower.raf = requestAnimationFrame(_rotFollowerStep);
            }
            // Rendering, slider sync, HUD and auto-key all happen in the follower.
            return;
        }

        // Throttle updateCanvas calls using requestAnimationFrame
        if (!dragUpdatePending) {
            dragUpdatePending = true;
            requestAnimationFrame(() => {
                dragUpdatePending = false;
                if (typeof updateCanvas === 'function') updateCanvas();
            });
        }
    }

    function end3DDrag() {
        if (!isDragging3D) return;
        const wasRotate = dragMode3D === 'rotate';
        isDragging3D = false;
        dragMode3D = 'move';
        canvas.style.cursor = getUse3D() ? 'move' : '';
        document.removeEventListener('mousemove', onDrag3DMove);
        document.removeEventListener('mouseup', end3DDrag);

        // Release a rotate gesture with a soft settle: nudge the target onto the
        // nearest round angle (0/±15/±30/±45/±60/±90/±135/180, within tolerance)
        // and let the follower ease there.
        if (wasRotate && _rotFollower) {
            const t = _rotFollower.target;
            t.x = snapRotationDeg(t.x);
            t.y = snapRotationDeg(t.y);
            t.z = snapRotationDeg(t.z);
            _rotFollower.rate = 10;
            if (!_rotFollower.raf) {
                _rotFollower.lastT = performance.now();
                _rotFollower.raf = requestAnimationFrame(_rotFollowerStep);
            }
        }
    }

    canvas.addEventListener('mousedown', (e) => {
        if (typeof state !== 'undefined' && getUse3D()) {
            isDragging3D = true;
            // plain → move, Ctrl/Cmd → rotate, Alt → zoom. (Shift is reserved for carousel.)
            dragMode3D = deviceDragModeForEvent(e);
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            dragStartX3D = e.clientX;
            dragStartY3D = e.clientY;
            lockedAxis3D = null;
            // Rotate gestures: the grab zone picks the axis (corners roll, top/bottom
            // tilt, middle turns), and roll needs the device's on-screen center as its
            // pivot. (The follower itself is primed lazily on the first move — this
            // mousedown may yet belong to an extra device, which app.js handles.)
            if (dragMode3D === 'rotate') {
                const zi = rotateZoneInfoForEvent(e);
                rotateZone3D = zi.zone;
                rollCenter3D = zi.center;
                rollLastAngle3D = Math.atan2(e.clientY - zi.center.y, e.clientX - zi.center.x) * 180 / Math.PI;
            }
            canvas.style.cursor = cursorForModifiers(e);
            // Follow the rest of the gesture globally so it survives the cursor leaving the canvas.
            document.addEventListener('mousemove', onDrag3DMove);
            document.addEventListener('mouseup', end3DDrag);
            e.preventDefault(); // avoid selecting page text while dragging off-canvas
        }
    });
    // Ctrl/Cmd+drag rotates — suppress the context menu that a Ctrl-click would pop on macOS.
    canvas.addEventListener('contextmenu', (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); });

    // Canvas mousemove now only previews the hover cursor — the active drag is handled on
    // `document` so it continues even when the pointer is outside the canvas.
    canvas.addEventListener('mousemove', (e) => {
        if (isDragging3D) return;
        if (typeof state !== 'undefined' && getUse3D()) canvas.style.cursor = cursorForModifiers(e);
    });

    canvas.addEventListener('mouseleave', () => {
        hovering3D = false;
        if (!isDragging3D) canvas.style.cursor = '';   // leave an in-progress drag running
    });

    // Change cursor when hovering in 3D mode (reflects the held modifier).
    canvas.addEventListener('mouseenter', (e) => {
        hovering3D = true;
        if (typeof state !== 'undefined' && getUse3D()) {
            canvas.style.cursor = cursorForModifiers(e);
        }
    });

    // While hovering, pressing/releasing Alt/Cmd/Ctrl updates the cursor live so you can
    // see each key's mode (move / zoom / rotate) without moving the mouse.
    const refreshHoverCursor = (e) => {
        if (hovering3D && !isDragging3D && typeof state !== 'undefined' && getUse3D()) {
            canvas.style.cursor = cursorForModifiers(e);
        }
    };
    document.addEventListener('keydown', refreshHoverCursor);
    document.addEventListener('keyup', refreshHoverCursor);

    // ---- Touch gestures (3D mode) -------------------------------------------
    // Touch-first manipulation so the canvas works on tablets/phones (groundwork
    // for a mobile build). Modifier-free and axis-locked by design:
    //   1 finger   — move the device under your finger (primary or extra device)
    //   2 fingers  — pinch = zoom · twist = roll · drag = rotate, locked to ↔ turn
    //                or ↕ tilt by the gesture's first dominant direction
    //   double-tap — reset that device's pose (eased back to Front)
    // Touches that start on a text element / popout are left to app.js's editors.

    let touch3D = null;          // active gesture descriptor
    let lastTap = { t: 0, x: 0, y: 0 };

    const angDiff = (a, b) => ((a - b + 540) % 360) - 180;

    // Client point → canvas-internal pixels (for hit-testing device rects).
    function canvasPtFromTouch(t) {
        const r = canvas.getBoundingClientRect();
        if (!r.width || !r.height) return null;
        return { x: (t.clientX - r.left) * (canvas.width / r.width),
                 y: (t.clientY - r.top) * (canvas.height / r.height) };
    }

    // The device a touch should manipulate: topmost extra device under the point,
    // else the primary device.
    function deviceTargetAt(cp) {
        if (cp && typeof getExtraDevices === 'function') {
            const devs = getExtraDevices();
            for (let i = devs.length - 1; i >= 0; i--) {
                const r = devs[i]._screenRect;
                if (r && cp.x >= r.x && cp.x <= r.x + r.w && cp.y >= r.y && cp.y <= r.y + r.h) {
                    return { kind: 'extra', dev: devs[i] };
                }
            }
        }
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
        return ss ? { kind: 'primary', ss } : null;
    }

    function touchInfo(touches) {
        const t0 = touches[0], t1 = touches[1];
        const dx = t1.clientX - t0.clientX, dy = t1.clientY - t0.clientY;
        return {
            dist: Math.hypot(dx, dy),
            ang: Math.atan2(dy, dx) * 180 / Math.PI,
            cx: (t0.clientX + t1.clientX) / 2,
            cy: (t0.clientY + t1.clientY) / 2
        };
    }

    function throttledCanvasUpdate() {
        if (dragUpdatePending) return;
        dragUpdatePending = true;
        requestAnimationFrame(() => {
            dragUpdatePending = false;
            if (typeof updateCanvas === 'function') updateCanvas();
        });
    }

    const syncSliderUI = (id, val, suffix) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
        const lbl = document.getElementById(id + '-value');
        if (lbl) lbl.textContent = Math.round(val) + suffix;
    };

    canvas.addEventListener('touchstart', (e) => {
        if (typeof state === 'undefined' || !getUse3D()) return;
        const cp = canvasPtFromTouch(e.touches[0]);
        if (!cp) return;

        if (e.touches.length === 1) {
            // Text elements and popouts keep their own touch editing.
            const onOther = (typeof hitTestPopouts === 'function' && hitTestPopouts(cp.x, cp.y)) ||
                            (typeof hitTestElements === 'function' && hitTestElements(cp.x, cp.y));
            if (onOther) { touch3D = null; return; }

            const target = deviceTargetAt(cp);
            if (!target) return;
            e.preventDefault();

            // Double-tap → reset this device's pose.
            const now = performance.now();
            const t = e.touches[0];
            if (now - lastTap.t < 320 && Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 24) {
                lastTap.t = 0;
                if (target.kind === 'extra') {
                    target.dev.rotation3D = { x: 0, y: 0, z: 0 };
                    throttledCanvasUpdate();
                    if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
                } else {
                    animateDeviceRotationTo(0, 0, 0);
                }
                touch3D = null;
                return;
            }
            lastTap = { t: now, x: t.clientX, y: t.clientY };

            if (target.kind === 'extra' && typeof selectExtraDevice === 'function') {
                selectExtraDevice(target.dev.id);
            }
            touch3D = { mode: 'move', target, lastX: t.clientX, lastY: t.clientY, startCp: cp };
        } else if (e.touches.length >= 2) {
            e.preventDefault();
            const target = (touch3D && touch3D.target) || deviceTargetAt(cp);
            if (!target) return;
            const info = touchInfo(e.touches);
            const src = target.kind === 'extra' ? target.dev : target.ss;
            const rot = src.rotation3D || { x: 0, y: 0, z: 0 };
            touch3D = {
                mode: 'pending2', target,
                d0: info.dist, a0: info.ang, c0: { x: info.cx, y: info.cy },
                origScale: src.scale ?? (target.kind === 'extra' ? 55 : 70),
                origRot: { x: rot.x, y: rot.y, z: rot.z },
                lockedAxis: null
            };
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        if (!touch3D || typeof state === 'undefined' || !getUse3D()) return;
        e.preventDefault();
        const tg = touch3D.target;
        const isExtra = tg.kind === 'extra';
        const dev = isExtra ? tg.dev : null;
        const ss = isExtra ? null : tg.ss;

        if (e.touches.length === 1 && touch3D.mode === 'move') {
            const t = e.touches[0];
            const dx = t.clientX - touch3D.lastX;
            const dy = t.clientY - touch3D.lastY;
            touch3D.lastX = t.clientX;
            touch3D.lastY = t.clientY;
            // Linked devices: one finger moves the whole arrangement.
            if (typeof deviceGroupActive === 'function' && deviceGroupActive()) {
                const r = canvas.getBoundingClientRect();
                membersMoveBy(allDeviceMembers(),
                    dx * canvas.width / Math.max(1, r.width),
                    dy * canvas.height / Math.max(1, r.height));
                if (typeof groupSyncUI === 'function') groupSyncUI();
                throttledCanvasUpdate();
                return;
            }
            if (isExtra) {
                // Same mapping as the mouse path: canvas-relative, tracks the finger.
                const r = canvas.getBoundingClientRect();
                const sx = canvas.width / r.width, sy = canvas.height / r.height;
                dev.x = Math.max(-80, Math.min(180, (dev.x ?? 50) + (dx * sx) * 100 / (0.85 * canvas.width)));
                dev.y = Math.max(-80, Math.min(180, (dev.y ?? 50) + (dy * sy) * 100 / (0.85 * canvas.height)));
                if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
            } else {
                ss.x = Math.max(-80, Math.min(180, ss.x + dx * 0.2));
                ss.y = Math.max(-80, Math.min(180, ss.y + dy * 0.2));
                syncSliderUI('screenshot-x', ss.x, '%');
                syncSliderUI('screenshot-y', ss.y, '%');
                if (typeof autoKeyTouch === 'function') { autoKeyTouch('screenshot.x'); autoKeyTouch('screenshot.y'); }
            }
            throttledCanvasUpdate();
            return;
        }

        if (e.touches.length < 2) return;
        const info = touchInfo(e.touches);

        // Classify the two-finger gesture once, by whichever signal crosses its
        // threshold first — then the whole gesture stays in that mode.
        if (touch3D.mode === 'pending2') {
            const dDist = Math.abs(info.dist - touch3D.d0);
            const dAng = Math.abs(angDiff(info.ang, touch3D.a0));
            const dPan = Math.hypot(info.cx - touch3D.c0.x, info.cy - touch3D.c0.y);
            if (dDist > 24) touch3D.mode = 'pinch';
            else if (dAng > 10) touch3D.mode = 'twist';
            else if (dPan > 14) touch3D.mode = 'rotate';
            else return;
        }

        // Linked devices: two-finger gestures drive the whole arrangement, applied
        // incrementally (per-frame deltas) through the group core in app.js.
        if (typeof deviceGroupActive === 'function' && deviceGroupActive()) {
            const members = allDeviceMembers();
            if (touch3D.mode === 'pinch') {
                const prev = touch3D._prevDist ?? touch3D.d0;
                touch3D._prevDist = info.dist;
                membersScaleBy(members, info.dist / Math.max(1, prev));
            } else if (touch3D.mode === 'twist') {
                const prev = touch3D._prevAng ?? touch3D.a0;
                touch3D._prevAng = info.ang;
                membersRotate2DBy(members, angDiff(info.ang, prev));
                const ssNow = _rotFollowerSS();
                if (ssNow) showRotationHUD(ssNow.rotation3D || { x: 0, y: 0, z: 0 }, 'roll');
            } else if (touch3D.mode === 'rotate') {
                const prev = touch3D._prevC || touch3D.c0;
                touch3D._prevC = { x: info.cx, y: info.cy };
                if (!touch3D.lockedAxis) {
                    const dx0 = info.cx - touch3D.c0.x, dy0 = info.cy - touch3D.c0.y;
                    touch3D.lockedAxis = Math.abs(dx0) >= Math.abs(dy0) ? 'horizontal' : 'vertical';
                }
                const r = canvas.getBoundingClientRect();
                const sens = 220 / Math.max(320, r.width || 320);
                if (touch3D.lockedAxis === 'horizontal') {
                    membersRotate3DBy(members, 'y', (info.cx - prev.x) * sens);
                } else {
                    membersRotate3DBy(members, 'x', (info.cy - prev.y) * sens);
                }
                const ssNow = _rotFollowerSS();
                if (ssNow) showRotationHUD(ssNow.rotation3D || { x: 0, y: 0, z: 0 },
                    touch3D.lockedAxis === 'horizontal' ? 'turn' : 'tilt');
            }
            if (typeof groupSyncUI === 'function') groupSyncUI();
            throttledCanvasUpdate();
            return;
        }

        if (touch3D.mode === 'pinch') {
            const factor = info.dist / Math.max(1, touch3D.d0);
            if (isExtra) {
                dev.scale = Math.max(10, Math.min(150, touch3D.origScale * factor));
                if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
            } else {
                ss.scale = Math.max(30, Math.min(400, touch3D.origScale * factor));
                syncSliderUI('screenshot-scale', ss.scale, '%');
                if (typeof autoKeyTouch === 'function') autoKeyTouch('screenshot.scale');
            }
            throttledCanvasUpdate();
        } else if (touch3D.mode === 'twist') {
            const roll = touch3D.origRot.z + angDiff(info.ang, touch3D.a0);
            if (isExtra) {
                dev.rotation3D = dev.rotation3D || { x: 0, y: 0, z: 0 };
                dev.rotation3D.z = _normDeg180(roll);
                showRotationHUD(dev.rotation3D, 'roll');
                if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
                throttledCanvasUpdate();
            } else {
                if (!_rotFollower) setRotationTarget(ss.rotation3D || { x: 0, y: 0, z: 0 }, { rate: 18 });
                _rotFollower.target.z = _normDeg180(roll);
                _rotFollower.lockLabel = 'roll';
                if (!_rotFollower.raf) {
                    _rotFollower.lastT = performance.now();
                    _rotFollower.raf = requestAnimationFrame(_rotFollowerStep);
                }
            }
        } else if (touch3D.mode === 'rotate') {
            const dxC = info.cx - touch3D.c0.x;
            const dyC = info.cy - touch3D.c0.y;
            // Axis lock from the pan's first dominant direction (always on for touch).
            if (!touch3D.lockedAxis) {
                touch3D.lockedAxis = Math.abs(dxC) >= Math.abs(dyC) ? 'horizontal' : 'vertical';
            }
            const r = canvas.getBoundingClientRect();
            const sens = 220 / Math.max(320, r.width || 320);
            const turn = touch3D.origRot.y + (touch3D.lockedAxis === 'horizontal' ? dxC * sens : 0);
            const tilt = touch3D.origRot.x + (touch3D.lockedAxis === 'vertical' ? dyC * sens : 0);
            const lock = touch3D.lockedAxis === 'horizontal' ? 'turn' : 'tilt';
            if (isExtra) {
                dev.rotation3D = dev.rotation3D || { x: 0, y: 0, z: 0 };
                dev.rotation3D.y = _normDeg180(turn);
                dev.rotation3D.x = _normDeg180(tilt);
                showRotationHUD(dev.rotation3D, lock);
                if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
                throttledCanvasUpdate();
            } else {
                if (!_rotFollower) setRotationTarget(ss.rotation3D || { x: 0, y: 0, z: 0 }, { rate: 18 });
                _rotFollower.target.y = Math.max(-180, Math.min(180, turn));
                _rotFollower.target.x = Math.max(-180, Math.min(180, tilt));
                _rotFollower.lockLabel = lock;
                if (!_rotFollower.raf) {
                    _rotFollower.lastT = performance.now();
                    _rotFollower.raf = requestAnimationFrame(_rotFollowerStep);
                }
            }
        }
    }, { passive: false });

    function end3DTouch(e) {
        if (!touch3D) return;
        const twoFingerMode = touch3D.mode !== 'move';
        if (twoFingerMode && e.touches.length < 2) {
            // Settle rotation gestures onto round angles (same snap as the mouse path).
            // Skipped for linked devices — per-device snapping would distort the
            // arrangement's relative offsets.
            if ((touch3D.mode === 'rotate' || touch3D.mode === 'twist') &&
                !(typeof deviceGroupActive === 'function' && deviceGroupActive())) {
                if (touch3D.target.kind === 'extra') {
                    const rd = touch3D.target.dev.rotation3D;
                    if (rd) {
                        rd.x = snapRotationDeg(rd.x); rd.y = snapRotationDeg(rd.y); rd.z = snapRotationDeg(rd.z);
                        if (typeof updateExtraDeviceProperties === 'function') updateExtraDeviceProperties();
                        throttledCanvasUpdate();
                    }
                } else if (_rotFollower) {
                    const t = _rotFollower.target;
                    t.x = snapRotationDeg(t.x); t.y = snapRotationDeg(t.y); t.z = snapRotationDeg(t.z);
                    _rotFollower.rate = 10;
                    _rotFollower.lockLabel = null;
                    if (!_rotFollower.raf) {
                        _rotFollower.lastT = performance.now();
                        _rotFollower.raf = requestAnimationFrame(_rotFollowerStep);
                    }
                }
            }
            if (e.touches.length === 1) {
                // One finger remains: hand it off to move mode.
                const t = e.touches[0];
                touch3D = { mode: 'move', target: touch3D.target, lastX: t.clientX, lastY: t.clientY };
            } else {
                touch3D = null;
            }
        } else if (e.touches.length === 0) {
            touch3D = null;
        }
    }
    canvas.addEventListener('touchend', end3DTouch);
    canvas.addEventListener('touchcancel', end3DTouch);
}

// Initialize interaction when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup3DCanvasInteraction);
} else {
    setup3DCanvasInteraction();
}
