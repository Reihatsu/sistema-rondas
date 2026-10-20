/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta corporativa inspirada en Odoo (púrpura + grises neutros).
        odoo: {
          50: "#fbf8fa",
          100: "#f4ebf1",
          200: "#e8d6e2",
          300: "#d4b3ca",
          400: "#b98aa9",
          500: "#9f668b",
          600: "#875a7b",
          700: "#714b67",
          800: "#5d3e55",
          900: "#4c3446",
          950: "#2d2029",
        },
      },
      fontFamily: {
        sans: [
          '"Segoe UI"',
          "system-ui",
          "-apple-system",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.06)",
      },
      screens: {
        xs: "420px",
      },
    },
  },
  plugins: [],
};
