// A small reader for web/app.css: every declaration with its selector, the at-rules around it and its line.
// It reads the file as it is written (one rule per line, a few rules over two lines), comments and strings included.

export function declarations(text) {
  const out = [];
  const stack = []; // { kind: 'at' | 'rule', prelude, line }
  let buf = '', bufLine = 0, line = 1;
  let i = 0;
  const start = () => { if (!buf.trim()) bufLine = line; };
  const flushDecl = () => {
    const raw = buf; buf = '';
    if (!raw.trim()) return;
    const top = stack[stack.length - 1];
    if (!top || top.kind !== 'rule') return;
    const c = raw.indexOf(':');
    if (c < 0) return;
    const prop = raw.slice(0, c).trim();
    const value = raw.slice(c + 1).trim().replace(/\s*!important$/, '');
    const important = /!important\s*$/.test(raw);
    out.push({ prop, value, important, line: bufLine, selector: top.prelude, at: stack.filter((s) => s.kind === 'at').map((s) => s.prelude) });
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const chunk = text.slice(i, end + 2);
      line += (chunk.match(/\n/g) || []).length;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      start();
      const end = text.indexOf(ch, i + 1);
      buf += text.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (ch === '\n') { line++; buf += ' '; i++; continue; }
    if (ch === '{') {
      const prelude = buf.trim().replace(/\s+/g, ' ');
      const pl = bufLine;
      buf = '';
      const top = stack[stack.length - 1];
      const kind = prelude.startsWith('@') ? 'at' : 'rule';
      // a rule nested in a rule does not occur in app.css; keyframe steps sit inside an at-rule
      stack.push({ kind, prelude, line: pl, parent: top });
      i++;
      continue;
    }
    if (ch === '}') {
      flushDecl();
      stack.pop();
      i++;
      continue;
    }
    if (ch === ';') {
      flushDecl();
      i++;
      continue;
    }
    if (ch === '(') {
      // keep parentheses whole, a ; never sits inside them in app.css but a : does (url, attr)
      let depth = 0, j = i;
      start();
      for (; j < text.length; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')') { depth--; if (depth === 0) break; }
        else if (text[j] === '\n') line++;
      }
      buf += text.slice(i, j + 1).replace(/\n/g, ' ');
      i = j + 1;
      continue;
    }
    if (ch.trim()) start();
    buf += ch;
    i++;
  }
  return out;
}

// split at commas that are not inside parentheses
export function splitTop(v, sep = ',') {
  const parts = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

// ---------------------------------------------------------------- colours
export const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

export function parseColor(s) {
  s = s.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? Math.round((parseInt(h.slice(6, 8), 16) / 255) * 1000) / 1000 : 1;
    return { r, g, b, a };
  }
  m = s.match(/^rgba?\(([^)]*)\)$/);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
export const colorKey = (c) => `rgba(${c.r},${c.g},${c.b},${+c.a.toFixed(4)})`;

// ---------------------------------------------------------------- canonical form, for comparing two CSS values
const EASE = { ease: '0.25,0.1,0.25,1', linear: '0,0,1,1', 'ease-in': '0.42,0,1,1', 'ease-out': '0,0,0.58,1', 'ease-in-out': '0.42,0,0.58,1' };
const num = (n) => String(+parseFloat(n).toFixed(6));

export function canon(v) {
  let s = String(v).trim().toLowerCase().replace(/["']/g, '');
  s = s.replace(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|\btransparent\b/g, (c) => colorKey(parseColor(c)));
  s = s.replace(/\s*([,()/])\s*/g, '$1').replace(/\s+/g, ' ');
  // durations to ms
  s = s.replace(/(^|[\s,(])(-?\d*\.?\d+)s\b/g, (_, p, n) => `${p}${num(n * 1000)}ms`);
  // numbers: .5 and 0.50 read as 0.5; 0px reads as 0
  s = s.replace(/(^|[^\w.#-]|(?<=[\s,(]))(-?\d*\.?\d+)(px|em|ms|%|deg|fr|vh|dvh)?\b/g, (m0, p, n, u) => {
    const k = num(n);
    if (k === '0' && (u === 'px' || u === 'em')) return `${p}0`;
    return `${p}${k}${u || ''}`;
  });
  s = s.replace(/\bcubic-bezier\(([^)]*)\)/g, (_, a) => `cubic-bezier(${a.split(',').map(num).join(',')})`);
  s = s.replace(/(^|[\s,])(ease-in-out|ease-in|ease-out|ease|linear)(?=$|[\s,])/g, (_, p, k) => `${p}cubic-bezier(${EASE[k]})`);
  // shadow layers: x y [blur [spread]] colour, padded to four lengths
  s = splitTop(s).map((layer) => {
    const t = layer.split(' ');
    const inset = t[0] === 'inset' ? t.shift() : null;
    const col = t.length && /^rgba\(/.test(t[t.length - 1]) ? t.pop() : null;
    if (!col || t.length < 2 || t.length > 4 || !t.every((x) => /^-?[\d.]+(px)?$/.test(x))) return layer;
    while (t.length < 4) t.push('0');
    return [inset, ...t, col].filter(Boolean).join(' ');
  }).join(',');
  return s;
}

// resolve var(--x) and var(--x, fallback) against a map of custom properties
export function resolve(v, vars, depth = 0) {
  if (depth > 20) throw new Error('var() loop in ' + v);
  let out = '', i = 0;
  while (i < v.length) {
    const k = v.indexOf('var(', i);
    if (k < 0) { out += v.slice(i); break; }
    out += v.slice(i, k);
    let d = 0, j = k + 3;
    for (; j < v.length; j++) { if (v[j] === '(') d++; else if (v[j] === ')') { d--; if (d === 0) break; } }
    const inner = v.slice(k + 4, j);
    const c = inner.indexOf(',');
    const name = (c < 0 ? inner : inner.slice(0, c)).trim();
    const fb = c < 0 ? null : inner.slice(c + 1).trim();
    if (vars[name] !== undefined) out += resolve(vars[name], vars, depth + 1);
    else if (fb !== null) out += resolve(fb, vars, depth + 1);
    else out += `var(${name})`;
    i = j + 1;
  }
  return out;
}

// the custom properties of a block, by selector
export function customProps(decls, selector) {
  const m = {};
  for (const d of decls) if (d.selector === selector && d.at.length === 0 && d.prop.startsWith('--')) m[d.prop] = { value: d.value, line: d.line };
  return m;
}
