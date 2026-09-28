from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Settings:
    drop_after_failures: int = 4
    max_links_per_source: int = 15000
    max_tcp_tests: int = 20000
    max_proxy_tests: int = 12000
    tcp_timeout_sec: float = 2.5
    proxy_timeout_sec: float = 6.0
    speed_timeout_sec: float = 0.0
    tcp_concurrency: int = 200
    proxy_concurrency: int = 12
    proxy_batch_size: int = 24
    fetch_timeout_sec: float = 30.0
    fetch_concurrency: int = 6
    max_bytes_per_source: int = 8_000_000
    telegram_pages: int = 2
    top_sizes: list[int] = field(default_factory=lambda: [20, 50, 100])
    clash_limit: int = 0
    max_tg_tests: int = 160
    tg_timeout_sec: float = 8.0
    tg_concurrency: int = 40
    max_tg_links_per_source: int = 500
    tg_top_sizes: list[int] = field(default_factory=lambda: [20, 50])
    user_agent: str = "vless-hub/1.0 (+https://github.com/Nyrokume/vless-hub)"


@dataclass(slots=True)
class Source:
    name: str
    type: str
    enabled: bool = True
    url: str = ""
    channel: str = ""
    kind: str = "vless"
    limit: int = 0


@dataclass(slots=True)
class SourceReport:
    name: str
    url: str
    ok: bool
    status: int = 0
    links: int = 0
    kept: int = 0
    elapsed_ms: float = 0
    error: str = ""
    parse_error: int = 0
    invalid_field: int = 0
    verified: int = 0
    tested: int = 0
    yield_ratio: float | None = None
    deprioritized: bool = False


@dataclass(slots=True)
class VlessConfig:
    uuid: str
    host: str
    port: int
    protocol: str = "vless"
    encryption: str = "none"
    flow: str = ""
    network: str = "tcp"
    security: str = "none"
    sni: str = ""
    fp: str = ""
    pbk: str = ""
    sid: str = ""
    spx: str = ""
    path: str = ""
    host_header: str = ""
    service_name: str = ""
    mode: str = ""
    alpn: str = ""
    header_type: str = ""
    extra: str = ""
    packet_encoding: str = ""
    allow_insecure: bool = False
    authority: str = ""
    extras: dict[str, str] = field(default_factory=dict)
    remark: str = ""
    remark_country: str = ""
    raw: str = ""
    sources: list[str] = field(default_factory=list)
    fingerprint: str = ""
    country: str = ""
    country_name: str = ""
    ip: str = ""
    latency_ms: float | None = None
    speed_kbps: float | None = None
    verified: str = ""
    uptime: float = 0.0
    checks_ok: int = 0
    checks_fail: int = 0
    bits: str = ""

    def __post_init__(self) -> None:
        if not self.fingerprint:
            from vlesshub.parser import fingerprint

            self.fingerprint = fingerprint(self)
