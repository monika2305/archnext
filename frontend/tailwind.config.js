/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        space: ['"Space Grotesk"', 'sans-serif'],
        syne: ['"Syne"', 'sans-serif'],
        serif: ['"Instrument Serif"', 'Georgia', 'serif'],
        bricolage: ['"Bricolage Grotesque"', 'sans-serif'],
        hand: ['"Caveat"', 'cursive'],
        unbounded: ['"Unbounded"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        paper: '#F7F5F1',
        panel: '#FFFFFF',
        line: '#E4E0D8',
        ink: { DEFAULT: '#26292E', soft: '#4A4F57', mute: '#7C818A' },
        accent: { DEFAULT: '#3F6A8F', soft: '#E7EEF4', dark: '#2F5373' },
        ok: '#3E7D5A', warn: '#B07A2A', bad: '#A64B45',
        // Landing page palette
        obsidian: '#11110F',
        bone: '#E9E2D0',
        'warm-ash': '#A9A397',
        'stone-shadow': '#3A3832',
        'oxidized-copper': '#C56A45',
        'mineral-teal': '#3F7C78',
        limestone: '#D7C9A8',
      },
      letterSpacing: {
        tightest: '-0.04em',
        tighter: '-0.02em',
        'widest-tech': '0.2em',
        'super-wide': '0.35em',
      },
      boxShadow: { card: '0 1px 2px rgba(38,41,46,0.05)', float: '0 6px 24px -6px rgba(38,41,46,0.18), 0 1px 3px rgba(38,41,46,0.06)' },
    },
  },
  plugins: [],
}
