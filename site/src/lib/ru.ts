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

function pluralFormUnchecked(count: number): string {
  return pluralCategory(count) === 'one' ? 'не проверен' : 'не проверены'
}

export const ru = {
  brand: 'V2Hub',
  loading: 'Загружаем список…',
  noData: 'Нет данных',
  retry: 'Повторить',
  loadFailed: 'Не удалось загрузить данные',
  dataBroken: 'Файл данных повреждён',
  refreshFailed: 'Не удалось обновить',
  alreadyFresh: 'Уже актуально',
  refreshed: 'Обновлено',
  refreshedNew: (count: number) => `Обновлено · +${plural(count, noun.newOne)}`,
  updateAvailable: 'Есть обновление',
  refresh: 'Обновить',
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
      body: 'На первой вкладке — только конфиги, которые прошли проверку в этом прогоне. Поиск ищет страну и адрес. Кнопка рядом открывает фильтры: пинг, страна, защита, тип соединения, порядок и вид списка. Долгое нажатие включает выбор нескольких строк. Залитая точка — конфиг прошёл все ступени.',
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
      body: 'Пункт «Живой парс» в меню «Конфигов» читает открытые списки прямо в браузере и показывает только новые строки, сгруппированные по странам. Браузер их не проверяет и не смешивает с проверенным списком. «Проверить на сервере» открывает страницу GitHub, где владелец сайта запускает настоящую проверку. Когда она закончится, нажмите «Обновить список».',
    },
    {
      id: 'refresh',
      title: 'Обновление списка',
      body: 'Кнопка со стрелками в шапке заново скачивает список и показывает его на месте, без перезагрузки страницы. Если на сайте появился более новый список, в шапке будет надпись «Есть обновление».',
    },
    {
      id: 'check',
      title: 'Как проходит проверка',
      body: 'Проверка идёт с серверов GitHub за пределами России. Конфиг, который открылся там, домашний провайдер всё равно может закрыть. Сайт сам никуда вас не подключает. В список попадает только то, что в этом прогоне прошло всё: подключение, два сайта из трёх с правильным ответом, скорость и другой адрес выхода. Не прошёл сейчас — сразу убран. В «Логах» видно, сколько отсеялось и почему: не прошёл HTTP-проверку, низкая скорость, не совпал выходной IP.',
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
    sources: (done: number, total: number) => `Источники ${formatCount(done)} из ${formatCount(total)}`,
    cancel: 'Отмена',
    found: (count: number) =>
      `Найдено ${plural(count, noun.newOne)} · ${pluralFormUnchecked(count)}`,
    skipped: (count: number) =>
      pluralCategory(count) === 'one'
        ? `Пропущен ${plural(count, noun.source)}`
        : `Пропущено ${plural(count, noun.source)}`,
    copy: 'Скопировать',
    copied: 'Ссылки скопированы',
    download: 'Скачать',
    check: 'Проверить на сервере',
    refreshList: 'Обновить список',
    idle: 'Ожидание',
    running: 'Идёт',
    done: 'Готово',
    failed: 'Не вышло',
    cancelled: 'Отменена',
    rateLimit: 'Слишком много запросов, статус позже',
    source: (name: string) => `Источник: ${name}`,
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

export function kindLabel(kind: string): string {
  if (kind === 'mtproto') return ru.kinds.mtproto
  if (kind === 'socks') return ru.kinds.socks
  return ru.kinds.all
}
