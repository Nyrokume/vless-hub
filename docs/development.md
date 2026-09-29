# Разработка

V2Hub состоит из сборщика на Python и сайта на React. Сборщик читает публичные списки, проверяет ссылки и кладёт файлы в `publish/`. Сайт эти файлы показывает. На GitHub Pages уезжает собранный `site/dist`.

## Структура

| Путь | Зачем |
| --- | --- |
| `vlesshub/` | Сбор, разбор, проверка, экспорт |
| `sources.yaml` | Откуда брать ссылки и лимиты прогона |
| `tests/` | Проверки сборщика и текст интерфейса |
| `site/` | Сайт: вкладки, строки, подписки |
| `site/src/lib/ru.ts` | Все строки интерфейса |
| `site/src/version.ts` | Версия в строке «Настроек» |
| `state/` | Сжатая история проверок. Её хранит кэш Actions |
| `publish/` | Результат прогона. В git не входит |
| `site/dist/` | Сборка сайта. В git не входит |
| `.github/workflows/update.yml` | Тесты, прогон, деплой |

Версия продукта `1.0.0` записана в `pyproject.toml`, `vlesshub/__init__.py`, `site/package.json` и `site/src/version.ts`. Отдельно в данных проверки стоит штамп сборщика `2.0.0` (`vlesshub/export.py`). В «Настройках» он виден в строке «Проверка», рядом со способом замера.

## Как идёт прогон

1. `vlesshub/collect.py` скачивает источники из `sources.yaml`.
2. `vlesshub/parser.py` достаёт ссылки и отбрасывает мусор. Одинаковые серверы схлопываются.
3. `vlesshub/rank.py` решает, кого проверять: сначала уже рабочие, затем новые, затем повтор неудачных. Пинг меньше 15 мс из старых прогонов — это замер открытия порта, не ответ сайта, поэтому такие строки идут после надёжных.
4. `vlesshub/probe.py` и `vlesshub/stages.py` гоняют порт, подключение, сайт, скорость и адрес выхода. Hysteria2 идёт через sing-box, остальное — через Xray.
5. `vlesshub/stability.py` ведёт окно из 10 результатов. `vlesshub/pipeline.py` публикует только то, что прошло все ступени в этом прогоне. Прошлый успех, который сейчас не прошёл, в список не остаётся.
6. `vlesshub/tgcollect.py` и `vlesshub/tgprobe.py` делают то же для прокси Telegram.
7. `vlesshub/export.py` пишет `sub/`, `tg/`, `api/`, `data/configs.json` и короткий `data/version.json`.
8. Сборка Vite копирует эти папки в `site/dist`. Их отдаёт Pages. Состояние проверки между прогонами лежит в кэше Actions, а не в новом коммите, чтобы история git не росла каждый раз.

Код выхода `2` значит: в этом прогоне никто не прошёл прокси, а история уже знает рабочие. Состояние сохраняется, сайт не затирается.

В пуле прокси 12 процессов Xray, в каждом до 24 конфигов. Hysteria2 идёт пачками не больше 8. Полный прогон рассчитан на лимит job 55 минут и обычно занимает несколько минут, поэтому расписание стоит на 15 минут. Следующий прогон ждёт, если предыдущий ещё идёт. Отдельная матрица job не используется: серия и история общие.

## Локальный запуск

```bash
pip install -r requirements.txt
python -m pytest
python -m vlesshub run --out publish --site site
cd site && npm ci && npm run build
```

Полный прогон качает Xray, sing-box и базу стран. Для короткой проверки без этого:

```bash
python -m vlesshub run --out publish --site site --max-tcp 20 --max-proxy 0 --max-tg 0 --skip-download
```

Одну ссылку можно разобрать так:

```bash
python -m vlesshub parse 'vless://…'
```

Проверка опубликованного списка с этой машины, без нового сбора источников:

```bash
python -m vlesshub check-local --out local-working.txt
```

`--list-only` только печатает `адрес:порт` и ничего не качает. `--limit 20` берёт первые 20 строк. На Termux то же самое делает `bash scripts/termux-check.sh`. Xray и sing-box скачиваются в `bin/`, этот каталог в git не входит.

Кнопка «Проверить на сервере» на сайте вызывает `workflow_dispatch` для `.github/workflows/update.yml`. Токен fine-grained хранится только в `localStorage` браузера владельца (`vless-hub-actions-token`), в репозиторий не коммитится. Ему нужно право Actions на запись и только этот репозиторий. Без токена сайт открывает страницу Actions.

Сайт в разработке: `cd site && npm run dev`. Он читает файлы из `publish/`.

## CI

Workflow `.github/workflows/update.yml` запускается по расписанию `7,22,37,52 * * * *`, вручную и при push в `main`.

- Job `check` гоняет pytest и сборку сайта.
- Job `build` собирает и проверяет конфиги. Состояние проверки пишется в кэш Actions `probe-state-`, а не в новый коммит.
- `data/stability.json` остаётся в артефакте Pages и в git не добавляется.
- Job `deploy` выкладывает `site/dist` на Pages.

Ручной запуск принимает лимиты TCP и прокси. Пустые поля значат лимиты из `sources.yaml`. Группа `vless-hub-pages` не обрывает уже идущий прогон. Состояние между прогонами лежит в кэше Actions, поэтому прогон не пушит коммит и не запускает сам себя.

## Как добавить источник

В `sources.yaml` скопируйте блок и задайте уникальное `name`.

Обычный список:

```yaml
- name: example-vless
  type: subscription
  enabled: true
  url: https://example.com/vless.txt
```

Канал Telegram, без токена. Берётся публичная лента `https://t.me/s/<channel>`:

```yaml
- name: tg-example
  type: telegram
  enabled: true
  channel: example
```

Прокси Telegram. `kind: telegram-proxy` отделяет их от конфигов:

```yaml
- name: example-mtproto
  kind: telegram-proxy
  type: subscription
  enabled: true
  url: https://example.com/mtproto.txt
```

`enabled: false` выключает источник, не удаляя запись. `limit` ограничивает, сколько ссылок брать. Тип `subscription` подходит и сырому файлу, и подписке в base64.

Чтобы источник участвовал в «Живом парсе», добавьте его URL в `site/src/lib/live-sources.ts`. Страницы Telegram туда попадают с пометкой пропуска: браузер их не читает из‑за ограничений сайта Telegram.

Источник с почти нулевым выходом два прогона подряд отодвигается в конец очереди. Три прогона без ответа или без рабочих конфигов ставят его на паузу, затем он пробуется снова. Это пишет `state/source_health.json` в кэше Actions, файл `sources.yaml` при этом не меняется.

## Тесты

`python -m pytest` проверяет разбор, ступени, статусы, экспорт и то, что интерфейс не показывает сырые коды отказов. Тест `tests/test_ui_copy.py` падает, если компонент рисует ключ вроде `tcp_refused` или `timeout` вместо русской подписи.

Перед push в `main` имеют смысл оба шага: `python -m pytest` и `npm run build --prefix site`. Push сам запускает полный прогон и деплой.
