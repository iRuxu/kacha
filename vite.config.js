import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { workbenchPlugins } from './server/index.js'

export default defineConfig({
  optimizeDeps: { exclude: ['virtual:project-global', '@/service/jimeng.js'] },
  plugins: [vue(), ...workbenchPlugins()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 24074, strictPort: true },
})
