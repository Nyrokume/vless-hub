import { formatStamp } from '@/lib/format'
import { ru } from '@/lib/ru'

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
  { name: 'mahdibland-eternity', url: 'https://raw.githubusercontent.com/mahdibland/V2RayAggregator/master/Eternity' },
  { name: 'mahdibland-ss', url: 'https://raw.githubusercontent.com/mahdibland/ShadowsocksAggregator/master/sub/sub_merge.txt' },
  { name: 'epodonios-mix', url: 'https://raw.githubusercontent.com/Epodonios/v2ray-configs/main/All_Configs_Sub.txt' },
  { name: 'barry-far-mix', url: 'https://raw.githubusercontent.com/barry-far/V2ray-Config/main/All_Configs_Sub.txt' },
  { name: 'radikal-trojan', url: 'https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/protocols/trojan.txt' },
  { name: 'radikal-hysteria2', url: 'https://raw.githubusercontent.com/0xRadikal/Free-v2ray-Configs/main/protocols/hysteria2.txt' },
  { name: 'peasoft-raw', url: 'https://raw.githubusercontent.com/peasoft/NoMoreWalls/master/list_raw.txt' },
  { name: 'ermaozi-v2ray', url: 'https://raw.githubusercontent.com/ermaozi/get_subscribe/main/subscribe/v2ray.txt' },
  { name: 'kwinshadow-mix', url: 'https://raw.githubusercontent.com/Kwinshadow/TelegramV2rayCollector/main/sublinks/mix.txt' },
  { name: 'surfboard-converted', url: 'https://raw.githubusercontent.com/Surfboardv2ray/Proxy-sorter/main/output/converted.txt' },
  { name: 'aliilapro-base64', url: 'https://raw.githubusercontent.com/ALIILAPRO/v2rayNG-Config/main/sub.txt' },
  { name: 'soli-mix', url: 'https://raw.githubusercontent.com/SoliSpirit/v2ray-configs/main/all_configs.txt' },
  { name: 'sevcator-vless', url: 'https://raw.githubusercontent.com/sevcator/5ubscrpt10n/main/protocols/vl.txt' },
  { name: 'sevcator-trojan', url: 'https://raw.githubusercontent.com/sevcator/5ubscrpt10n/main/protocols/tr.txt' },
  { name: 'sevcator-ss', url: 'https://raw.githubusercontent.com/sevcator/5ubscrpt10n/main/protocols/ss.txt' },
  { name: 'mhdi-mix', url: 'https://raw.githubusercontent.com/MhdiTaheri/V2rayCollector/main/sub/mix' },
  { name: 'coldwater-mix', url: 'https://raw.githubusercontent.com/coldwater-10/V2ray-Config/main/All_Configs_Sub.txt' },
  { name: 'coldwater-hysteria2', url: 'https://raw.githubusercontent.com/coldwater-10/V2ray-Config/main/Splitted-By-Protocol/hysteria2.txt' },
  { name: 'tg-v2rayng3', skip: ru.live.skipTelegram },
  { name: 'tg-v2ray-configs', skip: ru.live.skipTelegram },
  { name: 'tg-outlinev2ray', skip: ru.live.skipTelegram },
  { name: 'tg-v2raycollector', skip: ru.live.skipTelegram },
  { name: 'tg-privatevpns', skip: ru.live.skipTelegram },
  { name: 'tg-vlessconfig', skip: ru.live.skipTelegram },
  { name: 'tg-vlessvpnfree', skip: ru.live.skipTelegram },
  { name: 'tg-vlesstrojan', skip: ru.live.skipTelegram },
  { name: 'tg-proxymtproto', skip: ru.live.skipTelegram },
  { name: 'tg-proxy-pub', skip: ru.live.skipTelegram },
  { name: 'tg-mtpro-xyz', skip: ru.live.skipTelegram },
  { name: 'tg-mtproto-proxy', skip: ru.live.skipTelegram },
  { name: 'tg-proxy-mtg', skip: ru.live.skipTelegram },
]

export const CHECK_WORKFLOW_URL = 'https://github.com/Nyrokume/vless-hub/actions/workflows/update.yml'
export const CHECK_RUNS_URL =
  'https://api.github.com/repos/Nyrokume/vless-hub/actions/workflows/update.yml/runs?per_page=1'

export type RunSnapshot = {
  status: string
  conclusion: string | null
  url: string
  title: string
  updatedAt: string | null
}

export type RunPhase = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

export function runPhase(run: RunSnapshot | null): RunPhase | null {
  if (!run) return null
  if (run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' || run.status === 'in_progress') {
    return 'running'
  }
  if (run.conclusion === 'success') return 'done'
  if (run.conclusion === 'failure') return 'failed'
  if (run.conclusion === 'cancelled') return 'cancelled'
  return 'idle'
}

export function runLine(run: RunSnapshot | null, limited: boolean): string {
  if (limited) return ru.live.rateLimit
  const phase = runPhase(run)
  if (!run || !phase) return ''
  const label =
    phase === 'running'
      ? ru.live.running
      : phase === 'done'
        ? ru.live.done
        : phase === 'failed'
          ? ru.live.failed
          : phase === 'cancelled'
            ? ru.live.cancelled
            : ru.live.idle
  const time = run.updatedAt ? formatStamp(run.updatedAt) : ''
  return time ? `${label} · ${time}` : label
}

export async function fetchLatestRun(signal?: AbortSignal): Promise<{ run: RunSnapshot | null; limited: boolean }> {
  const response = await fetch(CHECK_RUNS_URL, { signal, cache: 'no-store' })
  if (response.status === 403 || response.status === 429) return { run: null, limited: true }
  if (!response.ok) return { run: null, limited: false }
  const payload = (await response.json()) as {
    workflow_runs?: {
      status?: string
      conclusion?: string | null
      html_url?: string
      display_title?: string
      updated_at?: string
      run_started_at?: string
    }[]
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
      updatedAt: row.updated_at || row.run_started_at || null,
    },
  }
}
