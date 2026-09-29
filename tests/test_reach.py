import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_reach_classifies_fast_errors_and_skips_udp():
    script = r"""
import { browserCanProbe, classifyReach, REACH_TIMEOUT_MS } from './site/src/lib/reach.ts'

if (classifyReach(50, false) !== 'open') process.exit(1)
if (classifyReach(149, false) !== 'open') process.exit(1)
if (classifyReach(REACH_TIMEOUT_MS, true) !== 'closed') process.exit(1)
if (classifyReach(REACH_TIMEOUT_MS - 50, false) !== 'closed') process.exit(1)
if (classifyReach(10, true) !== 'closed') process.exit(1)
if (browserCanProbe('hysteria2') !== false) process.exit(1)
if (browserCanProbe('hy2') !== false) process.exit(1)
if (browserCanProbe('tuic') !== false) process.exit(1)
if (browserCanProbe('vless') !== true) process.exit(1)
if (browserCanProbe('trojan') !== true) process.exit(1)
if (browserCanProbe('shadowsocks') !== true) process.exit(1)
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
