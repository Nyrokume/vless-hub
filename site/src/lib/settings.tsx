import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ClientId } from '@/lib/clients'

export type SortKey = 'latency-asc' | 'latency-desc' | 'country' | 'transport'

export type Settings = {
  sort: SortKey
  latencyThreshold: number | null
  client: ClientId
  publicBase: string
}

export const DEFAULT_PUBLIC_BASE = 'https://nyrokume.github.io/vless-hub'
const STORAGE_KEY = 'vless-hub-settings'

export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'latency-asc', label: 'Сначала быстрые' },
  { value: 'latency-desc', label: 'Сначала медленные' },
  { value: 'country', label: 'По стране' },
  { value: 'transport', label: 'По транспорту' },
]

export const THRESHOLDS: { value: string; label: string; hint?: string }[] = [
  { value: 'all', label: 'Все', hint: 'Без ограничения' },
  { value: '150', label: 'до 150 мс' },
  { value: '300', label: 'до 300 мс' },
  { value: '600', label: 'до 600 мс' },
  { value: '1000', label: 'до 1000 мс' },
]

export const DEFAULT_SETTINGS: Settings = {
  sort: 'latency-asc',
  latencyThreshold: null,
  client: 'happ',
  publicBase: DEFAULT_PUBLIC_BASE,
}

function isSort(value: unknown): value is SortKey {
  return SORTS.some((item) => item.value === value)
}

const CLIENT_IDS: ClientId[] = [
  'happ',
  'v2rayng',
  'hiddify',
  'v2raytun',
  'nekobox',
  'clashmeta',
  'mihomo',
  'singbox',
  'link',
]

function isClient(value: unknown): value is ClientId {
  return typeof value === 'string' && CLIENT_IDS.includes(value as ClientId)
}

function isThreshold(value: unknown): value is number | null {
  return value === null || value === 150 || value === 300 || value === 600 || value === 1000
}

export function thresholdKey(value: number | null): string {
  return value === null ? 'all' : String(value)
}

export function thresholdLabel(value: number | null): string {
  return THRESHOLDS.find((item) => item.value === thresholdKey(value))?.label ?? 'Все'
}

export function sortLabel(value: SortKey): string {
  return SORTS.find((item) => item.value === value)?.label ?? value
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      sort: isSort(parsed.sort) ? parsed.sort : DEFAULT_SETTINGS.sort,
      latencyThreshold: isThreshold(parsed.latencyThreshold) ? parsed.latencyThreshold : null,
      client: isClient(parsed.client) ? parsed.client : DEFAULT_SETTINGS.client,
      publicBase:
        typeof parsed.publicBase === 'string' && parsed.publicBase.trim()
          ? parsed.publicBase.trim().replace(/\/+$/, '')
          : DEFAULT_PUBLIC_BASE,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

type SettingsContextValue = {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  return (
    <SettingsContext.Provider
      value={{
        settings,
        update: (patch) => setSettings((current) => ({ ...current, ...patch })),
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used within SettingsProvider')
  return context
}
