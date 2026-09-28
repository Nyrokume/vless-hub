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
const SS_METHODS = new Set([
  'aes-128-gcm',
  'aes-256-gcm',
  'aes-128-cfb',
  'aes-256-cfb',
  'chacha20-ietf-poly1305',
  'chacha20-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCAL = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

export type ParsedProxy = {
  id: string
  uri: string
  protocol: string
  host: string
  port: number
  network: string
  security: string
  remark: string
}

type Fields = {
  protocol: string
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
  uri: string
}

function unquote(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function unquoteRepeat(value: string): string {
  let current = value
  for (let i = 0; i < 2; i += 1) {
    const next = unquote(current)
    if (next === current) break
    current = next
  }
  return current
}

function normalizeNetwork(value: string): string {
  const key = (value || 'tcp').trim().toLowerCase()
  return NETWORK[key] ?? (key || 'tcp')
}

function normalizeSecurity(value: string): string {
  const key = (value || 'none').trim().toLowerCase()
  return SECURITY[key] ?? (key || 'none')
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

function sanitizeAlpn(value: string): string {
  const kept: string[] = []
  for (const part of value.split(',')) {
    const token = part.trim().toLowerCase()
    if (ALPN_OK.has(token) && !kept.includes(token)) kept.push(token)
  }
  return kept.join(',')
}

function cleanUri(uri: string): string {
  let value = uri.trim().replace(/^["'`]|["'`]$/g, '')
  value = value.replace(/[.,;)\]}>"'']+$/g, '')
  while (value.endsWith(')') && (value.match(/\(/g) || []).length < (value.match(/\)/g) || []).length) {
    value = value.slice(0, -1)
  }
  return value
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

function splitRemark(body: string): { body: string; remark: string } {
  const hash = body.indexOf('#')
  if (hash < 0) return { body, remark: '' }
  return { body: body.slice(0, hash), remark: unquoteRepeat(body.slice(hash + 1)).trim() }
}

function applyQuery(fields: Fields, query: string) {
  const extras: Record<string, string> = {}
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = unquote(eq >= 0 ? part.slice(0, eq) : part).trim().toLowerCase()
    const val = unquote(eq >= 0 ? part.slice(eq + 1) : '').trim()
    if (!key) continue
    if (key === 'encryption') fields.encryption = val || 'none'
    else if (key === 'flow') fields.flow = val
    else if ((key === 'type' || key === 'network') && val) fields.network = normalizeNetwork(val)
    else if (key === 'security') fields.security = normalizeSecurity(val)
    else if (key === 'sni' || key === 'servername' || key === 'peer') {
      if (val && (key === 'sni' || !fields.sni)) fields.sni = val
    } else if (key === 'fp' || key === 'fingerprint') fields.fp = val
    else if (key === 'pbk' || key === 'publickey') fields.pbk = val
    else if (key === 'sid' || key === 'shortid') fields.sid = val
    else if (key === 'spx' || key === 'spiderx') fields.spx = val
    else if (key === 'path') fields.path = val
    else if (key === 'host') fields.hostHeader = sanitizeHost(val)
    else if (key === 'servicename' || key === 'service_name') fields.serviceName = val
    else if (key === 'authority') fields.authority = val
    else if (key === 'mode') fields.mode = val
    else if (key === 'alpn') fields.alpn = sanitizeAlpn(val)
    else if (key === 'headertype' || key === 'header_type') {
      fields.headerType = val.toLowerCase() === 'none' || val === '' ? '' : val.toLowerCase()
    } else if (key === 'allowinsecure' || key === 'insecure' || key === 'allow_insecure') {
      fields.allowInsecure = ['1', 'true', 'yes', 'on'].includes(val.toLowerCase())
    } else if (key === 'extra') fields.extra = val
    else if (key === 'packetencoding' || key === 'packet_encoding') fields.packetEncoding = val
    else if ((key === 'obfs-password' || key === 'obfspassword') && val) extras['obfs-password'] = val
    else if (KEEP_EXTRAS.has(key) && val) extras[key] = val
    else if (IGNORE.has(key)) continue
  }
  fields.extras = extras
  fields.network = normalizeNetwork(fields.network || 'tcp')
  fields.security = normalizeSecurity(fields.security || 'none')
  fields.encryption = fields.encryption || 'none'
  if (fields.network === 'h2' && (XHTTP_MODES.has(fields.mode.toLowerCase()) || fields.extra)) {
    fields.network = 'xhttp'
  }
  if (fields.fp) fields.fp = fields.fp.toLowerCase()
}

function blank(protocol: string, uri: string): Fields {
  return {
    protocol,
    uuid: '',
    host: '',
    port: 0,
    encryption: 'none',
    flow: '',
    network: protocol === 'hysteria2' ? 'hysteria2' : 'tcp',
    security: protocol === 'vless' ? 'none' : 'tls',
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
    remark: '',
    uri,
  }
}

function finish(fields: Fields) {
  if (fields.network === 'tcp' && (fields.path === '' || fields.path === '/')) fields.path = ''
  if (!fields.headerType || fields.headerType.toLowerCase() === 'none') fields.headerType = ''
  fields.sni = fields.sni.trim()
}

function material(fields: Fields): string {
  const extras = Object.keys(fields.extras)
    .sort()
    .map((key) => `${key}=${fields.extras[key]}`)
    .join('&')
  return [
    fields.protocol || 'vless',
    fields.uuid.toLowerCase(),
    fields.host.toLowerCase(),
    String(fields.port),
    normalizeSecurity(fields.security),
    fields.sni.toLowerCase(),
    fields.pbk,
    fields.sid,
    fields.flow,
    normalizeNetwork(fields.network),
    fields.path,
    fields.hostHeader.toLowerCase(),
    fields.serviceName,
    fields.mode,
    (fields.encryption || 'none').toLowerCase(),
    fields.alpn.toLowerCase(),
    fields.headerType.toLowerCase(),
    fields.packetEncoding.toLowerCase(),
    fields.allowInsecure ? '1' : '0',
    fields.spx,
    fields.authority.toLowerCase(),
    fields.extra,
    extras,
  ].join('|')
}

async function sha16(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function invalid(fields: Fields): boolean {
  if (fields.port < 1 || fields.port > 65535 || !fields.host) return true
  if (fields.protocol === 'vless') {
    if (!UUID_RE.test(fields.uuid)) return true
    if (fields.security === 'reality' && (fields.pbk.length < 16 || !plausibleName(fields.sni))) return true
    return false
  }
  if (fields.protocol === 'shadowsocks') return !SS_METHODS.has(fields.encryption) || !fields.uuid
  if (fields.protocol === 'trojan') return fields.uuid.length < 4
  if (fields.protocol === 'hysteria2') return !fields.uuid
  return true
}

function b64Text(value: string): string | null {
  const compact = value.trim().replace(/-/g, '+').replace(/_/g, '/')
  if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) return null
  const pad = '='.repeat((4 - (compact.length % 4)) % 4)
  try {
    const bytes = Uint8Array.from(atob(compact + pad), (char) => char.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return text || null
  } catch {
    return null
  }
}

function b64Document(text: string): string | null {
  let compact = text.replace(/\s+/g, '')
  if (compact.toLowerCase().startsWith('base64:')) compact = compact.slice(7)
  if (compact.length < 24 || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null
  const decoded = b64Text(compact)
  if (!decoded || !/(?:vless|trojan|ss|hysteria2|hy2):\/\//i.test(decoded)) return null
  return decoded
}

export function extractProxyUris(text: string): string[] {
  const proxyRe = /(?:vless|trojan|ss|hysteria2|hy2):\/\/[^\s<>"'`]+/gi
  const source = (text || '')
    .replace(/^\uFEFF/, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
  const found: string[] = []
  const seen = new Set<string>()
  const add = (blob: string) => {
    for (const match of blob.matchAll(proxyRe)) {
      const uri = cleanUri(match[0])
      if (!uri.includes('://') || seen.has(uri)) continue
      seen.add(uri)
      found.push(uri)
    }
  }
  add(source)
  for (const line of source.split(/\r?\n/)) {
    const stripped = line.trim()
    if (!stripped || stripped.startsWith('#') || stripped.includes('://')) continue
    const decoded = b64Document(stripped)
    if (decoded) add(decoded)
  }
  if (found.length === 0) {
    const decoded = b64Document(source)
    if (decoded) {
      add(decoded)
      for (const line of decoded.split(/\r?\n/)) {
        const stripped = line.trim()
        if (!stripped || stripped.includes('://')) continue
        const nested = b64Document(stripped)
        if (nested) add(nested)
      }
    }
  }
  return found
}

function parseFields(uri: string): Fields | null {
  const cleaned = cleanUri(uri)
  const scheme = cleaned.split(':', 1)[0].toLowerCase()
  if (scheme === 'vless') return parseVless(cleaned)
  if (scheme === 'ss') return parseSs(cleaned)
  if (scheme === 'trojan') return parseTrojan(cleaned)
  if (scheme === 'hysteria2' || scheme === 'hy2') return parseHy2(cleaned)
  return null
}

function parseVless(uri: string): Fields | null {
  const fields = blank('vless', uri)
  let body = uri.slice('vless://'.length)
  const marked = splitRemark(body)
  body = marked.body
  fields.remark = marked.remark
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
  if (!user || !hostport || LOCAL.has(hostport.host.toLowerCase())) return null
  fields.uuid = UUID_RE.test(user) ? user.toLowerCase() : user
  fields.host = hostport.host.toLowerCase().replace(/\.$/, '')
  fields.port = hostport.port
  applyQuery(fields, query)
  finish(fields)
  return fields
}

function parseSs(uri: string): Fields | null {
  const fields = blank('shadowsocks', uri)
  const marked = splitRemark(uri.slice('ss://'.length))
  fields.remark = marked.remark
  let method = ''
  let password = ''
  let host = ''
  let port: number | null = null
  const queryAt = marked.body.indexOf('?')
  const ssBody = queryAt >= 0 ? marked.body.slice(0, queryAt) : marked.body
  if (ssBody.includes('@')) {
    const at = ssBody.lastIndexOf('@')
    const userinfo = unquote(ssBody.slice(0, at))
    const colon = userinfo.indexOf(':')
    const methodName = colon >= 0 ? userinfo.slice(0, colon).toLowerCase() : ''
    if (SS_METHODS.has(methodName)) {
      method = methodName
      password = userinfo.slice(colon + 1)
    } else {
      const decoded = b64Text(userinfo)
      if (!decoded || !decoded.includes(':')) return null
      const decodedColon = decoded.indexOf(':')
      method = decoded.slice(0, decodedColon)
      password = decoded.slice(decodedColon + 1)
    }
    const hostport = splitHostPort(ssBody.slice(at + 1))
    if (!hostport) return null
    host = hostport.host
    port = hostport.port
  } else {
    const decoded = b64Text(unquote(ssBody))
    if (!decoded || !decoded.includes('@')) return null
    const at = decoded.lastIndexOf('@')
    const user = decoded.slice(0, at)
    if (!user.includes(':')) return null
    const colon = user.indexOf(':')
    method = user.slice(0, colon)
    password = user.slice(colon + 1)
    const hostport = splitHostPort(decoded.slice(at + 1))
    if (!hostport) return null
    host = hostport.host
    port = hostport.port
  }
  if (!method || !password || !host || port == null || LOCAL.has(host.toLowerCase())) return null
  fields.uuid = password
  fields.host = host.toLowerCase().replace(/\.$/, '')
  fields.port = port
  fields.encryption = method.toLowerCase()
  fields.network = 'tcp'
  fields.security = 'none'
  finish(fields)
  return fields
}

function parseTrojan(uri: string): Fields | null {
  const fields = blank('trojan', uri)
  const marked = splitRemark(uri.slice('trojan://'.length))
  fields.remark = marked.remark
  let body = marked.body
  let query = ''
  const q = body.indexOf('?')
  if (q >= 0) {
    query = body.slice(q + 1)
    body = body.slice(0, q)
  }
  const at = body.lastIndexOf('@')
  if (at < 0) return null
  const password = unquote(body.slice(0, at)).trim()
  const hostport = splitHostPort(body.slice(at + 1))
  if (!password || !hostport) return null
  fields.uuid = password
  fields.host = hostport.host.toLowerCase().replace(/\.$/, '')
  fields.port = hostport.port
  fields.security = 'tls'
  applyQuery(fields, query)
  if (!fields.security || fields.security === 'none') fields.security = 'tls'
  finish(fields)
  return fields
}

function parseHy2(uri: string): Fields | null {
  const fields = blank('hysteria2', uri)
  const marked = splitRemark(uri.slice(uri.indexOf('://') + 3))
  fields.remark = marked.remark
  let body = marked.body
  let query = ''
  const q = body.indexOf('?')
  if (q >= 0) {
    query = body.slice(q + 1)
    body = body.slice(0, q)
  }
  const at = body.lastIndexOf('@')
  if (at < 0) return null
  const password = unquote(body.slice(0, at)).trim()
  const hostport = splitHostPort(body.slice(at + 1))
  if (!password || !hostport) return null
  fields.uuid = password
  fields.host = hostport.host.toLowerCase().replace(/\.$/, '')
  fields.port = hostport.port
  applyQuery(fields, query)
  fields.network = 'hysteria2'
  fields.security = 'tls'
  finish(fields)
  return fields
}

export async function parseProxy(uri: string): Promise<ParsedProxy | null> {
  const fields = parseFields(uri)
  if (!fields || invalid(fields)) return null
  return {
    id: await sha16(material(fields)),
    uri: fields.uri,
    protocol: fields.protocol,
    host: fields.host,
    port: fields.port,
    network: fields.network,
    security: fields.security,
    remark: fields.remark,
  }
}

export async function parseProxyDocument(text: string): Promise<ParsedProxy[]> {
  const uris = extractProxyUris(text)
  const out: ParsedProxy[] = []
  const chunk = 80
  for (let index = 0; index < uris.length; index += chunk) {
    const part = await Promise.all(uris.slice(index, index + chunk).map((uri) => parseProxy(uri)))
    for (const item of part) {
      if (item) out.push(item)
    }
  }
  return out
}
