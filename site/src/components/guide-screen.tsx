import { InspectScreen } from '@/components/inspect-screen'
import { SettingsScreen } from '@/components/settings-screen'
import { SiteHeader } from '@/components/site-header'
import { FAILURE_LABELS, formatStamp } from '@/lib/format'
import type { HubData } from '@/lib/types'

function FailureCounts({ data }: { data: HubData | null }) {
  const rejected = data?.stats.rejected
  if (!rejected) return null
  const rows = Object.keys(FAILURE_LABELS)
    .map((key) => ({ key, label: FAILURE_LABELS[key], count: rejected[key] ?? 0 }))
    .filter((row) => row.count > 0)
  if (rows.length === 0) return null
  return (
    <ul className="mt-3 flex flex-col gap-1 text-[13px] text-muted-foreground">
      {rows.map((row) => (
        <li key={row.key} className="flex justify-between gap-3">
          <span>{row.label}</span>
          <span className="tabular-nums">{row.count}</span>
        </li>
      ))}
    </ul>
  )
}

export function GuideScreen({ data }: { data: HubData | null }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <SiteHeader updated={data ? formatStamp(data.generated_at) : undefined} />
      <div className="mb-6 flex flex-col gap-3 text-[15px] leading-relaxed">
        <p>
          V2Hub собирает публичные конфиги VLESS и прокси Telegram, проверяет их и отдаёт списками.
          Сайт не поднимает туннель и не подключается к серверу за вас.
        </p>
        <div className="rounded-2xl bg-card px-4 py-3">
          <p className="font-medium">Как читать результат</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Точка на строке — рабочий или нестабильный конфиг. Пинг — медиана нескольких HTTP-запросов
            через уже запущенный Xray или sing-box, без прогрева. Рядом доля успешных прогонов и
            скорость. «Порт открыт» значит, что TCP ответил, а полный проход в этом запуске не
            выполнялся.
          </p>
        </div>
        <div className="rounded-2xl bg-card px-4 py-3">
          <p className="font-medium">Как забрать конфиги</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            «Экспорт» — файлы по срезу, стране, защите и транспорту, Clash, sing-box и конструктор
            подписки. На «Конфигах» отметьте строки и выгрузите текст, base64, файл, QR, Clash или
            sing-box. QR и кнопки клиента используют только проверенные схемы: Happ, v2rayNG,
            Hiddify, v2RayTun для VLESS; Clash Meta, Mihomo, NekoBox и sing-box — для своих файлов.
          </p>
        </div>
        <div className="rounded-2xl bg-card px-4 py-3">
          <p className="font-medium">Проверка</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Сначала разбор ссылки, затем TCP, рукопожатие ядра, большинство из трёх HTTP-адресов,
            короткая загрузка и чужой адрес выхода. Рабочий — прошёл сейчас и держится хотя бы в 70%
            последних прогонов. Нестабильный прошёл сейчас, но реже. Мёртвый в список не попадает, а
            после нескольких провалов подряд выбывает из пула. Проверка идёт с серверов GitHub Actions
            вне России, поэтому местный провайдер может закрыть то, что здесь открылось.
          </p>
          <FailureCounts data={data} />
        </div>
        <div className="rounded-2xl bg-card px-4 py-3">
          <p className="font-medium">Telegram</p>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Кнопка «В Telegram» открывает tg:// и подставляет прокси. Если клиент не открылся, рядом
            есть HTTPS-ссылка и QR.
          </p>
        </div>
      </div>
      <h2 className="px-1 pb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
        Разбор ссылки
      </h2>
      <InspectScreen embedded />
      <h2 className="mt-6 px-1 pb-2 text-[13px] font-medium tracking-wide text-muted-foreground uppercase">
        Отображение
      </h2>
      <SettingsScreen data={data} embedded />
    </div>
  )
}
