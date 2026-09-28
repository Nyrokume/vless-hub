export type ClientId =
  | 'happ'
  | 'v2rayng'
  | 'hiddify'
  | 'v2raytun'
  | 'nekobox'
  | 'clashmeta'
  | 'mihomo'
  | 'singbox'
  | 'link'

export const CLIENTS: { id: ClientId; name: string; hint: string }[] = [
  { id: 'happ', name: 'Happ', hint: 'happ://add/ для https-подписки, vless:// для конфига' },
  { id: 'v2rayng', name: 'v2rayNG', hint: 'v2rayng://install-config/?url=' },
  { id: 'hiddify', name: 'Hiddify', hint: 'hiddify://import/…' },
  { id: 'v2raytun', name: 'v2RayTun', hint: 'v2raytun://import/ без кодирования' },
  { id: 'nekobox', name: 'NekoBox', hint: 'clash://install-config для https-подписки' },
  { id: 'clashmeta', name: 'Clash Meta', hint: 'clashmeta:// только для clash.yaml' },
  { id: 'mihomo', name: 'Mihomo Party', hint: 'mihomo:// только для clash.yaml' },
  { id: 'singbox', name: 'sing-box', hint: 'sing-box:// только для singbox.json' },
  { id: 'link', name: 'Только ссылка', hint: 'Копировать URL, без схемы клиента' },
]

export function clientName(id: ClientId): string {
  return CLIENTS.find((item) => item.id === id)?.name ?? id
}

function isClash(url: string): boolean {
  return /\.ya?ml($|\?)/i.test(url)
}

function isSingbox(url: string): boolean {
  return /singbox\.json($|\?)/i.test(url)
}

export function subscriptionDeepLink(client: ClientId, url: string, name: string): string | null {
  if (client === 'link') return null
  const clash = isClash(url)
  const sing = isSingbox(url)
  if (client === 'clashmeta') {
    return clash ? `clashmeta://install-config?url=${encodeURIComponent(url)}` : null
  }
  if (client === 'mihomo') {
    return clash
      ? `mihomo://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`
      : null
  }
  if (client === 'singbox') {
    return sing
      ? `sing-box://import-remote-profile?url=${encodeURIComponent(url)}#${encodeURIComponent(name)}`
      : null
  }
  if (client === 'nekobox') {
    if (clash || url.startsWith('https://') || url.startsWith('http://')) {
      return `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`
    }
    return null
  }
  if (clash || sing) {
    if (client === 'hiddify') return `hiddify://import/${url}#${encodeURIComponent(name)}`
    return null
  }
  if (client === 'happ') return `happ://add/${url}`
  if (client === 'v2rayng') {
    return `v2rayng://install-config/?url=${encodeURIComponent(`${url}#${name}`)}`
  }
  if (client === 'v2raytun') return `v2raytun://import/${url}`
  return `hiddify://import/${url}#${encodeURIComponent(name)}`
}

export function configDeepLink(client: ClientId, uri: string): string | null {
  if (client === 'link' || client === 'nekobox' || client === 'clashmeta' || client === 'mihomo' || client === 'singbox') {
    return null
  }
  if (client === 'happ') return uri
  if (client === 'v2rayng') return `v2rayng://install-config/?url=${encodeURIComponent(uri)}`
  if (client === 'v2raytun') return `v2raytun://import/${uri}`
  return `hiddify://import/${uri}`
}

export type ImportAction = { label: string; href: string }

export function configImportActions(uri: string): ImportAction[] {
  return [
    { label: 'Happ', href: uri },
    { label: 'v2rayNG', href: `v2rayng://install-config/?url=${encodeURIComponent(uri)}` },
    { label: 'Hiddify', href: `hiddify://import/${uri}` },
    { label: 'v2RayTun', href: `v2raytun://import/${uri}` },
  ]
}

export function subscriptionImportActions(url: string, name: string): ImportAction[] {
  const actions: ImportAction[] = []
  const push = (label: string, client: ClientId) => {
    const href = subscriptionDeepLink(client, url, name)
    if (href) actions.push({ label, href })
  }
  if (isClash(url)) {
    push('Clash Meta', 'clashmeta')
    push('Mihomo', 'mihomo')
    push('NekoBox', 'nekobox')
    push('Hiddify', 'hiddify')
    return actions
  }
  if (isSingbox(url)) {
    push('sing-box', 'singbox')
    push('Hiddify', 'hiddify')
    return actions
  }
  push('Happ', 'happ')
  push('v2rayNG', 'v2rayng')
  push('Hiddify', 'hiddify')
  push('v2RayTun', 'v2raytun')
  push('NekoBox', 'nekobox')
  return actions
}

export function openExternal(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
