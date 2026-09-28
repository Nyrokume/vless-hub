import { InspectScreen } from '@/components/inspect-screen'
import { SettingsScreen } from '@/components/settings-screen'
import { SiteHeader } from '@/components/site-header'
import { formatStamp } from '@/lib/format'
import type { HubData } from '@/lib/types'

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
            В список попадает ответ HTTP 200 или 204 через Xray. Задержка — время этого запроса с
            машины сборщика. Аптайм — доля успешных проверок. «Порт открыт» значит, что TCP ответил,
            а HTTP через Xray в этом прогоне не проверялся: такие строки скрыты, пока не включить
            «Непроверенные».
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
