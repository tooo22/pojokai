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
        sans: ['Geist', 'system-ui', 'sans-serif'],
        display: ['Geist', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        soft: '0 0 #0000'
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
        danger: c('--danger'),
        success: c('--success'),
        warning: c('--warning'),
      },
    },
  },
  plugins: [],
};
