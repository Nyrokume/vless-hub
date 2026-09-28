from __future__ import annotations

import argparse
import json
from pathlib import Path

from vlesshub.parser import parse_vless
from vlesshub.pipeline import run_pipeline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="vlesshub", description="Collect and test public VLESS configs")
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="collect, test, and build the site")
    run.add_argument("--sources", default="sources.yaml")
    run.add_argument("--out", default="publish")
    run.add_argument("--state", default="state")
    run.add_argument("--site", default="site")
    run.add_argument("--max-tcp", type=int)
    run.add_argument("--max-proxy", type=int)
    run.add_argument("--max-tg", type=int)
    run.add_argument("--skip-proxy", action="store_true")
    run.add_argument("--skip-download", action="store_true")

    show = sub.add_parser("parse", help="parse one vless:// URI and print JSON")
    show.add_argument("uri")

    args = parser.parse_args(argv)
    if args.cmd == "parse":
        cfg = parse_vless(args.uri)
        if cfg is None:
            print("not a vless URI")
            return 1
        print(
            json.dumps(
                {
                    "uuid": cfg.uuid,
                    "host": cfg.host,
                    "port": cfg.port,
                    "network": cfg.network,
                    "security": cfg.security,
                    "sni": cfg.sni,
                    "fp": cfg.fp,
                    "pbk": cfg.pbk,
                    "sid": cfg.sid,
                    "flow": cfg.flow,
                    "path": cfg.path,
                    "host_header": cfg.host_header,
                    "service_name": cfg.service_name,
                    "mode": cfg.mode,
                    "remark": cfg.remark,
                    "fingerprint": cfg.fingerprint,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    return run_pipeline(
        sources_path=Path(args.sources),
        out_dir=Path(args.out),
        state_dir=Path(args.state),
        site_dir=Path(args.site),
        max_tcp=args.max_tcp,
        max_proxy=args.max_proxy,
        max_tg=args.max_tg,
        skip_proxy=args.skip_proxy,
        skip_download=args.skip_download,
    )
