export type ClientId =
  | 'happ'
  | 'v2rayng'
  | 'hiddify'
  | 'v2raytun'
  | 'streisand'
  | 'v2rayn'
  | 'v2box'
  | 'foxray'
  | 'nekobox'
  | 'clashmeta'
  | 'mihomo'
  | 'clash'
  | 'singbox'
  | 'link'

export const CLIENTS: { id: ClientId; name: string; hint: string }[] = [
  { id: 'happ', name: 'Happ', hint: 'Подписка и отдельный конфиг' },
  { id: 'v2rayng', name: 'v2rayNG', hint: 'Конфиг и подписка' },
  { id: 'hiddify', name: 'Hiddify', hint: 'Импорт ссылки' },
  { id: 'v2raytun', name: 'v2RayTun', hint: 'Импорт ссылки' },
  { id: 'streisand', name: 'Streisand', hint: 'Импорт ссылки' },
  { id: 'v2rayn', name: 'v2rayN', hint: 'Подписка и конфиг' },
  { id: 'v2box', name: 'V2Box', hint: 'Подписка и конфиг' },
  { id: 'foxray', name: 'FoXray', hint: 'Подписка и конфиг' },
  { id: 'nekobox', name: 'NekoBox', hint: 'Файл Clash' },
  { id: 'clashmeta', name: 'Clash Meta', hint: 'Только файл Clash' },
  { id: 'mihomo', name: 'Mihomo Party', hint: 'Только файл Clash' },
  { id: 'clash', name: 'Clash', hint: 'Только файл Clash' },
  { id: 'singbox', name: 'sing-box', hint: 'Только файл sing-box' },
  { id: 'link', name: 'Только ссылка', hint: 'Без приложения' },
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

function hiddifyImport(url: string): string {
  // The name used to sit after #, and the browser dropped it together with the address.
  return `hiddify://import/${encodeURIComponent(url)}`
}

export function subscriptionDeepLink(client: ClientId, url: string, name: string): string | null {
  if (client === 'link') return null
  const clash = isClash(url)
  const sing = isSingbox(url)
  if (client === 'clashmeta') {
    return clash ? `clashmeta://install-config?url=${encodeURIComponent(url)}` : null
  }
  if (client === 'clash') {
    return clash ? `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}` : null
  }
  if (client === 'nekobox') {
    if (clash || url.startsWith('https://') || url.startsWith('http://')) {
      return `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}`
    }
    return null
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
  if (clash || sing) {
    if (client === 'hiddify') return hiddifyImport(url)
    return null
  }
  if (client === 'happ') return `happ://add/${url}`
  if (client === 'v2rayng') return `v2rayng://install-sub?url=${encodeURIComponent(url)}`
  if (client === 'v2raytun') return `v2raytun://import/${encodeURIComponent(url)}`
  if (client === 'streisand') return `streisand://import/${encodeURIComponent(url)}`
  if (client === 'v2rayn') return `v2rayn://install-sub?url=${encodeURIComponent(url)}`
  if (client === 'v2box') return `v2box://install-sub?url=${encodeURIComponent(url)}`
  if (client === 'foxray') return `foxray://install-sub?url=${encodeURIComponent(url)}`
  return hiddifyImport(url)
}

const CONFIG_FILE_CLIENTS = new Set<ClientId>(['link', 'nekobox', 'clashmeta', 'mihomo', 'clash', 'singbox'])

export function configDeepLink(client: ClientId, uri: string): string | null {
  if (CONFIG_FILE_CLIENTS.has(client)) return null
  if (client === 'happ') return uri
  if (client === 'v2rayng') return `v2rayng://install-config/?url=${encodeURIComponent(uri)}`
  if (client === 'v2raytun') return `v2raytun://import/${encodeURIComponent(uri)}`
  if (client === 'streisand') return `streisand://import/${encodeURIComponent(uri)}`
  if (client === 'v2rayn') return `v2rayn://install-config?url=${encodeURIComponent(uri)}`
  if (client === 'v2box') return `v2box://install-config?url=${encodeURIComponent(uri)}`
  if (client === 'foxray') return `foxray://install-config?url=${encodeURIComponent(uri)}`
  return hiddifyImport(uri)
}

export type ImportAction = { label: string; href: string }

export function configImportActions(uri: string): ImportAction[] {
  return [
    { label: 'Happ', href: uri },
    { label: 'v2rayNG', href: `v2rayng://install-config/?url=${encodeURIComponent(uri)}` },
    { label: 'Hiddify', href: hiddifyImport(uri) },
    { label: 'v2RayTun', href: `v2raytun://import/${encodeURIComponent(uri)}` },
    { label: 'Streisand', href: `streisand://import/${encodeURIComponent(uri)}` },
    { label: 'v2rayN', href: `v2rayn://install-config?url=${encodeURIComponent(uri)}` },
    { label: 'V2Box', href: `v2box://install-config?url=${encodeURIComponent(uri)}` },
    { label: 'FoXray', href: `foxray://install-config?url=${encodeURIComponent(uri)}` },
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
    push('Clash', 'clash')
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
  push('Streisand', 'streisand')
  push('v2rayN', 'v2rayn')
  push('V2Box', 'v2box')
  push('FoXray', 'foxray')
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
