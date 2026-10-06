import { configDeepLink, subscriptionDeepLink, subscriptionImportActions } from '../site/src/lib/clients.ts'

const url = 'https://nyrokume.github.io/vless-hub/sub/all.txt'
const clash = 'https://nyrokume.github.io/vless-hub/sub/clash.yaml'
const uri = 'vless://11111111-1111-4111-8111-111111111111@de.example:443?type=tcp&security=none#%D0%B8%D0%BC%D1%8F'

function fail(message) {
  console.error(message)
  process.exit(1)
}

const v2ray = subscriptionDeepLink('v2rayng', url, 'Все')
if (!v2ray || !v2ray.startsWith('v2rayng://install-sub?url=')) fail(v2ray)
if (v2ray.includes('install-config') || v2ray.includes('#')) fail(v2ray)

const one = configDeepLink('v2rayng', uri)
if (!one || !one.startsWith('v2rayng://install-config/?url=')) fail(one)

for (const [client, prefix] of [
  ['streisand', 'streisand://import/'],
  ['v2rayn', 'v2rayn://install-sub?url='],
  ['v2box', 'v2box://install-sub?url='],
  ['foxray', 'foxray://install-sub?url='],
]) {
  const link = subscriptionDeepLink(client, url, 'Все')
  if (!link || !link.startsWith(prefix)) fail(`${client} ${link}`)
}

const hiddify = subscriptionDeepLink('hiddify', url, 'Все')
if (!hiddify || !hiddify.startsWith('hiddify://import/https%3A%2F%2F')) fail(hiddify)
if (hiddify.includes('#')) fail(hiddify)

const clashLink = subscriptionDeepLink('clash', clash, 'Clash')
if (!clashLink || !clashLink.startsWith('clash://install-config?url=')) fail(clashLink)
if (subscriptionDeepLink('clash', url, 'Все') !== null) fail('clash accepted a text list')

const labels = subscriptionImportActions(url, 'Все').map((item) => item.label)
for (const name of ['Happ', 'v2rayNG', 'Hiddify', 'Streisand', 'v2rayN', 'V2Box', 'FoXray']) {
  if (!labels.includes(name)) fail(`missing ${name}`)
}
