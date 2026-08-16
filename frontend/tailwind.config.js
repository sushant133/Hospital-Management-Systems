/** @type {import('tailwindcss').Config} */

/**
 * ============================================================================
 * DESIGN TOKENS
 * ============================================================================
 *
 * This is an operational tool that clinicians read all shift, on bright ward
 * screens that are often cheap and badly calibrated. It is scanned, not read.
 * Two decisions follow from that and drive everything below.
 *
 * ---------------------------------------------------------------------------
 * 1. THE BRAND COLOUR RECEDES SO SEVERITY CAN SHOUT
 * ---------------------------------------------------------------------------
 * The previous palette used Tailwind's stock blue-500 — a bright, high-chroma
 * accent — for navigation, links and buttons. In a clinical interface that is
 * actively harmful: it competes for attention with the red and amber that carry
 * life-safety meaning (a critical potassium, an allergy contraindication, an
 * unacknowledged alert). When everything is vivid, nothing reads as urgent.
 *
 * So `brand` is a deeper, muted blue. It is unmistakably the interface's colour
 * without ever competing with a warning, and it holds up on a washed-out
 * monitor where a light blue turns to grey.
 *
 * ---------------------------------------------------------------------------
 * 2. SEVERITY IS A FIRST-CLASS SCALE, NOT AD-HOC UTILITY CLASSES
 * ---------------------------------------------------------------------------
 * `critical` / `warning` / `success` are named, so a component asks for meaning
 * rather than for a colour. That is what stops one screen rendering a severe
 * allergy in `red-500` and another in `rose-600`, and it is what makes the
 * severity vocabulary from the medication-safety and critical-result work read
 * consistently wherever it surfaces.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        /**
         * Deep clinical blue. Navigation, links, primary actions.
         * Deliberately calmer than stock blue — see note 1 above.
         */
        brand: {
          50: '#eef4fb',
          100: '#d7e6f5',
          200: '#b3cdea',
          300: '#82abd9',
          400: '#4f83c2',
          500: '#2f66a8',
          600: '#22508b',
          700: '#1c4172',
          800: '#1a375d',
          900: '#18304e',
          950: '#101f33',
        },

        /**
         * Life-safety. Reserved for things that can harm a patient: a
         * contraindicated prescription, an unacknowledged critical result, an
         * ABO mismatch. High chroma on purpose — this one is allowed to shout.
         */
        critical: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d',
        },

        /** Needs attention but is not dangerous: overdue, expiring, unverified. */
        warning: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },

        /** Settled, verified, acknowledged, in stock. */
        success: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
      },

      /**
       * A system stack, and NO webfont.
       *
       * The previous config named `Inter` first but nothing ever loaded it, so
       * every screen silently rendered in system-ui anyway — the design intent
       * was never on screen. Rather than add a font CDN, this commits to the
       * stack that was actually rendering: a hospital that loses its internet
       * connection (which this system is explicitly built to survive) must not
       * also lose its typeface, and a blocking font request on a slow ward
       * connection costs more than it returns.
       */
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Noto Sans',
          // Devanagari fallbacks, so Nepali text has a real face rather than
          // whatever the browser guesses.
          'Noto Sans Devanagari',
          'Mangal',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'Cascadia Mono', 'Consolas', 'Menlo', 'monospace'],
      },

      fontSize: {
        // A dedicated step for the small uppercase labels this UI uses heavily.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },

      /**
       * Softer, tighter shadows. The stock `shadow-sm` on a white card against
       * a light ground reads as a smudge; these define an edge instead.
       */
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 2px 4px -1px rgb(15 23 42 / 0.06), 0 4px 12px -2px rgb(15 23 42 / 0.08)',
        popover: '0 4px 6px -2px rgb(15 23 42 / 0.06), 0 12px 28px -6px rgb(15 23 42 / 0.16)',
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        /** For an unacknowledged critical alert. Slow — not a strobe. */
        'pulse-critical': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(220 38 38 / 0.4)' },
          '50%': { boxShadow: '0 0 0 6px rgb(220 38 38 / 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        'pulse-critical': 'pulse-critical 2s ease-out infinite',
      },
    },
  },
  plugins: [],
};
