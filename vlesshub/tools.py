from __future__ import annotations

import os
import platform
import stat
import subprocess
import urllib.request
import zipfile
from pathlib import Path

from vlesshub.util import log

_XRAY_RELEASE = "https://github.com/XTLS/Xray-core/releases/latest/download"
_GEOIP_URL = "https://github.com/Loyalsoldier/geoip/releases/latest/download/Country.mmdb"
_UA = "vless-hub/1.0"


def ensure_xray(bin_dir: Path) -> Path | None:
    override = os.environ.get("XRAY_BIN", "").strip()
    if override:
        path = Path(override)
        if path.is_file():
            return path
        log(f"XRAY_BIN does not exist: {override}")
    dest = bin_dir / "xray"
    if dest.is_file() and os.access(dest, os.X_OK):
        return dest
    asset = _xray_asset()
    archive = bin_dir / "xray.zip"
    try:
        bin_dir.mkdir(parents=True, exist_ok=True)
        log(f"downloading Xray ({asset})")
        _download(f"{_XRAY_RELEASE}/{asset}", archive, limit=80_000_000)
        with zipfile.ZipFile(archive) as bundle:
            bundle.extract("xray", path=bin_dir)
        dest.chmod(dest.stat().st_mode | stat.S_IEXEC)
    except Exception as exc:  # noqa: BLE001
        log(f"xray download failed: {exc}")
        return None
    if not dest.is_file():
        log("xray binary missing after unzip")
        return None
    try:
        proc = subprocess.run([str(dest), "version"], capture_output=True, text=True, timeout=15)
        line = (proc.stdout or proc.stderr or "").splitlines()
        log(line[0] if line else "xray version unknown")
    except Exception as exc:  # noqa: BLE001
        log(f"xray failed to start: {exc}")
        return None
    return dest


def ensure_geoip(dest: Path) -> Path | None:
    if dest.is_file() and dest.stat().st_size > 100_000:
        return dest
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        log("downloading Country.mmdb (Loyalsoldier GeoLite2 mirror)")
        _download(_GEOIP_URL, dest, limit=40_000_000)
    except Exception as exc:  # noqa: BLE001
        log(f"geoip download failed: {exc}")
        return None
    return dest if dest.is_file() else None


def _xray_asset() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system == "linux" and machine in {"x86_64", "amd64"}:
        return "Xray-linux-64.zip"
    if system == "linux" and machine in {"aarch64", "arm64"}:
        return "Xray-linux-arm64-v8a.zip"
    if system == "darwin" and machine == "arm64":
        return "Xray-macos-arm64-v8a.zip"
    if system == "darwin":
        return "Xray-macos-64.zip"
    if system == "windows":
        return "Xray-windows-64.zip"
    return "Xray-linux-64.zip"


def _download(url: str, dest: Path, limit: int) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "*/*"})
    partial = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(request, timeout=90) as response, partial.open("wb") as handle:
        total = 0
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                raise RuntimeError(f"download exceeded {limit} bytes")
            handle.write(chunk)
    partial.replace(dest)
