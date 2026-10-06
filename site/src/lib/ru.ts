/** Every string the site shows. Protocol names stay as VLESS, TCP, WS, gRPC, Reality. */

import { formatCount, plural, pluralCategory, type PluralForms } from './plural.ts'

export const RAW_KEYS = [
  'parse_error',
  'invalid_field',
  'tcp_refused',
  'timeout',
  'tls_fail',
  'reality_fail',
  'handshake_fail',
  'http_fail',
  'no_data',
  'exit_ip_leak',
  'mtproto_fail',
  'socks_fail',
  'unsupported_protocol',
  'export_mismatch',
  'flaky',
  'dead',
  'working',
  'unstable',
  'xray-http',
] as const

export type RawKey = (typeof RAW_KEYS)[number]

const reasons = {
  parse_error: 'Ссылка не разобралась',
  invalid_field: 'Ошибка в поле',
  tcp_refused: 'Сервер отклонил подключение',
  timeout: 'Нет ответа',
  tls_fail: 'Ошибка TLS',
  reality_fail: 'Ошибка Reality',
  handshake_fail: 'Не удалось подключиться',
  http_fail: 'не прошёл HTTP-проверку',
  no_data: 'низкая скорость',
  exit_ip_leak: 'не совпал выходной IP',
  mtproto_fail: 'MTProto не ответил',
  socks_fail: 'SOCKS не открыл туннель',
  unsupported_protocol: 'Протокол не поддерживается',
  export_mismatch: 'ссылка после сборки не совпала',
  flaky: 'не прошёл повтор',
  dead: 'Не работает',
} as const

const statuses = {
  working: 'Рабочий',
  unstable: 'Нестабильный',
  dead: 'Не работает',
} as const

const probes = {
  'xray-http': 'Через прокси',
} as const

const noun = {
  config: ['конфиг', 'конфига', 'конфигов'],
  country: ['страна', 'страны', 'стран'],
  link: ['ссылка', 'ссылки', 'ссылок'],
  uniqueLink: ['уникальная ссылка', 'уникальные ссылки', 'уникальных ссылок'],
  port: ['порт', 'порта', 'портов'],
  proxyCheck: ['проверка через прокси', 'проверки через прокси', 'проверок через прокси'],
  working: ['рабочий', 'рабочих', 'рабочих'],
  checked: ['проверенного', 'проверенных', 'проверенных'],
  newOne: ['новый', 'новых', 'новых'],
  source: ['источник', 'источника', 'источников'],
} as const satisfies Record<string, PluralForms>

export const ru = {
  brand: 'V2Hub',
  loading: 'Загружаем список…',
  noData: 'Нет данных',
  retry: 'Повторить',
  loadFailed: 'Не удалось загрузить данные',
  dataBroken: 'Файл данных повреждён',
  refreshFailed: 'Не удалось обновить',
  refreshed: 'Обновлено',
  refreshedNew: (count: number) => `Обновлено · +${plural(count, noun.newOne)}`,
  listUpdated: (added: number, removed: number) =>
    added === 0 && removed === 0
      ? 'Список обновлён'
      : `Список обновлён: +${formatCount(added)} / −${formatCount(removed)}`,
  updatedAgo: (age: string) => `обновлено ${age}`,
  noLongerWorks: 'Больше не работает',
  updateAvailable: 'Есть обновление',
  refresh: 'Обновить',
  reachProgress: (done: number, total: number) => `Проверяю ${formatCount(done)} из ${formatCount(total)}…`,
  reachSummary: (open: number, total: number) =>
    `С вашей сети доступны ${formatCount(open)} из ${formatCount(total)}`,
  reachOpen: 'Доступен у вас',
  reachClosed: 'Недоступен у вас',
  reachSkip: 'не проверяется в браузере',
  reachNone: 'В списке нечего проверять',
  reachNote:
    'Доступен только адрес, у которого браузер закончил TLS или открыл WebSocket. Мгновенный отказ, ошибка DNS и тишина — недоступен. Это не полная проверка протокола.',
  onlyReachable: 'Только доступные у меня',
  gateTitle: 'Ищу доступные серверы',
  gateFound: (count: number) => `найдено ${formatCount(count)}`,
  gateProgress: (done: number, total: number, found: number, need: number) =>
    `Проверено ${formatCount(done)} из ${formatCount(total)} · найдено ${formatCount(found)} из ${formatCount(need)}`,
  gateShortTitle: 'Меньше пяти серверов',
  gateShort: 'С вашей сети не набралось пяти доступных адресов.',
  gateUdp: 'Hysteria2 и TUIC браузер не проверяет, поэтому их нет в этом списке.',
  themeDark: 'Тёмная тема',
  themeLight: 'Светлая тема',
  close: 'Закрыть',
  copyFailed: 'Не удалось скопировать',
  copied: 'Скопировано',
  linkCopied: 'Ссылка скопирована',
  nothingFound: 'Ничего не нашлось',
  showCount: (count: number) => `Показать ${formatCount(count)}`,
  noProxies: 'Проверенных прокси нет.',
  tabs: {
    configs: 'Конфиги',
    telegram: 'Telegram',
    export: 'Экспорт',
    settings: 'Настройки',
    nav: 'Разделы',
  },
  menu: 'Меню',
  filters: 'Фильтры',
  resetFilters: 'Сбросить фильтры',
  searchConfigs: 'Поиск конфигов',
  searchConfigsPlaceholder: 'Страна, адрес, соединение',
  searchProxies: 'Поиск прокси',
  searchProxiesPlaceholder: 'Адрес или страна',
  select: 'Выбрать',
  doneSelecting: 'Закончить выбор',
  liveParse: 'Живой парс',
  showUnverified: 'Показать непроверенные',
  showUnstable: 'Показать нестабильные',
  selectShown: 'Выбрать показанные',
  selected: (count: number) => `Выбрано ${plural(count, noun.config)}`,
  clear: 'Снять',
  text: 'Текст',
  encoded: 'Код',
  encodedCopied: 'Код скопирован',
  file: 'Файл',
  qr: 'QR-код',
  qrShort: 'QR',
  qrBuilding: 'Строим QR…',
  qrFailed: 'Не удалось построить QR',
  qrLong: 'Ссылка длинная, код получится плотным. Надёжнее скопировать её текстом.',
  qrHint: 'Код чёрный на белом, чтобы его можно было сканировать. Сайт не поднимает туннель.',
  qrTooLong: 'Для QR выберите короткую подборку. Длинный список скачивается файлом.',
  copiedCount: (count: number) => `Скопировано ${plural(count, noun.config)}`,
  picture: 'Картинка',
  share: 'Поделиться',
  copy: 'Копировать',
  details: 'Подробности',
  choose: (title: string) => `Выбрать ${title}`,
  qrOf: (title: string) => `QR-код ${title}`,
  detailsOf: (title: string) => `Подробности ${title}`,
  copyOf: (title: string) => `Скопировать ${title}`,
  openIn: (name: string) => `Открыть в ${name}`,
  clientFallback: 'клиенте',
  openInTelegram: (title: string) => `Открыть ${title} в Telegram`,
  copyHttps: 'Скопировать ссылку',
  httpsCopied: 'Ссылка скопирована',
  qrProxy: 'QR прокси',
  inTelegram: 'В Telegram',
  bestInTelegram: (place: string, ping: string) => `Лучший в Telegram · ${place} · ${ping}`,
  country: 'Страна',
  allCountries: 'Все страны',
  all: 'Все',
  kinds: { all: 'Все', mtproto: 'MTProto', socks: 'SOCKS' },
  tgAllLinks: 'Все ссылки Telegram',
  tgBrowserLinks: 'Ссылки для браузера',
  view: 'Вид',
  sort: 'Сортировка',
  ping: 'Пинг',
  protocol: 'Протокол',
  connection: 'Тип соединения',
  security: 'Защита',
  expandGroups: 'Развернуть все',
  collapseGroups: 'Свернуть все',
  noCountry: 'Без страны',
  listSummary: (configs: number, countries: number) =>
    `${plural(configs, noun.config)} · ${plural(countries, noun.country)}`,
  telegramCounts: (mtproto: number, socks: number) =>
    `${plural(mtproto, ['MTProto', 'MTProto', 'MTProto'])} · ${plural(socks, ['SOCKS', 'SOCKS', 'SOCKS'])}`,
  portOpen: 'только открытый порт',
  fromRussia: 'есть из России',
  noun,
  fields: {
    address: 'Адрес',
    port: 'Порт',
    connection: 'Тип соединения',
    security: 'Защита',
    serverName: 'Имя сервера',
    flow: 'Поток',
    path: 'Путь',
    headerName: 'Имя в заголовке',
    service: 'Имя службы',
    tlsPrint: 'Отпечаток TLS',
    id: 'Идентификатор',
    name: 'Название',
    ipCountry: 'Страна IP',
    countryMark: 'Метка страны',
    fromName: 'Флаг в названии',
    fromAddress: 'По адресу сервера',
    stability: 'Стабильность',
    speed: 'Скорость',
    handshake: 'Подключение',
    status: 'Статус',
    list: 'Список',
    checked: 'Проверено',
    yours: 'С вашей сети',
    core: 'Ядро',
    opened: 'Другие точки',
    publicKey: 'Ключ Reality',
    shortId: 'Короткий код',
    fingerprint: 'Отпечаток',
  },
  copyConfig: 'Ссылка конфига скопирована',
  copyLink: 'Скопировать ссылку',
  linkOnly: 'Только ссылка',
  slices: 'Срезы',
  protocols: 'Протоколы',
  countries: 'Страны',
  securityAndConnection: 'Защита и соединение',
  allVerified: 'Все проверенные',
  withUnstable: 'Вместе с нестабильными',
  top: (count: number) => `Топ ${formatCount(count)}`,
  linkForClientOnly: 'Для этого клиента есть только ссылка',
  subscriptionCopied: 'Ссылка скопирована',
  buildSubscription: 'Собрать подписку',
  inListNow: (count: number) => `Сейчас в списке ${plural(count, noun.config)}`,
  copySelection: 'Ссылка подборки скопирована',
  selection: 'Подборка',
  downloadCount: (count: number) => `Скачать ${plural(count, noun.config)}`,
  any: 'все',
  copySubscription: 'Ссылка подписки скопирована',
  copySubscriptionUrl: 'Скопировать ссылку',
  copyEncodedUrl: 'Скопировать ссылку на код',
  encodedUrlCopied: 'Ссылка на код скопирована',
  copyAllLinks: 'Скопировать все ссылки',
  copiedConfigs: (count: number) => `Скопировано ${plural(count, noun.config)}`,
  subscriptionQr: 'QR подписки',
  allSubscriptions: 'Все подписки',
  settings: {
    client: 'Клиент',
    app: 'Приложение',
    siteAddress: 'Адрес сайта',
    info: 'Информация',
    version: (version: string) => `Версия: ${version}`,
    check: (value: string) => `Проверка: ${value}`,
    lastRun: (value: string) => `Последний запуск: ${value}`,
    pingMeaning: 'Пинг — время ответа сайта, без времени подключения',
    inList: (published: number, tested: number) =>
      `${plural(published, noun.working)} из ${plural(tested, noun.checked)}`,
    inListEmpty: '—',
    countryLine: (countries: number) => plural(countries, noun.country),
    countryEmpty: '—',
    guide: 'Инструкции',
    sources: 'Источники',
    sourceError: 'ошибка',
    lowYield: 'низкий выход',
    autoDisabled: 'выключен',
    about: 'Об авторе',
    aboutText: 'Самоучка: Rust, фронтенд, бэкенд, Python, AI, навыки для агентов, промпты.',
    github: 'GitHub',
    repo: 'Репозиторий',
    versionShort: (version: string) => `Версия ${version}`,
    updated: (stamp: string) => `обновлено ${stamp}`,
    save: 'Сохранить',
    restoreAddress: 'Вернуть обычный адрес',
    dash: '—',
    logs: 'Логи',
    dropped: 'Отброшено',
    collected: (count: number) => `Собрано ${plural(count, noun.link)}`,
    unique: (count: number) => plural(count, noun.uniqueLink),
    portsChecked: (count: number) =>
      pluralCategory(count) === 'one'
        ? `Проверен ${formatCount(count)} порт`
        : `Проверено ${plural(count, noun.port)}`,
    proxyChecked: (count: number) => plural(count, noun.proxyCheck),
    published: (count: number) => `${plural(count, noun.working)} в списке`,
    duration: (seconds: number) => {
      const whole = Math.max(0, Math.round(seconds))
      const minutes = Math.floor(whole / 60)
      const rest = whole % 60
      if (minutes === 0) return `${rest} с`
      return `${minutes} мин ${rest} с`
    },
    sourceMeta: (links: number, kept: number, verified: number, yieldPct: string) =>
      `${plural(links, noun.link)} · разобрано ${formatCount(kept)} · ${plural(verified, noun.working)} · выход ${yieldPct}`,
  },
  guideItems: [
    {
      id: 'list',
      title: 'Список конфигов',
      body: 'На первой вкладке — только конфиги, которые прошли проверку на сервере и открылись с вашей сети. Поиск ищет страну и адрес. Страны свёрнуты. Долгое нажатие включает выбор нескольких строк. Залитая точка — конфиг прошёл все ступени.',
    },
    {
      id: 'colors',
      title: 'Цвета, проценты и скорость',
      body: 'Пинг — сколько миллисекунд сайт отвечает уже после подключения. Зелёный быстрее 300 мс, жёлтый от 300 до 800, красный медленнее. Процент — какая доля последних проверок прошла. Скорость — как быстро скачался короткий файл. В список попадает только то, что прошло все ступени в этом прогоне.',
    },
    {
      id: 'apps',
      title: 'Подписка в приложение',
      body: 'Откройте «Экспорт», выберите список и нажмите кнопку приложения. Если оно не открылось, скопируйте ссылку и вставьте её сами. Happ, v2RayTun, Hiddify и v2rayNG принимают ссылку подписки. В Streisand нажмите плюс и вставьте скопированную ссылку. NekoBox и Clash берут файл Clash: его можно скачать на «Экспорте» или с выбранных строк. sing-box берёт свой файл там же.',
    },
    {
      id: 'telegram',
      title: 'Прокси Telegram',
      body: 'На вкладке Telegram — только прокси, которые в этом прогоне дошли до серверов Telegram. SOCKS должен открыть туннель и получить ответ. MTProto должен пройти рукопожатие. Просто открытый порт в список не попадает. Кнопка открывает Telegram и подставляет прокси. Если приложение не открылось, скопируйте ссылку или покажите QR.',
    },
    {
      id: 'live',
      title: 'Живой парс',
      body: 'Пункт «Живой парс» в меню «Конфигов» читает открытые списки в браузере и оставляет только строки, которые уже есть в проверенном списке и открываются с вашей сети. «Открыть проверку на GitHub» открывает страницу запуска прогона. Сам прогон стартует только там.',
    },
    {
      id: 'refresh',
      title: 'Обновление списка',
      body: 'Пока вкладка открыта, сайт сам подхватывает новый список примерно раз в минуту. Кнопка со стрелками заново скачивает список и проверяет адреса с вашей сети. «Доступен у вас» — только если браузер закончил TLS или открыл WebSocket. Мгновенный отказ, ошибка DNS и тишина — «Недоступен у вас». Это не полная проверка протокола. Hysteria2 и TUIC в браузере не проверяются. Отдельных фильтров нет.',
    },
    {
      id: 'phone',
      title: 'Проверка с телефона',
      body: 'Полная проверка с вашего интернета идёт в Termux теми же ступенями, что на сервере: Xray для VLESS, Shadowsocks и Trojan, sing-box для Hysteria2 и TUIC. Включите мобильные данные, если нужен адрес вашей сети. Команды ниже скачивают текущий список и записывают рабочие ссылки в local-working.txt. На весь список уходит много времени. Для пробы добавьте в конец --limit 20.',
    },
    {
      id: 'check',
      title: 'Как проходит проверка',
      body: 'Проверка идёт с серверов GitHub за пределами России. Ссылка собирается заново так, как её получит приложение, и весь проход повторяется ещё два раза: все три должны пройти. VLESS, Shadowsocks и Trojan проверяет Xray, Hysteria2 и TUIC — sing-box. Где умеют оба, в карточке написано «Xray и sing-box». Пинг — это ответ сайта через прокси, не сумма ступеней. Дольше 5 секунд в список не попадает. Так проверка в Clash и Hiddify помечает узел мёртвым. Порт ещё смотрится с узла в России. Если узел явно не открыл порт, конфиг не публикуется. Если узел не ответил, конфиг остаётся: это не ваша сеть. «есть из России» значит, что порт оттуда открылся. Сайт сам никуда не подключает. Не прошёл повтор или ссылка после сборки разошлась — сразу убран. Если рабочих мало, прошлые рабочие проверяются ещё раз, но в список попадают только прошедшие сейчас. В «Логах» видно выход каждого источника. Источник, который несколько прогонов мёртв, помечается «выключен» и пропускается, потом пробуется снова.',
    },
    {
      id: 'inspect',
      title: 'Разбор ссылки',
      body: 'Вставьте ссылку VLESS. Сайт покажет, из чего она состоит, и никуда её не отправит.',
    },
  ],
  inspect: {
    title: 'Разбор ссылки',
    hint: 'Ссылка разбирается в браузере. Плюс в ключе остаётся плюсом, название в отпечаток не входит.',
    placeholder: 'vless://…',
    aria: 'Ссылка VLESS',
    notVless: 'Это не ссылка VLESS',
    run: 'Разобрать',
    qrClients: 'QR и приложения',
  },
  live: {
    title: 'Живой парс',
    find: 'Найти новые',
    hint: 'Список покажет только то, что уже прошло проверку на сервере и открывается с вашей сети.',
    emptyReach: 'С вашей сети рабочих серверов не нашлось',
    unchecked: 'не проверено',
    exportNote: 'В файл попадают только проверенные строки.',
    downloadStage: (done: number, total: number) =>
      `Скачиваю источники ${formatCount(done)}/${formatCount(total)}`,
    parseStage: 'Разбираю ссылки',
    reachStage: (done: number, total: number) =>
      `Проверяю доступность у вас ${formatCount(done)}/${formatCount(total)}`,
    cancel: 'Отмена',
    summary: (found: number, fresh: number, open: number) =>
      `Найдено ${formatCount(found)} · новых ${formatCount(fresh)} · доступны у вас ${formatCount(open)}`,
    segmentNew: 'Новые',
    segmentAll: 'Все найденные',
    emptyNew: 'Новых нет — все найденные уже в списке',
    emptyFail: 'Ничего не нашлось — источники не открылись',
    emptyNone: 'В списках нет подходящих ссылок',
    emptyCancelled: 'Поиск отменён',
    sourcesTitle: 'Источники',
    copy: 'Скопировать',
    copied: 'Ссылки скопированы',
    download: 'Скачать',
    check: 'Открыть проверку на GitHub',
    idle: 'Ожидание',
    running: 'Идёт',
    done: 'Готово',
    failed: 'Не вышло',
    cancelled: 'Отменена',
    rateLimit: 'Слишком много запросов, статус позже',
    skipClosed: 'не открылся',
    skipTelegram: 'страница Telegram',
  },
  reasons,
  statuses,
  probes,
  otherError: 'Другая ошибка',
  noStatus: 'Без статуса',
  probeFallback: 'Проверка с сервера',
} as const

export const phoneCommands = [
  'pkg update && pkg install -y python git',
  'git clone https://github.com/Nyrokume/vless-hub.git',
  'cd vless-hub',
  'pip install -r requirements.txt',
  'bash scripts/termux-check.sh --out local-working.txt',
] as const

export function reasonLabel(key: string): string {
  const label = (reasons as Record<string, string>)[key]
  if (!label) return ru.otherError
  return label
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return ''
  const label = (statuses as Record<string, string>)[status]
  return label ?? ru.noStatus
}

export function probeLabel(probe: string | null | undefined): string {
  if (!probe) return ru.settings.dash
  const label = (probes as Record<string, string>)[probe]
  return label ?? ru.probeFallback
}

export function coreLabel(core: string | null | undefined): string {
  if (core === 'xray') return 'Xray'
  if (core === 'sing-box') return 'sing-box'
  if (core === 'xray+sing-box') return 'Xray и sing-box'
  return ''
}

export function kindLabel(kind: string): string {
  if (kind === 'mtproto') return ru.kinds.mtproto
  if (kind === 'socks') return ru.kinds.socks
  return ru.kinds.all
}
