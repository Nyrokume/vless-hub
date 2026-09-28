import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { SettingsScreen } from '@/components/settings-screen'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { FAILURE_LABELS, formatStamp } from '@/lib/format'
import type { HubData } from '@/lib/types'

const HELP = [
  {
    title: 'V2Hub',
    body: 'Публичные конфиги VLESS и прокси Telegram. Сайт не поднимает туннель и не подключается к серверу за вас.',
  },
  {
    title: 'Как читать результат',
    body: 'Точка на строке — рабочий или нестабильный конфиг. Пинг — медиана HTTP-запросов через Xray или sing-box. «Порт открыт» значит, что TCP ответил, а полный проход в этом запуске не выполнялся.',
  },
  {
    title: 'Как забрать конфиги',
    body: '«Экспорт» — срезы, страны, защита, транспорт, Clash и sing-box. На «Конфигурации Vless» отметьте строки и выгрузите текст, base64, файл, QR, Clash или sing-box.',
  },
  {
    title: 'Проверка',
    body: 'Разбор ссылки, TCP, рукопожатие, HTTP, короткая загрузка и адрес выхода. Рабочий прошёл сейчас и держится хотя бы в 70% последних прогонов. Нестабильный прошёл сейчас, но реже. Мёртвый в список не попадает. Проверка идёт с GitHub Actions вне России.',
  },
  {
    title: 'Telegram',
    body: 'Кнопка открывает tg://. Если клиент не открылся, рядом есть HTTPS и QR.',
  },
]

export function GuideScreen({
  data,
  onRefresh,
}: {
  data: HubData | null
  onRefresh?: () => Promise<void>
}) {
  const [help, setHelp] = useState(false)
  if (help) return <HelpScreen data={data} onBack={() => setHelp(false)} />
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader />
      <p className="mb-3 text-xs text-muted-foreground">{data ? formatStamp(data.generated_at) : 'Настройки'}</p>
      <SettingsScreen data={data} embedded onOpenHelp={() => setHelp(true)} onRefresh={onRefresh} />
    </div>
  )
}

function HelpScreen({ data, onBack }: { data: HubData | null; onBack: () => void }) {
  const rejected = data?.stats.rejected
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Назад" onClick={onBack}>
          <ChevronLeft />
        </Button>
        <h1 className="text-[17px] font-semibold">Справка</h1>
      </div>
      <div className="flex flex-col gap-3">
        {HELP.map((item) => (
          <section key={item.title} className="rounded-2xl bg-card px-4 py-3">
            <h2 className="text-[15px] font-medium">{item.title}</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{item.body}</p>
          </section>
        ))}
        {rejected && (
          <section className="rounded-2xl bg-card px-4 py-3">
            <h2 className="text-[15px] font-medium">Почему отброшено</h2>
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-muted-foreground">
              {Object.keys(FAILURE_LABELS)
                .map((key) => ({ key, label: FAILURE_LABELS[key], count: rejected[key] ?? 0 }))
                .filter((row) => row.count > 0)
                .map((row) => (
                  <li key={row.key} className="flex justify-between gap-3">
                    <span>{row.label}</span>
                    <span className="tabular-nums">{row.count}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
