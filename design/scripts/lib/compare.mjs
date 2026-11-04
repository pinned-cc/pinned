// Compares two PNG screenshots pixel by pixel in a blank browser page (canvas), so no image library is needed.
// Returns the sizes, the number of pixels that differ at all and by more than 16 of 255 in a channel, and the largest
// difference; writes a picture of the differences (red where they differ, the first image greyed elsewhere).
import { readFileSync, writeFileSync } from 'node:fs';

export async function comparer(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  await page.setContent('<canvas id="c"></canvas>');
  return async (a, b, diffPath) => {
    const r = await page.evaluate(async ([A, B]) => {
      const load = (s) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + s; });
      const [ia, ib] = await Promise.all([load(A), load(B)]);
      const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
      const px = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
      const da = px(ia), db = px(ib);
      const out = document.getElementById('c'); out.width = w; out.height = h;
      const ox = out.getContext('2d'), od = ox.createImageData(w, h);
      let any = 0, big = 0, max = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]), Math.abs(da[i + 3] - db[i + 3]));
        if (d > 0) any++;
        if (d > 16) big++;
        if (d > max) max = d;
        const g = (da[i] + da[i + 1] + da[i + 2]) / 3 * 0.35;
        od.data[i] = d > 16 ? 255 : g; od.data[i + 1] = d > 16 ? 40 : g; od.data[i + 2] = d > 16 ? 40 : g; od.data[i + 3] = 255;
      }
      ox.putImageData(od, 0, 0);
      return { a: [ia.width, ia.height], b: [ib.width, ib.height], any, big, max, total: w * h, diff: any ? out.toDataURL('image/png').split(',')[1] : null };
    }, [readFileSync(a).toString('base64'), readFileSync(b).toString('base64')]);
    if (r.diff && diffPath) writeFileSync(diffPath, Buffer.from(r.diff, 'base64'));
    delete r.diff;
    r.sameSize = r.a[0] === r.b[0] && r.a[1] === r.b[1];
    r.identical = r.sameSize && r.any === 0;
    return r;
  };
}
