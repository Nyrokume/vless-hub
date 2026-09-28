import type { ConfigRecord } from '@/lib/types'

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%2B'))
  } catch {
    return value
  }
}

function vlessQuery(uri: string): Record<string, string> {
  const hash = uri.indexOf('#')
  const noHash = hash >= 0 ? uri.slice(0, hash) : uri
  const queryAt = noHash.indexOf('?')
  if (queryAt < 0) return {}
  const out: Record<string, string> = {}
  for (const part of noHash.slice(queryAt + 1).split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = decodeParam(eq >= 0 ? part.slice(0, eq) : part).toLowerCase()
    out[key] = decodeParam(eq >= 0 ? part.slice(eq + 1) : '')
  }
  return out
}

function truthy(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'yes'
}

export function configsToText(configs: ConfigRecord[]): string {
  return configs.map((item) => item.uri).join('\n')
}

export function configsToBase64(configs: ConfigRecord[]): string {
  const text = configs.length ? `${configsToText(configs)}\n` : ''
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function downloadText(filename: string, body: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([body], { type: mime })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(href)
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (value === '') return '""'
  if (
    /[:#&*!|>%@`{}[\],\n'"\\]/.test(value) ||
    /^\s|\s$/.test(value) ||
    /^(true|false|null|yes|no|~)$/i.test(value) ||
    /^[-?:,]/.test(value)
  ) {
    return JSON.stringify(value)
  }
  return value
}

function dumpYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]`
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const inner = dumpYaml(item, indent + 1)
          const lines = inner.split('\n')
          return `${pad}- ${lines[0].trimStart()}${lines.length > 1 ? `\n${lines.slice(1).join('\n')}` : ''}`
        }
        return `${pad}- ${yamlScalar(item as string)}`
      })
      .join('\n')
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== '')
      .map(([key, item]) => {
        if (item && typeof item === 'object') {
          return `${pad}${key}:\n${dumpYaml(item, indent + 1)}`
        }
        return `${pad}${key}: ${yamlScalar(item as string)}`
      })
      .join('\n')
  }
  return `${pad}${yamlScalar(value as string)}`
}

function protocolOf(config: ConfigRecord): string {
  if (config.protocol) return config.protocol
  const scheme = config.uri.slice(0, config.uri.indexOf(':')).toLowerCase()
  if (scheme === 'ss') return 'shadowsocks'
  if (scheme === 'trojan') return 'trojan'
  if (scheme === 'hysteria2' || scheme === 'hy2') return 'hysteria2'
  return 'vless'
}

function clashProxy(config: ConfigRecord, index: number): Record<string, unknown> {
  const query = vlessQuery(config.uri)
  const network = config.transport || 'tcp'
  const protocol = protocolOf(config)
  const name = `${config.country_code || 'XX'}-${protocol}-${network}-${config.port}-${index}`
  if (protocol === 'shadowsocks') {
    return {
      name,
      type: 'ss',
      server: config.host,
      port: config.port,
      cipher: config.encryption && config.encryption !== 'none' ? config.encryption : query.method || 'aes-256-gcm',
      password: config.uuid,
      udp: true,
    }
  }
  if (protocol === 'trojan') {
    const item: Record<string, unknown> = {
      name,
      type: 'trojan',
      server: config.host,
      port: config.port,
      password: config.uuid,
      udp: true,
      sni: config.sni || config.host,
    }
    if (truthy(query.allowinsecure) || truthy(query.insecure)) item['skip-cert-verify'] = true
    return item
  }
  if (protocol === 'hysteria2') {
    const item: Record<string, unknown> = {
      name,
      type: 'hysteria2',
      server: config.host,
      port: config.port,
      password: config.uuid,
      sni: query.sni || config.sni || config.host,
    }
    if (truthy(query.insecure) || truthy(query.allowinsecure)) item['skip-cert-verify'] = true
    if (query.obfs) {
      item.obfs = query.obfs
      item['obfs-password'] = query['obfs-password'] || ''
    }
    return item
  }
  const item: Record<string, unknown> = {
    name,
    type: 'vless',
    server: config.host,
    port: config.port,
    uuid: config.uuid,
    udp: true,
    network: network === 'h2' ? 'h2' : network,
  }
  if (config.flow && network === 'tcp') item.flow = config.flow
  const packet = query.packetencoding || query.packet_encoding
  if (packet) item['packet-encoding'] = packet
  const security = config.security || 'none'
  if (security === 'tls' || security === 'reality') {
    item.tls = true
    item.servername = config.sni || config.host_header || config.host
    const fp = query.fp || config.fingerprint
    if (fp || security === 'reality') item['client-fingerprint'] = fp || 'chrome'
    if (query.alpn) item.alpn = query.alpn.split(',').map((part) => part.trim()).filter(Boolean)
    if (truthy(query.allowinsecure) || truthy(query.insecure)) item['skip-cert-verify'] = true
  }
  if (security === 'reality') {
    item['reality-opts'] = { 'public-key': query.pbk || query.publickey || '', 'short-id': query.sid || query.shortid || '' }
  }
  if (network === 'ws') {
    const ws: Record<string, unknown> = { path: config.path || '/' }
    if (config.host_header) ws.headers = { Host: config.host_header }
    item['ws-opts'] = ws
  } else if (network === 'grpc') {
    item['grpc-opts'] = { 'grpc-service-name': config.service_name }
  } else if (network === 'h2') {
    item['h2-opts'] = { path: config.path || '/', host: config.host_header ? [config.host_header] : [] }
  } else if (network === 'xhttp') {
    const opts: Record<string, unknown> = { path: config.path || '/', mode: query.mode || 'auto' }
    if (config.host_header) opts.host = config.host_header
    item['xhttp-opts'] = opts
  } else if (network === 'httpupgrade') {
    const opts: Record<string, unknown> = { path: config.path || '/' }
    if (config.host_header) opts.host = config.host_header
    item['httpupgrade-opts'] = opts
  }
  return item
}

export function configsToClash(configs: ConfigRecord[]): string {
  const proxies = configs.map((config, index) => clashProxy(config, index + 1))
  const names = proxies.map((item) => String(item.name))
  return `${dumpYaml({
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'warning',
    proxies,
    'proxy-groups': [{ name: 'V2Hub', type: 'select', proxies: [...names, 'DIRECT'] }],
    rules: ['MATCH,V2Hub'],
  })}\n`
}

function singboxOutbound(config: ConfigRecord, index: number): Record<string, unknown> {
  const query = vlessQuery(config.uri)
  const network = config.transport || 'tcp'
  const protocol = protocolOf(config)
  const tag = `${config.country_code || 'XX'}-${protocol}-${network}-${index}`
  if (protocol === 'shadowsocks') {
    return {
      type: 'shadowsocks',
      tag,
      server: config.host,
      server_port: config.port,
      method: config.encryption && config.encryption !== 'none' ? config.encryption : query.method || 'aes-256-gcm',
      password: config.uuid,
    }
  }
  if (protocol === 'trojan') {
    return {
      type: 'trojan',
      tag,
      server: config.host,
      server_port: config.port,
      password: config.uuid,
      tls: {
        enabled: true,
        server_name: config.sni || config.host,
        insecure: truthy(query.allowinsecure) || truthy(query.insecure),
      },
    }
  }
  if (protocol === 'hysteria2') {
    const item: Record<string, unknown> = {
      type: 'hysteria2',
      tag,
      server: config.host,
      server_port: config.port,
      password: config.uuid,
      tls: {
        enabled: true,
        server_name: query.sni || config.sni || config.host,
        insecure: truthy(query.insecure) || truthy(query.allowinsecure),
        alpn: ['h3'],
      },
    }
    if (query.obfs) item.obfs = { type: query.obfs, password: query['obfs-password'] || '' }
    return item
  }
  const item: Record<string, unknown> = {
    type: 'vless',
    tag: `${config.country_code || 'XX'}-${network}-${index}`,
    server: config.host,
    server_port: config.port,
    uuid: config.uuid,
  }
  if (config.flow && network === 'tcp') item.flow = config.flow
  const packet = query.packetencoding || query.packet_encoding
  if (packet) item.packet_encoding = packet
  const security = config.security || 'none'
  if (security === 'tls' || security === 'reality') {
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: config.sni || config.host_header || config.host,
      insecure: truthy(query.allowinsecure) || truthy(query.insecure),
    }
    const fp = query.fp || config.fingerprint
    if (fp || security === 'reality') tls.utls = { enabled: true, fingerprint: fp || 'chrome' }
    if (query.alpn) tls.alpn = query.alpn.split(',').map((part) => part.trim()).filter(Boolean)
    if (security === 'reality') {
      tls.reality = {
        enabled: true,
        public_key: query.pbk || query.publickey || '',
        short_id: query.sid || query.shortid || '',
      }
    }
    item.tls = tls
  }
  if (network === 'ws') {
    const transport: Record<string, unknown> = { type: 'ws', path: config.path || '/' }
    if (config.host_header) transport.headers = { Host: config.host_header }
    item.transport = transport
  } else if (network === 'grpc') {
    item.transport = { type: 'grpc', service_name: config.service_name }
  } else if (network === 'h2') {
    const transport: Record<string, unknown> = { type: 'http', path: config.path || '/' }
    if (config.host_header) transport.host = config.host_header.split(',').map((part) => part.trim()).filter(Boolean)
    item.transport = transport
  } else if (network === 'xhttp') {
    const transport: Record<string, unknown> = { type: 'xhttp', path: config.path || '/', mode: query.mode || 'auto' }
    if (config.host_header) transport.host = config.host_header
    item.transport = transport
  } else if (network === 'httpupgrade') {
    const transport: Record<string, unknown> = { type: 'httpupgrade', path: config.path || '/' }
    if (config.host_header) transport.host = config.host_header
    item.transport = transport
  }
  return item
}

export function configsToSingbox(configs: ConfigRecord[]): string {
  const outbounds = configs.map((config, index) => singboxOutbound(config, index + 1))
  const tags = outbounds.map((item) => String(item.tag))
  outbounds.push({ type: 'direct', tag: 'direct' })
  outbounds.push({
    type: 'selector',
    tag: 'select',
    outbounds: [...tags, 'direct'],
    default: tags[0] ?? 'direct',
  })
  return `${JSON.stringify(
    {
      log: { level: 'warn' },
      inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }],
      outbounds,
      route: { final: 'select' },
    },
    null,
    2,
  )}\n`
}
