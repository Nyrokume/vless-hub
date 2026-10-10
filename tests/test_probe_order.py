import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_browser_checks_a_russia_443_before_a_faster_core():
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--import",
            "./tests/register-alias.mjs",
            "tests/probe_order.mjs",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
