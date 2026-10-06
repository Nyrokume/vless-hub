import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { judgeReach } from '../site/src/lib/reach.ts'

const LAB = `
import http.server, ssl, socket, threading, time, os
from pathlib import Path
root = Path('/tmp/reach-lab')
root.mkdir(exist_ok=True)
cert, key = root / 'cert.pem', root / 'key.pem'
if not cert.exists():
    os.system(f'openssl req -x509 -newkey rsa:2048 -keyout {key} -out {cert} -days 1 -nodes -subj /CN=127.0.0.1 >/dev/null 2>&1')
httpd = http.server.HTTPServer(('127.0.0.1', 0), http.server.BaseHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
silent = socket.socket()
silent.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
silent.bind(('127.0.0.1', 0))
silent.listen(8)
def accept_loop():
    while True:
        try:
            conn, _ = silent.accept()
        except Exception:
            return
        threading.Thread(target=lambda c: time.sleep(30) or c.close(), args=(conn,), daemon=True).start()
threading.Thread(target=accept_loop, daemon=True).start()
rst = socket.socket(); rst.bind(('127.0.0.1', 0)); rst_port = rst.getsockname()[1]; rst.close()
print(f'PORTS {httpd.server_address[1]} {silent.getsockname()[1]} {rst_port}', flush=True)
time.sleep(60)
`

const require = createRequire(process.env.PUPPETEER_PATH)
const puppeteer = require(process.env.PUPPETEER_PATH)
const lab = spawn('python3', ['-u', '-c', LAB], { stdio: ['ignore', 'pipe', 'inherit'] })

try {
  const ports = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('lab did not start')), 10000)
    lab.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      const line = buffer.split('\n').find((item) => item.startsWith('PORTS '))
      if (!line) return
      clearTimeout(timer)
      const [, tls, silent, rst] = line.trim().split(/\s+/)
      resolve({ tls: Number(tls), silent: Number(silent), rst: Number(rst) })
    })
    lab.on('exit', (code) => reject(new Error(`lab exited ${code}`)))
  })

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const page = await browser.newPage()
  await page.goto('about:blank')

  async function sample(url, timeout) {
    return page.evaluate(async (url, timeout) => {
      const started = performance.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeout)
      try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
        return { elapsedMs: Math.round(performance.now() - started), aborted: false, resolved: true }
      } catch (error) {
        const elapsedMs = Math.round(performance.now() - started)
        const aborted = (error && error.name) === 'AbortError' || elapsedMs >= timeout - 200
        return { elapsedMs, aborted, resolved: false }
      } finally {
        clearTimeout(timer)
      }
    }, url, timeout)
  }

  async function socketSample(url, timeout) {
    return page.evaluate(async (url, timeout) => {
      const started = performance.now()
      return await new Promise((resolve) => {
        let socket
        try {
          socket = new WebSocket(url)
        } catch {
          resolve({ elapsedMs: 0, aborted: false, resolved: false })
          return
        }
        let settled = false
        const finish = (row) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try { socket.close() } catch { /* already closed */ }
          resolve(row)
        }
        const timer = setTimeout(
          () => finish({ elapsedMs: Math.round(performance.now() - started), aborted: true, resolved: false }),
          timeout,
        )
        socket.addEventListener('open', () =>
          finish({ elapsedMs: Math.round(performance.now() - started), aborted: false, resolved: true }),
        )
        socket.addEventListener('close', () =>
          finish({ elapsedMs: Math.round(performance.now() - started), aborted: false, resolved: false }),
        )
      })
    }, url, timeout)
  }

  const controls = async () => [await sample('https://127.0.0.1:48123/', 800), await sample('https://127.0.0.1:39281/', 800)]
  const tlsTrials = []
  for (let index = 0; index < 5; index += 1) {
    const service = await sample(`https://127.0.0.1:${ports.tls}/`, 1500)
    tlsTrials.push({ status: judgeReach(service, await controls(), null), ms: service.elapsedMs })
  }
  const rstTrials = []
  for (let index = 0; index < 3; index += 1) {
    rstTrials.push(judgeReach(await sample(`https://127.0.0.1:${ports.rst}/`, 1500), await controls(), null))
  }
  const report = {
    tls: tlsTrials,
    rst: rstTrials,
    silent: judgeReach(await sample(`https://127.0.0.1:${ports.silent}/`, 700), [], null),
  }
  const nonce = `no-such-${Date.now()}`
  const dnsService = await sample(`https://${nonce}.example/`, 2500)
  const dnsControls = [
    await sample(`https://${nonce}.example:48123/`, 2500),
    await sample(`https://${nonce}-other.example/`, 2500),
  ]
  const dnsMs = Math.max(dnsService.elapsedMs, ...dnsControls.map((item) => item.elapsedMs))
  report.dns = judgeReach(dnsService, dnsControls, dnsMs)
  report.dnsSamples = { service: dnsService, controls: dnsControls }
  const wssTls = []
  const wssRst = []
  for (let index = 0; index < 3; index += 1) {
    wssTls.push(await socketSample(`wss://127.0.0.1:${ports.tls}/`, 1500))
    wssRst.push(await socketSample(`wss://127.0.0.1:${ports.rst}/`, 1500))
  }
  report.wssTls = wssTls
  report.wssRst = wssRst
  console.log(JSON.stringify(report, null, 2))
  await browser.close()

  const tlsHits = tlsTrials.filter((trial) => trial.status === 'open').length
  const negatives = [...rstTrials, report.silent, report.dns]
  const socketFalseOpen = [...wssRst, ...wssTls].some((sample) => sample.resolved)
  if (tlsHits < 1 || socketFalseOpen || negatives.some((status) => status !== 'closed')) process.exit(1)
} finally {
  lab.kill()
}
