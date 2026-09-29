/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './owner.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#F5F5F0', 100: '#E8E8E0', 200: '#D6D6CD', 300: '#B5B5AC',
          400: '#8E8E86', 500: '#6B6B64', 600: '#4A4A45', 700: '#2A2A27',
          800: '#1A1A18', 900: '#0F0F0E',
        },
        paper: '#FDFDFB',
        accent: {
          50: '#EEF7F2', 100: '#D6EDE2', 300: '#6BBF9A',
          500: '#1A7F5A', 700: '#145C43', 900: '#0B3D2E',
        },
        success: '#1A7F5A',
        warning: '#B8731A',
        danger: '#A83232',
        info: '#2A5C8E',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'monospace'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px', xl: '24px' },
      boxShadow: {
        xs: '0 1px 2px rgba(15,15,14,0.04)',
        sm: '0 1px 3px rgba(15,15,14,0.06), 0 1px 2px rgba(15,15,14,0.04)',
        md: '0 4px 12px rgba(15,15,14,0.06), 0 2px 4px rgba(15,15,14,0.04)',
        lg: '0 12px 32px rgba(15,15,14,0.08), 0 4px 8px rgba(15,15,14,0.04)',
        xl: '0 24px 64px rgba(15,15,14,0.10), 0 8px 16px rgba(15,15,14,0.04)',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
};
