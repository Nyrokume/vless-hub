import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

function collectorData(): Plugin {
  const publish = path.resolve(import.meta.dirname, '../publish')
  const roots = ['data', 'sub', 'api', 'tg']

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const raw = (req.url ?? '').split('?')[0]
    for (const folder of roots) {
      const marker = `/${folder}/`
      const index = raw.indexOf(marker)
      if (index === -1) continue
      const rel = decodeURIComponent(raw.slice(index + marker.length))
      if (!rel || rel.includes('..') || rel.includes('\\')) {
        next()
        return
      }
      const file = path.resolve(publish, folder, rel)
      const root = path.resolve(publish, folder) + path.sep
      if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        next()
        return
      }
      const type = file.endsWith('.json')
        ? 'application/json; charset=utf-8'
        : file.endsWith('.yaml') || file.endsWith('.yml')
          ? 'application/yaml; charset=utf-8'
          : 'text/plain; charset=utf-8'
      res.setHeader('Content-Type', type)
      res.setHeader('Cache-Control', 'no-cache')
      fs.createReadStream(file).pipe(res)
      return
    }
    next()
  }

  return {
    name: 'collector-data',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
    closeBundle() {
      const dist = path.resolve(import.meta.dirname, 'dist')
      for (const folder of roots) {
        const src = path.join(publish, folder)
        if (!fs.existsSync(src)) continue
        fs.cpSync(src, path.join(dist, folder), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  base: '/vless-hub/',
  build: {
    target: ['chrome80', 'safari13', 'firefox78', 'edge88'],
  },
  plugins: [react(), tailwindcss(), collectorData()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
