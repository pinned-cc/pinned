// The token pages, from build/json/tokens.json (Style Dictionary, from design/tokens/*.json). Every value is drawn with
// its own custom property from build/css/tokens.css, so a page shows what the stylesheet holds, in the mode picked in
// the toolbar. Each row names the line of web/app.css the value comes from.
import tokens from '../../build/json/tokens.json';

export default { title: 'Tokens', parameters: { controls: { disable: true } } };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const src = (t) => (t.source.length > 3 ? `${t.source.slice(0, 3).join(', ')} and ${t.source.length - 3} more` : t.source.join(', '));
const named = (t) => !t.part;
const mode = () => document.documentElement.dataset.theme || 'dark';
const head = (title, note) => `<h1 class="ds-h1">${title}</h1>${note ? `<p class="ds-note">${note}</p>` : ''}`;
const byPath = (prefix) => tokens.filter((t) => t.path.startsWith(prefix));
const pair = (name) => {
  const d = tokens.find((t) => t.name === name && t.mode !== 'light'), l = tokens.find((t) => t.name === name && t.mode === 'light');
  return { d, l };
};
const table = (cols, rows) => `<table class="ds-table"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const role = (t) => t.path.split('.').slice(t.mode ? 2 : 1).join('.');

export const Colour = {
  render: () => {
    const m = mode();
    const groups = {};
    for (const t of tokens.filter((x) => x.type === 'color' && x.mode === m)) (groups[t.path.split('.')[2]] ||= []).push(t);
    return head('Colour', `${tokens.filter((t) => t.type === 'color' && t.mode === 'dark').length} colours by role, each in dark and light. Shown: ${m}. The swatch paints var(name) from tokens.css; the values are the two modes.`)
      + Object.entries(groups).map(([g, list]) => `<h2 class="ds-h2">${g}</h2><div class="ds-grid">${list.map((t) => {
        const { d, l } = pair(t.name);
        return `<div class="ds-sw"><div class="chip" style="background:var(${t.name})"></div><b>${role(t)}</b><span class="ds-mono">${t.name}</span><span class="ds-mono">dark ${esc(d.css)}<br>light ${esc(l.css)}</span><span>${esc(t.description)}</span><span class="ds-mono">${src(t)}</span></div>`;
      }).join('')}</div>`).join('')
      + `<h2 class="ds-h2">Gradients and surface fills</h2>` + table(['Token', 'Variable', 'Dark', 'Light', 'Source'], byPath('gradient.dark').map((t) => { const { l } = pair(t.name); return [`<b>${role(t)}</b><div class="chip" style="height:40px;margin-top:6px;border-radius:8px;background:var(${t.name}),var(--surface)"></div>`, `<span class="ds-mono">${t.name}</span>`, `<span class="ds-mono">${esc(t.css)}</span>`, `<span class="ds-mono">${esc(l.css)}</span>`, `<span class="ds-mono">${src(t)}</span>`]; }));
  },
};

export const Type = {
  render: () => {
    const sizes = byPath('font.size'), lhs = byPath('font.line-height'), w = byPath('font.weight'), tr = byPath('font.tracking'), fam = byPath('font.family');
    return head('Type', 'Geist for every text, Geist Mono for hosts, tokens and code, the serif of pinned.cc for the brand and the Dashboard heads. Sizes are named by role; 11.5, 12.5 and 13.5 sit between steps on purpose (app.css says to see the style guide before merging them).')
      + `<h2 class="ds-h2">Families</h2>` + table(['Token', 'Sample', 'Stack', 'Source'], fam.map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="font:400 20px/1.3 var(${t.name})">Pinned keeps your links</span>`, `<span class="ds-mono">${esc(t.css)}</span>`, `<span class="ds-mono">${src(t)}</span>`]))
      + `<h2 class="ds-h2">Size scale</h2>` + table(['Token', 'Sample', 'Size', 'Source'], sizes.map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="font:400 var(${t.name})/1.2 var(--sans)">Night trains of Europe</span>`, `<span class="ds-mono">${t.css}</span>`, `<span class="ds-mono">${src(t)}</span>`]))
      + `<h2 class="ds-h2">Weights</h2>` + table(['Token', 'Sample', 'Value', 'Used at'], w.map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="font:${t.css} var(--t-heading)/1.2 var(--sans)">Field notes on slow software</span>`, `<span class="ds-mono">${t.css}</span>`, `<span class="ds-mono">${t.source.length} lines: ${src(t)}</span>`]))
      + `<h2 class="ds-h2">Line heights</h2>` + table(['Token', 'Sample', 'Value', 'Use', 'Source'], lhs.map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="display:inline-block;max-width:220px;font:400 var(--t-meta)/var(${t.name}) var(--sans);box-shadow:inset 0 0 0 1px var(--line)">Two lines of a meta text to show the step between them</span>`, `<span class="ds-mono">${t.css}</span>`, esc(t.description), `<span class="ds-mono">${src(t)}</span>`]))
      + `<h2 class="ds-h2">Tracking</h2>` + table(['Token', 'Sample', 'Value', 'Use', 'Used at'], tr.map((t) => [`<b>${role(t)}</b>`, `<span style="font:600 var(--t-title)/1.2 var(--sans);letter-spacing:${t.css}">Recently opened</span>`, `<span class="ds-mono">${t.css}</span>`, esc(t.description), `<span class="ds-mono">${src(t)}</span>`]));
  },
};

export const Space = {
  render: () => head('Space', 'A 2 px grid: step n is n times 2 px. Padding, margin and gap use it; the odd values app.css writes out are optical nudges, listed under Written in rules. The step names are the scale’s own (a grid unit count), the one role name is the gutter.')
    + table(['Token', 'Size', 'Value', 'Source'], byPath('space.').map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="display:block;height:12px;width:var(${t.name});background:var(--accent);border-radius:2px"></span>`, `<span class="ds-mono">${t.css}</span>`, `<span class="ds-mono">${src(t)}</span>`]))
    + `<h2 class="ds-h2">Control heights and icon sizes</h2>` + table(['Token', 'Size', 'Value', 'Use', 'Source'], byPath('size.').map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="display:block;width:var(${t.name});height:var(${t.name});max-width:160px;max-height:160px;border-radius:6px;box-shadow:inset 0 0 0 1px var(--line-2);background:var(--surface)"></span>`, `<span class="ds-mono">${t.css}</span>`, esc(t.description), `<span class="ds-mono">${src(t)}</span>`])),
};

export const Radius = {
  render: () => head('Radius', 'Surfaces, small square boxes, pills (half the control height) and the large panels.')
    + `<div class="ds-grid">${byPath('radius.').map((t) => `<div class="ds-sw"><div class="chip" style="height:72px;border-radius:var(${t.name});background:var(--surface);box-shadow:inset 0 0 0 1px var(--line-2)"></div><b>${role(t)}</b><span class="ds-mono">${t.name} ${t.css}</span><span class="ds-mono">${src(t)}</span></div>`).join('')}</div>`,
};

export const Shadow = {
  render: () => {
    const m = mode();
    return head('Shadow', `Rings, edges and elevation, in two modes. Shown: ${m}.`) + `<div class="ds-grid">${tokens.filter((t) => t.path.startsWith('shadow.' + m)).map((t) => { const { d, l } = pair(t.name); return `<div class="ds-sw"><div class="chip" style="height:72px;margin:12px;background:var(--surface);box-shadow:var(${t.name})"></div><b>${role(t)}</b><span class="ds-mono">${t.name}</span><span>${esc(t.description)}</span><span class="ds-mono">dark ${esc(d.css)}</span><span class="ds-mono">light ${esc(l.css)}</span><span class="ds-mono">${src(t)}</span></div>`; }).join('')}</div>`
      + `<h2 class="ds-h2">Backdrop filters</h2>` + table(['Token', 'Variable', 'Value', 'Source'], byPath('blur.').map((t) => [`<b>${role(t)}</b>`, `<span class="ds-mono">${t.name}</span>`, `<span class="ds-mono">${t.css}</span>`, `<span class="ds-mono">${src(t)}</span>`]));
  },
};

export const Motion = {
  render: () => {
    const el = document.createElement('div');
    el.innerHTML = head('Motion', 'Durations and easings. Press Play to run each easing over 600 ms; with reduced motion set in the system, app.css stops every transition, and so does this page.')
      + `<p><button type="button" class="btn" data-play>Play</button></p>`
      + `<h2 class="ds-h2">Easings</h2>` + table(['Token', 'Curve', 'Value', 'Use', 'Source'], byPath('easing.').map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="display:block;width:220px;height:10px;position:relative;background:var(--line);border-radius:5px"><i data-ease style="position:absolute;left:0;top:-3px;width:16px;height:16px;border-radius:50%;background:var(--accent);transition:transform 600ms var(${t.name})"></i></span>`, `<span class="ds-mono">${esc(t.css)}</span>`, esc(t.description), `<span class="ds-mono">${src(t)}</span>`]))
      + `<h2 class="ds-h2">Durations</h2>` + table(['Token', 'Length', 'Value', 'Use', 'Used at'], byPath('duration.').map((t) => [`<b>${role(t)}</b><br><span class="ds-mono">${t.name}</span>`, `<span style="display:block;height:8px;width:calc(${parseFloat(t.css)}px / 6);background:var(--accent-soft);border-radius:4px"></span>`, `<span class="ds-mono">${t.css}</span>`, esc(t.description), `<span class="ds-mono">${t.source.length} lines: ${src(t)}</span>`]));
    let on = false;
    el.querySelector('[data-play]').addEventListener('click', () => { on = !on; el.querySelectorAll('[data-ease]').forEach((i) => { i.style.transform = on ? 'translateX(204px)' : 'none'; }); });
    return el;
  },
};

export const WrittenInRules = {
  name: 'Written in rules',
  render: () => {
    const parts = tokens.filter((t) => t.part);
    const groups = {};
    for (const t of parts) (groups[t.path.split('.')[1]] ||= []).push(t);
    return head('Written in rules', `${parts.length} values that app.css writes straight into one rule instead of using a custom property, by kind. Each is named after its rule (selector, then property) and lists its line. They are tokens now, so the check proves them; a later pass can fold them into the named tokens.`)
      + Object.entries(groups).map(([g, list]) => `<h2 class="ds-h2">${g}, ${list.length}</h2>` + table(['Token', 'Value', 'Selector', 'Source'], list.map((t) => [
        `${g === 'color' ? `<span style="display:inline-block;width:14px;height:14px;border-radius:4px;vertical-align:-2px;margin-right:6px;background:var(${t.name});box-shadow:inset 0 0 0 1px var(--line-2)"></span>` : ''}<span class="ds-mono">${t.name}</span>`,
        `<span class="ds-mono">${esc(t.css)}</span>`, `<span class="ds-mono">${esc(t.selector)} { ${esc(t.property)} }</span>`, `<span class="ds-mono">${src(t)}</span>`]))).join('');
  },
};
