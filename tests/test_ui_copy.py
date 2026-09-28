import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "site" / "src" / "components"
APP = ROOT / "site" / "src" / "App.tsx"

RAW_KEYS = (
    "parse_error",
    "invalid_field",
    "tcp_refused",
    "timeout",
    "tls_fail",
    "reality_fail",
    "handshake_fail",
    "http_fail",
    "no_data",
    "exit_ip_leak",
    "unsupported_protocol",
    "dead",
    "working",
    "unstable",
    "xray-http",
)


def test_reason_status_and_probe_labels_are_plain_russian():
    script = r"""
import { RAW_KEYS, probeLabel, reasonLabel, statusLabel } from './site/src/lib/ru.ts'

const cyrillic = /[А-Яа-яЁё]/
function assertPlain(label, key) {
  if (!label || !cyrillic.test(label)) {
    console.error('not russian', key, label)
    process.exit(1)
  }
  for (const raw of RAW_KEYS) {
    if (label === raw || label.includes(raw)) {
      console.error('leaked', key, label)
      process.exit(1)
    }
  }
}

for (const key of RAW_KEYS) {
  assertPlain(reasonLabel(key), key)
  assertPlain(statusLabel(key), key)
  assertPlain(probeLabel(key), key)
}
assertPlain(reasonLabel('no-such-reason'), 'fallback')
assertPlain(statusLabel('nope'), 'status-fallback')
assertPlain(probeLabel('custom-probe'), 'probe-fallback')
"""
    result = subprocess.run(
        ["node", "--experimental-strip-types", "--input-type=module", "-e", script],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _strip_comments(source: str) -> str:
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
    return re.sub(r"//.*?$", "", source, flags=re.M)


def test_ui_components_do_not_render_raw_reason_keys():
    files = list(COMPONENTS.rglob("*.tsx")) + [APP]
    leaks: list[str] = []
    for path in files:
        source = _strip_comments(path.read_text(encoding="utf-8"))
        for line_no, line in enumerate(source.splitlines(), 1):
                visible = re.sub(r"(?:===|!==|==|!=)\s*(['\"])[^'\"]+\1", "", line)
                shown = any(
                    mark in visible
                    for mark in ("<", ">", "placeholder", "aria-", "toast.", "title=", "label:")
                )
                if not shown:
                    continue
                for key in RAW_KEYS:
                    if re.search(rf"['\"]{re.escape(key)}['\"]", visible) or re.search(
                        rf">\s*{re.escape(key)}\s*<", visible
                    ):
                        leaks.append(f"{path.relative_to(ROOT)}:{line_no}: {key}")
    assert leaks == []
