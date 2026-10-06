/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './owner.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#F7F9FE', 100: '#E9EDF6', 200: '#D9E1EF', 300: '#BEC9DC',
          400: '#8B98AF', 500: '#68758E', 600: '#4C5A75', 700: '#344263',
          800: '#1C2A50', 900: '#101A42',
        },
        paper: '#FFFFFF',
        accent: {
          50: '#F2F1FF', 100: '#E8E6FF', 300: '#BEB7FF',
          500: '#5948ED', 700: '#483BD7', 900: '#322A9B',
        },
        success: '#0E9F6E',
        warning: '#B8731A',
        danger: '#A83232',
        info: '#2A5C8E',
      },
      fontFamily: {
        display: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      borderRadius: { sm: '10px', md: '14px', lg: '18px', xl: '24px' },
      boxShadow: {
        xs: '0 1px 3px rgba(15,23,42,0.05), 0 6px 18px rgba(25,41,84,0.04)',
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
