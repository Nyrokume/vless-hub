export type LiveSource = {
  name: string
  url?: string
  skip?: string
}

/** Subscription files that allow browser fetches, plus channel pages that do not. */
export const LIVE_SOURCES: LiveSource[] = [
  { name: 'epodonios-vless', url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/vless.txt' },
  { name: 'barry-far-vless', url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/vless.txt' },
  { name: 'ebrasha-vless', url: 'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/main/separated-protocols/vless_configs.txt' },
  { name: 'radikal-vless', url: 'https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/protocols/vless.txt' },
  { name: 'peasoft-list', url: 'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list.txt' },
  { name: 'epodonios-ss', url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/ss.txt' },
  { name: 'epodonios-trojan', url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/Splitted-By-Protocol/trojan.txt' },
  { name: 'barry-far-ss', url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/ss.txt' },
  { name: 'barry-far-trojan', url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/Splitted-By-Protocol/trojan.txt' },
  { name: 'ebrasha-ss', url: 'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/main/separated-protocols/ss_configs.txt' },
  { name: 'ebrasha-trojan', url: 'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/main/separated-protocols/trojan_configs.txt' },
  { name: 'ebrasha-hysteria2', url: 'https://raw.githubusercontent.com/ebrasha/free-v2ray-public-list/main/separated-protocols/hysteria2_configs.txt' },
  { name: 'matinghanbari-mix', url: 'https://raw.githubusercontent.com/MatinGhanbari/v2ray-configs/main/subscriptions/v2ray/all_sub.txt' },
  { name: 'mahdibland-base64', url: 'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/sub/sub_merge_base64.txt' },
  { name: 'tg-v2rayng3', skip: 'страница Telegram' },
  { name: 'tg-vlessconfig', skip: 'страница Telegram' },
  { name: 'tg-vlessvpnfree', skip: 'страница Telegram' },
  { name: 'tg-vlesstrojan', skip: 'страница Telegram' },
  { name: 'tg-proxymtproto', skip: 'страница Telegram' },
  { name: 'tg-proxy-pub', skip: 'страница Telegram' },
  { name: 'tg-mtpro-xyz', skip: 'страница Telegram' },
]

export const CHECK_WORKFLOW_URL = 'https://github.com/Nyrokume/vless-hub/actions/workflows/update.yml'
export const CHECK_RUNS_URL =
  'https://api.github.com/repos/Nyrokume/vless-hub/actions/workflows/update.yml/runs?per_page=1'

export type RunSnapshot = {
  status: string
  conclusion: string | null
  url: string
  title: string
}

export function runLabel(run: RunSnapshot | null, limited: boolean): string {
  if (limited) return 'Лимит GitHub, статус позже'
  if (!run) return 'Статус проверки неизвестен'
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending') return 'Проверка в очереди'
  if (run.status === 'in_progress') return 'Проверка идёт'
  if (run.conclusion === 'success') return 'Проверка завершилась'
  if (run.conclusion === 'failure') return 'Проверка остановилась с ошибкой'
  if (run.conclusion === 'cancelled') return 'Проверка отменена'
  return 'Проверка на GitHub'
}

export async function fetchLatestRun(signal?: AbortSignal): Promise<{ run: RunSnapshot | null; limited: boolean }> {
  const response = await fetch(CHECK_RUNS_URL, { signal, cache: 'no-store' })
  if (response.status === 403 || response.status === 429) return { run: null, limited: true }
  if (!response.ok) return { run: null, limited: false }
  const payload = (await response.json()) as {
    workflow_runs?: { status?: string; conclusion?: string | null; html_url?: string; display_title?: string }[]
  }
  const row = payload.workflow_runs?.[0]
  if (!row) return { run: null, limited: false }
  return {
    limited: false,
    run: {
      status: row.status || '',
      conclusion: row.conclusion ?? null,
      url: row.html_url || CHECK_WORKFLOW_URL,
      title: row.display_title || '',
    },
  }
}
