// Opens every story of the static Storybook headless (Chromium, with timeouts), in dark and light, screenshots it, and
// compares each part and screen with the same part or screen of the real app (proof/real, from scripts/capture.mjs).
// Serves storybook-static itself on 127.0.0.1 for the run and stops it at the end.
// Usage: node scripts/shoot.mjs [port]     Writes proof/story/*.png, proof/diff/*.png and proof/report.json
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/real.mjs';
import { comparer } from './lib/compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATIC = join(HERE, '..', 'storybook-static');
const PROOF = join(HERE, '..', 'proof');
const PORT = +(process.argv[2] || 6107);
for (const d of ['story', 'diff']) { rmSync(join(PROOF, d), { recursive: true, force: true }); mkdirSync(join(PROOF, d), { recursive: true }); }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let f = join(STATIC, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!f.startsWith(STATIC) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((ok) => server.listen(PORT, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${PORT}`;

const index = JSON.parse(readFileSync(join(STATIC, 'index.json'), 'utf8'));
const stories = Object.values(index.entries).filter((e) => e.type === 'story');
const fixture = (id) => {
  const [kind, name] = id.startsWith('parts-') ? ['parts', id.split('--')[1].replace(/-story$/, '')] : id.startsWith('screens-') ? ['screens', id.split('--')[1].replace(/-story$/, '')] : [null, null];
  if (!kind) return null;
  return { kind, name, fx: JSON.parse(readFileSync(join(HERE, '..', 'storybook', 'fixtures', kind, `${name}.json`), 'utf8')) };
};

const browser = await launch();
const report = { stories: stories.length, results: [], problems: [] };
try {
  const cmp = await comparer(browser);
  for (const theme of ['dark', 'light']) {
    for (const s of stories) {
      const f = fixture(s.id);
      const vp = f ? { width: f.fx.viewport.width + 120, height: f.fx.viewport.height + 160 } : { width: 1440, height: 900 };
      // a phone part or screen is looked at as on a phone: touch, a coarse pointer (app.css hides the key cap there)
      const phone = f && f.fx.device === 'phone';
      const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, reducedMotion: 'reduce', ...(phone ? { isMobile: true, hasTouch: true } : {}) });
      page.setDefaultTimeout(20000);
      page.on('pageerror', (e) => report.problems.push(`${theme} ${s.id} page error: ${e.message}`));
      try {
        await page.goto(`${BASE}/iframe.html?id=${s.id}&viewMode=story&globals=theme:${theme}`, { timeout: 30000 });
        await page.waitForSelector('#storybook-root > *', { timeout: 20000 });
        if (s.id.startsWith('flows--mermaid')) await page.waitForSelector('.flow[data-ready="true"]', { timeout: 20000 }).catch(() => report.problems.push(`${s.id} flow not drawn`));
        const shot = join(PROOF, 'story', `${s.id}--${theme}.png`);
        if (!f) {
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(s.id.startsWith('wireframes') ? 1200 : 300);
          await page.screenshot({ path: shot, fullPage: true, timeout: 30000 });
          continue;
        }
        await page.waitForSelector('iframe.ds-frame[data-ready="true"]', { timeout: 20000 });
        const frame = page.frameLocator('iframe.ds-frame');
        await page.waitForTimeout(150);
        const part = frame.locator('[data-story-part]');
        // the states the app had that markup does not carry: the pointer on the part, the focus inside it
        // a screen copy starts at the top; scroll it to where the app was
        if (f.kind === 'screens' && f.fx.scroll && (f.fx.scroll[0] || f.fx.scroll[1])) { await page.locator('iframe.ds-frame').evaluate((el, s) => el.contentWindow.scrollTo(s[0], s[1]), f.fx.scroll); await page.waitForTimeout(100); }
        const nth = (i) => f.kind === 'parts' ? part.locator('xpath=self::*|.//*').nth(i) : frame.locator('body *:not(script)').nth(i);
        if (f.fx.hover >= 0) { await nth(f.fx.hover).hover({ timeout: 10000, force: true }); await page.waitForTimeout(100); }
        if (f.fx.focus >= 0) { await nth(f.fx.focus).evaluate((e) => e.focus()); await page.waitForTimeout(100); }
        if (f.kind === 'parts') await part.screenshot({ path: shot, timeout: 20000 });
        else await page.locator('iframe.ds-frame').screenshot({ path: shot, timeout: 20000 });
        const real = join(PROOF, 'real', `${f.kind === 'parts' ? 'part' : 'screen'}-${f.name}--${theme}.png`);
        if (!existsSync(real)) { report.problems.push(`${s.id} no real screenshot ${real}`); continue; }
        const r = await cmp(real, shot, join(PROOF, 'diff', `${f.kind}-${f.name}--${theme}.png`));
        report.results.push({ id: s.id, kind: f.kind, name: f.name, title: f.fx.title, device: f.fx.device, theme, ...r });
      } catch (e) {
        report.problems.push(`${theme} ${s.id}: ${e.message.split('\n')[0]}`);
      } finally { await page.close(); }
    }
  }
} finally {
  await browser.close();
  await new Promise((ok) => server.close(ok));
}
writeFileSync(join(PROOF, 'report.json'), JSON.stringify(report, null, 1));
const res = report.results;
const pct = (r) => ((100 * r.big) / r.total).toFixed(2);
console.log(`${stories.length} stories x 2 themes; ${res.length} compared with the real app`);
console.log(`identical: ${res.filter((r) => r.identical).length}; differ: ${res.filter((r) => !r.identical).length}`);
for (const r of res.filter((x) => !x.identical)) console.log(`  ${r.kind} ${r.name} ${r.theme}: ${r.sameSize ? '' : `size real ${r.a.join('x')} story ${r.b.join('x')}, `}${r.any} px differ, ${r.big} by more than 16 (${pct(r)} %), max ${r.max}`);
console.log(report.problems.length ? 'problems:\n' + report.problems.join('\n') : 'no page errors');
