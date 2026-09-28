import { useState } from 'react'
import { useTheme } from 'next-themes'
import {
  Activity,
  Clock,
  Gauge,
  Globe,
  Link2,
  Server,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@/components/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { CLIENTS, type ClientId } from '@/lib/clients'
import { formatStamp } from '@/lib/format'
import {
  DEFAULT_PUBLIC_BASE,
  SORTS,
  THRESHOLDS,
  thresholdKey,
  useSettings,
  type SortKey,
} from '@/lib/settings'
import type { HubData } from '@/lib/types'
import { SITE_VERSION } from '@/version'

export function SettingsScreen({ data }: { data: HubData | null }) {
  const { settings, update } = useSettings()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== 'light'
  const [baseDraft, setBaseDraft] = useState(settings.publicBase)

  const sourceLine =
    data?.sources
      .map((source) => `${source.name}${source.ok ? '' : ' (ошибка)'}: ${source.fetched}`)
      .join(' · ') ?? 'нет данных'

  const info = [
    { icon: Square, text: `Версия: ${SITE_VERSION}` },
    { icon: Activity, text: `Сборщик: ${data?.collector_version ?? '—'}` },
    { icon: Clock, text: `Последний запуск: ${data ? formatStamp(data.generated_at) : '—'}` },
    { icon: Gauge, text: 'Проверка: TCP-соединение' },
    {
      icon: Server,
      text: data
        ? `В списке: ${data.stats.published} из ${data.stats.tested} проверенных`
        : 'В списке: —',
    },
    {
      icon: Globe,
      text: data
        ? `Стран: ${data.stats.countries} · медиана ${data.stats.median_latency_ms ?? '—'} мс`
        : 'Стран: —',
    },
    { icon: Link2, text: sourceLine },
  ]

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Настройки</h1>

      <Card>
        <CardHeader>
          <CardTitle>Вид</CardTitle>
          <CardDescription>Тема, сортировка и порог задержки. Сохраняются на этом устройстве.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="dark-theme">Тёмная тема</FieldLabel>
                <FieldDescription>Тёмный режим включён по умолчанию.</FieldDescription>
              </FieldContent>
              <Switch
                id="dark-theme"
                checked={dark}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="sort">Сортировка</FieldLabel>
              <Select
                value={settings.sort}
                onValueChange={(value) => update({ sort: value as SortKey })}
              >
                <SelectTrigger id="sort" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {SORTS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="threshold">Порог задержки</FieldLabel>
              <FieldDescription>Конфиги медленнее порога скрываются из списка.</FieldDescription>
              <Select
                value={thresholdKey(settings.latencyThreshold)}
                onValueChange={(value) =>
                  update({ latencyThreshold: value === 'all' ? null : Number(value) })
                }
              >
                <SelectTrigger id="threshold" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    {THRESHOLDS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.hint ? `${item.label} — ${item.hint}` : item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Клиент</CardTitle>
          <CardDescription>Какую схему открывать кнопкой «в клиент».</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              const next = baseDraft.trim().replace(/\/+$/, '')
              update({ publicBase: next || DEFAULT_PUBLIC_BASE })
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="client">Приложение</FieldLabel>
                <Select
                  value={settings.client}
                  onValueChange={(value) => update({ client: value as ClientId })}
                >
                  <SelectTrigger id="client" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectGroup>
                      {CLIENTS.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.hint ? `${item.name} — ${item.hint}` : item.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="public-base">Адрес сайта</FieldLabel>
                <FieldDescription>
                  К нему добавляется путь data/subs/…. Для этого репозитория оставьте адрес GitHub Pages.
                </FieldDescription>
                <Input
                  id="public-base"
                  value={baseDraft}
                  onChange={(event) => setBaseDraft(event.target.value)}
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="submit">Сохранить</Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  update({ publicBase: DEFAULT_PUBLIC_BASE })
                  setBaseDraft(DEFAULT_PUBLIC_BASE)
                }}
              >
                Вернуть адрес Pages
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Информация</CardTitle>
          <CardDescription>Снимок, который опубликовал сборщик.</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup className="gap-0">
            {info.map((row, index) => (
              <div key={row.text}>
                {index > 0 && <ItemSeparator />}
                <Item>
                  <ItemMedia variant="icon">
                    <row.icon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="line-clamp-none w-full whitespace-normal">{row.text}</ItemTitle>
                  </ItemContent>
                </Item>
              </div>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Сборщик забирает публичные VLESS-ссылки, проверяет TCP до адреса и порта и публикует
        ответившие. Задержка измерена с раннера сборщика, а не с вашего телефона. Кнопка на экране
        подключения копирует ссылку подписки — сайт не устанавливает VPN-туннель.
      </p>
    </div>
  )
}
