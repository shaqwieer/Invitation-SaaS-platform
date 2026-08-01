import type { Config } from 'tailwindcss';

/**
 * Design tokens from §00 of the design doc ("لوحة نظام التصميم").
 *
 * The five guest-status colours are defined once here and used nowhere else in
 * any other role — the design's stated rule is that a host should be able to read
 * the guest table at a glance, which only holds if those hues never appear as
 * decoration.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: '#EBE9E3',
        surface: { DEFAULT: '#FFFFFF', muted: '#FAF9F6', sand: '#F3EFE4' },
        line: { DEFAULT: '#E5E3DC', soft: '#EFEDE7', strong: '#DAD7CF' },
        ink: { DEFAULT: '#17211D', muted: '#5C665F', light: '#8A928C', faint: '#A6ADA7' },

        emerald: {
          900: '#093127',
          800: '#0A4234',
          700: '#0E5A45', // primary
          500: '#1A7458',
          100: '#E7F0EB',
          ink: '#0B2019',
        },
        gold: { DEFAULT: '#A8843C', dark: '#6E5420', light: '#F5EFE2' },
        rose: { DEFAULT: '#B98A86', deep: '#8E5F58' },

        // Guest status — reserved. Do not reuse for anything else.
        status: {
          confirmed: '#0E5A45',
          confirmedBg: '#E7F0EB',
          confirmedFg: '#0B4B39',
          declined: '#A14A4A',
          declinedBg: '#F7EBEA',
          declinedFg: '#8E3F3F',
          pending: '#9A6B1E',
          pendingBg: '#F8F0DF',
          pendingFg: '#7E5716',
          notSent: '#8A928C',
          notSentBg: '#EFEEE9',
          notSentFg: '#5C665F',
        },
      },

      fontFamily: {
        // Arabic first: it is the default UI language, not a translation layer.
        sans: ['var(--font-plex-arabic)', 'var(--font-plex)', 'system-ui', 'sans-serif'],
        latin: ['var(--font-plex)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-amiri)', 'Georgia', 'serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        // Arabic needs ≥1.9 line-height on body copy to leave room for
        // diacritics and dots — the design calls this out explicitly.
        display: ['2.75rem', { lineHeight: '1.4', fontWeight: '600' }],
        h1: ['2.125rem', { lineHeight: '1.45', fontWeight: '600' }],
        h2: ['1.625rem', { lineHeight: '1.5', fontWeight: '600' }],
        h3: ['1.25rem', { lineHeight: '1.55', fontWeight: '600' }],
        body: ['0.9375rem', { lineHeight: '1.9' }],
        caption: ['0.78125rem', { lineHeight: '1.7' }],
      },

      borderRadius: { card: '1.25rem', control: '0.75rem', chip: '999px' },

      boxShadow: {
        'sh-1': '0 1px 2px rgba(23,33,29,.05)',
        'sh-2': '0 10px 28px -18px rgba(23,33,29,.5)',
        'sh-3': '0 24px 52px -30px rgba(23,33,29,.6)',
      },
    },
  },
  plugins: [],
};

export default config;
