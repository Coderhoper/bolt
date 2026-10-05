/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './owner.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#F4F7FB', 100: '#E8EDF5', 200: '#D7DFEB', 300: '#B5C1D4',
          400: '#8694AA', 500: '#64748B', 600: '#475569', 700: '#334155',
          800: '#172033', 900: '#0C1426',
        },
        paper: '#FFFFFF',
        accent: {
          50: '#EEF2FF', 100: '#E0E7FF', 300: '#A5B4FC',
          500: '#635BFF', 700: '#4F46E5', 900: '#312E81',
        },
        success: '#0E9F6E',
        warning: '#B8731A',
        danger: '#A83232',
        info: '#2A5C8E',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      borderRadius: { sm: '8px', md: '14px', lg: '18px', xl: '24px' },
      boxShadow: {
        xs: '0 1px 3px rgba(15,23,42,0.04)',
        sm: '0 2px 8px rgba(15,23,42,0.06)',
        md: '0 8px 24px rgba(15,23,42,0.08)',
        lg: '0 16px 40px rgba(15,23,42,0.10)',
        xl: '0 24px 64px rgba(15,23,42,0.12)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
};
