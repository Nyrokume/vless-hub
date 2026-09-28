from __future__ import annotations

import json
import os
import platform
import stat
import subprocess
import tarfile
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


def ensure_singbox(bin_dir: Path) -> Path | None:
    override = os.environ.get("SINGBOX_BIN", "").strip()
    if override:
        path = Path(override)
        if path.is_file():
            return path
        log(f"SINGBOX_BIN does not exist: {override}")
    dest = bin_dir / "sing-box"
    if dest.is_file() and os.access(dest, os.X_OK):
        return dest
    asset, url = _singbox_asset()
    if not url:
        return None
    archive = bin_dir / asset
    try:
        bin_dir.mkdir(parents=True, exist_ok=True)
        log(f"downloading sing-box ({asset})")
        _download(url, archive, limit=40_000_000)
        binary = _extract_singbox(archive)
        dest.write_bytes(binary)
        dest.chmod(dest.stat().st_mode | stat.S_IEXEC)
    except Exception as exc:  # noqa: BLE001
        log(f"sing-box download failed: {exc}")
        return None
    if not dest.is_file():
        log("sing-box binary missing after unpack")
        return None
    try:
        proc = subprocess.run([str(dest), "version"], capture_output=True, text=True, timeout=15)
        line = (proc.stdout or proc.stderr or "").splitlines()
        log(line[0] if line else "sing-box version unknown")
    except Exception as exc:  # noqa: BLE001
        log(f"sing-box failed to start: {exc}")
        return None
    return dest


def _singbox_asset() -> tuple[str, str]:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if system != "linux":
        log(f"sing-box auto-download supports linux only ({system})")
        return "", ""
    arch = "amd64" if machine in {"x86_64", "amd64"} else "arm64" if machine in {"aarch64", "arm64"} else ""
    if not arch:
        log(f"sing-box auto-download has no build for {machine}")
        return "", ""
    request = urllib.request.Request(
        "https://api.github.com/repos/SagerNet/sing-box/releases/latest",
        headers={"User-Agent": _UA, "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    tag = str(payload.get("tag_name") or "")
    version = tag.lstrip("v")
    if not version:
        return "", ""
    name = f"sing-box-{version}-linux-{arch}.tar.gz"
    return name, f"https://github.com/SagerNet/sing-box/releases/download/{tag}/{name}"


def _extract_singbox(archive: Path) -> bytes:
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle.getmembers():
            name = member.name.replace("\\", "/")
            if not name.endswith("/sing-box") and name != "sing-box":
                continue
            if ".." in name.split("/"):
                continue
            handle = bundle.extractfile(member)
            if handle is None:
                continue
            data = handle.read()
            if data:
                return data
    raise RuntimeError("sing-box binary not found in the archive")


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
