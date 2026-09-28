import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_russian_counts_agree_and_group_thousands():
    script = r"""
import { formatCount, plural, pluralCategory } from './site/src/lib/plural.ts'
import { ru } from './site/src/lib/ru.ts'

const nb = '\u202f'
const cases = [
  [ru.settings.inList(647, 4808), `647 рабочих из 4${nb}808 проверенных`],
  [ru.settings.inList(1, 1), '1 рабочий из 1 проверенного'],
  [ru.settings.inList(2, 22), '2 рабочих из 22 проверенных'],
  [ru.settings.inList(21, 11), '21 рабочий из 11 проверенных'],
  [ru.settings.inList(5, 0), '5 рабочих из 0 проверенных'],
  [ru.settings.countryLine(1), '1 страна'],
  [ru.settings.countryLine(2), '2 страны'],
  [ru.settings.countryLine(5), '5 стран'],
  [ru.settings.countryLine(21), '21 страна'],
  [ru.listSummary(673, 41), '673 конфига · 41 страна'],
  [ru.listSummary(1, 12), '1 конфиг · 12 стран'],
  [ru.telegramCounts(1, 4), '1 MTProto · 4 SOCKS'],
  [ru.settings.collected(57037), `Собрано 57${nb}037 ссылок`],
  [ru.settings.collected(1), 'Собрано 1 ссылка'],
  [ru.settings.unique(1), '1 уникальная ссылка'],
  [ru.settings.unique(2), '2 уникальные ссылки'],
  [ru.settings.unique(25859), `25${nb}859 уникальных ссылок`],
  [ru.settings.portsChecked(1), 'Проверен 1 порт'],
  [ru.settings.portsChecked(2), 'Проверено 2 порта'],
  [ru.settings.portsChecked(5), 'Проверено 5 портов'],
  [ru.settings.portsChecked(21), 'Проверен 21 порт'],
  [ru.settings.proxyChecked(1), '1 проверка через прокси'],
  [ru.settings.proxyChecked(2), '2 проверки через прокси'],
  [ru.settings.proxyChecked(4808), `4${nb}808 проверок через прокси`],
  [ru.settings.published(647), '647 рабочих в списке'],
  [ru.settings.sourceMeta(1, 1200, 1, '12%'), `1 ссылка · разобрано 1${nb}200 · 1 рабочий · выход 12%`],
  [ru.settings.sourceMeta(5, 22, 3, '8%'), '5 ссылок · разобрано 22 · 3 рабочих · выход 8%'],
  [ru.refreshedNew(1), 'Обновлено · +1 новый'],
  [ru.refreshedNew(22), 'Обновлено · +22 новых'],
  [ru.selected(3), 'Выбрано 3 конфига'],
  [ru.copiedCount(1), 'Скопировано 1 конфиг'],
  [ru.inListNow(5), 'Сейчас в списке 5 конфигов'],
  [ru.downloadCount(21), 'Скачать 21 конфиг'],
  [ru.copiedConfigs(11), 'Скопировано 11 конфигов'],
  [ru.live.found(1), 'Найдено 1 новый · не проверен'],
  [ru.live.found(1240), `Найдено 1${nb}240 новых · не проверены`],
  [ru.live.found(2), 'Найдено 2 новых · не проверены'],
  [ru.live.skipped(1), 'Пропущен 1 источник'],
  [ru.live.skipped(2), 'Пропущено 2 источника'],
  [ru.live.skipped(5), 'Пропущено 5 источников'],
  [ru.live.sources(3, 14), 'Источники 3 из 14'],
  [ru.top(1000), `Топ 1${nb}000`],
  [formatCount(4808), `4${nb}808`],
  [plural(21, ru.noun.working), '21 рабочий'],
]
if (pluralCategory(11) !== 'many' || pluralCategory(22) !== 'few' || pluralCategory(1) !== 'one') {
  console.error('category', pluralCategory(1), pluralCategory(11), pluralCategory(22))
  process.exit(1)
}
for (const [got, expect] of cases) {
  if (got !== expect) {
    console.error('mismatch')
    console.error(got)
    console.error(expect)
    process.exit(1)
  }
  if (got.includes(':')) {
    console.error('colon', got)
    process.exit(1)
  }
}
"""
    result = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_ui_does_not_show_an_average_ping():
    root = ROOT / "site" / "src"
    files = list((root / "components").rglob("*.tsx"))
    files.append(root / "App.tsx")
    files.append(root / "lib" / "ru.ts")
    banned = ("средний", "медиан", "среднее", "median_latency")
    leaks: list[str] = []
    for path in files:
        text = path.read_text(encoding="utf-8").lower()
        for word in banned:
            if word in text:
                leaks.append(f"{path.relative_to(ROOT)}:{word}")
    assert leaks == []
