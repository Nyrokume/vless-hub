import { useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import {
  Activity,
  ArrowUpDown,
  Check,
  ChevronRight,
  Clock,
  Gauge,
  Globe,
  Link2,
  Moon,
  Server,
  Smartphone,
  Square,
} from 'lucide-react'
import { IconTile } from '@/components/icon-tile'
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
import { formatStamp, latencyText } from '@/lib/format'
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
  description: string
  value: T
  choices: { value: T; label: string; hint?: string }[]
  onOpenChange: (open: boolean) => void
  onChange: (value: T) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80dvh] gap-0 overflow-y-auto rounded-t-3xl">
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
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
                    <span className="block text-[13px] text-muted-foreground">{choice.hint}</span>
                  )}
                </span>
                {value === choice.value && <Check className="size-5 text-primary" />}
              </button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function SettingsScreen({ data, embedded = false }: { data: HubData | null; embedded?: boolean }) {
  const { settings, update } = useSettings()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const [picker, setPicker] = useState<'sort' | 'threshold' | 'client' | 'base' | null>(null)
  const [baseDraft, setBaseDraft] = useState(settings.publicBase)

  function openBase() {
    setBaseDraft(settings.publicBase)
    setPicker('base')
  }

  const rejected = data?.stats.rejected
  const rejectedLine = rejected
    ? `Отброшено: разбор ${rejected.parse_error ?? 0}, tcp_refused ${rejected.tcp_refused ?? 0}, timeout ${rejected.timeout ?? 0}, http_fail ${rejected.http_fail ?? 0}, no_data ${rejected.no_data ?? 0}`
    : ''

  return (
    <div className={embedded ? 'pb-4' : 'mx-auto w-full max-w-[560px] px-4 pt-4'}>
      {!embedded && <h1 className="px-1 pb-5 text-[34px] leading-none font-bold tracking-tight">Настройки</h1>}

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
          <span className="flex-1 text-[17px]">Порог задержки</span>
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
        <InfoRow icon={<Square className="size-4" />} text={`Версия: ${SITE_VERSION}`} />
        <Separator />
        <InfoRow
          icon={<Activity className="size-4" />}
          text={`Сборщик: ${data?.collector_version ?? '—'}`}
        />
        <Separator />
        <InfoRow
          icon={<Clock className="size-4" />}
          text={`Последний запуск: ${data ? formatStamp(data.generated_at) : '—'}`}
        />
        <Separator />
        <InfoRow
          icon={<Gauge className="size-4" />}
          text="Пинг — медиана HTTP после прогрева, отдельно от рукопожатия"
        />
        <Separator />
        <InfoRow
          icon={<Server className="size-4" />}
          text={
            data
              ? `В списке: ${data.stats.published} прокси из ${data.stats.proxy_tested ?? data.stats.tested} проверок`
              : 'В списке: —'
          }
        />
        <Separator />
        <InfoRow
          icon={<Globe className="size-4" />}
          text={
            data
              ? `Стран: ${data.stats.countries} · медиана HTTP ${latencyText(data.stats.median_latency_ms)}`
              : 'Стран: —'
          }
        />
        {rejectedLine && (
          <>
            <Separator />
            <InfoRow icon={<Gauge className="size-4" />} text={rejectedLine} />
          </>
        )}
      </Group>

      <Collapsible className="mb-6">
        <div className="overflow-hidden rounded-2xl bg-card">
          <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
            <IconTile>
              <Server className="size-4" />
            </IconTile>
            <span className="flex-1 text-[17px]">Источники</span>
            <ChevronRight className="size-4 text-muted-foreground/80 transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            {(data?.sources ?? []).map((source) => (
              <div key={source.id}>
                <Separator />
                <div className="px-4 py-2.5">
                  <p className="text-[15px]">{source.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {source.ok ? source.fetched : 'ошибка'}
                    {source.yield == null ? '' : ` · ${Math.round(source.yield * 100)}%`}
                    {source.deprioritized ? ' · низкий выход' : ''}
                  </p>
                </div>
              </div>
            ))}
            {(!data || data.sources.length === 0) && (
              <>
                <Separator />
                <p className="px-4 py-3 text-[14px] text-muted-foreground">Нет данных</p>
              </>
            )}
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
        description="Порядок списка конфигураций. Сохраняется на этом устройстве."
        value={settings.sort}
        choices={SORTS}
        onOpenChange={(open) => setPicker(open ? 'sort' : null)}
        onChange={(value) => update({ sort: value })}
      />
      <ChoiceSheet
        open={picker === 'threshold'}
        title="Порог задержки"
        description="Конфиги медленнее порога скрываются из списка."
        value={thresholdKey(settings.latencyThreshold)}
        choices={THRESHOLDS}
        onOpenChange={(open) => setPicker(open ? 'threshold' : null)}
        onChange={(value) => update({ latencyThreshold: value === 'all' ? null : Number(value) })}
      />
      <ChoiceSheet
        open={picker === 'client'}
        title="Приложение"
        description="Какую схему открывать кнопкой «в клиент»."
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
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader className="pr-10 text-left">
            <SheetTitle>Адрес сайта</SheetTitle>
            <SheetDescription>
              К нему добавляются пути data/subs/ и sub/. Для этого репозитория оставьте адрес GitHub Pages.
            </SheetDescription>
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
              Вернуть адрес Pages
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function InfoRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <IconTile>{icon}</IconTile>
      <span className="min-w-0 flex-1 text-[16px] leading-snug break-words">{text}</span>
    </div>
  )
}
