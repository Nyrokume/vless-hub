import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { SettingsScreen } from '@/components/settings-screen'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { formatStamp } from '@/lib/format'
import type { HubData } from '@/lib/types'

const HELP = [
  {
    title: 'V2Hub',
    body: 'Публичные конфиги VLESS и прокси Telegram. Сайт не поднимает VPN и не подключается к серверу за вас.',
  },
  {
    title: 'Как читать результат',
    body: 'В список попадает ответ HTTP 200 или 204. Задержка — время этого запроса с машины сборщика, не пинг вашего телефона.',
  },
  {
    title: 'Как забрать конфиги',
    body: '«Экспорт» — срезы, страны, защита, транспорт, Clash и sing-box. На «Конфигурации Vless» отметьте строки и выгрузите их.',
  },
  {
    title: 'Telegram',
    body: 'Кнопка открывает tg://. Если клиент не открылся, рядом есть HTTPS и QR.',
  },
]

export function GuideScreen({ data }: { data: HubData | null }) {
  const [help, setHelp] = useState(false)
  if (help) return <HelpScreen onBack={() => setHelp(false)} />
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={data ? formatStamp(data.generated_at) : undefined} />
      <h1 className="px-1 pb-5 text-[28px] leading-none font-semibold tracking-tight">Настройки</h1>
      <SettingsScreen data={data} embedded onOpenHelp={() => setHelp(true)} />
    </div>
  )
}

function HelpScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={onBack}>
        <ChevronLeft data-icon="inline-start" />
        Настройки
      </Button>
      <h1 className="px-1 pb-6 text-[28px] leading-none font-semibold tracking-tight">Справка</h1>
      <div className="flex flex-col gap-6">
        {HELP.map((item) => (
          <section key={item.title}>
            <h2 className="text-[15px] font-medium">{item.title}</h2>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{item.body}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
