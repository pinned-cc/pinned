/** Storybook 9, plain HTML stories on Vite, as the planner's design system.
 *  The app's own files are served as the app serves them: web/ at /static (app.css, fonts, icons), the favicon at
 *  /favicon.svg. The wireframes are served as they are, next to iframe.html. */
const WEB = '../../../web';
export default {
  stories: ['../stories/**/*.stories.js'],
  framework: { name: '@storybook/html-vite', options: {} },
  core: { disableTelemetry: true },
  staticDirs: [
    { from: WEB, to: '/static' },
    { from: `${WEB}/icons/favicon.svg`, to: '/favicon.svg' },
    { from: '../../wireframes/screens', to: '/wireframes/screens' },
    ...['wire.css', 'wire.js', 'flows.js', 'walk.html', 'index.html'].map((f) => ({ from: `../../wireframes/${f}`, to: `/wireframes/${f}` })),
  ],
};
