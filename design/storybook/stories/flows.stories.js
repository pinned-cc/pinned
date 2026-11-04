// The flows as drawn (design/wireframes/flows/*.mmd, Mermaid) and as written (flows/flows.md), shown as they are in the files.
import mermaid from 'mermaid';
import md from '../../wireframes/flows/flows.md?raw';

const FLOWS = import.meta.glob('../../wireframes/flows/*.mmd', { query: '?raw', import: 'default', eager: true });
const NAMES = Object.keys(FLOWS).map((p) => p.split('/').pop()).sort();
let n = 0;

export default { title: 'Flows', parameters: { controls: { expanded: true } } };

export const Mermaid = {
  argTypes: { flow: { control: 'select', options: NAMES } },
  args: { flow: NAMES[0] },
  render: ({ flow }) => {
    const el = document.createElement('div');
    el.innerHTML = `<p class="ds-cap">design/wireframes/flows/${flow}</p><div class="flow" data-ready="false" style="background:#fff;border-radius:12px;padding:16px;overflow:auto"></div>`;
    const box = el.querySelector('.flow');
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', flowchart: { htmlLabels: true } });
    mermaid.render(`flow${n++}`, FLOWS[`../../wireframes/flows/${flow}`])
      .then(({ svg }) => { box.innerHTML = svg; box.dataset.ready = 'true'; })
      .catch((e) => { box.textContent = String(e); box.dataset.ready = 'error'; });
    return el;
  },
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
function render(src) {
  const out = [];
  let list = null, table = null, para = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; }
    if (table) {
      const [h, , ...rows] = table;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      out.push(`<table class="ds-table"><tr>${cells(h).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`);
      table = null;
    }
  };
  for (const line of src.split('\n')) {
    const h = line.match(/^(#{1,3}) (.*)/), ol = line.match(/^\d+[a-z]?\. (.*)/), ul = line.match(/^[-*] (.*)/);
    if (h) { flush(); out.push(`<h${h[1].length + 1} class="ds-h2">${inline(h[2])}</h${h[1].length + 1}>`); }
    else if (line.startsWith('|')) { if (!table) { flush(); table = []; } table.push(line); }
    else if (ol || ul) { const tag = ol ? 'ol' : 'ul'; if (!list || list.tag !== tag) { flush(); list = { tag, items: [] }; } list.items.push((ol || ul)[1]); }
    else if (/^\s{2,}\S/.test(line) && list) list.items[list.items.length - 1] += ' ' + line.trim();
    else if (!line.trim()) flush();
    else { if (list || table) flush(); para.push(line.trim()); }
  }
  flush();
  return out.join('');
}

export const WrittenFlows = {
  name: 'Written flows',
  parameters: { controls: { disable: true } },
  render: () => `<p class="ds-cap">design/wireframes/flows/flows.md</p><article style="max-width:900px">${render(md)}</article>`,
};
