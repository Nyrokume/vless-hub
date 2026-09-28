# Подписки и экспорт

Подписка — это адрес файла со списком. Приложение скачивает его и может обновлять само. Все адреса ниже живут на [сайте](https://nyrokume.github.io/vless-hub/).

На «Экспорте» те же файлы можно скопировать текстом, кодом base64, ссылкой, QR или скачать. С выбранных строк на «Конфигах» выгружается отдельный набор: текст, код, файл, QR, Clash или sing-box.

## Основные списки

| Список | Адрес | Что внутри |
| --- | --- | --- |
| Все рабочие | https://nyrokume.github.io/vless-hub/sub/all.txt | Конфиги, которые прошли проверку и держатся стабильно |
| Рабочие и нестабильные | https://nyrokume.github.io/vless-hub/sub/with-unstable.txt | То же плюс те, что проходят не каждый раз |
| Проверенные | https://nyrokume.github.io/vless-hub/sub/verified.txt | Тот же набор, что у всех рабочих. Адрес оставлен для старых подписок |
| Только открытый порт | https://nyrokume.github.io/vless-hub/sub/unverified.txt | Сервер ответил, полный проход в этот раз не делали |

В начале файла есть служебные строки для приложений: название списка и как часто его обновлять. У рабочих списков интервал 6 часов, у списка с нестабильными — 12.

## Срезы

В адресе страны подставьте код из двух букв, например `DE`. Срезы защиты и типа соединения содержат только VLESS, чтобы Shadowsocks не попадал в список TCP.

| Срез | Пример | Что внутри |
| --- | --- | --- |
| Протокол | https://nyrokume.github.io/vless-hub/sub/protocol/vless.txt | `vless`, `shadowsocks`, `trojan` или `hysteria2` |
| Самые быстрые | https://nyrokume.github.io/vless-hub/sub/top-20.txt | 20, 50 или 100 строк с лучшим пингом. Есть и `sub/top.txt` |
| Страна | https://nyrokume.github.io/vless-hub/sub/country/DE.txt | Одна страна по адресу выхода |
| Защита | https://nyrokume.github.io/vless-hub/sub/security/reality.txt | `reality` или `tls`, только VLESS |
| Тип соединения | https://nyrokume.github.io/vless-hub/sub/transport/ws.txt | Например `tcp`, `ws`, `grpc`, `xhttp`. Только VLESS |
| Страна и защита | https://nyrokume.github.io/vless-hub/sub/combo/DE-reality.txt | Пара страны и Reality или TLS |

Тот же текст в base64 лежит рядом: замените `sub/` на `sub/base64/`. Пример: https://nyrokume.github.io/vless-hub/sub/base64/all.txt

Старые адреса `data/subs/all.txt`, `fast`, `reality`, `tls`, `tcp`, `ws`, `grpc`, `xhttp` остаются, чтобы уже добавленные подписки не оборвались. Новым лучше брать пути из таблицы.

## Файлы для приложений

| Формат | Адрес | Кому |
| --- | --- | --- |
| Clash | https://nyrokume.github.io/vless-hub/sub/clash.yaml | Clash Meta, Mihomo, NekoBox |
| sing-box | https://nyrokume.github.io/vless-hub/sub/singbox.json | sing-box и Hiddify |
| Данные сайта | https://nyrokume.github.io/vless-hub/data/configs.json | Сам сайт: статусы, пинг, страны |
| Краткая статистика | https://nyrokume.github.io/vless-hub/api/stats.json | Числа прогона |
| Метаданные | https://nyrokume.github.io/vless-hub/api/configs.json | То же семейство, без ленты сайта |

## Как добавить в приложение

Кнопка на «Экспорте» открывает приложение и передаёт ему ссылку. Если ничего не открылось, скопируйте адрес и вставьте его вручную.

**Happ.** Нажмите кнопку Happ или добавьте подписку по ссылке. Отдельный конфиг Happ принимает как есть.

**v2RayTun.** Кнопка v2RayTun импортирует ссылку списка или одну строку.

**Hiddify.** Кнопка импортирует обычную подписку, файл Clash и файл sing-box.

**v2rayNG.** Кнопка передаёт ссылку подписки или одну строку. Если приложение не перехватило ссылку, вставьте адрес в разделе подписок.

**Streisand.** Отдельной кнопки нет. Скопируйте ссылку, в приложении нажмите плюс и вставьте её.

**NekoBox.** Скачайте файл Clash на «Экспорте» или с выбранных строк и импортируйте его. Обычную текстовую подписку NekoBox тоже может принять по ссылке.

**Clash Meta и Mihomo.** Им нужен файл Clash, не текстовый список строк. Скачайте `sub/clash.yaml` или откройте его кнопкой на «Экспорте».

**sing-box.** Скачайте `sub/singbox.json` или откройте его кнопкой sing-box.

QR на сайте чёрный на белом. Его можно показать другому телефону или сохранить картинкой.

## Прокси Telegram

| Список | Адрес |
| --- | --- |
| MTProto | https://nyrokume.github.io/vless-hub/tg/mtproto.txt |
| MTProto для браузера | https://nyrokume.github.io/vless-hub/tg/mtproto-https.txt |
| SOCKS | https://nyrokume.github.io/vless-hub/tg/socks.txt |
| SOCKS для браузера | https://nyrokume.github.io/vless-hub/tg/socks-https.txt |
| Все ссылки Telegram | https://nyrokume.github.io/vless-hub/tg/all.txt |
| Рабочие и нестабильные | https://nyrokume.github.io/vless-hub/tg/with-unstable.txt |
| Ссылки для браузера | https://nyrokume.github.io/vless-hub/tg/https.txt |
| Данные | https://nyrokume.github.io/vless-hub/api/proxies.json |

Есть и короткие топы: `tg/top-20.txt`, `tg/top-50.txt` и такие же файлы отдельно для MTProto и SOCKS.

На сайте кнопка строки открывает `tg://` и подставляет прокси в Telegram. Ссылка для браузера имеет вид `https://t.me/proxy` или `https://t.me/socks`: её можно открыть, если приложение по `tg://` не запустилось.
