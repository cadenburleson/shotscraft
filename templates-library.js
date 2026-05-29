// templates-library.js
// ---------------------------------------------------------------------------
// Curated, JSON-serializable App Store screenshot templates.
//
// A template captures a *look* (background + device/position + text styling) plus
// an optional multi-frame "story set" of placeholder captions. It deliberately
// carries NO user content (no real images, no real headlines) — applyTemplate()
// in app.js layers a template's styling onto the user's own screenshots, the same
// way transferStyle() copies a look between screenshots.
//
// Shape of one template:
// {
//   id, name, category, archetype, description, device, accent,
//   style: { background, screenshot, text },   // text = STYLING only, no content
//   frames: [ { name, headline, subheadline, overrides? }, ... ]
// }
//
// `overrides` is a partial { background?, screenshot?, text? } deep-merged over
// `style` for that frame (e.g. alternate the tilt direction, shift the hue).
// The library is intentionally data-only so it can grow without touching app.js.
// ---------------------------------------------------------------------------

(function () {
    const FONT_SF = "-apple-system, BlinkMacSystemFont, 'SF Pro Display'";
    const FONT_GEORGIA = "Georgia, 'Times New Roman', serif";

    // ----- builders (keep every template a complete, valid runtime object) -----

    function grad(angle, stops, extra) {
        return Object.assign({
            type: 'gradient',
            gradient: { angle, stops: stops.map(([color, position]) => ({ color, position })) },
            solid: '#1a1a2e',
            image: null,
            imageFit: 'cover',
            imageBlur: 0,
            overlayColor: '#000000',
            overlayOpacity: 0,
            noise: false,
            noiseIntensity: 10
        }, extra || {});
    }

    function solid(color, extra) {
        return Object.assign({
            type: 'solid',
            gradient: { angle: 135, stops: [{ color: '#667eea', position: 0 }, { color: '#764ba2', position: 100 }] },
            solid: color,
            image: null,
            imageFit: 'cover',
            imageBlur: 0,
            overlayColor: '#000000',
            overlayOpacity: 0,
            noise: false,
            noiseIntensity: 10
        }, extra || {});
    }

    // Full screenshot (device/position) object, overridable per template/frame.
    function shot(o) {
        return Object.assign({
            scale: 70, y: 60, x: 50, rotation: 0, perspective: 0,
            cornerRadius: 24, frameStyle: 'none',
            use3D: false, device3D: 'iphone', rotation3D: { x: 0, y: 0, z: 0 },
            shadow: { enabled: true, style: 'drop', color: '#000000', blur: 40, opacity: 30, x: 0, y: 20, lightAngle: 40, lightElev: 0.65 },
            frame: { enabled: false, color: '#1d1d1f', width: 12, opacity: 100 }
        }, o || {});
    }

    // Text STYLING only — never headlines/subheadlines content or language structures.
    function txt(o) {
        return Object.assign({
            headlineEnabled: true,
            headlineFont: FONT_SF, headlineSize: 100, headlineWeight: '700',
            headlineItalic: false, headlineUnderline: false, headlineStrikethrough: false,
            headlineColor: '#ffffff', headlineOpacity: 100,
            perLanguageLayout: false,
            position: 'top', offsetY: 12, lineHeight: 110,
            subheadlineEnabled: false,
            subheadlineFont: FONT_SF, subheadlineSize: 50, subheadlineWeight: '400',
            subheadlineItalic: false, subheadlineUnderline: false, subheadlineStrikethrough: false,
            subheadlineColor: '#ffffff', subheadlineOpacity: 70
        }, o || {});
    }

    // Convenience for a star-rating text element (social proof). No image to load.
    function ratingElement(text, color) {
        return {
            type: 'text',
            x: 50, y: 30, width: 60, rotation: 0, opacity: 100, layer: 'above-text',
            text: text, texts: { en: text },
            font: FONT_SF, fontSize: 64, fontWeight: '700', fontColor: color || '#ffd60a',
            italic: false, frame: 'none', frameColor: '#ffffff', frameScale: 100,
            name: 'Rating'
        };
    }

    // ----- the curated seed library (expanded further from the gallery UI) -----

    window.SCREENSHOT_TEMPLATES = [
        {
            id: 'aurora-bold',
            name: 'Aurora Bold',
            category: 'Bold',
            archetype: 'benefit-headline',
            description: 'Punchy benefit headline over a vivid aurora gradient, device bleeding from the bottom.',
            device: 'iphone-6.9',
            accent: '#a855f7',
            style: {
                background: grad(160, [['#7c3aed', 0], ['#db2777', 55], ['#f59e0b', 100]]),
                screenshot: shot({ scale: 82, x: 50, y: 122, rotation: 0, cornerRadius: 44, frameStyle: 'modern' }),
                text: txt({ headlineSize: 118, headlineWeight: '800', position: 'top', offsetY: 9, lineHeight: 104 })
            },
            frames: [
                { name: 'Hook', headline: 'Everything in\none place', subheadline: '' },
                { name: 'Feature', headline: 'Built for\nspeed', subheadline: '' },
                { name: 'Payoff', headline: 'Get started\ntoday', subheadline: '' }
            ]
        },
        {
            id: 'midnight-minimal',
            name: 'Midnight Minimal',
            category: 'Minimal',
            archetype: 'full-bleed',
            description: 'Near-black canvas, light caption at the bottom, a calmly floating device.',
            device: 'iphone-6.9',
            accent: '#e5e7eb',
            style: {
                background: solid('#0b0b0f'),
                screenshot: shot({ scale: 66, x: 50, y: 44, rotation: 0, cornerRadius: 40, shadow: { enabled: true, style: 'drop', color: '#000000', blur: 70, opacity: 55, x: 0, y: 30, lightAngle: 40, lightElev: 0.65 } }),
                text: txt({ headlineSize: 92, headlineWeight: '600', headlineColor: '#f5f5f7', position: 'bottom', offsetY: 8, lineHeight: 112 })
            },
            frames: [
                { name: 'Intro', headline: 'Focus on\nwhat matters', subheadline: '' },
                { name: 'Detail', headline: 'Quietly\npowerful', subheadline: '' },
                { name: 'Close', headline: 'Yours, finally', subheadline: '' }
            ]
        },
        {
            id: 'sunset-story',
            name: 'Sunset Story',
            category: 'Bold',
            archetype: 'panoramic',
            description: 'Warm sunset gradient with alternating device tilt — reads as one connected story across frames.',
            device: 'iphone-6.9',
            accent: '#fb7185',
            style: {
                background: grad(135, [['#fb7185', 0], ['#f59e0b', 100]]),
                screenshot: shot({ scale: 64, x: 50, y: 60, rotation: -8, cornerRadius: 40 }),
                text: txt({ headlineSize: 104, headlineWeight: '800', position: 'top', offsetY: 10 })
            },
            frames: [
                { name: 'One', headline: 'Plan your\nday', subheadline: '', overrides: { screenshot: { rotation: -8 } } },
                { name: 'Two', headline: 'Track every\nstep', subheadline: '', overrides: { screenshot: { rotation: 8 } } },
                { name: 'Three', headline: 'Celebrate\nwins', subheadline: '', overrides: { screenshot: { rotation: -8 } } }
            ]
        },
        {
            id: 'ocean-clean',
            name: 'Ocean Clean',
            category: 'App Store',
            archetype: 'benefit-headline',
            description: 'Classic, trustworthy blue gradient with headline + supporting subheadline. The safe default.',
            device: 'iphone-6.9',
            accent: '#38bdf8',
            style: {
                background: grad(150, [['#0ea5e9', 0], ['#2563eb', 100]]),
                screenshot: shot({ scale: 74, x: 50, y: 78, rotation: 0, cornerRadius: 42 }),
                text: txt({ headlineSize: 96, headlineWeight: '700', position: 'top', offsetY: 8, lineHeight: 108, subheadlineEnabled: true, subheadlineSize: 46, subheadlineColor: '#dbeafe', subheadlineOpacity: 90 })
            },
            frames: [
                { name: 'Value', headline: 'Stay in\nsync', subheadline: 'Across all your devices' },
                { name: 'Feature', headline: 'See it\nall', subheadline: 'One dashboard for everything' },
                { name: 'Trust', headline: 'Private by\ndesign', subheadline: 'Your data never leaves you' }
            ]
        },
        {
            id: 'mono-light',
            name: 'Mono Light',
            category: 'Minimal',
            archetype: 'caption-band',
            description: 'Soft light background, dark headline, subtly framed device with a clean shadow.',
            device: 'iphone-6.9',
            accent: '#111827',
            style: {
                background: solid('#f2f2f5'),
                screenshot: shot({ scale: 70, x: 50, y: 74, rotation: 0, cornerRadius: 40, frame: { enabled: true, color: '#111827', width: 10, opacity: 100 }, shadow: { enabled: true, style: 'drop', color: '#000000', blur: 36, opacity: 18, x: 0, y: 18, lightAngle: 40, lightElev: 0.65 } }),
                text: txt({ headlineColor: '#0b0b0f', headlineSize: 92, headlineWeight: '700', position: 'top', offsetY: 9, subheadlineEnabled: true, subheadlineColor: '#3f3f46', subheadlineSize: 44, subheadlineWeight: '500', subheadlineOpacity: 100 })
            },
            frames: [
                { name: 'One', headline: 'Simple,\nby default', subheadline: 'No clutter, no noise' },
                { name: 'Two', headline: 'Fast where\nit counts', subheadline: 'Designed for daily use' },
                { name: 'Three', headline: 'Made for\nyou', subheadline: 'Set it up in seconds' }
            ]
        },
        {
            id: 'neon-pop',
            name: 'Neon Pop',
            category: 'Bold',
            archetype: 'feature-callout',
            description: 'Dark stage with an electric headline and a device on a slight perspective tilt.',
            device: 'iphone-6.9',
            accent: '#22d3ee',
            style: {
                background: grad(135, [['#0f172a', 0], ['#1e1b4b', 100]]),
                screenshot: shot({ scale: 66, x: 50, y: 58, rotation: 0, perspective: 12, cornerRadius: 40 }),
                text: txt({ headlineColor: '#22d3ee', headlineSize: 110, headlineWeight: '800', position: 'top', offsetY: 10, subheadlineEnabled: true, subheadlineColor: '#e2e8f0', subheadlineSize: 44, subheadlineOpacity: 85 })
            },
            frames: [
                { name: 'Hook', headline: 'Go further,\nfaster', subheadline: 'Power tools for power users' },
                { name: 'Feature', headline: 'Automate\nthe boring', subheadline: 'Set rules once, relax' },
                { name: 'Close', headline: 'Level up\ntonight', subheadline: 'Free to start' }
            ]
        },
        {
            id: 'social-proof-pop',
            name: 'Social Proof',
            category: 'App Store',
            archetype: 'social-proof',
            description: 'Lead with a star rating and a confident claim — designed for the trust-building frame.',
            device: 'iphone-6.9',
            accent: '#ffd60a',
            style: {
                background: grad(150, [['#111827', 0], ['#374151', 100]]),
                screenshot: shot({ scale: 70, x: 50, y: 86, rotation: 0, cornerRadius: 42 }),
                text: txt({ headlineSize: 94, headlineWeight: '800', position: 'top', offsetY: 20, lineHeight: 106 }),
                elements: [ratingElement('★★★★★  4.9', '#ffd60a')]
            },
            frames: [
                { name: 'Proof', headline: 'Loved by\nthousands', subheadline: '' },
                { name: 'Feature', headline: 'See why\nthey switched', subheadline: '' },
                { name: 'Close', headline: 'Join them\ntoday', subheadline: '' }
            ]
        },
        {
            id: 'editorial-serif',
            name: 'Editorial',
            category: 'Minimal',
            archetype: 'caption-band',
            description: 'Elegant serif headline on a warm paper background — boutique, premium feel.',
            device: 'iphone-6.9',
            accent: '#92400e',
            style: {
                background: solid('#f5efe6'),
                screenshot: shot({ scale: 68, x: 50, y: 76, rotation: 0, cornerRadius: 40, shadow: { enabled: true, style: 'drop', color: '#3a2f1f', blur: 44, opacity: 22, x: 0, y: 22, lightAngle: 40, lightElev: 0.65 } }),
                text: txt({ headlineFont: FONT_GEORGIA, headlineColor: '#1c1917', headlineSize: 96, headlineWeight: '600', position: 'top', offsetY: 10, lineHeight: 108 })
            },
            frames: [
                { name: 'One', headline: 'Crafted\nwith care', subheadline: '' },
                { name: 'Two', headline: 'Every\ndetail', subheadline: '' },
                { name: 'Three', headline: 'Made to\nlast', subheadline: '' }
            ]
        }
    ];
})();

// ---- Curated, judged additions (authored by theme, scored for appeal & legibility) ----
// Generated and curated 2026-05-29. Plain JSON; runtime completion in app.js
// (completeTemplateBackground/Screenshot + normalizeTextSettings) backfills any
// omitted fields so each remains a valid, render-safe template.
window.SCREENSHOT_TEMPLATES.push(
{
    "id": "indigo-trust",
    "name": "Indigo Trust",
    "category": "App Store",
    "archetype": "benefit-headline",
    "description": "Deep indigo-to-blue gradient with a confident benefit headline up top and the device sitting low. The dependable productivity default.",
    "device": "iphone-6.9",
    "accent": "#6366f1",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 150,
                "stops": [
                    {
                        "color": "#4338ca",
                        "position": 0
                    },
                    {
                        "color": "#3b82f6",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 74,
            "x": 50,
            "y": 80,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 46,
                "opacity": 28,
                "x": 0,
                "y": 24,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 98,
            "headlineWeight": "700",
            "headlineItalic": false,
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 9,
            "lineHeight": 108,
            "subheadlineEnabled": true,
            "subheadlineColor": "#c7d2fe",
            "subheadlineSize": 46,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 95
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Stay on top\nof everything",
            "subheadline": "Your whole day, organized"
        },
        {
            "name": "Feature",
            "headline": "Plan in\nseconds",
            "subheadline": "Smart scheduling that adapts"
        },
        {
            "name": "Payoff",
            "headline": "Finish more,\nstress less",
            "subheadline": "Free to get started"
        }
    ]
},
{
    "id": "slate-pro",
    "name": "Slate Pro",
    "category": "App Store",
    "archetype": "caption-band",
    "description": "Refined slate-to-navy gradient with a bottom caption band and a floating device. Premium, enterprise, finance-grade.",
    "device": "iphone-6.9",
    "accent": "#3b82f6",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 160,
                "stops": [
                    {
                        "color": "#0f172a",
                        "position": 0
                    },
                    {
                        "color": "#1e293b",
                        "position": 60
                    },
                    {
                        "color": "#1d4ed8",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 66,
            "x": 50,
            "y": 46,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 60,
                "opacity": 45,
                "x": 0,
                "y": 28,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#f8fafc",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 90,
            "headlineWeight": "600",
            "headlineItalic": false,
            "headlineOpacity": 100,
            "position": "bottom",
            "offsetY": 8,
            "lineHeight": 110,
            "subheadlineEnabled": true,
            "subheadlineColor": "#93c5fd",
            "subheadlineSize": 44,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 92
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Money, made\nclear",
            "subheadline": "Every account in one view"
        },
        {
            "name": "Feature",
            "headline": "Spot trends\ninstantly",
            "subheadline": "Insights that do the math"
        },
        {
            "name": "Payoff",
            "headline": "Save with\nconfidence",
            "subheadline": "Bank-level security, always"
        }
    ]
},
{
    "id": "sky-clean",
    "name": "Sky Clean",
    "category": "App Store",
    "archetype": "benefit-headline",
    "description": "Airy off-white canvas with dark headline and a softly framed device. Bright, honest, and approachable.",
    "device": "iphone-6.9",
    "accent": "#0ea5e9",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 165,
                "stops": [
                    {
                        "color": "#f8fafc",
                        "position": 0
                    },
                    {
                        "color": "#e0f2fe",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 72,
            "x": 50,
            "y": 78,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "frame": {
                "enabled": true,
                "color": "#0f172a",
                "width": 10,
                "opacity": 100
            },
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#0c4a6e",
                "blur": 40,
                "opacity": 18,
                "x": 0,
                "y": 20,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#0b1220",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 94,
            "headlineWeight": "700",
            "headlineItalic": false,
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 9,
            "lineHeight": 108,
            "subheadlineEnabled": false,
            "subheadlineColor": "#0369a1",
            "subheadlineSize": 44,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Work feels\neffortless",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "Sync across\nevery device",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Ready when\nyou are",
            "subheadline": ""
        }
    ]
},
{
    "id": "ocean-depth",
    "name": "Ocean Depth",
    "category": "App Store",
    "archetype": "feature-callout",
    "description": "Cool cyan-to-blue gradient with a low device and a roomy headline. Trustworthy with a touch of energy.",
    "device": "iphone-6.9",
    "accent": "#22d3ee",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 140,
                "stops": [
                    {
                        "color": "#0891b2",
                        "position": 0
                    },
                    {
                        "color": "#2563eb",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 78,
            "x": 50,
            "y": 116,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#082f49",
                "blur": 50,
                "opacity": 32,
                "x": 0,
                "y": 26,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 110,
            "headlineWeight": "800",
            "headlineItalic": false,
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 10,
            "lineHeight": 104,
            "subheadlineEnabled": false,
            "subheadlineColor": "#cffafe",
            "subheadlineSize": 46,
            "subheadlineWeight": "400",
            "subheadlineOpacity": 90
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Reach your\ngoals",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "See progress\nin real time",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Stay on\ntrack daily",
            "subheadline": ""
        }
    ]
},
{
    "id": "electric-duotone",
    "name": "Electric Duotone",
    "category": "Bold",
    "archetype": "duotone",
    "description": "High-voltage magenta-to-cyan duotone wash with a heavy device bleed and oversized white headline punching off the top.",
    "device": "iphone-6.9",
    "accent": "#d946ef",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 145,
                "stops": [
                    {
                        "color": "#d946ef",
                        "position": 0
                    },
                    {
                        "color": "#7c3aed",
                        "position": 48
                    },
                    {
                        "color": "#06b6d4",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 84,
            "x": 50,
            "y": 120,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 60,
                "opacity": 40,
                "x": 0,
                "y": 24
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 116,
            "headlineWeight": "800",
            "position": "top",
            "offsetY": 9,
            "lineHeight": 104,
            "subheadlineEnabled": false
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Feel the\nrush",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "Mix beats\ninstantly",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Drop your\nfirst track",
            "subheadline": ""
        }
    ]
},
{
    "id": "neon-grid-dark",
    "name": "Neon Grid Dark",
    "category": "Bold",
    "archetype": "feature-callout",
    "description": "Neon-on-near-black look with a deep violet glow, floating device, and an electric-lime callout subheadline under each big white headline.",
    "device": "iphone-6.9",
    "accent": "#a3e635",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 160,
                "stops": [
                    {
                        "color": "#1e1b4b",
                        "position": 0
                    },
                    {
                        "color": "#0b0b14",
                        "position": 60
                    },
                    {
                        "color": "#000000",
                        "position": 100
                    }
                ]
            },
            "noise": true,
            "noiseIntensity": 8
        },
        "screenshot": {
            "scale": 68,
            "x": 50,
            "y": 70,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#a3e635",
                "blur": 90,
                "opacity": 28,
                "x": 0,
                "y": 26
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 104,
            "headlineWeight": "800",
            "position": "top",
            "offsetY": 11,
            "lineHeight": 106,
            "subheadlineEnabled": true,
            "subheadlineColor": "#a3e635",
            "subheadlineSize": 46,
            "subheadlineWeight": "600",
            "subheadlineOpacity": 95
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Level up\ntonight",
            "subheadline": "Your daily streak awaits"
        },
        {
            "name": "Feature",
            "headline": "Compete\nlive",
            "subheadline": "Real-time global leaderboards"
        },
        {
            "name": "Payoff",
            "headline": "Claim the\ncrown",
            "subheadline": "Win rewards every week"
        }
    ]
},
{
    "id": "hyper-fullbleed",
    "name": "Hyper Full-Bleed",
    "category": "Bold",
    "archetype": "full-bleed",
    "description": "Saturated indigo-to-hot-pink full-bleed with a giant device dominating the frame and a bold bottom caption.",
    "device": "iphone-6.9",
    "accent": "#ec4899",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 150,
                "stops": [
                    {
                        "color": "#4f46e5",
                        "position": 0
                    },
                    {
                        "color": "#9333ea",
                        "position": 50
                    },
                    {
                        "color": "#ec4899",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 90,
            "x": 50,
            "y": 52,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 70,
                "opacity": 42,
                "x": 0,
                "y": 30
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 110,
            "headlineWeight": "800",
            "position": "bottom",
            "offsetY": 8,
            "lineHeight": 104,
            "subheadlineEnabled": false
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Go viral\nfaster",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "Trends at\nyour fingertips",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Grow your\naudience",
            "subheadline": ""
        }
    ]
},
{
    "id": "acid-pop-duo",
    "name": "Acid Pop Duo",
    "category": "Bold",
    "archetype": "duotone",
    "description": "Punchy lime-to-teal duotone with dark legible headlines, a subtle device tilt, and an energetic playful feel for creative apps.",
    "device": "iphone-6.9",
    "accent": "#84cc16",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 135,
                "stops": [
                    {
                        "color": "#bef264",
                        "position": 0
                    },
                    {
                        "color": "#34d399",
                        "position": 55
                    },
                    {
                        "color": "#14b8a6",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 72,
            "x": 50,
            "y": 66,
            "rotation": 5,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#064e3b",
                "blur": 50,
                "opacity": 30,
                "x": 0,
                "y": 22
            }
        },
        "text": {
            "headlineColor": "#0b0b0f",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 112,
            "headlineWeight": "800",
            "position": "top",
            "offsetY": 10,
            "lineHeight": 104,
            "subheadlineEnabled": false
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Create\nout loud",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "Design with\nbold tools",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Publish in\na tap",
            "subheadline": ""
        }
    ]
},
{
    "id": "ink-full-bleed",
    "name": "Ink",
    "category": "Minimal",
    "archetype": "full-bleed",
    "description": "Near-black canvas with a lighter-weight headline at the top and the device floating low into the frame. Generous negative space, quiet and confident.",
    "device": "iphone-6.9",
    "accent": "#e7e5e4",
    "style": {
        "background": {
            "type": "solid",
            "solid": "#0c0d10"
        },
        "screenshot": {
            "scale": 64,
            "x": 50,
            "y": 96,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 80,
                "opacity": 50,
                "x": 0,
                "y": 34,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineColor": "#f4f4f5",
            "headlineSize": 88,
            "headlineWeight": "500",
            "position": "top",
            "offsetY": 13,
            "lineHeight": 112,
            "headlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Less, but\nbetter",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "Quiet by\ndesign",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Begin\ntonight",
            "subheadline": ""
        }
    ]
},
{
    "id": "paper-caption",
    "name": "Paper",
    "category": "Minimal",
    "archetype": "caption-band",
    "description": "Soft off-white paper background with a dark medium-weight caption sitting low under a calmly floating device. Airy, restrained, premium.",
    "device": "iphone-6.9",
    "accent": "#1c1917",
    "style": {
        "background": {
            "type": "solid",
            "solid": "#faf8f4"
        },
        "screenshot": {
            "scale": 62,
            "x": 50,
            "y": 48,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#2b2620",
                "blur": 50,
                "opacity": 16,
                "x": 0,
                "y": 26,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineColor": "#16140f",
            "headlineSize": 86,
            "headlineWeight": "500",
            "position": "bottom",
            "offsetY": 11,
            "lineHeight": 112,
            "headlineOpacity": 100,
            "subheadlineEnabled": true,
            "subheadlineColor": "#57534e",
            "subheadlineSize": 42,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "Intro",
            "headline": "Calm and\nclear",
            "subheadline": "Nothing you don't need"
        },
        {
            "name": "Detail",
            "headline": "Space to\nthink",
            "subheadline": "Designed to disappear"
        },
        {
            "name": "Close",
            "headline": "Simply\nyours",
            "subheadline": "Ready in moments"
        }
    ]
},
{
    "id": "noir-serif-editorial",
    "name": "Noir Serif",
    "category": "Minimal",
    "archetype": "editorial",
    "description": "Charcoal-black stage with an elegant serif headline up top and a low, framed device. Reads like the cover of a design quarterly.",
    "device": "iphone-6.9",
    "accent": "#d6d3d1",
    "style": {
        "background": {
            "type": "solid",
            "solid": "#121110"
        },
        "screenshot": {
            "scale": 66,
            "x": 50,
            "y": 92,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "none",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 64,
                "opacity": 46,
                "x": 0,
                "y": 30,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineFont": "Georgia, 'Times New Roman', serif",
            "headlineColor": "#f5f3ef",
            "headlineSize": 96,
            "headlineWeight": "500",
            "headlineItalic": false,
            "position": "top",
            "offsetY": 12,
            "lineHeight": 108,
            "headlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "One",
            "headline": "Made with\nintention",
            "subheadline": ""
        },
        {
            "name": "Two",
            "headline": "Refined to\nthe detail",
            "subheadline": ""
        },
        {
            "name": "Three",
            "headline": "Yours to\nkeep",
            "subheadline": ""
        }
    ]
},
{
    "id": "linen-serif-editorial",
    "name": "Linen Serif",
    "category": "Minimal",
    "archetype": "editorial",
    "description": "Warm linen off-white with a serif headline and a quiet supporting line. Boutique, magazine-like, with a gentle shadow grounding the device.",
    "device": "iphone-6.9",
    "accent": "#44403c",
    "style": {
        "background": {
            "type": "solid",
            "solid": "#f3efe7"
        },
        "screenshot": {
            "scale": 64,
            "x": 50,
            "y": 80,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "none",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#36302610",
                "blur": 46,
                "opacity": 18,
                "x": 0,
                "y": 24,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineFont": "Georgia, 'Times New Roman', serif",
            "headlineColor": "#1c1917",
            "headlineSize": 92,
            "headlineWeight": "500",
            "position": "top",
            "offsetY": 11,
            "lineHeight": 108,
            "headlineOpacity": 100,
            "subheadlineEnabled": true,
            "subheadlineColor": "#57534e",
            "subheadlineSize": 40,
            "subheadlineWeight": "400",
            "subheadlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "One",
            "headline": "A thoughtful\nstart",
            "subheadline": "Considered, not crowded"
        },
        {
            "name": "Two",
            "headline": "Crafted to\nfeel right",
            "subheadline": "Every detail in place"
        },
        {
            "name": "Three",
            "headline": "Built to\nlast",
            "subheadline": "Made for the long run"
        }
    ]
},
{
    "id": "slate-soft-minimal",
    "name": "Slate",
    "category": "Minimal",
    "archetype": "full-bleed",
    "description": "Cool deep-slate solid with an airy off-white headline and a device set slightly low. Understated, modern, and calm without going pure black.",
    "device": "iphone-6.9",
    "accent": "#94a3b8",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 160,
                "stops": [
                    {
                        "color": "#1e2430",
                        "position": 0
                    },
                    {
                        "color": "#14181f",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 66,
            "x": 50,
            "y": 88,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 70,
                "opacity": 44,
                "x": 0,
                "y": 30,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineColor": "#eef2f6",
            "headlineSize": 90,
            "headlineWeight": "600",
            "position": "top",
            "offsetY": 13,
            "lineHeight": 110,
            "headlineOpacity": 100,
            "subheadlineEnabled": true,
            "subheadlineColor": "#aeb8c4",
            "subheadlineSize": 42,
            "subheadlineWeight": "400",
            "subheadlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Clarity,\nfound",
            "subheadline": "Everything in its place"
        },
        {
            "name": "Feature",
            "headline": "Effortless\nby nature",
            "subheadline": "Works the way you think"
        },
        {
            "name": "Payoff",
            "headline": "Move with\nease",
            "subheadline": "Start in seconds"
        }
    ]
},
{
    "id": "mango-sunrise",
    "name": "Mango Sunrise",
    "category": "Playful",
    "archetype": "benefit-headline",
    "description": "A sunny yellow-to-coral-to-pink gradient with a low, bottom-bleeding device. Deep ink headlines pop hard against the warm brightness for crisp contrast.",
    "device": "iphone-6.9",
    "accent": "#fbbf24",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 160,
                "stops": [
                    {
                        "color": "#fde047",
                        "position": 0
                    },
                    {
                        "color": "#fb923c",
                        "position": 55
                    },
                    {
                        "color": "#f472b6",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 80,
            "x": 50,
            "y": 120,
            "rotation": 5,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#7c2d12",
                "blur": 50,
                "opacity": 28,
                "x": 0,
                "y": 22
            }
        },
        "text": {
            "headlineColor": "#1c1917",
            "headlineSize": 116,
            "headlineWeight": "800",
            "position": "top",
            "offsetY": 9,
            "lineHeight": 104,
            "subheadlineEnabled": false
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Start your\nday happy",
            "subheadline": ""
        },
        {
            "name": "Feature",
            "headline": "Track every\nlittle win",
            "subheadline": ""
        },
        {
            "name": "Payoff",
            "headline": "Glow up\nyour routine",
            "subheadline": ""
        }
    ]
},
{
    "id": "cotton-candy-dream",
    "name": "Cotton Candy Dream",
    "category": "Playful",
    "archetype": "caption-band",
    "description": "Soft lavender-to-pink-to-peach pastel gradient with a gently tilted floating device and supporting subheadlines. Dark plum text keeps the dreamy palette legible.",
    "device": "iphone-6.9",
    "accent": "#c084fc",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 135,
                "stops": [
                    {
                        "color": "#c4b5fd",
                        "position": 0
                    },
                    {
                        "color": "#f9a8d4",
                        "position": 50
                    },
                    {
                        "color": "#fed7aa",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 64,
            "x": 50,
            "y": 70,
            "rotation": -5,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#581c87",
                "blur": 48,
                "opacity": 24,
                "x": 0,
                "y": 20
            }
        },
        "text": {
            "headlineColor": "#3b0764",
            "headlineSize": 98,
            "headlineWeight": "700",
            "position": "top",
            "offsetY": 8,
            "lineHeight": 108,
            "subheadlineEnabled": true,
            "subheadlineColor": "#6b21a8",
            "subheadlineSize": 46,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 90
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Sweeten\nyour days",
            "subheadline": "Little moments, made magical"
        },
        {
            "name": "Feature",
            "headline": "Save the\ngood stuff",
            "subheadline": "Keep memories close, always"
        },
        {
            "name": "Payoff",
            "headline": "Pure\nhappiness",
            "subheadline": "Your daily dose of delight"
        }
    ]
},
{
    "id": "mint-splash",
    "name": "Mint Splash",
    "category": "Playful",
    "archetype": "feature-callout",
    "description": "A fresh mint-to-teal-to-sky gradient with a bouncy tilt and bottom captions. Deep navy headlines stay sharp and readable across the cool brightness.",
    "device": "iphone-6.9",
    "accent": "#2dd4bf",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 150,
                "stops": [
                    {
                        "color": "#6ee7b7",
                        "position": 0
                    },
                    {
                        "color": "#2dd4bf",
                        "position": 50
                    },
                    {
                        "color": "#60a5fa",
                        "position": 100
                    }
                ]
            }
        },
        "screenshot": {
            "scale": 68,
            "x": 50,
            "y": 50,
            "rotation": 6,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#0f766e",
                "blur": 52,
                "opacity": 30,
                "x": 0,
                "y": 24
            }
        },
        "text": {
            "headlineColor": "#0c1f3f",
            "headlineSize": 108,
            "headlineWeight": "800",
            "position": "bottom",
            "offsetY": 10,
            "lineHeight": 106,
            "subheadlineEnabled": false
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Fresh ideas\nevery day",
            "subheadline": "",
            "overrides": {
                "screenshot": {
                    "rotation": 6
                }
            }
        },
        {
            "name": "Feature",
            "headline": "Splash into\nsomething new",
            "subheadline": "",
            "overrides": {
                "screenshot": {
                    "rotation": -6
                }
            }
        },
        {
            "name": "Payoff",
            "headline": "Dive in\nfor free",
            "subheadline": "",
            "overrides": {
                "screenshot": {
                    "rotation": 6
                }
            }
        }
    ]
},
{
    "id": "story-spotlight-violet",
    "name": "Story Spotlight",
    "category": "Social",
    "archetype": "full-bleed",
    "description": "Vertical IG-story promo with a bold centered headline over an electric violet-to-magenta gradient and a device rising from the bottom edge.",
    "device": "social-ig-story",
    "accent": "#8b5cf6",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 155,
                "stops": [
                    {
                        "color": "#6d28d9",
                        "position": 0
                    },
                    {
                        "color": "#a21caf",
                        "position": 55
                    },
                    {
                        "color": "#ec4899",
                        "position": 100
                    }
                ]
            },
            "noise": true,
            "noiseIntensity": 8,
            "overlayColor": "#000000",
            "overlayOpacity": 8
        },
        "screenshot": {
            "scale": 68,
            "x": 50,
            "y": 116,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#1e0a3c",
                "blur": 60,
                "opacity": 45,
                "x": 0,
                "y": 24,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 112,
            "headlineWeight": "800",
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 14,
            "lineHeight": 106,
            "subheadlineEnabled": true,
            "subheadlineColor": "#f5d0fe",
            "subheadlineSize": 50,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 95
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Swipe up to\nlevel up",
            "subheadline": "The app everyone's posting about"
        },
        {
            "name": "Feature",
            "headline": "All your wins,\none feed",
            "subheadline": "Share progress in a tap"
        },
        {
            "name": "Payoff",
            "headline": "Download\nfree today",
            "subheadline": "Link in bio"
        }
    ]
},
{
    "id": "story-midnight-reel",
    "name": "Midnight Reel",
    "category": "Social",
    "archetype": "full-bleed",
    "description": "Cinematic dark vertical story for reels, with a glowing cyan accent headline and a centered device floating over deep ink-blue.",
    "device": "social-ig-story",
    "accent": "#22d3ee",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 165,
                "stops": [
                    {
                        "color": "#020617",
                        "position": 0
                    },
                    {
                        "color": "#0f172a",
                        "position": 60
                    },
                    {
                        "color": "#164e63",
                        "position": 100
                    }
                ]
            },
            "noise": true,
            "noiseIntensity": 6,
            "overlayColor": "#000000",
            "overlayOpacity": 0
        },
        "screenshot": {
            "scale": 64,
            "x": 50,
            "y": 110,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 44,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 75,
                "opacity": 60,
                "x": 0,
                "y": 30,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#22d3ee",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 116,
            "headlineWeight": "800",
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 13,
            "lineHeight": 104,
            "subheadlineEnabled": true,
            "subheadlineColor": "#e2e8f0",
            "subheadlineSize": 48,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 90
        }
    },
    "frames": [
        {
            "name": "Hook",
            "headline": "Tap to see\nthe glow up",
            "subheadline": "New drop is live"
        },
        {
            "name": "Feature",
            "headline": "Built for\nthe night shift",
            "subheadline": "Dark mode that actually slaps"
        },
        {
            "name": "Payoff",
            "headline": "Get it on\nthe App Store",
            "subheadline": "Free, no catch"
        }
    ]
},
{
    "id": "before-after-shift",
    "name": "Before / After",
    "category": "App Store",
    "archetype": "before-after",
    "description": "A two-state transformation story: a cool muted 'before' frame flips to a vibrant green 'after' payoff, with the device tilting to mirror the change.",
    "device": "iphone-6.9",
    "accent": "#10b981",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 145,
                "stops": [
                    {
                        "color": "#0f766e",
                        "position": 0
                    },
                    {
                        "color": "#059669",
                        "position": 100
                    }
                ]
            },
            "noise": false,
            "noiseIntensity": 10,
            "overlayColor": "#000000",
            "overlayOpacity": 0
        },
        "screenshot": {
            "scale": 72,
            "x": 50,
            "y": 80,
            "rotation": -6,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#022c22",
                "blur": 48,
                "opacity": 38,
                "x": 0,
                "y": 22,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#ffffff",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 100,
            "headlineWeight": "800",
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 10,
            "lineHeight": 106,
            "subheadlineEnabled": true,
            "subheadlineColor": "#d1fae5",
            "subheadlineSize": 46,
            "subheadlineWeight": "500",
            "subheadlineOpacity": 92
        }
    },
    "frames": [
        {
            "name": "Before",
            "headline": "Before:\nchaos everywhere",
            "subheadline": "Tabs, notes, lost links",
            "overrides": {
                "background": {
                    "type": "gradient",
                    "gradient": {
                        "angle": 145,
                        "stops": [
                            {
                                "color": "#334155",
                                "position": 0
                            },
                            {
                                "color": "#475569",
                                "position": 100
                            }
                        ]
                    }
                },
                "screenshot": {
                    "rotation": -6
                },
                "text": {
                    "subheadlineColor": "#e2e8f0"
                }
            }
        },
        {
            "name": "After",
            "headline": "After:\none calm home",
            "subheadline": "Everything finally in order",
            "overrides": {
                "screenshot": {
                    "rotation": 6
                }
            }
        },
        {
            "name": "Payoff",
            "headline": "Make the\nswitch today",
            "subheadline": "Set up in under a minute",
            "overrides": {
                "screenshot": {
                    "rotation": -6
                }
            }
        }
    ]
},
{
    "id": "five-star-trust",
    "name": "Five-Star Trust",
    "category": "App Store",
    "archetype": "social-proof",
    "description": "Opens on a five-star rating and a million-strong user count for instant credibility, then earns the install across a warm amber-on-charcoal set.",
    "device": "iphone-6.9",
    "accent": "#fbbf24",
    "style": {
        "background": {
            "type": "gradient",
            "gradient": {
                "angle": 155,
                "stops": [
                    {
                        "color": "#171717",
                        "position": 0
                    },
                    {
                        "color": "#292524",
                        "position": 60
                    },
                    {
                        "color": "#451a03",
                        "position": 100
                    }
                ]
            },
            "noise": false,
            "noiseIntensity": 10,
            "overlayColor": "#000000",
            "overlayOpacity": 0
        },
        "screenshot": {
            "scale": 70,
            "x": 50,
            "y": 88,
            "rotation": 0,
            "perspective": 0,
            "cornerRadius": 42,
            "frameStyle": "modern",
            "shadow": {
                "enabled": true,
                "style": "drop",
                "color": "#000000",
                "blur": 50,
                "opacity": 45,
                "x": 0,
                "y": 24,
                "lightAngle": 40,
                "lightElev": 0.65
            }
        },
        "text": {
            "headlineColor": "#fbbf24",
            "headlineFont": "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            "headlineSize": 96,
            "headlineWeight": "800",
            "headlineOpacity": 100,
            "position": "top",
            "offsetY": 11,
            "lineHeight": 106,
            "subheadlineEnabled": true,
            "subheadlineColor": "#f5f5f4",
            "subheadlineSize": 48,
            "subheadlineWeight": "600",
            "subheadlineOpacity": 100
        }
    },
    "frames": [
        {
            "name": "Proof",
            "headline": "★★★★★\n2M+ happy users",
            "subheadline": "Rated 4.9 on the App Store"
        },
        {
            "name": "Feature",
            "headline": "See why\nthey stay",
            "subheadline": "Reviewers call it a game-changer"
        },
        {
            "name": "Payoff",
            "headline": "Join the\ncommunity",
            "subheadline": "Free to download today"
        }
    ]
}
);

// ---------------------------------------------------------------------------
// 3D presentation layer
// ---------------------------------------------------------------------------
// Render every template on the real 3D HD device (Three.js iPhone) instead of a
// flat 2D image. This replaces each template's `style.screenshot` block with a
// 3D config (use3D + a tasteful per-archetype camera angle) and converts any
// per-frame 2D tilt into a 3D camera yaw. Backgrounds, text styling, and
// captions are left untouched. Kept as a single post-process so the device
// angles for the whole library can be tuned in one place.
(function applyThreeDPresentation() {
    const list = window.SCREENSHOT_TEMPLATES;
    if (!Array.isArray(list)) return;

    // archetype -> base camera pitch(x)/yaw(y) in degrees
    const POSE = {
        'benefit-headline': { x: 4, y: -16 },
        'feature-callout':  { x: 5, y: 18 },
        'caption-band':     { x: 2, y: -8 },
        'full-bleed':       { x: 3, y: -12 },
        'social-proof':     { x: 2, y: 0 },
        'before-after':     { x: 0, y: 0 },
        'duotone':          { x: 6, y: -20 },
        'panoramic':        { x: 5, y: -18 },
        'editorial':        { x: 0, y: -6 },
        'default':          { x: 4, y: -14 }
    };

    // Sit the device opposite the headline so they don't collide.
    function deviceY(text) {
        const pos = (text && text.position) || 'top';
        if (pos === 'bottom') return 46;
        if (pos === 'center' || pos === 'middle') return 50;
        return 57; // headline top -> device a touch lower
    }

    function shot3D(pose, y) {
        return {
            use3D: true, device3D: 'iphone',
            scale: 70, x: 50, y: y,
            rotation: 0, perspective: 0, cornerRadius: 24, frameStyle: 'none',
            rotation3D: { x: pose.x, y: pose.y, z: 0 },
            placeholderDevice: true,
            shadow: { enabled: true, style: 'drop', color: '#000000', blur: 64, opacity: 34, x: 0, y: 30, lightAngle: 40, lightElev: 0.65 },
            frame: { enabled: false, color: '#1d1d1f', width: 12, opacity: 100 }
        };
    }

    list.forEach(t => {
        const pose = POSE[t.archetype] || POSE.default;
        t.style = t.style || {};
        t.style.screenshot = shot3D(pose, deviceY(t.style.text));
        if (!Array.isArray(t.frames)) return;
        // Drop stale 2D transform overrides (rotation/perspective) — meaningless in 3D.
        t.frames.forEach(f => {
            if (f.overrides && f.overrides.screenshot) {
                delete f.overrides.screenshot.rotation;
                delete f.overrides.screenshot.perspective;
            }
        });
        // Panoramic sets read as one turning device: alternate the camera yaw per frame.
        if (t.archetype === 'panoramic') {
            t.frames.forEach((f, i) => {
                f.overrides = f.overrides || {};
                f.overrides.screenshot = Object.assign({}, f.overrides.screenshot, {
                    rotation3D: { x: pose.x, y: (i % 2 === 0 ? pose.y : -pose.y), z: 0 }
                });
            });
        }
    });
})();
