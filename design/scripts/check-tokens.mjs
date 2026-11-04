// Proves the tokens match web/app.css. Run after the Style Dictionary build: node scripts/check-tokens.mjs
// Fails (exit 1) on any difference. Three checks:
//   1. Every custom property of :root and :root[data-theme="light"] in app.css has the same value in build/css/tokens.css,
//      in both modes, after var() is resolved in each file and both values are written the same way.
//   2. Every other token is found at each line it names: the built value is in the declaration on that line.
//   3. Every colour, shadow, duration, easing, font weight, size, line height, tracking, radius and space written out in
//      app.css is a token: read line by line with plain patterns, independent of the reader used for the tokens.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declarations, canon, resolve, customProps, COLOR_RE, parseColor, colorKey } from './lib/css.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const appText = readFileSync(process.argv[2] || join(ROOT, 'web', 'app.css'), 'utf8'); // another app.css can be named, to see the check fail
const builtText = readFileSync(join(HERE, '..', 'build', 'css', 'tokens.css'), 'utf8');
const list = JSON.parse(readFileSync(join(HERE, '..', 'build', 'json', 'tokens.json'), 'utf8'));

const fail = [];
const app = declarations(appText), built = declarations(builtText);
const flat = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.value]));
const LIGHT = ':root[data-theme="light"]';
const appVars = { dark: flat(customProps(app, ':root')) }; appVars.light = { ...appVars.dark, ...flat(customProps(app, LIGHT)) };
const bVars = { dark: flat(customProps(built, ':root')) }; bVars.light = { ...bVars.dark, ...flat(customProps(built, LIGHT)) };

// built names must be unique within a block
for (const sel of [':root', LIGHT]) {
  const seen = new Set();
  for (const d of built.filter((x) => x.selector === sel)) { if (seen.has(d.prop)) fail.push(`tokens.css declares ${d.prop} twice in ${sel}`); seen.add(d.prop); }
}

// ---------------------------------------------------------------- 1. custom properties, both modes
let n1 = 0;
const appNames = new Set([...Object.keys(appVars.light)]);
for (const mode of ['dark', 'light']) {
  for (const name of Object.keys(appVars[mode])) {
    n1++;
    if (bVars[mode][name] === undefined) { fail.push(`1 ${mode} ${name}: no token`); continue; }
    const a = canon(resolve(appVars[mode][name], appVars[mode])), b = canon(resolve(bVars[mode][name], bVars[mode]));
    if (a !== b) fail.push(`1 ${mode} ${name}: app.css ${a}  tokens ${b}`);
  }
}
const valueTokens = list.filter((t) => !appNames.has(t.name));
for (const t of list) if (appNames.has(t.name) && !t.source.length) fail.push(`1 ${t.name} has no source line`);

// ---------------------------------------------------------------- 2. each other token at each of its lines
const atLine = new Map();
for (const d of app) { if (!atLine.has(d.line)) atLine.set(d.line, []); atLine.get(d.line).push(d); }
const builtValue = Object.fromEntries(built.filter((d) => d.selector === ':root').map((d) => [d.prop, d.value]));
const fontParts = (v) => { const m = v.match(/^(?:(\d{3})\s+)?(\S+?)(?:\/(\S+))?\s+(\S+)$/); return m ? { weight: m[1], size: m[2], lh: m[3] } : {}; };
let n2 = 0;
for (const t of valueTokens) {
  const bv = builtValue[t.name];
  if (bv === undefined) { fail.push(`2 ${t.name}: not in tokens.css`); continue; }
  if (!t.source.length) { fail.push(`2 ${t.name}: no source line`); continue; }
  for (const s of t.source) {
    n2++;
    const line = +s.split(':').pop();
    let ds = atLine.get(line) || [];
    if (t.selector) ds = ds.filter((d) => d.selector === t.selector && d.prop === t.property);
    const want = canon(bv);
    const ok = ds.some((d) => {
      const got = canon(d.value);
      const esc = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!t.part) return new RegExp(`(^|[\\s,(/])${esc}${want.endsWith(')') ? '' : '($|[\\s,)/])'}`).test(got)
        || (t.path.startsWith('font.weight') && (d.prop === 'font-weight' ? got === want : fontParts(d.value).weight === bv));
      if (t.path.startsWith('part.color')) return got.includes(want);
      if (d.prop === 'font' && t.path.startsWith('part.font-size')) return canon(fontParts(d.value).size) === want;
      if (d.prop === 'font' && t.path.startsWith('part.line-height')) return canon(fontParts(d.value).lh) === want;
      return got === want;
    });
    if (!ok) fail.push(`2 ${t.name} (${t.path}) = ${bv}: not found at app.css:${line}${ds.length ? ' in ' + ds.map((d) => d.prop + ':' + d.value).join('; ') : ''}`);
  }
}

// ---------------------------------------------------------------- 3. nothing written out is left without a token
// covered[line] holds the canonical values of every token that names the line
const covered = new Map();
const cover = (line, kind, v) => { const k = `${line} ${kind}`; if (!covered.has(k)) covered.set(k, new Set()); covered.get(k).add(v); };
const rootLines = new Set([...app.filter((d) => (d.selector === ':root' || d.selector === LIGHT) && d.prop.startsWith('--')).map((d) => d.line)]);
for (const t of list) {
  const bv = builtValue[t.name] ?? bVars.dark[t.name];
  for (const s of t.source) {
    const line = +s.split(':').pop();
    const c = canon(bv ?? '');
    for (const col of (c.match(/rgba\([^)]*\)/g) || [])) cover(line, 'color', col);
    const kind = t.path.split('.')[t.part ? 1 : 0];
    cover(line, kind, c);
  }
}
const has = (line, kind, v) => (covered.get(`${line} ${kind}`) || new Set()).has(v);
const lines = appText.split('\n');
let inComment = false, n3 = 0;
const gaps = [];
lines.forEach((raw, i) => {
  const ln = i + 1;
  // drop comments, keep the code
  let s = '', j = 0;
  while (j < raw.length) {
    if (inComment) { const e = raw.indexOf('*/', j); if (e < 0) { j = raw.length; } else { inComment = false; j = e + 2; } continue; }
    const b = raw.indexOf('/*', j);
    if (b < 0) { s += raw.slice(j); break; }
    s += raw.slice(j, b); inComment = true; j = b + 2;
  }
  if (!s.trim() || rootLines.has(ln) || /@font-face/.test(s)) return;
  const decls = [...s.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;{}]*)/g)].map((m) => ({ prop: m[1], value: m[2].replace(/!important/, '').trim() }));
  for (const { prop, value } of decls) {
    const v = value.replace(/var\([^)]*\)/g, 'V');
    const check = (kind, x, label = x) => { n3++; if (!has(ln, kind, x)) gaps.push(`3 app.css:${ln} ${prop}: ${label} has no token`); };
    if (prop === 'box-shadow' || /drop-shadow/.test(value)) {
      if (value !== 'none' && !/^(var\(--[\w-]+\),?)+$/.test(value)) check('shadow', canon(value), value);
      continue;
    }
    for (const c of value.match(COLOR_RE) || []) check('color', colorKey(parseColor(c)), c);
    if (/^(transition|animation)/.test(prop)) {
      for (const m of v.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)) check('duration', canon(m[0]), m[0]);
      for (const m of v.matchAll(/cubic-bezier\([^)]*\)|steps\([^)]*\)|(?<![\w-])(ease-in-out|ease|linear)(?![\w-])/g)) check('easing', canon(m[0]), m[0]);
    }
    if (prop === 'font') {
      const f = fontParts(value);
      if (f.weight) check('font', canon(f.weight), f.weight);
      if (f.size && !f.size.startsWith('var(')) check('font-size', canon(f.size), f.size);
      if (f.lh && !f.lh.startsWith('var(')) check('line-height', canon(f.lh), f.lh);
    }
    if (prop === 'font-weight') check('font', canon(value), value);
    if (prop === 'font-size' && !value.startsWith('var(')) check('font-size', canon(value), value);
    if (prop === 'line-height' && !value.startsWith('var(')) check('line-height', canon(value), value);
    if (prop === 'letter-spacing') check('font', canon(value), value);
    if (prop === 'border-radius' && /\d/.test(v) && value !== '0') check(value === '50%' ? 'radius' : 'radius', canon(value), value);
    if (/^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)?$/.test(prop) && /(?<![\w-])\d*\.?\d+px/.test(v)) check('space', canon(value), value);
  }
});
fail.push(...gaps);

console.log(`1. custom properties, dark and light: ${n1} compared`);
console.log(`2. other tokens at their lines: ${valueTokens.length} tokens, ${n2} lines`);
console.log(`3. values written out in app.css: ${n3} checked`);
console.log(`${list.length} tokens in build/json/tokens.json`);
if (fail.length) { console.log(`\nFAIL, ${fail.length} differences:\n` + fail.join('\n')); process.exit(1); }
console.log('\nPASS: every token matches web/app.css, and every value in app.css is a token');
