import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 900,
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
