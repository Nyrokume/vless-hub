from __future__ import annotations

import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import yaml

from vlesshub.models import Settings, Source, SourceReport, VlessConfig
from vlesshub.parser import dedup, parse_document
from vlesshub.util import log


def load_config(path: Path) -> tuple[Settings, list[Source]]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    settings_raw = raw.get("settings") if isinstance(raw, dict) else {}
    if not isinstance(settings_raw, dict):
        settings_raw = {}
    known = Settings.__dataclass_fields__
    values = {key: settings_raw[key] for key in settings_raw if key in known}
    settings = Settings(**values)
    items = raw.get("sources") if isinstance(raw, dict) else raw
    sources: list[Source] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict) or not item.get("name"):
                continue
            sources.append(
                Source(
                    name=str(item["name"]),
                    type=str(item.get("type") or "subscription"),
                    enabled=bool(item.get("enabled", True)),
                    url=str(item.get("url") or ""),
                    channel=str(item.get("channel") or ""),
                    kind=str(item.get("kind") or "vless"),
                    limit=int(item.get("limit") or 0),
                )
            )
    return settings, sources


def collect_all(
    settings: Settings,
    sources: list[Source],
) -> tuple[list[SourceReport], list[VlessConfig], dict[str, int]]:
    enabled = [source for source in sources if source.enabled and source.kind != "telegram-proxy"]
    reports: list[SourceReport] = []
    configs: list[VlessConfig] = []
    reasons = {"parse_error": 0, "invalid_field": 0}
    workers = max(1, settings.fetch_concurrency)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(_fetch_source, settings, source): source for source in enabled}
        for future in as_completed(futures):
            source = futures[future]
            try:
                report, parsed = future.result()
            except Exception as exc:  # noqa: BLE001 — one source must not abort the run
                report = SourceReport(
                    name=source.name,
                    url=source.url or source.channel,
                    ok=False,
                    error=str(exc),
                    kind=source.kind,
                    source_type=source.type,
                )
                parsed = []
            reports.append(report)
            configs.extend(parsed)
            reasons["parse_error"] += report.parse_error
            reasons["invalid_field"] += report.invalid_field
            state = "ok" if report.ok else "fail"
            log(
                f"source {report.name}: {state} status={report.status} "
                f"links={report.links} kept={report.kept} "
                f"parse_error={report.parse_error} invalid={report.invalid_field} "
                f"{report.error}".rstrip()
            )
    reports.sort(key=lambda item: item.name)
    unique = dedup(configs)
    seen = sum(report.links for report in reports)
    log(
        f"collected {seen} links, {len(configs)} valid, {len(unique)} unique, "
        f"parse_error={reasons['parse_error']} invalid_field={reasons['invalid_field']}"
    )
    return reports, unique, reasons


def _fetch_source(settings: Settings, source: Source) -> tuple[SourceReport, list[VlessConfig]]:
    started = time.perf_counter()
    url = _source_url(source)
    report = SourceReport(
        name=source.name,
        url=url,
        ok=False,
        kind=source.kind,
        source_type=source.type,
    )
    try:
        if source.type == "telegram":
            status, text = _fetch_telegram(source.channel, settings)
        else:
            status, text = _fetch_url(url, settings)
        report.status = status
        parsed, doc_reasons = parse_document(text, source=source.name, validate=True)
        report.parse_error = doc_reasons["parse_error"]
        report.invalid_field = doc_reasons["invalid_field"]
        report.links = report.parse_error + report.invalid_field + len(parsed)
        report.parsed = len(parsed)
        report.kept = min(len(parsed), settings.max_links_per_source)
        report.ok = True
        report.elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        return report, parsed[: settings.max_links_per_source]
    except Exception as exc:  # noqa: BLE001
        report.error = f"{type(exc).__name__}: {exc}"
        report.elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        return report, []


def _source_url(source: Source) -> str:
    if source.type == "telegram":
        channel = source.channel.strip().lstrip("@")
        return f"https://t.me/s/{channel}"
    return source.url


def _fetch_url(url: str, settings: Settings) -> tuple[int, str]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": settings.user_agent, "Accept": "*/*"},
    )
    with urllib.request.urlopen(request, timeout=settings.fetch_timeout_sec) as response:
        status = getattr(response, "status", 200)
        return status, _read_limited(response, settings.max_bytes_per_source)


def _fetch_telegram(channel: str, settings: Settings) -> tuple[int, str]:
    channel = channel.strip().lstrip("@")
    if not channel:
        raise ValueError("telegram channel is empty")
    url = f"https://t.me/s/{channel}"
    pages: list[str] = []
    status = 0
    for _ in range(max(1, settings.telegram_pages)):
        status, body = _fetch_url(url, settings)
        pages.append(body)
        match = re.search(r'href="([^"]*\?before=\d+)"', body)
        if not match:
            break
        href = html_unescape_href(match.group(1))
        if href.startswith("?"):
            url = f"https://t.me/s/{channel}{href}"
        elif href.startswith("/"):
            url = "https://t.me" + href
        elif href.startswith("http"):
            url = href
        else:
            break
    return status, "\n".join(pages)


def html_unescape_href(value: str) -> str:
    return value.replace("&amp;", "&")


def _read_limited(response: object, limit: int) -> str:
    chunks: list[bytes] = []
    total = 0
    while total < limit:
        buf = response.read(min(65536, limit - total))  # type: ignore[attr-defined]
        if not buf:
            break
        chunks.append(buf)
        total += len(buf)
    return b"".join(chunks).decode("utf-8", errors="replace")

