// The token pages draw on the app's own stylesheet (preview-head.html loads /static/app.css) and the built tokens.
// Parts and screens render in a frame of their own: a whole document with app.css, the body classes the app gave it and
// the markup the app rendered, so every selector of app.css matches as it does in the app.
import '../../build/css/tokens.css';
import './preview.css';

export const globalTypes = {
  theme: {
    description: 'Appearance',
    toolbar: { title: 'Appearance', icon: 'mirror', items: [{ value: 'dark', title: 'Dark' }, { value: 'light', title: 'Light' }], dynamicTitle: true },
  },
};
export const initialGlobals = { theme: 'dark' };

export const decorators = [
  (storyFn, context) => {
    document.documentElement.dataset.theme = context.globals.theme || 'dark';
    const out = storyFn();
    if (context.parameters.bare) return out;
    const el = document.createElement('div');
    el.className = 'stage';
    if (typeof out === 'string') el.innerHTML = out; else el.appendChild(out);
    return el;
  },
];

export const parameters = {
  layout: 'fullscreen',
  controls: { expanded: true },
  options: {
    storySort: {
      order: ['Wireframes', 'Flows', 'Screens', ['Desktop', 'Phone'], 'Parts', 'Tokens', ['Colour', 'Type', 'Space', 'Radius', 'Shadow', 'Motion', 'Written in rules']],
    },
  },
};
