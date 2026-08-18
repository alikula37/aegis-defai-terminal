import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Dev server proxies the same-origin paths the production nginx serves:
  // the app uses relative /api and /ws by default, so dev and prod behave
  // identically (cookies stay first-party, no CORS involved).
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    coverage: {
      // lcov feeds SonarQube/SonarCloud; text-summary for the terminal;
      // json-summary feeds the CI coverage gate (scripts/coverage-gate.mjs).
      reporter: ['lcov', 'text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
    },
  }
})
