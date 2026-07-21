import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Build commit, injected for the client error sink so a logged error says which
// deploy it came from. Vercel sets VERCEL_GIT_COMMIT_SHA at build; 'dev' locally.
const APP_VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  build: {
    chunkSizeWarningLimit: 900,
    // Skip the inline module-preload polyfill so a strict `script-src 'self'` CSP
    // (no 'unsafe-inline') isn't tripped by an injected inline script. Modern
    // browsers support modulepreload natively.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Keep long-lived vendor code in its own cacheable chunk, separate from
        // app code. Recharts is additionally split via the dynamic import in
        // OverviewTab, so it streams in after first paint rather than blocking it.
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'motion'
            if (id.includes('lucide-react')) return 'icons'
          }
        },
      },
    },
  },
})
