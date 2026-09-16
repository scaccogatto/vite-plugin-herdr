import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import inspector from 'vite-plugin-vue-inspector'
import herdr from './src/index.ts'

// Demo app: bundle demo/ with vite-plugin-herdr injected. The library itself
// is built by vite.config.ts; here we only serve the demo, aliasing the plugin
// import to the sources so the demo reads exactly like real consumer code.
export default defineConfig({
  root: resolve(import.meta.dirname, 'demo'),
  plugins: [
    vue(),
    // vite-plugin-herdr's sourceHint() reads data-v-inspector with getAttribute, so the
    // attribute must survive in the DOM: since inspector v7 that is the only behaviour
    // (v6 needed cleanHtml: false, the option is gone).
    inspector({ enabled: false, toggleButtonVisibility: 'never', toggleComboKey: false }),
    herdr(),
  ],
  server: { port: 3131 },
  build: {
    outDir: resolve(import.meta.dirname, 'dist-demo'),
    emptyOutDir: true,
  },
})
