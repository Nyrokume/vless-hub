import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import {
  Activity,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronRight,
  Gauge,
  Globe,
  Link2,
  Moon,
  RefreshCw,
  Server,
  Smartphone,
  Square,
} from 'lucide-react'
import { IconTile } from '@/components/icon-tile'
import { ListEmpty } from '@/components/list-empty'
import { InspectScreen } from '@/components/inspect-screen'
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
import { WORKFLOW_PAGE, loadCollectorRun, nextScheduledRun, runStatusLabel, type CollectorRun } from '@/lib/collector-run'
import { FAILURE_LABELS, formatStamp, latencyText } from '@/lib/format'
import { useHub } from '@/lib/hub'
import {
  DEFAULT_PUBLIC_BASE,
  SORTS,
  sortLabel,
  THRESHOLDS,
  thresholdKey,
  thresholdLabel,
  useSettings,
} from '@/lib/settings'
import type { HubData, SourceReport } from '@/lib/types'
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
      <SheetContent side="bottom" className="max-h-[80dvh] gap-0 overflow-y-auto rounded-t-3xl">
        <SheetHeader className="pr-10 text-left">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
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

function FailureCounts({ data }: { data: HubData | null }) {
  const rejected = data?.stats.rejected
  if (!rejected) return null
  const rows = Object.keys(FAILURE_LABELS)
    .map((key) => ({ key, label: FAILURE_LABELS[key], count: rejected[key] ?? 0 }))
    .filter((row) => row.count > 0)
  if (rows.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.key} className="flex justify-between gap-3">
          <span>{row.label}</span>
          <span className="tabular-nums">{row.count}</span>
        </li>
      ))}
    </ul>
  )
}

export function SettingsScreen({ data }: { data: HubData | null }) {
  const { settings, update } = useSettings()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const { refresh, refreshing: listRefreshing } = useHub()
  const [picker, setPicker] = useState<'sort' | 'threshold' | 'client' | 'base' | null>(null)
  const [baseDraft, setBaseDraft] = useState(settings.publicBase)
  const [run, setRun] = useState<CollectorRun | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadCollectorRun(data?.generated_at ?? null).then((next) => {
      if (!cancelled) setRun(next)
    })
    return () => {
      cancelled = true
    }
  }, [data?.generated_at])

  function openBase() {
    setBaseDraft(settings.publicBase)
    setPicker('base')
  }

  const rejected = data?.stats.rejected
  const rejectedParts = rejected
    ? Object.entries(FAILURE_LABELS)
        .map(([key, label]) => [label, rejected[key] ?? 0] as const)
        .filter(([, count]) => count > 0)
        .map(([label, count]) => `${label} ${count}`)
    : []
  const rejectedLine = rejectedParts.length ? `Отброшено: ${rejectedParts.join(', ')}` : ''

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

      <Group title="Обновление">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <IconTile>
            <RefreshCw className="size-4" />
          </IconTile>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px]">Последний запуск</span>
            <span className="block text-[13px] text-muted-foreground">
              {run?.at ? formatStamp(run.at) : data ? formatStamp(data.generated_at) : '—'}
              {' · '}
              {run ? runStatusLabel(run.status) : '…'}
            </span>
          </span>
        </div>
        <Separator />
        <div className="px-4 py-2.5 text-[13px] text-muted-foreground">
          Следующий: {formatStamp(nextScheduledRun().toISOString())}
          {run?.source === 'data' ? ' · время из файла данных' : ''}
        </div>
        <Separator />
        <div className="flex flex-wrap gap-2 px-4 py-2.5">
          <Button size="sm" disabled={listRefreshing} onClick={() => void refresh()}>
            Обновить списки
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.open(WORKFLOW_PAGE, '_blank', 'noopener,noreferrer')}>
            Запустить проверку
          </Button>
        </div>
        <p className="px-4 pb-2.5 text-[12px] text-muted-foreground">Проверку может запустить только владелец репозитория.</p>
        <Separator />
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Label htmlFor="auto-refresh" className="flex-1 text-[15px] font-normal">
            Обновлять списки
          </Label>
          <Switch
            id="auto-refresh"
            checked={settings.autoRefresh}
            onCheckedChange={(checked) => update({ autoRefresh: checked })}
          />
        </div>
        <p className="px-4 pb-2.5 text-[12px] text-muted-foreground">При возврате на вкладку и каждые 15 минут.</p>
      </Group>

      <Group title="Информация">
        <InfoRow icon={<Square className="size-4" />} text={`Версия: ${SITE_VERSION}`} />
        <Separator />
        <InfoRow
          icon={<Activity className="size-4" />}
          text={`Проверка: ${data?.collector_version ?? '—'}`}
        />
        <Separator />
        <InfoRow
          icon={<Gauge className="size-4" />}
          text="Пинг — время ответа сайта, без времени подключения"
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
              <BookOpen className="size-4" />
            </IconTile>
            <span className="flex-1 text-[17px]">Инструкции</span>
            <ChevronRight className="size-4 text-muted-foreground/80 transition-transform group-data-[state=open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="flex flex-col gap-4 px-4 pb-4 text-[14px] leading-relaxed text-muted-foreground">
              <p>
                V2Hub собирает публичные конфиги VLESS и прокси Telegram, проверяет их и отдаёт списками.
                Сайт не поднимает туннель и не подключается к серверу за вас.
              </p>
              <div>
                <p className="font-medium text-foreground">Как читать результат</p>
                <p className="mt-1">
                  Точка на строке — рабочий или нестабильный конфиг. Пинг — медиана нескольких HTTP-запросов
                  через уже запущенный Xray или sing-box, без прогрева. Рядом доля успешных прогонов и
                  скорость. «Порт открыт» значит, что TCP ответил, а полный проход в этом запуске не
                  выполнялся.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Как забрать конфиги</p>
                <p className="mt-1">
                  «Экспорт» — файлы по срезу, стране, защите и типу соединения, Clash, sing-box и конструктор
                  подписки. На «Конфигах» отметьте строки и выгрузите текст, base64, файл, QR, Clash или
                  sing-box. QR и кнопки клиента используют только проверенные схемы: Happ, v2rayNG,
                  Hiddify, v2RayTun для VLESS; Clash Meta, Mihomo, NekoBox и sing-box — для своих файлов.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Проверка</p>
                <p className="mt-1">
                  Сначала разбор ссылки, затем TCP, рукопожатие ядра, большинство из трёх HTTP-адресов,
                  короткая загрузка и чужой адрес выхода. Рабочий — прошёл сейчас и держится хотя бы в 70%
                  последних прогонов. Нестабильный прошёл сейчас, но реже. Мёртвый в список не попадает, а
                  после нескольких провалов подряд выбывает из пула. Проверка идёт с серверов GitHub Actions
                  вне России, поэтому местный провайдер может закрыть то, что здесь открылось.
                </p>
                <div className="mt-3">
                  <FailureCounts data={data} />
                </div>
              </div>
              <div>
                <p className="font-medium text-foreground">Telegram</p>
                <p className="mt-1">
                  Кнопка «В Telegram» открывает tg:// и подставляет прокси. Если клиент не открылся, рядом
                  есть HTTPS-ссылка и QR.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground">Разбор ссылки</p>
                <div className="mt-2">
                  <InspectScreen embedded />
                </div>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

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
                    {sourceKindLabel(source)}
                    {source.ok ? ` · прошло ${source.passed ?? source.verified ?? source.fetched}` : ' · ошибка'}
                    {source.yield == null ? '' : ` · ${Math.round(source.yield * 100)}%`}
                    {source.deprioritized ? ' · низкий выход' : ''}
                  </p>
                </div>
              </div>
            ))}
            {(!data || data.sources.length === 0) && <ListEmpty title="Нет данных" />}
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
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader className="pr-10 text-left">
            <SheetTitle>Адрес сайта</SheetTitle>
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

function sourceKindLabel(source: SourceReport): string {
  if (source.kind === 'telegram-proxy' || /socks|mtproto|proxy/i.test(source.name)) return 'прокси'
  if (source.type === 'telegram' || source.name.startsWith('tg-')) return 'Telegram'
  return 'подписка'
}

function InfoRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <IconTile>{icon}</IconTile>
      <span className="min-w-0 flex-1 text-[16px] leading-snug break-words">{text}</span>
    </div>
  )
}
