import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ClientId } from '@/lib/clients'
import { migrateSettings, SETTINGS_VERSION } from '@/lib/filters'

export type SortKey = 'latency-asc' | 'latency-desc' | 'country' | 'transport' | 'reach'
export type ViewMode = 'country' | 'flat' | 'compact' | 'cards'

export type Settings = {
  sort: SortKey
  view: ViewMode
  latencyThreshold: number | null
  client: ClientId
  publicBase: string
  onlyReachable: boolean
}

export const DEFAULT_PUBLIC_BASE = 'https://nyrokume.github.io/vless-hub'
export const STORAGE_KEY = 'vless-hub-settings'

export const SORTS: { value: SortKey; label: string }[] = [
  { value: 'latency-asc', label: 'Сначала быстрые' },
  { value: 'latency-desc', label: 'Сначала медленные' },
  { value: 'country', label: 'По стране' },
  { value: 'transport', label: 'По типу соединения' },
  { value: 'reach', label: 'Сначала доступные у меня' },
]

export const VIEWS: { value: ViewMode; label: string }[] = [
  { value: 'country', label: 'По странам' },
  { value: 'flat', label: 'Список' },
  { value: 'compact', label: 'Компактно' },
  { value: 'cards', label: 'Карточки' },
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
  view: 'country',
  latencyThreshold: null,
  client: 'happ',
  publicBase: DEFAULT_PUBLIC_BASE,
  onlyReachable: false,
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return migrateSettings(JSON.parse(raw), DEFAULT_SETTINGS)
  } catch {
    return DEFAULT_SETTINGS
  }
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

type SettingsContextValue = {
  settings: Settings
  update: (patch: Partial<Settings>) => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION }))
  }, [settings])

  return (
    <SettingsContext.Provider
      value={{
        settings,
        update: (patch) => setSettings((current) => migrateSettings({ ...current, ...patch }, DEFAULT_SETTINGS)),
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
