const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './assets/app.js',
    './assets/admin.js',
    './assets/style.css'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Geist', 'system-ui', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Geist', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        soft: '0 0 #0000',
        card: '0 2px 8px -2px rgba(15, 34, 87, 0.06), 0 1px 4px -1px rgba(15, 34, 87, 0.04)',
        'card-hover': '0 12px 24px -6px rgba(15, 34, 87, 0.1), 0 4px 8px -2px rgba(15, 34, 87, 0.05)',
      },
      colors: {
        bg: c('--bg'),
        main: c('--fg'),
        surface: c('--surface'),
        'surface-2': c('--surface-2'),
        'surface-3': c('--surface-3'),
        line: c('--border'),
        'line-soft': c('--line-soft'),
        muted: c('--muted'),
        subtle: c('--subtle'),
        primary: c('--primary'),
        'primary-fg': c('--primary-fg'),
        'primary-hover': c('--primary-hover'),
        accent: c('--accent'),
        'accent-fg': c('--accent-fg'),
        price: c('--price'),
        navy: c('--navy'),
        danger: c('--danger'),
        success: c('--success'),
        warning: c('--warning'),
      },
    },
  },
  plugins: [],
};
