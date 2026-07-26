import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function buildPwaServiceWorker(): Plugin {
  return {
    name: 'build-attendance-service-worker',
    apply: 'build',
    generateBundle() {
      const template = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf8')
      const buildVersion = new Date().toISOString().replace(/\D/g, '')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace(/__BUILD_VERSION__/g, buildVersion),
      })
    },
  }
}

export default defineConfig({
  base: '/crew-attendance/',
  plugins: [
    react(),
    buildPwaServiceWorker(),
  ],
})
