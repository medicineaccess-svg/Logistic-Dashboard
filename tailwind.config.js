/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Ikris design tokens (defined as CSS variables in src/index.css)
        navy: { 50: v('pale-blue'), 100: v('blue-100'), 600: v('blue'), 700: v('blue-700'), 800: v('navy'), 900: v('navy-900') },
        sage: { 50: v('pale-sage'), 500: v('sage') },
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        mist: v('mist'),
        canvas: v('canvas'),
        aubergine: v('aubergine'),
        marigold: v('marigold'),
        ok: v('ok'),
        warn: v('warn'),
        err: v('err'),
        info: v('info'),
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: { soft: '0 1px 2px rgba(25,49,83,0.04), 0 2px 8px rgba(25,49,83,0.04)' },
      keyframes: { rise: { '0%': { opacity: '0', transform: 'translateY(4px)' }, '100%': { opacity: '1', transform: 'none' } } },
      animation: { rise: 'rise 220ms ease-out both' },
    },
  },
  plugins: [],
};
