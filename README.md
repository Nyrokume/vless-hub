# V2Hub

Публичный агрегатор VLESS, Shadowsocks, Trojan, Hysteria2 и прокси Telegram. Сайт на React и shadcn/ui, сборщик на Python: VLESS, Shadowsocks и Trojan проходят HTTP через Xray, Hysteria2 — через sing-box, MTProto и SOCKS проверяются рукопожатием до датацентра Telegram.

Страница: https://nyrokume.github.io/vless-hub/

Сборщик только читает уже опубликованные ссылки, измеряет их с раннера и выкладывает списки. Он не поднимает туннель в браузере и не обещает, что адрес останется рабочим.

## Что публикуется

В списке только ответы HTTP 200/204 через Xray или sing-box (`generate_204`). Это VLESS, Shadowsocks, Trojan и Hysteria2. Открытый TCP-порт без такой проверки попадает в `sub/unverified.txt` и скрыт на сайте, пока не включить «Непроверенные». Hysteria2 — UDP, поэтому TCP-предфильтр для него не используется. Задержка — время этого HTTP-запроса. Имя в подписке собирается заново: флаг, страна по GeoIP, протокол, транспорт и измеренные миллисекунды. Страна и задержка из замечания ссылки не используются.

## Как разбирается и проверяется ссылка

1. Из текста, HTML и base64-подписки достаются `vless://`, `ss://`, `trojan://` и `hysteria2://`.
2. Shadowsocks читается как SIP002: userinfo в base64 бывает с `=`, без padding и с `%3D%3D`. Старая форма `ss://base64(method:password@host:port)` тоже принимается. У VLESS `type=http` вместе с `mode` (`packet-up`, `stream-one`, `stream-up`, `auto`) или `extra` — это XHTTP, JSON из `extra` уходит в Xray. `type=raw` — это TCP. Пустые `fp=` и `headerType=` не ломают разбор. `headerType=http` сохраняет список хостов. Регистр `allowInsecure` / `headertype` не важен, лишний `&` в начале query пропускается.
3. Мусор вычищается. В `alpn` остаются только `h3`, `h2`, `http/1.1`, `http/1.0`. В `host` — только правдоподобные имена и IP. Параметры вроде `Telegram=@…` отбрасываются. Обрезанная ссылка, не-UUID у VLESS, Reality без нормального `pbk` и имени `sni`, порт вне 1–65535 не проходят дальше.
4. Одинаковые серверы с разным `fp`, замечанием или порядком параметров схлопываются. Из вариантов отпечатка остаётся `chrome`.
5. TCP — только предфильтр для VLESS, Shadowsocks и Trojan. Дальше один HTTP-запрос через уже запущенный Xray (или sing-box для Hysteria2). Задержка — время до первого байта ответа, без старта процесса и без повторов curl. Hysteria2 проверяется сразу, в том числе с `obfs=salamander`. В опубликованные списки попадает только успешный ответ. Отказ сокета — `dead`, нет ответа вовремя — `timeout`. Конфиг, который не влез в лимит прогона, не считается мёртвым.
6. У каждого источника считается доля прошедших проверку. Два прогона подряд почти без рабочих ссылок отодвигают его в конец очереди, чтобы место досталось живым источникам. Счётчики `parse_error`, `invalid_field`, `dead` и `timeout` пишутся в статистику.

Прокси Telegram публикуются после `resPQ` (MTProto) или SOCKS5 CONNECT до `149.154.167.51:443` и того же запроса.

## Адреса

Канонические файлы:

| Файл | Содержание |
| --- | --- |
| `/sub/all.txt` | рабочие конфиги всех протоколов |
| `/sub/protocol/vless.txt` | только VLESS |
| `/sub/protocol/shadowsocks.txt` | только Shadowsocks |
| `/sub/protocol/trojan.txt` | только Trojan |
| `/sub/protocol/hysteria2.txt` | только Hysteria2 |
| `/sub/verified.txt` | тот же список |
| `/sub/unverified.txt` | только открытый порт |
| `/sub/top-20.txt`, `top-50.txt`, `top-100.txt` | самые быстрые |
| `/sub/country/DE.txt` | страна |
| `/sub/security/reality.txt` | security |
| `/sub/transport/ws.txt` | транспорт |
| `/sub/combo/DE-reality.txt` | страна и security |
| `/sub/base64/…` | те же списки в base64 |
| `/sub/clash.yaml` | Clash Meta / Mihomo |
| `/sub/singbox.json` | sing-box |
| `/api/configs.json`, `/api/stats.json` | метаданные VLESS |
| `/tg/mtproto.txt`, `/tg/socks.txt`, `/tg/all.txt` | `tg://` |
| `/tg/mtproto-https.txt`, `/tg/https.txt` | `https://t.me/proxy` и `t.me/socks` |
| `/api/proxies.json` | метаданные Telegram |

Старые адреса `data/subs/all.txt`, `all.b64.txt`, `fast`, `reality`, `tls`, `tcp`, `ws`, `grpc`, `xhttp` остаются в артефакте Pages. Срезы `reality`, `tls` и транспортов — только VLESS, чтобы Shadowsocks не попадал в `tcp`. `data/configs.json` кормит сайт. Эти файлы не коммитятся: в git лежит только компактное состояние `state/history.json`, `state/tg_history.json`, `state/geo_cache.json`, `state/source_health.json`.

## Сайт

Тёмная тема — чёрный фон и белый текст, светлая — белый фон и чёрный текст. Первый заход смотрит `prefers-color-scheme`, переключатель запоминает выбор. Вкладки: «Конфигурации Vless», «Telegram Proxy», «Экспорт», «Настройки». В шапке — время последнего обновления текстом. Список по умолчанию сгруппирован по странам: флаг, название, число и лучший пинг, внутри группы пинг по возрастанию. Порядок стран переключается между числом и лучшим пингом, рядом есть плоский список с общей сортировкой. Длинный список рисуется окном, QR собирается только по нажатию. Строка показывает проверку через Xray, задержку и аптайм. «Экспорт» отдаёт файлы по срезу, конструктор подписки и схемы клиентов. На «Конфигурации Vless» можно отметить строки и выгрузить текст, base64, файл, QR, Clash или sing-box. QR чёрный на белом, со скачиванием PNG. Схемы только проверенные: Happ, v2rayNG, Hiddify, v2RayTun, NekoBox, Clash Meta, Mihomo, sing-box. «В Telegram» открывает `tg://`. «Настройки» хранят вид списка; «Справка» коротко объясняет задержку и то, что сайт не поднимает VPN.

## Запуск

```bash
pip install -r requirements.txt
python -m pytest
python -m vlesshub run --out publish --site site
cd site && npm ci && npm run build
```

Полный прогон качает Xray, sing-box и GeoIP, проверяет до 20000 TCP и 12000 прокси (Xray и sing-box параллельно) и до 160 прокси Telegram. Бюджет идёт по кругу: сначала ещё не проверенные, затем давно не перепроверенные рабочие, потом повтор неудачных. Конфиг, который уже прошёл HTTP и в этом прогоне не падал, остаётся в полном списке. `all.txt` и файлы стран отсортированы по пингу, без обрезки. Для короткой проверки: `--max-tcp 20 --max-proxy 0 --max-tg 0`. Код выхода 2 значит, что в этом прогоне нет прокси-проверенных конфигов, а история уже знает рабочие: состояние сохраняется, сайт не затирается.

Расписание — `.github/workflows/update.yml`, cron `17 */6 * * *` и ручной запуск. Один workflow гоняет тесты, сборщик, сборку React и деплой на Pages.
