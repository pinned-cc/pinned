// A part or a screen in a frame of its own: a whole document with the app's app.css, the html and body attributes the
// app set, and the markup the app rendered (fixtures/, taken from the real app by scripts/capture.mjs).
// A part keeps its ancestors' tags and classes, so selectors such as `.sheet .fld-in` or `.selecting .tile` still match;
// the ancestors take no box of their own (display:contents) and a grid cell of the part's own size holds it, so the part
// keeps the width and height it had in the app. Nothing of app.css is changed or added.
const SPRITES = import.meta.glob('../fixtures/sprites/*.html', { query: '?raw', import: 'default', eager: true });
const sprite = (k) => SPRITES[`../fixtures/sprites/${k}.html`] || '';

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const attrs = (o, extra = {}) => Object.entries({ ...o, ...extra }).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');

function doc({ theme, htmlAttrs = {}, bodyAttrs = {}, body }) {
  const h = { ...htmlAttrs, 'data-theme': theme, lang: 'en' };
  return `<!doctype html><html${attrs(h)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="${theme}"><link rel="stylesheet" href="/static/app.css"></head><body${attrs(bodyAttrs)}>${body}</body></html>`;
}

function frameEl(viewport, html, label) {
  const f = document.createElement('iframe');
  f.className = 'ds-frame';
  f.title = label;
  f.width = viewport.width;
  f.height = viewport.height;
  f.style.width = viewport.width + 'px';
  f.style.height = viewport.height + 'px';
  f.dataset.ready = 'false';
  f.addEventListener('load', () => {
    const d = f.contentDocument;
    (d.fonts ? d.fonts.ready : Promise.resolve()).then(() => { f.dataset.ready = 'true'; });
  });
  f.srcdoc = html;
  return f;
}

export function partFrame(fx, theme) {
  const m = fx.box.margin;
  const w = fx.box.width + m[1] + m[3], h = fx.box.height + m[0] + m[2];
  const fixed = fx.box.position === 'fixed' || fx.box.position === 'absolute'; // these place themselves against the window, as in the app
  // the cell sits where the part sat in the app, to the fraction of a pixel, so its text lands on the same subpixels
  const cell = fixed ? '' : `display:grid;grid-template-columns:minmax(0,1fr);position:absolute;left:${fx.box.x - m[3]}px;top:${fx.box.y - m[0]}px;width:${w}px;height:${h}px`;
  const el = fx.html.replace(/^<([a-z0-9-]+)/i, '<$1 data-story-part=""');
  let inner = el;
  for (const a of [...fx.chain].reverse()) {
    const style = ((a.attrs.style || '') + ';display:contents').replace(/^;/, '');
    inner = `<${a.tag}${attrs(a.attrs, { style })}>${inner}</${a.tag}>`;
  }
  const body = `<div data-story-cell=""${cell ? ` style="${cell}"` : ''}>${inner}</div>${sprite(fx.sprite)}`;
  return frameEl(fx.viewport, doc({ theme, htmlAttrs: fx.htmlAttrs, bodyAttrs: fx.body, body }), fx.title);
}

export function screenFrame(fx, theme) {
  // a static copy: the app's scripts stay out, or they would start the app inside the frame
  const body = fx.inner.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  return frameEl(fx.viewport, doc({ theme, htmlAttrs: fx.htmlAttrs, bodyAttrs: fx.body, body }), fx.title);
}

export function themed(make) {
  return (args, ctx) => {
    const theme = ctx.globals.theme || 'dark';
    return make(theme);
  };
}
