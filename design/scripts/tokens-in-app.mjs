// The render proof of the tokens: the real app with build/css/tokens.css laid over app.css (its :root blocks then come
// from the tokens) must look the same, pixel for pixel, as the app alone. Run through scripts/with-real-app.sh.
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, context, login, seed, BASE } from './lib/real.mjs';
import { comparer } from './lib/compare.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'proof', 'tokens-in-app');
mkdirSync(OUT, { recursive: true });
const css = readFileSync(join(HERE, '..', 'build', 'css', 'tokens.css'), 'utf8');
const browser = await launch();
const rows = [];
try {
  const cmp = await comparer(browser);
  let seeded = false;
  for (const device of ['desk', 'phone']) {
    for (const theme of ['dark', 'light']) {
      const ctx = await context(browser, device, theme);
      await login(ctx);
      if (!seeded) { await seed(ctx); seeded = true; }
      const page = await ctx.newPage();
      for (const [name, path, act] of [['dashboard', '/', null], ['all', '/', device === 'desk' ? '.si[data-view="all"]' : '.ptab[data-tab="inbox"]'], ['how-to-save', '/bookmarklet', null], ['save', '/save?url=https%3A%2F%2Fexample.com%2Fx&title=X', null]]) {
        await page.goto(BASE + path, { timeout: 20000 });
        if (act) await page.locator(act).first().click({ timeout: 5000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const a = join(OUT, `${device}-${name}-${theme}-app.png`), b = join(OUT, `${device}-${name}-${theme}-tokens.png`);
        await page.screenshot({ path: a, timeout: 15000 });
        const tag = await page.addStyleTag({ content: css });
        await page.waitForTimeout(150);
        await page.screenshot({ path: b, timeout: 15000 });
        await tag.evaluate((n) => n.remove());
        const r = await cmp(a, b, join(OUT, `${device}-${name}-${theme}-diff.png`));
        rows.push(`${device} ${name} ${theme}: ${r.identical ? 'identical' : `${r.any} px differ, max ${r.max}`}`);
      }
      await ctx.close();
    }
  }
} finally { await browser.close(); }
console.log(rows.join('\n'));
console.log(rows.every((r) => r.endsWith('identical')) ? 'PASS: the app with tokens.css looks the same as the app alone' : 'FAIL');
