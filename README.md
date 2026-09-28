# V2Hub

Публичный агрегатор VLESS и прокси Telegram. Сайт на React и shadcn/ui, сборщик на Python: конфиги проходят HTTP через Xray, MTProto и SOCKS проверяются рукопожатием до датацентра Telegram.

Страница: https://nyrokume.github.io/vless-hub/

Сборщик только читает уже опубликованные ссылки, измеряет их с раннера и выкладывает списки. Он не поднимает туннель в браузере и не обещает, что адрес останется рабочим.

## Что публикуется

В списке VLESS только ответы HTTP 200/204 через Xray (`generate_204`). Открытый TCP-порт без такой проверки попадает в `sub/unverified.txt` и скрыт на сайте, пока не включить «Непроверенные». Задержка — время этого HTTP-запроса.

Прокси Telegram публикуются после `resPQ` (MTProto) или SOCKS5 CONNECT до `149.154.167.51:443` и того же запроса.

## Адреса

Канонические файлы:

| Файл | Содержание |
| --- | --- |
| `/sub/all.txt` | рабочие VLESS |
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

Старые адреса `data/subs/all.txt`, `all.b64.txt`, `fast`, `reality`, `tls`, `tcp`, `ws`, `grpc`, `xhttp` остаются в артефакте Pages и ведут на те же рабочие списки. `data/configs.json` кормит сайт. Эти файлы не коммитятся: в git лежит только компактное состояние `state/history.json`, `state/tg_history.json`, `state/geo_cache.json`.

## Сайт

Тёмная тема — чёрный фон и белый текст, светлая — белый фон и чёрный текст. Первый заход смотрит `prefers-color-scheme`, переключатель запоминает выбор. Вкладки: «Конфиги», «Telegram Proxy», «Экспорт», «Инструкции». В шапке — время последнего обновления текстом. Список показывает проверку через Xray, задержку и аптайм. «Экспорт» отдаёт файлы по срезу, конструктор подписки и схемы клиентов. На «Конфигах» можно отметить строки и выгрузить текст, base64, файл, QR, Clash или sing-box. QR чёрный на белом, со скачиванием PNG. Схемы только проверенные: Happ, v2rayNG, Hiddify, v2RayTun, NekoBox, Clash Meta, Mihomo, sing-box. «В Telegram» открывает `tg://`. «Инструкции» разбирают `vless://` локально.

## Запуск

```bash
pip install -r requirements.txt
python -m pytest
python -m vlesshub run --out publish --site site
cd site && npm ci && npm run build
```

Полный прогон качает Xray и GeoIP, проверяет до 1000 TCP и 400 прокси и до 160 прокси Telegram. Для короткой проверки: `--max-tcp 20 --max-proxy 0 --max-tg 0`. Код выхода 2 значит, что в этом прогоне нет прокси-проверенных VLESS, а история уже знает рабочие: состояние сохраняется, сайт не затирается.

Расписание — `.github/workflows/update.yml`, cron `17 */6 * * *` и ручной запуск. Один workflow гоняет тесты, сборщик, сборку React и деплой на Pages.
