import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_redundant_transport_is_not_repeated():
    script = r"""
import { distinctTransport, protocolLabel, protocolLine, transportLabel } from './site/src/lib/format.ts'

const cases = [
  ['hysteria2', 'hysteria2', 'Hysteria2'],
  ['hy2', 'hysteria2', 'Hysteria2'],
  ['hysteria2', 'hy2', 'Hysteria2'],
  ['tcp', 'vless', 'VLESS / TCP'],
  ['ws', 'trojan', 'Trojan / WS'],
  ['tcp', 'shadowsocks', 'SS / TCP'],
  ['', 'vless', 'VLESS'],
]
for (const [transport, protocol, expect] of cases) {
  const line = protocolLine(transport, protocol)
  if (line !== expect) {
    console.error('line', transport, protocol, line, expect)
    process.exit(1)
  }
}
if (distinctTransport('hysteria2', 'hysteria2') !== null) process.exit(1)
if (distinctTransport('ws', 'vless') !== 'WS') process.exit(1)
if (protocolLabel('hysteria2') !== 'Hysteria2') process.exit(1)
if (transportLabel('hysteria2') !== 'Hysteria2') process.exit(1)
if (protocolLine('hysteria2', 'hysteria2').includes('/')) process.exit(1)
"""
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--import",
            "./tests/register-alias.mjs",
            "--input-type=module",
            "-e",
            script,
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
