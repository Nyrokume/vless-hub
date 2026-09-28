import { copyText } from '@/lib/copy'

export type ClientId = 'v2raytun' | 'happ' | 'v2rayng' | 'hiddify' | 'link'

export const CLIENTS: { id: ClientId; name: string; hint: string }[] = [
  { id: 'v2raytun', name: 'v2RayTun', hint: 'v2raytun://import/ — конфиг или URL подписки' },
  { id: 'happ', name: 'Happ', hint: 'happ://add/ для подписки, vless:// для конфига' },
  { id: 'v2rayng', name: 'v2rayNG', hint: 'v2rayng://install-sub и install-config' },
  { id: 'hiddify', name: 'Hiddify', hint: 'hiddify://import/…' },
  { id: 'link', name: 'Только ссылка', hint: 'Копировать URL, без схемы клиента' },
]

export function clientName(id: ClientId): string {
  return CLIENTS.find((item) => item.id === id)?.name ?? id
}

/**
 * v2RayTun import link.
 * Source: https://docs.v2raytun.com/deep-link — `v2raytun://import/{configuration}`
 * and `v2raytun://import/{subscription_link}`. The payload is the raw `vless://`
 * string or the https subscription URL. The docs do not use base64.
 */
export function v2raytunImport(payload: string): string {
  return `v2raytun://import/${payload}`
}

export function subscriptionDeepLink(client: ClientId, url: string, name: string): string | null {
  if (client === 'link') return null
  if (client === 'v2raytun') return v2raytunImport(url)
  if (client === 'happ') return `happ://add/${url}`
  if (client === 'v2rayng') {
    return `v2rayng://install-sub?url=${encodeURIComponent(url)}#${encodeURIComponent(name)}`
  }
  return `hiddify://import/${url}#${encodeURIComponent(name)}`
}

export function configDeepLink(client: ClientId, uri: string): string | null {
  if (client === 'link') return null
  if (client === 'v2raytun') return v2raytunImport(uri)
  if (client === 'happ') return uri
  if (client === 'v2rayng') return `v2rayng://install-config/?url=${encodeURIComponent(uri)}`
  return `hiddify://import/${uri}`
}

export function clientImportLinks(
  client: ClientId,
  configUri: string | null,
  subscriptionUrl: string | null,
): string[] {
  const links: string[] = []
  if (configUri) {
    const link = configDeepLink(client, configUri)
    if (link) links.push(link)
  }
  if (subscriptionUrl) {
    const link = subscriptionDeepLink(client, subscriptionUrl, 'vless-hub')
    if (link) links.push(link)
  }
  return links
}

export function openExternal(url: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

function coarsePointer(): boolean {
  return window.matchMedia('(hover: none), (pointer: coarse)').matches
}

export function openSchemes(
  links: string[],
  fallback: string,
  messages: { desktop: string; missed: string },
) {
  const usable = links.filter(Boolean)
  if (usable.length === 0 || !coarsePointer()) {
    void copyText(fallback, usable.length === 0 ? messages.missed : messages.desktop)
    return
  }
  let left = false
  const onHide = () => {
    if (document.hidden) left = true
  }
  const onBlur = () => {
    left = true
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('blur', onBlur)
  for (const link of usable) openExternal(link)
  window.setTimeout(() => {
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('blur', onBlur)
    if (!left) void copyText(fallback, messages.missed)
  }, 1500)
}
