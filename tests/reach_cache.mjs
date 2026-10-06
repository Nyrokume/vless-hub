import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const require = createRequire(process.env.PUPPETEER_PATH)
const puppeteer = require(process.env.PUPPETEER_PATH)
const root = path.resolve('site/dist')
const preview = await mkdtemp(path.join(tmpdir(), 'reach-cache-'))
const site = path.join(preview, 'vless-hub')
await cp(root, site, { recursive: true })

function typeOf(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8'
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (file.endsWith('.css')) return 'text/css; charset=utf-8'
  if (file.endsWith('.json')) return 'application/json; charset=utf-8'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  if (file.endsWith('.png')) return 'image/png'
  return 'application/octet-stream'
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    let rel = decodeURIComponent(url.pathname)
    if (rel.endsWith('/')) rel += 'index.html'
    const file = path.normalize(path.join(preview, rel))
    if (!file.startsWith(preview)) {
      res.writeHead(403)
      res.end()
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': typeOf(file), 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('missing')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const origin = `http://127.0.0.1:${port}`

function config(host, portNumber, country, code) {
  return {
    id: `${host}-${portNumber}`,
    uri: `vless://00000000-0000-0000-0000-000000000000@${host}:${portNumber}#${code}`,
    protocol: 'vless',
    remark: country,
    uuid: '00000000-0000-0000-0000-000000000000',
    host,
    port: portNumber,
    transport: 'tcp',
    security: 'tls',
    sni: host,
    flow: '',
    path: '',
    host_header: '',
    service_name: '',
    fingerprint: '',
    country_code: code,
    country,
    country_source: 'remark',
    ip_country_code: code,
    ip_country: country,
    extra: {},
    source: 'test',
    latency_ms: 180,
    status: 'working',
    stability: 1,
    tested_at: '2026-10-06T07:22:24Z',
    bits: '111',
    verified: 'full',
  }
}

function hub(configs) {
  return {
    version: 1,
    collector_version: '2.0.0',
    generated_at: '2026-10-06T07:22:24Z',
    duration_sec: 1,
    probe: {},
    fast_threshold_ms: 800,
    sources: [],
    stats: {},
    subscriptions: [],
    catalog: [],
    configs,
    unstable: [],
    unverified: [],
    proxies: [],
    unstable_proxies: [],
  }
}

async function publish(payload) {
  await mkdir(path.join(site, 'data'), { recursive: true })
  await writeFile(path.join(site, 'data', 'configs.json'), JSON.stringify(payload))
  await writeFile(
    path.join(site, 'data', 'version.json'),
    JSON.stringify({ generated_at: payload.generated_at }),
  )
}

function watch(page, accept) {
  const urls = []
  page.on('request', (request) => {
    if (accept(request.url())) urls.push(request.url())
  })
  return urls
}

async function openPage(context, options = {}) {
  const page = await context.newPage()
  await page.setViewport({ width: options.width || 412, height: options.height || 820, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
  await page.evaluateOnNewDocument(
    (book, hidden) => {
      localStorage.setItem('v2hub-theme', 'dark')
      if (book) localStorage.setItem('vless-hub-reach', JSON.stringify(book))
      if (hidden) {
        Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => true })
        Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => 'hidden' })
      }
    },
    options.book || null,
    Boolean(options.hidden),
  )
  return page
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

const report = {}
try {
  const cacheContext = await browser.createBrowserContext()
  const cacheHosts = [
    ['de.cache.test', 'Германия', 'DE'],
    ['us.cache.test', 'США', 'US'],
    ['nl.cache.test', 'Нидерланды', 'NL'],
    ['fi.cache.test', 'Финляндия', 'FI'],
    ['fr.cache.test', 'Франция', 'FR'],
  ]
  const cacheConfigs = cacheHosts.map(([host, country, code], index) => config(host, 443, country, code, index))
  await publish(hub(cacheConfigs))
  const stamped = Date.now()
  const cacheBook = {
    at: stamped,
    byEndpoint: Object.fromEntries(
      cacheHosts.map(([host]) => [`${host}:443`, { status: 'open', ms: 180, at: stamped }]),
    ),
  }
  const cachePage = await openPage(cacheContext, { book: cacheBook })
  const cacheProbes = watch(cachePage, (url) => cacheHosts.some(([host]) => url.includes(host)))
  await cachePage.goto(`${origin}/vless-hub/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await cachePage.waitForFunction(() => (document.body.innerText || '').includes('Германия'), { timeout: 15000, polling: 200 })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const cacheText = await cachePage.evaluate(() => document.body.innerText || '')
  const cacheGate = await cachePage.$('[data-reach-gate]')
  report.cacheProbes = cacheProbes.length
  report.cacheSplash = cacheText.includes('Ищу доступные') || Boolean(cacheGate)
  report.cacheList = cacheText.includes('Германия') && cacheText.includes('США')
  await cacheContext.close()

  const livePath = '/tmp/live-configs.json'
  let live = null
  try {
    live = JSON.parse(await readFile(livePath, 'utf8'))
  } catch {
    live = null
  }
  if (live && Array.isArray(live.configs)) {
    const shotContext = await browser.createBrowserContext()
    const probeable = live.configs.filter((item) => {
      const name = String(item.protocol || 'vless').toLowerCase()
      return item.host && item.port && name !== 'hysteria2' && name !== 'hy2' && name !== 'tuic'
    })
    const shotAt = Date.now()
    const shotBook = {
      at: shotAt,
      byEndpoint: Object.fromEntries(
        probeable.map((item) => [
          `${String(item.host).trim().toLowerCase()}:${item.port}`,
          { status: 'open', ms: 220, at: shotAt },
        ]),
      ),
    }
    await publish(live)
    const shot = await openPage(shotContext, { book: shotBook, width: 412, height: 820 })
    const hosts = new Set(probeable.map((item) => String(item.host).trim().toLowerCase()))
    const shotProbes = watch(shot, (url) => {
      try {
        return hosts.has(new URL(url).hostname.toLowerCase())
      } catch {
        return false
      }
    })
    await shot.goto(`${origin}/vless-hub/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await shot.waitForFunction(() => (document.body.innerText || '').includes('США'), { timeout: 20000, polling: 200 })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    const shotText = await shot.evaluate(() => document.body.innerText || '')
    report.shotProbes = shotProbes.length
    report.shotSplash = shotText.includes('Ищу доступные')
    report.shotList = shotText.includes('США') && shotText.includes('Германия')
    await mkdir('/opt/cursor/artifacts', { recursive: true })
    await shot.screenshot({ path: '/opt/cursor/artifacts/configs-412-cache-dark.png' })
    await shotContext.close()
  }

  const scanHosts = [19021, 19022, 19023, 19024]
  const scanConfigs = scanHosts.map((item, index) =>
    config('127.0.0.1', item, index % 2 ? 'США' : 'Германия', index % 2 ? 'US' : 'DE'),
  )
  await publish(hub(scanConfigs))
  const isScanProbe = (url) => {
    try {
      const parsed = new URL(url)
      return (parsed.hostname === '127.0.0.1' && parsed.port !== String(port)) || parsed.hostname.endsWith('.example')
    } catch {
      return false
    }
  }

  async function scan(pages) {
    const context = await browser.createBrowserContext()
    const opened = []
    const urls = []
    for (let index = 0; index < pages; index += 1) {
      const page = await openPage(context)
      watch(page, (url) => {
        if (isScanProbe(url)) urls.push(url)
        return false
      })
      opened.push(page)
    }
    await Promise.all(opened.map((page) => page.goto(`${origin}/vless-hub/`, { waitUntil: 'domcontentloaded', timeout: 20000 })))
    await Promise.all(
      opened.map(async (page) => {
        try {
          await page.waitForFunction(() => (document.body.innerText || '').includes('Меньше пяти'), {
            timeout: 30000,
            polling: 200,
          })
        } catch (error) {
          const text = await page.evaluate(() => (document.body.innerText || '').slice(0, 500)).catch(() => '')
          throw new Error(`${error.message}\n${text}\nprobes ${urls.length}`)
        }
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 500))
    await context.close()
    return urls.length
  }

  report.single = await scan(1)
  report.dual = await scan(2)

  const hiddenContext = await browser.createBrowserContext()
  const hiddenPage = await openPage(hiddenContext, { hidden: true })
  const hiddenUrls = []
  watch(hiddenPage, (url) => {
    if (isScanProbe(url)) hiddenUrls.push(url)
    return false
  })
  await hiddenPage.goto(`${origin}/vless-hub/`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await new Promise((resolve) => setTimeout(resolve, 3000))
  report.hiddenFlag = await hiddenPage.evaluate(() => document.hidden === true && document.visibilityState === 'hidden')
  report.hidden = hiddenUrls.length
  await hiddenContext.close()

  console.log(JSON.stringify(report))
  if (report.cacheProbes !== 0 || report.cacheSplash || !report.cacheList) process.exit(1)
  if (report.shotProbes !== 0 || report.shotSplash || !report.shotList) process.exit(1)
  if (!(report.single > 0) || !(report.dual > 0) || report.dual > report.single * 1.5) process.exit(1)
  if (!report.hiddenFlag || report.hidden !== 0) process.exit(1)
} finally {
  await browser.close()
  server.close()
  await rm(preview, { recursive: true, force: true })
}
