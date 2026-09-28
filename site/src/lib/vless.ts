const NETWORK: Record<string, string> = {
  tcp: 'tcp',
  raw: 'tcp',
  ws: 'ws',
  websocket: 'ws',
  grpc: 'grpc',
  gun: 'grpc',
  h2: 'h2',
  http: 'h2',
  http2: 'h2',
  xhttp: 'xhttp',
  splithttp: 'xhttp',
  httpupgrade: 'httpupgrade',
  kcp: 'kcp',
  mkcp: 'kcp',
  quic: 'quic',
}

const SECURITY: Record<string, string> = {
  none: 'none',
  '': 'none',
  false: 'none',
  '0': 'none',
  no: 'none',
  off: 'none',
  tls: 'tls',
  reality: 'reality',
  xtls: 'tls',
}

const IGNORE = new Set(['remarks', 'remark', 'ps', 'name', 'tag', 'telegram'])
const XHTTP_MODES = new Set(['auto', 'packet-up', 'stream-one', 'stream-up', 'stream-down'])
const ALPN_OK = new Set(['h3', 'h2', 'http/1.1', 'http/1.0'])
const KEEP_EXTRAS = new Set(['obfs', 'obfs-password', 'mport'])

function sanitizeAlpn(value: string): string {
  const kept: string[] = []
  for (const part of value.split(',')) {
    const token = part.trim().toLowerCase()
    if (ALPN_OK.has(token) && !kept.includes(token)) kept.push(token)
  }
  return kept.join(',')
}

function plausibleName(value: string): boolean {
  const token = value.trim().replace(/\.$/, '')
  if (!token || token.includes('@') || token.startsWith('-') || token.includes(' ')) return false
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(token)) return true
  if (!token.includes('.') || token.length > 253) return false
  return token.split('.').every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))
}

function sanitizeHost(value: string): string {
  const kept: string[] = []
  for (const part of value.split(',')) {
    const token = part.trim()
    if (token && plausibleName(token) && !kept.includes(token)) kept.push(token)
  }
  return kept.join(',')
}

export type ParsedVless = {
  uuid: string
  host: string
  port: number
  encryption: string
  flow: string
  network: string
  security: string
  sni: string
  fp: string
  pbk: string
  sid: string
  spx: string
  path: string
  hostHeader: string
  serviceName: string
  mode: string
  alpn: string
  headerType: string
  packetEncoding: string
  allowInsecure: boolean
  authority: string
  extra: string
  extras: Record<string, string>
  remark: string
  fingerprint: string
}

function unquote(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%2B'))
  } catch {
    return value
  }
}

function normalizeNetwork(value: string): string {
  const key = (value || 'tcp').trim().toLowerCase()
  return NETWORK[key] ?? (key || 'tcp')
}

function normalizeSecurity(value: string): string {
  const key = (value || 'none').trim().toLowerCase()
  return SECURITY[key] ?? (key || 'none')
}

function splitHostPort(hostport: string): { host: string; port: number } | null {
  if (!hostport) return null
  hostport = hostport.trim()
  if (hostport.startsWith('[')) {
    const end = hostport.indexOf(']')
    const slash = end >= 0 ? hostport.indexOf('/', end) : -1
    if (slash >= 0) hostport = hostport.slice(0, slash)
  } else {
    const slash = hostport.indexOf('/')
    if (slash >= 0) hostport = hostport.slice(0, slash)
  }
  let host = ''
  let portStr = ''
  if (hostport.startsWith('[')) {
    const end = hostport.indexOf(']')
    if (end < 0 || !hostport.slice(end + 1).startsWith(':')) return null
    host = hostport.slice(1, end)
    portStr = hostport.slice(end + 2)
  } else {
    const index = hostport.lastIndexOf(':')
    if (index < 0) return null
    host = hostport.slice(0, index)
    portStr = hostport.slice(index + 1)
  }
  const port = Number(portStr)
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: unquote(host).trim(), port }
}

async function sha256Prefix(material: string): Promise<string> {
  const bytes = new TextEncoder().encode(material)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export async function parseVless(uri: string): Promise<ParsedVless | null> {
  const cleaned = uri.trim().replace(/^["'`]|["'`]$/g, '')
  if (!cleaned.toLowerCase().startsWith('vless://')) return null
  let body = cleaned.slice('vless://'.length)
  let remark = ''
  const hash = body.indexOf('#')
  if (hash >= 0) {
    remark = unquote(body.slice(hash + 1)).trim()
    body = body.slice(0, hash)
  }
  let query = ''
  const q = body.indexOf('?')
  if (q >= 0) {
    query = body.slice(q + 1)
    body = body.slice(0, q)
  }
  const at = body.lastIndexOf('@')
  if (at < 0) return null
  const user = unquote(body.slice(0, at)).trim()
  const hostport = splitHostPort(body.slice(at + 1).trim())
  if (!user || !hostport) return null
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostport.host.toLowerCase())) return null

  const parsed: ParsedVless = {
    uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user) ? user.toLowerCase() : user,
    host: hostport.host.toLowerCase().replace(/\.$/, ''),
    port: hostport.port,
    encryption: 'none',
    flow: '',
    network: 'tcp',
    security: 'none',
    sni: '',
    fp: '',
    pbk: '',
    sid: '',
    spx: '',
    path: '',
    hostHeader: '',
    serviceName: '',
    mode: '',
    alpn: '',
    headerType: '',
    packetEncoding: '',
    allowInsecure: false,
    authority: '',
    extra: '',
    extras: {},
    remark,
    fingerprint: '',
  }
  const extras: Record<string, string> = {}
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = unquote(eq >= 0 ? part.slice(0, eq) : part).trim().toLowerCase()
    const val = unquote(eq >= 0 ? part.slice(eq + 1) : '').trim()
    if (!key) continue
    if (key === 'encryption') parsed.encryption = val || 'none'
    else if (key === 'flow') parsed.flow = val
    else if ((key === 'type' || key === 'network') && val) parsed.network = normalizeNetwork(val)
    else if (key === 'security') parsed.security = normalizeSecurity(val)
    else if (key === 'sni' || key === 'servername' || key === 'peer') {
      if (val && (key === 'sni' || !parsed.sni)) parsed.sni = val
    } else if (key === 'fp' || key === 'fingerprint') parsed.fp = val
    else if (key === 'pbk' || key === 'publickey') parsed.pbk = val
    else if (key === 'sid' || key === 'shortid') parsed.sid = val
    else if (key === 'spx' || key === 'spiderx') parsed.spx = val
    else if (key === 'path') parsed.path = val
    else if (key === 'host') parsed.hostHeader = sanitizeHost(val)
    else if (key === 'servicename' || key === 'service_name') parsed.serviceName = val
    else if (key === 'authority') parsed.authority = val
    else if (key === 'mode') parsed.mode = val
    else if (key === 'alpn') parsed.alpn = sanitizeAlpn(val)
    else if (key === 'headertype' || key === 'header_type') {
      parsed.headerType = val.toLowerCase() === 'none' || val === '' ? '' : val.toLowerCase()
    } else if (key === 'allowinsecure' || key === 'insecure' || key === 'allow_insecure') {
      parsed.allowInsecure = ['1', 'true', 'yes', 'on'].includes(val.toLowerCase())
    } else if (key === 'extra') parsed.extra = val
    else if (key === 'packetencoding' || key === 'packet_encoding') parsed.packetEncoding = val
    else if ((key === 'obfs-password' || key === 'obfspassword') && val) extras['obfs-password'] = val
    else if (KEEP_EXTRAS.has(key) && val) extras[key] = val
    else if (!IGNORE.has(key) && val) continue
  }
  parsed.network = normalizeNetwork(parsed.network || 'tcp')
  parsed.security = normalizeSecurity(parsed.security || 'none')
  parsed.encryption = parsed.encryption || 'none'
  if (parsed.network === 'h2' && (XHTTP_MODES.has(parsed.mode.toLowerCase()) || parsed.extra)) {
    parsed.network = 'xhttp'
  }
  if (parsed.network === 'tcp' && (parsed.path === '' || parsed.path === '/')) parsed.path = ''
  if (parsed.headerType.toLowerCase() === 'none' || parsed.headerType === '') parsed.headerType = ''
  if (parsed.fp) parsed.fp = parsed.fp.toLowerCase()
  parsed.extras = extras
  const extraQuery = Object.keys(extras)
    .sort()
    .map((key) => `${key}=${extras[key]}`)
    .join('&')
  const material = [
    'vless',
    parsed.uuid.toLowerCase(),
    parsed.host.toLowerCase(),
    String(parsed.port),
    parsed.security,
    parsed.sni.toLowerCase(),
    parsed.pbk,
    parsed.sid,
    parsed.flow,
    parsed.network,
    parsed.path,
    parsed.hostHeader.toLowerCase(),
    parsed.serviceName,
    parsed.mode,
    parsed.encryption.toLowerCase(),
    parsed.alpn.toLowerCase(),
    parsed.headerType.toLowerCase(),
    parsed.packetEncoding.toLowerCase(),
    parsed.allowInsecure ? '1' : '0',
    parsed.spx,
    parsed.authority.toLowerCase(),
    parsed.extra,
    extraQuery,
  ].join('|')
  parsed.fingerprint = await sha256Prefix(material)
  return parsed
}
