export type ClientId = 'happ' | 'v2rayng' | 'hiddify' | 'link'

export const CLIENTS: { id: ClientId; name: string; hint: string }[] = [
  { id: 'happ', name: 'Happ', hint: 'happ://add/ для подписки, vless:// для конфига' },
  { id: 'v2rayng', name: 'v2rayNG', hint: 'v2rayng://install-sub и install-config' },
  { id: 'hiddify', name: 'Hiddify', hint: 'hiddify://import/…' },
  { id: 'link', name: 'Только ссылка', hint: 'Копировать URL, без схемы клиента' },
]

export function clientName(id: ClientId): string {
  return CLIENTS.find((item) => item.id === id)?.name ?? id
}

export function subscriptionDeepLink(client: ClientId, url: string, name: string): string | null {
  if (client === 'link') return null
  if (client === 'happ') return `happ://add/${url}`
  if (client === 'v2rayng') {
    return `v2rayng://install-sub?url=${encodeURIComponent(url)}#${encodeURIComponent(name)}`
  }
  return `hiddify://import/${url}#${encodeURIComponent(name)}`
}

export function configDeepLink(client: ClientId, uri: string): string | null {
  if (client === 'link') return null
  if (client === 'happ') return uri
  if (client === 'v2rayng') return `v2rayng://install-config/?url=${encodeURIComponent(uri)}`
  return `hiddify://import/${uri}`
}

export function openExternal(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
