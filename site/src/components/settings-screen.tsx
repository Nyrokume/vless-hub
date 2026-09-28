import { useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import {
  Activity,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Gauge,
  Globe,
  Link2,
  Moon,
  ScrollText,
  Server,
  Smartphone,
  Tag,
} from 'lucide-react'
import { IconTile } from '@/components/icon-tile'
import { InspectScreen } from '@/components/inspect-screen'
import { LatencyRange } from '@/components/latency-range'
import { SiteHeader } from '@/components/site-header'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { CLIENTS, clientName, type ClientId } from '@/lib/clients'
import { displayedLatencyBounds, formatStamp } from '@/lib/format'
import { formatCount } from '@/lib/plural'
import { probeLabel, reasonLabel, ru } from '@/lib/ru'
import {
  DEFAULT_PUBLIC_BASE,
  SORTS,
  sortLabel,
  THRESHOLDS,
  thresholdKey,
  thresholdLabel,
  useSettings,
} from '@/lib/settings'
import type { HubData } from '@/lib/types'
import { SITE_VERSION } from '@/version'

function Group({
  title,
  children,
}: {
  title?: string
  children: ReactNode
}) {
  return (
    <section className="mb-6">
      {title && (
        <h2 className="px-4 pb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
      )}
      <div className="overflow-hidden rounded-2xl bg-card">{children}</div>
    </section>
  )
}

function ChoiceSheet<T extends string>({
  open,
  title,
  description,
  value,
  choices,
  onOpenChange,
  onChange,
}: {
  open: boolean
  title: string
  description?: string
  value: T
  choices: { value: T; label: string; hint?: string }[]
  onOpenChange: (open: boolean) => void
  onChange: (value: T) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="gap-0 overflow-hidden p-0">
        <div className="max-h-[inherit] overflow-y-auto">
        <SheetHeader className="pr-12 text-left">
          <SheetTitle className="text-[22px] leading-tight font-semibold">{title}</SheetTitle>
          {description ? (
            <SheetDescription className="text-[14px] text-foreground/75">{description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="mx-4 mb-6 overflow-hidden rounded-2xl bg-card">
          {choices.map((choice, index) => (
            <div key={choice.value}>
              {index > 0 && <Separator />}
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() => {
                  onChange(choice.value)
                  onOpenChange(false)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[17px]">{choice.label}</span>
                  {choice.hint && (
                    <span className="block text-[13px] leading-5 text-foreground/75">{choice.hint}</span>
                  )}
                </span>
                {value === choice.value && <Check className="size-5 text-primary" />}
              </button>
            </div>
          ))}
        </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function LogLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">{value}</span>
    </div>
  )
}

function RunLogs({ data }: { data: HubData | null }) {
  const rejected = data?.stats.rejected
  const reasons = rejected
    ? Object.entries(rejected)
        .map(([key, count]) => ({ key, label: reasonLabel(key), count }))
        .filter((row) => row.count > 0 && row.key !== 'dead')
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'))
    : []
  const sources = data?.sources ?? []
  return (
    <div className="px-4 pb-3 text-[14px] text-muted-foreground">
      {!data && <p>{ru.noData}</p>}
      {data && (
        <>
          <p>
            {formatStamp(data.generated_at)}
            {' · '}
            {ru.settings.duration(data.duration_sec)}
          </p>
          <div className="mt-2">
            <p className="py-1 text-foreground">{ru.settings.collected(data.stats.fetched)}</p>
            <p className="py-1 text-foreground">{ru.settings.unique(data.stats.unique)}</p>
            <p className="py-1 text-foreground">{ru.settings.portsChecked(data.stats.tested)}</p>
            <p className="py-1 text-foreground">{ru.settings.proxyChecked(data.stats.proxy_tested ?? data.stats.tested)}</p>
            <p className="py-1 text-foreground">{ru.settings.published(data.stats.published)}</p>
          </div>
          {reasons.length > 0 && (
            <>
              <p className="mt-3 font-medium text-foreground">{ru.settings.dropped}</p>
              <div>
                {reasons.map((row) => (
                  <LogLine key={row.key} label={row.label} value={formatCount(row.count)} />
                ))}
              </div>
            </>
          )}
          <p className="mt-3 font-medium text-foreground">{ru.settings.sources}</p>
          {sources.length === 0 && <p className="py-1">{ru.noData}</p>}
          {sources.map((source) => {
            const yieldPct = source.yield == null ? ru.settings.dash : `${Math.round(source.yield * 100)}%`
            return (
              <div key={source.id} className="border-t border-border py-2">
                <p className="truncate text-[15px] text-foreground">{source.name}</p>
                <p className="text-[13px]">
                  {source.ok
                    ? ru.settings.sourceMeta(source.fetched, source.kept ?? 0, source.verified ?? 0, yieldPct)
                    : ru.settings.sourceError}
                  {source.deprioritized ? ` · ${ru.settings.lowYield}` : ''}
                </p>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

export function SettingsScreen({ data }: { data: HubData | null }) {
  const { settings, update } = useSettings()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const [picker, setPicker] = useState<'sort' | 'threshold' | 'client' | 'base' | null>(null)
  const [baseDraft, setBaseDraft] = useState(settings.publicBase)
  const latency = data ? displayedLatencyBounds(data.configs) : { min: null, max: null }

  function openBase() {
    setBaseDraft(settings.publicBase)
    setPicker('base')
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={data ? formatStamp(data.generated_at) : undefined} />

      <Group>
        <div className="flex items-center gap-3 px-4 py-3">
          <IconTile>
            <Moon className="size-4" />
          </IconTile>
          <Label htmlFor="dark-theme" className="flex-1 text-[17px] font-normal">
            Тёмная тема
          </Label>
          <Switch
            id="dark-theme"
            checked={dark}
            onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          />
        </div>
        <Separator />
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => setPicker('sort')}
        >
          <IconTile>
            <ArrowUpDown className="size-4" />
          </IconTile>
          <span className="flex-1 text-[17px]">Сортировка</span>
          <span className="text-[15px] text-muted-foreground">{sortLabel(settings.sort)}</span>
          <ChevronRight className="size-4 text-muted-foreground/80" />
        </button>
        <Separator />
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => setPicker('threshold')}
        >
          <IconTile>
            <Gauge className="size-4" />
          </IconTile>
          <span className="flex-1 text-[17px]">Максимальный пинг</span>
          <span className="text-[15px] text-muted-foreground">
            {thresholdLabel(settings.latencyThreshold)}
          </span>
          <ChevronRight className="size-4 text-muted-foreground/80" />
        </button>
      </Group>

      <Group title="Клиент">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
          onClick={() => setPicker('client')}
        >
          <IconTile>
            <Smartphone className="size-4" />
          </IconTile>
          <span className="flex-1 text-[17px]">Приложение</span>
          <span className="text-[15px] text-muted-foreground">{clientName(settings.client)}</span>
          <ChevronRight className="size-4 text-muted-foreground/80" />
        </button>
        <Separator />
        <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={openBase}>
          <IconTile>
            <Link2 className="size-4" />
          </IconTile>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px]">Адрес сайта</span>
            <span className="block truncate text-[13px] text-muted-foreground">{settings.publicBase}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/80" />
        </button>
      </Group>

      <Group title="Информация">
        <InfoRow icon={<Tag className="size-4" />} text={`Версия: ${SITE_VERSION}`} />
        <Separator />
        <InfoRow
          icon={<Activity className="size-4" />}
          text={
            data
              ? ru.settings.check(`${probeLabel(data.probe)} · ${data.collector_version}`)
              : ru.settings.check(ru.settings.dash)
          }
        />
        <Separator />
        <InfoRow
          icon={<Clock className="size-4" />}
          text={`Последний запуск: ${data ? formatStamp(data.generated_at) : '—'}`}
        />
        <Separator />
        <InfoRow
          icon={<Gauge className="size-4" />}
          text={ru.settings.pingMeaning}
        />
        <Separator />
        <InfoRow
          icon={<Server className="size-4" />}
          text={
            data
              ? ru.settings.inList(data.stats.published, data.stats.proxy_tested ?? data.stats.tested)
              : ru.settings.inListEmpty
          }
        />
        <Separator />
        <InfoRow
          icon={<Globe className="size-4" />}
          text={data ? ru.settings.countryLine(data.stats.countries) : ru.settings.countryEmpty}
        />
        <Separator />
        <InfoRow icon={<Gauge className="size-4" />}>
          <LatencyRange className="text-[16px]" min={latency.min} max={latency.max} />
        </InfoRow>
      </Group>

      <Collapsible className="mb-6">
        <div className="overflow-hidden rounded-2xl bg-card">
          <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
            <IconTile>
              <BookOpen className="size-4" />
            </IconTile>
            <span className="flex-1 text-[17px]">{ru.settings.guide}</span>
            <ChevronRight className="size-4 text-muted-foreground/80 transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col pb-2">
              {ru.guideItems.map((item) => (
                <Collapsible key={item.id}>
                  <Separator />
                  <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
                    <span className="flex-1 text-[16px]">{item.title}</span>
                    <ChevronRight className="size-4 text-muted-foreground/80 transition-transform group-data-[state=open]:rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-3 text-[14px] leading-relaxed text-muted-foreground">
                      <p>{item.body}</p>
                      {item.id === 'inspect' && (
                        <div className="mt-3">
                          <InspectScreen embedded />
                        </div>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Collapsible className="mb-6">
        <div className="overflow-hidden rounded-2xl bg-card">
          <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
            <IconTile>
              <ScrollText className="size-4" />
            </IconTile>
            <span className="flex-1 text-[17px]">{ru.settings.logs}</span>
            <ChevronRight className="size-4 text-muted-foreground/80 transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Separator />
            <RunLogs data={data} />
          </CollapsibleContent>
        </div>
      </Collapsible>

      <Group title="Об авторе">
        <div className="px-4 py-3">
          <p className="text-[16px] font-medium">nyrokume.dev</p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Самоучка: Rust, фронтенд, бэкенд, Python, AI, навыки для агентов, промпты.
          </p>
          <p className="mt-2 flex flex-wrap gap-x-4 text-[14px]">
            <a className="underline underline-offset-2" href="https://github.com/Nyrokume" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a
              className="underline underline-offset-2"
              href="https://github.com/Nyrokume/vless-hub"
              target="_blank"
              rel="noreferrer"
            >
              Репозиторий
            </a>
          </p>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Версия {SITE_VERSION}
            {data ? ` · обновлено ${formatStamp(data.generated_at)}` : ''}
          </p>
        </div>
      </Group>

      <ChoiceSheet
        open={picker === 'sort'}
        title="Сортировка"
        value={settings.sort}
        choices={SORTS}
        onOpenChange={(open) => setPicker(open ? 'sort' : null)}
        onChange={(value) => update({ sort: value })}
      />
      <ChoiceSheet
        open={picker === 'threshold'}
        title="Максимальный пинг"
        value={thresholdKey(settings.latencyThreshold)}
        choices={THRESHOLDS}
        onOpenChange={(open) => setPicker(open ? 'threshold' : null)}
        onChange={(value) => update({ latencyThreshold: value === 'all' ? null : Number(value) })}
      />
      <ChoiceSheet
        open={picker === 'client'}
        title="Приложение"
        value={settings.client}
        choices={CLIENTS.map((item) => ({
          value: item.id,
          label: item.name,
          hint: item.hint,
        }))}
        onOpenChange={(open) => setPicker(open ? 'client' : null)}
        onChange={(value) => update({ client: value as ClientId })}
      />

      <Sheet open={picker === 'base'} onOpenChange={(open) => setPicker(open ? 'base' : null)}>
        <SheetContent side="bottom" className="gap-0 overflow-hidden p-0">
          <div className="max-h-[inherit] overflow-y-auto">
          <SheetHeader className="pr-12 text-left">
            <SheetTitle className="text-[22px] leading-tight font-semibold">Адрес сайта</SheetTitle>
          </SheetHeader>
          <form
            className="flex flex-col gap-3 px-4 pb-6"
            onSubmit={(event) => {
              event.preventDefault()
              const next = baseDraft.trim().replace(/\/+$/, '')
              update({ publicBase: next || DEFAULT_PUBLIC_BASE })
              setPicker(null)
            }}
          >
            <Label htmlFor="public-base" className="sr-only">
              Адрес сайта
            </Label>
            <Input
              id="public-base"
              value={baseDraft}
              onChange={(event) => setBaseDraft(event.target.value)}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="h-11"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit">Сохранить</Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  update({ publicBase: DEFAULT_PUBLIC_BASE })
                  setBaseDraft(DEFAULT_PUBLIC_BASE)
                  setPicker(null)
                }}
              >
                {ru.settings.restoreAddress}
              </Button>
            </div>
          </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function InfoRow({ icon, text, children }: { icon: ReactNode; text?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <IconTile>{icon}</IconTile>
      <span className="min-w-0 flex-1 text-[16px] leading-snug break-words">{children ?? text}</span>
    </div>
  )
}
