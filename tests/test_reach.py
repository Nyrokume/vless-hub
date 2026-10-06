import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_browser_reach_rejects_refusals_dns_and_stalls():
    script = r"""
import { browserCanProbe, classifyReach, controlPorts, judgeReach, steadyRefusal, usableRefusal } from './site/src/lib/reach.ts'

const tls = { elapsedMs: 2, aborted: false, resolved: false }
const refusal = { elapsedMs: 1, aborted: false, resolved: false }
const stall = { elapsedMs: 4000, aborted: true, resolved: false }
const dnsA = { elapsedMs: 68, aborted: false, resolved: false }
const dnsB = { elapsedMs: 165, aborted: false, resolved: false }
const http = { elapsedMs: 40, aborted: false, resolved: true }

if (judgeReach(tls, [refusal, refusal], null) !== 'open') process.exit(1)
if (judgeReach(refusal, [refusal, refusal], null) !== 'closed') process.exit(1)
if (judgeReach(stall, [refusal, refusal], null) !== 'closed') process.exit(1)
if (judgeReach(dnsA, [dnsA, dnsB], 165) !== 'closed') process.exit(1)
if (judgeReach(dnsB, [dnsA, dnsA], 70) !== 'closed') process.exit(1)
if (judgeReach(http, [], null) !== 'open') process.exit(1)
if (judgeReach({ elapsedMs: 80, aborted: false, resolved: false }, [{ elapsedMs: 1200, aborted: true, resolved: false }, { elapsedMs: 1200, aborted: true, resolved: false }], null) !== 'closed') process.exit(1)
if (classifyReach({ elapsedMs: 30, aborted: false, resolved: false, tlsDone: true }, null) !== 'open') process.exit(1)
if (classifyReach({ elapsedMs: 2200, aborted: false, resolved: false }, 40) !== 'closed') process.exit(1)
if (steadyRefusal([dnsA, dnsB]) !== null) process.exit(1)
if (usableRefusal(140, 150) !== null) process.exit(1)
if (usableRefusal(20, 150) !== 20) process.exit(1)
const [first, second] = controlPorts(48123)
if (first === 48123 || second === 48123 || first === second) process.exit(1)
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


def test_reach_plan_reuses_fresh_results_and_caps_the_queue():
    result = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--import",
            "./tests/register-alias.mjs",
            "tests/reach_plan.mjs",
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_cached_reload_two_tabs_and_hidden_page_do_not_rescan():
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable")
    puppeteer = Path("/tmp/preview-gate/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js")
    if not chrome or not puppeteer.exists():
        pytest.skip("Chrome or puppeteer-core is not available")
    build = subprocess.run(
        ["npm", "run", "build", "--prefix", "site"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert build.returncode == 0, build.stdout[-4000:] + build.stderr[-4000:]
    env = os.environ.copy()
    env["CHROME_PATH"] = chrome
    env["PUPPETEER_PATH"] = str(puppeteer)
    result = subprocess.run(
        ["node", "tests/reach_cache.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
        timeout=180,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_chrome_open_port_is_not_confused_with_refusal_stall_or_dns():
    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable")
    puppeteer = Path("/tmp/preview-gate/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js")
    if not chrome or not puppeteer.exists():
        pytest.skip("Chrome or puppeteer-core is not available")
    env = os.environ.copy()
    env["CHROME_PATH"] = chrome
    env["PUPPETEER_PATH"] = str(puppeteer)
    result = subprocess.run(
        ["node", "--experimental-strip-types", "--import", "./tests/register-alias.mjs", "tests/reach_browser.mjs"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
        timeout=90,
    )
    assert result.returncode == 0, result.stdout + result.stderr
