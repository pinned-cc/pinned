// The clickable wireframes (design/wireframes, built by build.py), served next to iframe.html through staticDirs.
// Each story is one full height frame; links between screens work inside it as they do on disk.
import flowsSrc from '../../wireframes/flows.js?raw';

const { FLOWS, TITLES } = new Function('window', `${flowsSrc}; return window;`)({});
const SCREENS = Object.keys(TITLES).sort();
const FLOW_IDS = FLOWS.map((f) => f.id);
const FLOW_LABELS = Object.fromEntries(FLOWS.map((f) => [f.id, `${f.id} ${f.name}`]));

const full = (src) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;background:#e5e7ef';
  el.innerHTML = `<iframe src="${src}" title="Wireframe" style="display:block;border:0;width:100%;height:100%;background:#e5e7ef"></iframe>`;
  return el;
};

export default { title: 'Wireframes', parameters: { bare: true, layout: 'fullscreen', controls: { expanded: true } } };

export const AllFlowsAndScreens = { name: 'All flows and screens', parameters: { controls: { disable: true } }, render: () => full('wireframes/index.html') };

export const WalkAFlow = {
  name: 'Walk a flow',
  argTypes: { flow: { control: { type: 'select', labels: FLOW_LABELS }, options: FLOW_IDS } },
  args: { flow: FLOW_IDS[0] },
  render: ({ flow }) => full(`wireframes/walk.html?f=${flow}`),
};

export const OneScreen = {
  name: 'One screen',
  argTypes: {
    screen: { control: { type: 'select', labels: Object.fromEntries(SCREENS.map((s) => [s, `${s}: ${TITLES[s]}`])) }, options: SCREENS },
    hot: { control: 'boolean', description: 'Outline every link (the h key on any screen)' },
  },
  args: { screen: SCREENS.includes('all') ? 'all' : SCREENS[0], hot: false },
  render: ({ screen, hot }) => full(`wireframes/screens/${screen}.html${hot ? '?hot=1' : ''}`),
};
