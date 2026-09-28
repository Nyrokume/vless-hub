"""Fetch public Telegram-proxy sources and pick which ones to probe."""

from __future__ import annotations

from vlesshub.collect import _fetch_telegram, _fetch_url, _source_url
from vlesshub.history import History
from vlesshub.models import Settings, Source, SourceReport
from vlesshub.tgparse import TgProxy, dedup, parse_many
from vlesshub.util import log


def collect_proxies(settings: Settings, sources: list[Source]) -> tuple[list[SourceReport], list[TgProxy]]:
    enabled = [source for source in sources if source.enabled and source.kind == "telegram-proxy"]
    reports: list[SourceReport] = []
    proxies: list[TgProxy] = []
    for source in enabled:
        report, found = _fetch(settings, source)
        reports.append(report)
        proxies.extend(found)
        state = "ok" if report.ok else "fail"
        log(
            f"tg source {report.name}: {state} status={report.status} "
            f"links={report.links} kept={report.kept} {report.error}".rstrip()
        )
    unique = dedup(proxies)
    log(f"tg collected {len(proxies)} links, {len(unique)} unique")
    return reports, unique


def select_proxies(
    proxies: list[TgProxy],
    history: History,
    limit: int,
    drop_after: int,
) -> list[TgProxy]:
    if limit <= 0 or not proxies:
        return []
    mtproto = [item for item in proxies if item.kind == "mtproto"]
    socks = [item for item in proxies if item.kind == "socks"]
    if mtproto and socks:
        socks_limit = min(len(socks), max(8, limit // 4))
        mt_limit = min(len(mtproto), max(0, limit - socks_limit))
        if mt_limit + socks_limit < limit:
            socks_limit = min(len(socks), limit - mt_limit)
    else:
        mt_limit = limit
        socks_limit = limit
    chosen = _pick(mtproto, history, mt_limit, drop_after) + _pick(socks, history, socks_limit, drop_after)
    return chosen[:limit]


def _pick(proxies: list[TgProxy], history: History, limit: int, drop_after: int) -> list[TgProxy]:
    if limit <= 0:
        return []
    good: list[TgProxy] = []
    fresh: list[TgProxy] = []
    stale: list[TgProxy] = []
    for proxy in proxies:
        entry = history.get(proxy.fingerprint)
        if entry is None:
            fresh.append(proxy)
        elif int(entry.get("streak_fail", 0)) >= drop_after:
            continue
        else:
            good.append(proxy)

    def good_key(proxy: TgProxy) -> tuple[float, float]:
        entry = history.get(proxy.fingerprint) or {}
        ema = entry.get("ema_ms")
        trusted = float(ema) if ema is not None else 99_999.0
        return (-history.uptime(proxy.fingerprint), trusted)

    good.sort(key=good_key)
    fresh.sort(key=lambda proxy: proxy.fingerprint)
    stale.sort(key=lambda proxy: (int((history.get(proxy.fingerprint) or {}).get("streak_fail", 0)), proxy.fingerprint))
    revival = min(len(stale), max(2, limit // 12))
    fresh_slots = min(len(fresh), max(4, limit // 3))
    good_slots = max(0, limit - revival - fresh_slots)
    if len(good) < good_slots:
        fresh_slots = min(len(fresh), fresh_slots + (good_slots - len(good)))
        good_slots = len(good)
    chosen = good[:good_slots] + fresh[:fresh_slots]
    used = {proxy.fingerprint for proxy in chosen}
    for proxy in stale:
        if len(chosen) >= good_slots + fresh_slots + revival:
            break
        if proxy.fingerprint not in used:
            chosen.append(proxy)
            used.add(proxy.fingerprint)
    if len(chosen) < limit:
        for pool in (good[good_slots:], fresh[fresh_slots:], stale):
            for proxy in pool:
                if len(chosen) >= limit:
                    break
                if proxy.fingerprint not in used:
                    chosen.append(proxy)
                    used.add(proxy.fingerprint)
    return chosen[:limit]


def _fetch(settings: Settings, source: Source) -> tuple[SourceReport, list[TgProxy]]:
    import time

    started = time.perf_counter()
    url = _source_url(source)
    report = SourceReport(name=source.name, url=url, ok=False)
    cap = source.limit or settings.max_tg_links_per_source
    try:
        if source.type == "telegram":
            status, text = _fetch_telegram(source.channel, settings)
        else:
            status, text = _fetch_url(url, settings)
        report.status = status
        parsed = parse_many(text, source=source.name)
        report.links = len(parsed)
        kept = parsed[: max(0, cap)]
        report.kept = len(kept)
        report.ok = True
        report.elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        return report, kept
    except Exception as exc:  # noqa: BLE001
        report.error = f"{type(exc).__name__}: {exc}"
        report.elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
        return report, []
