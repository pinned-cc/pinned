// Writes design/tokens/*.json (W3C DTCG) from web/app.css as it is at Pinned 0.1.11.
// The token files are the source of truth from here on; this script records how they were taken, so a later reader can
// see that every value came from the stylesheet and from which line. Run: node scripts/extract-tokens.mjs
//
// Two kinds of token:
//   named tokens: every custom property of :root (dark, the default) and :root[data-theme="light"], under a role name,
//     plus the values the stylesheet writes out without a property (font weights, durations, easings, tracking, 50%).
//   part tokens (group "part"): a colour, shadow, gradient, radius, space, font size or line height written straight into
//     one rule, named after the rule's selector and property. They are the values a later pass may fold into named tokens.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declarations, splitTop, parseColor, COLOR_RE, customProps } from './lib/css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CSS = join(ROOT, 'web', 'app.css');
const SRC = relative(ROOT, CSS);
const OUT = join(HERE, '..', 'tokens');
const NS = 'cc.pinned';

const decls = declarations(readFileSync(CSS, 'utf8'));
const dark = customProps(decls, ':root');
const light = customProps(decls, ':root[data-theme="light"]');
const at = (line) => `${SRC}:${line}`;

// ---------------------------------------------------------------- the role name of every custom property
const COLOR = {
  '--ground-base': ['ground.app', 'The one flat colour behind the whole app, sidebar included (html, body::before).'],
  '--ground': ['ground.page', 'The ground of the save page; the text of the chosen How to save tab.'],
  '--screen': ['ground.screen', 'The ring around the tick badge of the All sorted pile.'],
  '--surface': ['surface.base', 'Cards, the search, fields, list rows while moving.'],
  '--surface-up': ['surface.raised', 'Menus, the palette, toasts, the chosen segment, the kbd keys.'],
  '--sheet': ['surface.sheet', 'Sheets and dialogs where they are solid.'],
  '--recess': ['surface.recess', 'The back card of the All sorted pile.'],
  '--fold': ['surface.folder', 'Folder tiles and the folder chips.'],
  '--line': ['edge.default', 'Hairlines and the rim of cards and fields.'],
  '--line-2': ['edge.strong', 'Buttons, menus, the selection bar, scrollbars.'],
  '--ink': ['text.default', 'Default text.'],
  '--ink-weak': ['text.weak', 'Secondary text: counts, hosts, labels, placeholders.'],
  '--ink-faint': ['text.faint', 'The faintest text, the key names of How to save.'],
  '--accent': ['accent.default', 'The one accent: the plus, Save, the picked tick, focus outlines.'],
  '--accent-ink': ['accent.on-accent', 'Text and icons on the accent.'],
  '--accent-soft': ['accent.text', 'The accent as text: text buttons, links, toast actions.'],
  '--danger': ['danger.default', 'Delete, warnings, field errors.'],
  '--cyan': ['hue.cyan.base', 'Folder hue cyan: the folder icon and dot.'], '--cyan-p': ['hue.cyan.text', 'Folder hue cyan: text on its tint.'],
  '--coral': ['hue.coral.base', 'Folder hue coral: the folder icon and dot.'], '--coral-p': ['hue.coral.text', 'Folder hue coral: text on its tint.'],
  '--lilac': ['hue.lilac.base', 'Folder hue lilac: the folder icon and dot.'], '--lilac-p': ['hue.lilac.text', 'Folder hue lilac: text on its tint.'],
  '--lime': ['hue.lime.base', 'Folder hue lime: the folder icon and dot.'], '--lime-p': ['hue.lime.text', 'Folder hue lime: text on its tint.'],
  '--mint': ['hue.mint.base', 'Folder hue mint: the folder icon and dot.'], '--mint-p': ['hue.mint.text', 'Folder hue mint: text on its tint.'],
  '--rose': ['hue.rose.base', 'Folder hue rose: the folder icon and dot.'], '--rose-p': ['hue.rose.text', 'Folder hue rose: text on its tint.'],
  '--ink-h': ['hue.ink.base', 'The ink hue of All bookmarks and the Dashboard.'], '--ink-hp': ['hue.ink.text', 'The ink hue: text on its tint.'],
  '--tray': ['hue.inbox.base', 'The Inbox hue.'], '--tray-p': ['hue.inbox.text', 'The Inbox hue: text on its tint.'],
  '--bin': ['hue.trash.base', 'The Trash hue.'], '--bin-p': ['hue.trash.text', 'The Trash hue: text on its tint.'],
  '--plain': ['hue.plain.base', 'A folder without a hue.'], '--plain-p': ['hue.plain.text', 'A folder without a hue: text on its tint.'],
  '--tile-blank': ['surface.favicon-blank', 'The tile behind a letter, a favicon without colour of its own, a favicon that fails.'],
  '--hover': ['state.hover', 'The veil under a row or item on hover.'],
  '--press': ['state.press', 'The veil under a pressed control.'],
  '--picked-edge': ['state.picked-edge', 'The edge of a picked card or folder.'],
  '--picked-fill': ['state.picked-fill', 'The fill of a picked list row.'],
  '--card-tint': ['glass.card', 'Grid cards on the ground: a clear tint.'],
  '--fold-tint': ['glass.folder', 'Folder tiles on the ground: a clear tint.'],
  '--strip-tint': ['glass.strip', 'The strip at the foot of a card.'],
  '--card-rim': ['glass.rim', 'The rim of a tinted card.'],
  '--card-rim-hover': ['glass.rim-hover', 'The rim of a tinted card on hover.'],
  '--glass-side': ['glass.sidebar', 'The sidebar fill over its blur.'],
  '--glass-menu': ['glass.menu', 'Menus over their blur.'],
  '--glass-panel': ['glass.panel', 'The palette over its blur.'],
  '--glass-sheet': ['glass.sheet', 'Sheets and dialogs over their blur, desktop.'],
  '--glass-sheet-phone': ['glass.sheet-phone', 'Sheets over their blur, phone.'],
  '--glass-rows': ['glass.action-sheet', 'A sheet of action rows over busy cards.'],
  '--save-field': ['save.field', 'Fields on the save page.'],
};
const SHADOW = {
  '--focus-glow': ['focus.ring', 'The focus ring of the search and the bulb.'],
  '--focus-field': ['focus.field', 'The focus glow of a field.'],
  '--edge-top': ['edge.top-light', 'The lit top edge of sheets.'],
  '--shadow-hover': ['elevation.hover', 'A card under the pointer.'],
  '--shadow-lift': ['elevation.lift', 'A card lifted by a hold or carried by a drag.'],
  '--shadow-float': ['elevation.float', 'The phone search and plus over the grid.'],
  '--shadow-glass': ['elevation.glass', 'Panels over a blur: sheets, the palette, menus.'],
  '--card-shadow': ['elevation.card', 'A card resting on the ground.'],
  '--save-edge': ['save.edge', 'The lit edge and shadow of the save panel.'],
};
const GRADIENT = {
  '--ground-light': ['ground.light', 'A light over the ground; none at 0.1.11 (transparent).'],
  '--save-ground': ['save.ground', 'The faint light on the save page ground.'],
  '--save-sheet': ['save.sheet', 'The save panel surface.'],
  '--save-light': ['save.light', 'The corner light inside the save panel.'],
};
const BLUR = {
  '--blur-side': ['sidebar', 'The sidebar backdrop filter.'],
  '--blur-menu': ['menu', 'The menu backdrop filter.'],
  '--blur-panel': ['panel', 'Sheets and the palette, backdrop filter.'],
};
const EASING = {
  '--ease-out': ['out', 'The default ease out of every transition.'],
  '--ease-drawer': ['drawer', 'A sheet sliding up.'],
  '--ease-soft': ['soft', 'The save panel: a long ease out that lands softly.'],
  '--ease-glide': ['glide', 'The save panel: a calm glide for its light and form.'],
  '--ease-draw': ['draw', 'The save tick drawing its stroke.'],
};
const FAMILY = { '--sans': ['sans', 'Geist, every text but code, hosts and headlines.'], '--mono': ['mono', 'Geist Mono: hosts, tokens, code.'], '--serif': ['serif', 'The serif of pinned.cc: the brand, the Dashboard title and heads.'] };
const SIZE_T = {
  '--t-micro': 'micro', '--t-small': 'small', '--t-label': 'label', '--t-tag': 'tag', '--t-meta': 'meta', '--t-ui': 'ui', '--t-body': 'body',
  '--t-control': 'control', '--t-input': 'input', '--t-heading': 'heading', '--t-heading-l': 'heading-large', '--t-title': 'title',
  '--t-page': 'page', '--t-page-l': 'page-large', '--t-display': 'display',
};
const LH = {
  '--lh-none': ['none', 'One line controls.'], '--lh-tight': ['tight', 'Headings.'], '--lh-snug': ['snug', 'Toasts, empty boxes.'], '--lh-body': ['running', 'Running text, the body default.'],
  '--lh-14': ['caption', 'Hosts, dock and recent labels, the version line.'], '--lh-16': ['label', 'Group labels, small notes.'],
  '--lh-17': ['card-title', 'The desktop card title.'], '--lh-18': ['meta', 'Meta lines, field errors, day heads.'],
  '--lh-19': ['card-title-phone', 'Phone card and folder titles.'], '--lh-20': ['field', 'Fields, sheet text, release notes.'], '--lh-24': ['calm-heading', 'The calm empty state heading.'],
};
const RADIUS = {
  '--r-xs': 'xs', '--r-s': 's', '--r-m': 'm', '--r-l': 'l', '--r-xl': 'xl', '--r-2xl': '2xl', '--r-icon-s': 'icon-s', '--r-icon-m': 'icon-m', '--r-icon-l': 'icon-l',
  '--r-pill-s': 'pill-s', '--r-pill-m': 'pill-m', '--r-pill': 'pill', '--r-pill-l': 'pill-l', '--r-pill-xl': 'pill-xl', '--r-panel-s': 'panel-s', '--r-panel': 'panel', '--r-sheet': 'sheet',
};
const SIZE = {
  '--h-control': ['control', 'Desktop buttons and switches.'], '--tap': ['tap-target', 'The 44 px touch target.'], '--h-field': ['field', 'Fields and the search.'], '--h-cta': ['primary-button', 'The big primary button.'],
  '--icon-2xs': ['icon.2xs', ''], '--icon-xs': ['icon.xs', ''], '--icon-s': ['icon.s', ''], '--icon-m': ['icon.m', ''], '--icon': ['icon.default', 'svg.i'], '--icon-l': ['icon.l', ''], '--icon-xl': ['icon.xl', ''],
  '--pb': ['phone-bottom-bar', 'Room kept for the phone bottom bar, toasts sit above it.'],
};
const SPACE_EXTRA = { '--gut': ['gutter', 'The side gutter of the phone and of sheets.'] };

// ---------------------------------------------------------------- value conversion
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const hex2 = (n) => n.toString(16).padStart(2, '0');
function dtcgColor(s) {
  const c = parseColor(s);
  if (!c) throw new Error('not a colour: ' + s);
  const v = { colorSpace: 'srgb', components: [r6(c.r / 255), r6(c.g / 255), r6(c.b / 255)], hex: `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}` };
  if (c.a !== 1) v.alpha = c.a;
  return v;
}
function dim(s) {
  const m = String(s).trim().match(/^(-?\d*\.?\d+)(px|em|rem)?$/);
  if (!m) return null;
  return { value: +m[1], unit: m[2] || 'px' };
}
function duration(s) {
  const m = s.match(/^(\d*\.?\d+)(ms|s)$/);
  return { value: +m[1], unit: m[2] };
}
const COLOR_VAR = Object.fromEntries(Object.entries(COLOR).map(([k, [p]]) => [k, p]));
const SHADOW_VAR = Object.keys(SHADOW);

// a CSS shadow list to DTCG layers; var(--shadow) is spliced in from the same mode, var(--colour) becomes an alias
function dtcgShadow(css, mode, vars) {
  let s = css;
  for (let k = 0; k < 5; k++) s = s.replace(/var\((--[\w-]+)\)/g, (m0, n) => (SHADOW_VAR.includes(n) ? vars[n].value : m0));
  return splitTop(s).map((layer) => {
    const t = layer.match(/inset|var\([^)]*\)|rgba?\([^)]*\)|#[0-9a-f]{3,8}|-?\d*\.?\d+(px)?/gi);
    const inset = t[0] === 'inset' ? !!t.shift() : false;
    const col = t.pop();
    const [x, y, b = '0', sp = '0'] = t;
    const color = col.startsWith('var(') ? `{color.${mode}.${COLOR_VAR[col.slice(4, -1)]}}` : dtcgColor(col);
    const L = { color, offsetX: dim(x), offsetY: dim(y), blur: dim(b), spread: dim(sp) };
    if (inset) L.inset = true;
    return L;
  });
}
function family(s) { return splitTop(s).map((f) => f.replace(/^["']|["']$/g, '')); }

const ext = (o) => ({ [NS]: o });
const set = (obj, path, tok) => {
  const parts = path.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ||= {};
  if (o[parts.at(-1)]) throw new Error('two tokens at ' + path);
  o[parts.at(-1)] = tok;
};

// ---------------------------------------------------------------- named tokens from the custom properties
const files = { color: {}, shadow: {}, gradient: {}, type: {}, space: {}, radius: {}, size: {}, motion: {}, effect: {}, parts: {} };
const used = new Set();
const modes = (name) => [['dark', dark[name]], ['light', light[name] || dark[name]]];
const srcs = (name) => [at(dark[name].line), ...(light[name] ? [at(light[name].line)] : [])];

for (const [name, [path, desc]] of Object.entries(COLOR)) {
  used.add(name);
  for (const [mode, d] of modes(name)) set(files.color, `color.${mode}.${path}`, { $type: 'color', $value: dtcgColor(d.value), $description: desc, $extensions: ext({ var: name, source: srcs(name) }) });
}
for (const [name, [path, desc]] of Object.entries(SHADOW)) {
  used.add(name);
  for (const [mode, d] of modes(name)) set(files.shadow, `shadow.${mode}.${path}`, { $type: 'shadow', $value: dtcgShadow(d.value, mode, mode === 'dark' ? dark : { ...dark, ...light }), $description: desc, $extensions: ext({ var: name, source: srcs(name), css: d.value }) });
}
for (const [name, [path, desc]] of Object.entries(GRADIENT)) {
  used.add(name);
  // radial gradients and gradient-or-colour values have no DTCG type; the CSS is kept as written
  for (const [mode, d] of modes(name)) set(files.gradient, `gradient.${mode}.${path}`, { $value: d.value, $description: desc + ' CSS as written (DTCG has no radial gradient).', $extensions: ext({ var: name, source: srcs(name), raw: true }) });
}
for (const [name, [path, desc]] of Object.entries(BLUR)) { used.add(name); set(files.effect, `blur.${path}`, { $value: dark[name].value, $description: desc + ' A CSS filter, kept as written.', $extensions: ext({ var: name, source: srcs(name), raw: true }) }); }
for (const [name, [path, desc]] of Object.entries(EASING)) {
  used.add(name);
  const v = dark[name].value.match(/cubic-bezier\(([^)]*)\)/)[1].split(',').map(Number);
  set(files.motion, `easing.${path}`, { $type: 'cubicBezier', $value: v, $description: desc, $extensions: ext({ var: name, source: srcs(name) }) });
}
for (const [name, [path, desc]] of Object.entries(FAMILY)) { used.add(name); set(files.type, `font.family.${path}`, { $type: 'fontFamily', $value: family(dark[name].value), $description: desc, $extensions: ext({ var: name, source: srcs(name) }) }); }
for (const [name, path] of Object.entries(SIZE_T)) { used.add(name); set(files.type, `font.size.${path}`, { $type: 'dimension', $value: dim(dark[name].value), $extensions: ext({ var: name, source: srcs(name) }) }); }
for (const [name, [path, desc]] of Object.entries(LH)) {
  used.add(name);
  const d = dim(dark[name].value);
  const v = /px$/.test(dark[name].value) ? { $type: 'dimension', $value: d } : { $type: 'number', $value: d.value };
  set(files.type, `font.line-height.${path}`, { ...v, $description: desc, $extensions: ext({ var: name, source: srcs(name) }) });
}
for (const [name, d] of Object.entries(dark)) {
  const m = name.match(/^--s-(\d+)$/);
  if (!m) continue;
  used.add(name);
  set(files.space, `space.step-${m[1]}`, { $type: 'dimension', $value: dim(d.value), $description: `${m[1]} steps of the 2 px grid.`, $extensions: ext({ var: name, source: srcs(name) }) });
}
for (const [name, [path, desc]] of Object.entries(SPACE_EXTRA)) {
  used.add(name);
  const ref = dark[name].value.match(/var\(--s-(\d+)\)/)[1];
  set(files.space, `space.${path}`, { $type: 'dimension', $value: `{space.step-${ref}}`, $description: desc, $extensions: ext({ var: name, source: srcs(name) }) });
}
for (const [name, path] of Object.entries(RADIUS)) { used.add(name); set(files.radius, `radius.${path}`, { $type: 'dimension', $value: dim(dark[name].value), $extensions: ext({ var: name, source: srcs(name) }) }); }
for (const [name, [path, desc]] of Object.entries(SIZE)) { used.add(name); set(files.size, `size.${path}`, { $type: 'dimension', $value: dim(dark[name].value), ...(desc ? { $description: desc } : {}), $extensions: ext({ var: name, source: srcs(name) }) }); }

const missing = [...Object.keys(dark), ...Object.keys(light)].filter((n) => !used.has(n));
if (missing.length) throw new Error('custom properties without a token: ' + [...new Set(missing)].join(' '));

// ---------------------------------------------------------------- values written out in rules
const inRoot = (d) => d.selector === ':root' || d.selector === ':root[data-theme="light"]';
const rules = decls.filter((d) => !inRoot(d) && !d.at.some((a) => a.startsWith('@font-face')) && !d.selector.startsWith('@font-face'));
const MOTION_PROPS = /^(transition|animation)(-duration|-timing-function|-delay)?$/;

// durations: one token per value, named by the role of its most common use
const DUR_NAME = {
  0: ['none', 'No time: the delay of a visibility switch, a zero fallback.'], 80: ['reduced', 'The palette fade with reduced motion.'],
  120: ['press', 'A press, the palette and dialogs going out, phone cards.'], 150: ['morph', 'The grid and list view transition.'],
  160: ['quick', 'Hover, switches, fields, small fades.'], 180: ['enter', 'The palette, dialogs and the scrim coming in.'],
  200: ['fade', 'Toasts, tab colour, the How to save tabs and copy.'], 240: ['settle', 'The selection bar glide, a card leaving, a toast arriving.'],
  250: ['glass', 'Glass surfaces changing fill, the How to save copy button.'], 260: ['fold', 'The sidebar actions folding open.'],
  280: ['drawer', 'A sheet sliding, the tick popping in.'], 320: ['slide', 'The phone tab indicator, the field shake, the How to save pill.'],
  400: ['pile', 'The All sorted pile settling.'], 420: ['save-in', 'The save panel coming in.'], 600: ['save-light', 'The save panel corner light.'],
  1000: ['caret-blink', 'The drawn caret in How to save.'], 1100: ['skeleton-pulse', 'Loading cards pulsing.'], 1600: ['skeleton-sweep', 'The favicon placeholder sweep.'],
};
const KEY_EASE = {
  ease: ['css-ease', [0.25, 0.1, 0.25, 1], 'The CSS keyword ease.'], linear: ['linear', [0, 0, 1, 1], 'The CSS keyword linear.'],
  'ease-in-out': ['in-out', [0.42, 0, 0.58, 1], 'The CSS keyword ease-in-out: the skeleton pulse.'],
  'cubic-bezier(.2,.8,.2,1)': ['howto-slide', [0.2, 0.8, 0.2, 1], 'The How to save pill and copy button.'],
  'cubic-bezier(.36,.07,.19,.97)': ['shake', [0.36, 0.07, 0.19, 0.97], 'A wrong password shaking its field.'],
};
const durations = new Map(), easings = new Map();
const add = (m, k, line) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(line); };
for (const d of decls) {
  if (!MOTION_PROPS.test(d.prop) || d.selector === ':root') continue;
  for (const x of d.value.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) add(durations, x[2] === 's' ? Math.round(x[1] * 1000) : +x[1], d.line);
  for (const x of d.value.matchAll(/cubic-bezier\([^)]*\)|steps\([^)]*\)|(?<![\w-])(ease-in-out|ease|linear)(?![\w-])/g)) add(easings, x[0].replace(/\s/g, ''), d.line);
}
for (const [ms, lines] of [...durations].sort((a, b) => a[0] - b[0])) {
  const [name, desc] = DUR_NAME[ms] || (() => { throw new Error('no name for duration ' + ms); })();
  set(files.motion, `duration.${name}`, { $type: 'duration', $value: { value: ms, unit: 'ms' }, $description: desc, $extensions: ext({ source: [...lines].sort((a, b) => a - b).map(at) }) });
}
for (const [k, lines] of easings) {
  if (k === 'steps(1)') { set(files.motion, 'easing.blink-step', { $value: 'steps(1)', $description: 'One step, the drawn caret blinking. A CSS timing function DTCG has no type for.', $extensions: ext({ source: [...lines].map(at), raw: true }) }); continue; }
  const e = KEY_EASE[k];
  if (!e) throw new Error('no name for easing ' + k);
  set(files.motion, `easing.${e[0]}`, { $type: 'cubicBezier', $value: e[1], $description: e[2], $extensions: ext({ source: [...lines].sort((a, b) => a - b).map(at), css: k }) });
}

// font weights, tracking and the round radius: one token per value
const weights = new Map(), tracking = new Map(), round = new Set();
for (const d of rules) {
  if (d.prop === 'font') { const w = d.value.match(/^(\d{3})\s/); if (w) add(weights, +w[1], d.line); }
  if (d.prop === 'font-weight') add(weights, +d.value, d.line);
  if (d.prop === 'letter-spacing') add(tracking, d.value, d.line);
  if (d.prop === 'border-radius' && d.value === '50%') round.add(d.line);
}
const W = { 400: 'regular', 500: 'medium', 600: 'semibold' };
for (const [w, lines] of [...weights].sort()) set(files.type, `font.weight.${W[w]}`, { $type: 'fontWeight', $value: w, $extensions: ext({ source: [...lines].sort((a, b) => a - b).map(at) }) });
const TR = { '-.005em': ['slight', 'The brand and the calm heading.'], '-.01em': ['tight', 'Titles, hosts, mono text.'], '-.02em': ['tighter', 'The large phone and Dashboard titles.'], '.02em': ['caps', 'Upper case captions in the iPhone drawings.'] };
for (const [v, lines] of tracking) {
  const [name, desc] = TR[v];
  set(files.type, `font.tracking.${name}`, { $type: 'dimension', $value: dim(v), $description: desc, $extensions: ext({ source: [...lines].sort((a, b) => a - b).map(at) }) });
}
set(files.radius, 'radius.round', { $value: '50%', $description: 'A circle: ticks, the plus, avatars of a folder. A percentage, which DTCG dimensions do not take.', $extensions: ext({ source: [...round].sort((a, b) => a - b).map(at), raw: true }) });

// ---------------------------------------------------------------- part tokens
function roleName(d, as) {
  let s = splitTop(d.selector)[0];
  let mode = '';
  if (/:root\[data-theme="light"\]/.test(s)) mode = 'light';
  if (/:root:not\(\[data-theme="light"\]\)/.test(s)) mode = 'dark';
  s = s.replace(/:root\[[^\]]*\]|:root:not\(\[[^\]]*\]\)/g, '');
  s = s.replace(/:is\(([^,)]*)[^)]*\)/g, '$1').replace(/:where\(([^)]*)\)/g, '$1');
  s = s.replace(/:(not|has)\((?:[^()]|\([^()]*\))*\)/g, '');
  const words = (s.match(/\[aria-([a-z]+)[^\]]*\]|\[([a-z-]+)\]|::?[a-z-]+|[.#][\w-]+|(?<![\w.#-])(?:input|textarea|button|a|svg|img|mark|kbd|code|summary|h1|h2|li|p|i|span|b|hr|time|form)(?![\w-])/g) || [])
    .map((w) => w.replace(/^\[aria-([a-z]+).*$/, '$1').replace(/^\[([a-z-]+)\]$/, '$1').replace(/^::?/, '').replace(/^[.#]/, ''))
    .filter((w) => !['app', 'root', 'desk'].includes(w));
  const out = [];
  for (const w of words) if (out.at(-1) !== w) out.push(w);
  const PROP = { background: 'bg', 'background-color': 'bg', 'border-color': 'border', 'box-shadow': 'shadow', color: 'text', 'caret-color': 'caret', 'border-radius': 'radius', 'font-size': 'size', 'line-height': 'line-height' };
  const p = as ? as : d.prop.startsWith('--') ? d.prop.slice(2) : PROP[d.prop] || d.prop;
  return { name: [...out, p].join('-').replace(/[^\w-]/g, ''), mode };
}
const parts = {};
function part(kind, d, $value, $type, extra = {}, as = null) {
  const { name, mode } = roleName(d, as);
  const base = `${name}${mode ? '-' + mode : ''}`;
  parts[kind] ||= {};
  const g = parts[kind];
  // the same selector and property with the same value is one token with all its lines
  for (let i = 1; ; i++) {
    const key = i === 1 ? base : `${base}-${i}`;
    const t = g[key];
    if (!t) {
      g[key] = { ...($type ? { $type } : {}), $value, $extensions: ext({ selector: d.selector, property: d.prop, ...(d.at.length ? { media: d.at } : {}), mode: mode || 'both', source: [at(d.line)], ...extra }) };
      return;
    }
    if (JSON.stringify(t.$value) === JSON.stringify($value) && t.$extensions[NS].property === d.prop && t.$extensions[NS].selector === d.selector) { t.$extensions[NS].source.push(at(d.line)); return; }
  }
}
const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left))?$/;
for (const d of rules) {
  const v = d.value;
  const isVarDecl = d.prop.startsWith('--');
  const hasColor = (v.match(COLOR_RE) || []).length > 0;
  if (d.prop === 'box-shadow' || /drop-shadow\(/.test(v)) {
    if (v === 'none' || (!hasColor && !/\d/.test(v.replace(/var\([^)]*\)/g, '')))) continue;
    if (/^(var\(--[\w-]+\),?)+$/.test(v)) continue;
    const dtcg = !/var\(|drop-shadow/.test(v);
    part('shadow', d, dtcg ? dtcgShadow(v, 'dark', dark) : v, dtcg ? 'shadow' : null, { css: v, ...(dtcg ? {} : { raw: true }) });
    continue;
  }
  if (hasColor && /gradient\(/.test(v)) { part('gradient', d, v, null, { raw: true }); continue; }
  if (hasColor) {
    for (const c of v.match(COLOR_RE)) part('color', d, dtcgColor(c), 'color', isVarDecl ? {} : { css: v });
    continue;
  }
  if (isVarDecl) continue;
  if (d.prop === 'border-radius' && /\d(px)?\b/.test(v.replace(/var\([^)]*\)/g, '')) && v !== '50%' && !/^0$/.test(v)) {
    const d1 = dim(v);
    part('radius', d, d1 || v, d1 ? 'dimension' : null, d1 ? {} : { raw: true });
  }
  if (SPACE_PROPS.test(d.prop) && /(?<![\w-])\d*\.?\d+px/.test(v.replace(/var\([^)]*\)/g, ''))) {
    const d1 = dim(v);
    part('space', d, d1 || v, d1 ? 'dimension' : null, d1 ? {} : { raw: true });
  }
  let size = null, lh = null;
  if (d.prop === 'font') {
    const m = v.match(/^(?:\d{3}\s+)?(\S+?)(?:\/(\S+))?\s+(var\(--[\w-]+\)|inherit)$/);
    if (m) { size = m[1]; lh = m[2] || null; }
  }
  if (d.prop === 'font-size') size = v;
  if (d.prop === 'line-height') lh = v;
  if (size && !size.startsWith('var(')) part('font-size', d, dim(size), 'dimension', d.prop === 'font' ? { css: v } : {}, d.prop === 'font' ? 'size' : null);
  if (lh && !lh.startsWith('var(')) {
    const d1 = dim(lh);
    part('line-height', d, /px$/.test(lh) ? d1 : d1.value, /px$/.test(lh) ? 'dimension' : 'number', d.prop === 'font' ? { css: v } : {}, d.prop === 'font' ? 'line-height' : null);
  }
}
files.parts.part = parts;

// ---------------------------------------------------------------- write
const DESC = {
  color: 'Colour, two modes: dark is :root (the default), light is :root[data-theme="light"]. From web/app.css at Pinned 0.1.11.',
  shadow: 'Shadows and rings, two modes. Layers that use a colour token alias it.',
  gradient: 'Gradients and surface fills, two modes, kept as CSS.',
  type: 'Type: families, the size scale by role, line heights, weights and tracking.',
  space: 'Space: the 2 px grid used by padding, margin and gap, and the gutter.',
  radius: 'Corner radius by role.',
  size: 'Control heights, the touch target, icon sizes and layout room.',
  motion: 'Durations and easings. The five easings with a custom property, then every other value the stylesheet writes out.',
  effect: 'Backdrop filters.',
  parts: 'Values written straight into one rule of web/app.css, named after the rule (selector, then property). Each lists its lines.',
};
mkdirSync(OUT, { recursive: true });
let total = 0;
const count = (o) => (o.$value !== undefined ? 1 : Object.values(o).reduce((n, x) => n + (typeof x === 'object' ? count(x) : 0), 0));
for (const [f, body] of Object.entries(files)) {
  const n = count(body);
  total += n;
  // the file's note sits on its first group: a note at the top of every file would collide when the files merge
  const [first, ...rest] = Object.keys(body);
  const out = { [first]: { $description: DESC[f], ...body[first] }, ...Object.fromEntries(rest.map((k) => [k, body[k]])) };
  writeFileSync(join(OUT, `${f}.json`), JSON.stringify(out, null, 2) + '\n');
  console.log(`${f}.json ${n}`);
}
console.log(`${total} tokens`);
