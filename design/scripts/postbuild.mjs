// After storybook build, as the planner does: keep one page title, and write U+FFFD in the JS bundles as the escape
// � (every occurrence sits inside a string literal), since the publisher refuses the raw character.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const out = process.argv[2] || 'storybook-static';
const index = join(out, 'index.html');
writeFileSync(index, readFileSync(index, 'utf8').replace(/<title>[^<]*Storybook<\/title>\s*/, ''));
let n = 0;
for (const f of readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js'))) {
  const p = join(out, 'assets', f), s = readFileSync(p, 'utf8');
  if (!s.includes('�')) continue;
  n += s.split('�').length - 1;
  writeFileSync(p, s.replaceAll('�', '\\uFFFD'));
}
console.log(`postbuild: ${n} U+FFFD escaped`);
