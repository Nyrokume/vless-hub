import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

function collectorData(): Plugin {
  const src = path.resolve(import.meta.dirname, '../data')

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const raw = (req.url ?? '').split('?')[0]
    const marker = '/data/'
    const index = raw.indexOf(marker)
    if (index === -1) {
      next()
      return
    }
    const rel = decodeURIComponent(raw.slice(index + marker.length))
    if (!rel || rel.includes('..') || rel.includes('\\')) {
      next()
      return
    }
    const file = path.resolve(src, rel)
    const root = src.endsWith(path.sep) ? src : `${src}${path.sep}`
    if (!file.startsWith(root)) {
      next()
      return
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      next()
      return
    }
    const type = file.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : 'text/plain; charset=utf-8'
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'no-cache')
    fs.createReadStream(file).pipe(res)
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
      fs.cpSync(src, path.resolve(import.meta.dirname, 'dist/data'), { recursive: true })
    },
  }
}

export default defineConfig({
  base: '/vless-hub/',
  plugins: [react(), tailwindcss(), collectorData()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
