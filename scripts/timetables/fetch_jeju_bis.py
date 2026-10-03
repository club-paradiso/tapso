#!/usr/bin/env python3
"""Download every route timetable file bus.jeju.go.kr offers, and parse each.

    python3 scripts/timetables/fetch_jeju_bis.py OUT_DIR [--intermediate PEM]
    python3 scripts/timetables/fetch_jeju_bis.py OUT_DIR --reparse

`--reparse` sends no request: it parses the raw files already in OUT_DIR again
with the current parser and rewrites the datasets and the manifest's outcomes,
keeping each file's download date.

The requests are the timetable page's own, read from the page by
`scripts/data-sources/jeju-timetable-endpoints.ts` (data-source probe run
37086675116, 2026-10-03), not guessed:

    the page's buttons      onclick="showRouteNum('<type>')"     route groups
    POST /publicTrafficInformation/getBusRouteNum  GROUTE_TYPE=<type>
                            → JSON [{GSCHEDULE_ID, GSCHEDULE_NM, ...}]
    POST /data/schedule/getGroupScheduleInfo       gscheduleId=<id>
                            → JSON; empty means "해당의 노선 시간표가 없습니다"
    GET  /data/schedule/downScheduleExcel?gscheduleId=<id>       the XLSX

This is the download data.go.kr dataset 3043887 describes ("버스 타입을 선택한
후 노선을 클릭하면 시간표정보를 엑셀파일로 다운로드"), automated at one request
per second for an offline, dated import. It is never a runtime dependency.

Writes OUT_DIR/raw/<id>.xlsx, OUT_DIR/<id>.json for each file the parser
accepts, and OUT_DIR/manifest.json listing every file with its checksum and
parse outcome. A file the parser refuses is kept raw and listed with the
reason; it is never forced through.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jeju_xlsx  # noqa: E402

BIS = "https://bus.jeju.go.kr"
PAGE = f"{BIS}/publicTrafficInformation/generalBusSchedule"
KST = dt.timezone(dt.timedelta(hours=9))
PAUSE_SECONDS = 1.0


class Client:
    def __init__(self, intermediate: str | None) -> None:
        self.context = ssl.create_default_context()
        if intermediate:
            # The site omits its intermediate certificate; the workflow fetches it and
            # verifies it against the system roots first. Verification stays on.
            self.context.load_verify_locations(cafile=intermediate)
        self.last = 0.0

    def request(self, method: str, path: str, form: dict[str, str] | None = None) -> tuple[int, str, bytes]:
        wait = PAUSE_SECONDS - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        data = urllib.parse.urlencode(form).encode() if form is not None else None
        request = urllib.request.Request(
            f"{BIS}{path}",
            data=data,
            method=method,
            headers={
                "user-agent": "TAPSO-timetable-import/1.0 (+https://github.com/club-paradiso/tapso)",
                "referer": PAGE,
                **({"content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest"} if data else {}),
            },
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, context=self.context, timeout=30) as response:
                    self.last = time.monotonic()
                    return response.status, response.headers.get("content-type", ""), response.read()
            except urllib.error.HTTPError as error:
                self.last = time.monotonic()
                if error.code < 500 or attempt == 2:
                    return error.code, error.headers.get("content-type", ""), error.read()
            except (urllib.error.URLError, TimeoutError) as error:
                self.last = time.monotonic()
                if attempt == 2:
                    raise RuntimeError(f"{method} {path}: {error}") from error
            time.sleep(2 * (attempt + 1))
        raise AssertionError("unreachable")


def json_body(status: int, body: bytes, what: str) -> object:
    if status != 200:
        raise RuntimeError(f"{what}: HTTP {status}")
    try:
        return json.loads(body.decode("utf-8"))
    except ValueError as error:
        raise RuntimeError(f"{what}: not JSON ({body[:120]!r})") from error


def parse_into(out: Path, record: dict, retrieved_on: str) -> None:
    """Parse one downloaded file; set the record's outcome. Writes or removes OUT/<id>.json."""
    path = out / record["file"]
    target = out / f"{record['id']}.json"
    for key in ("routeNumber", "services", "reason"):
        record.pop(key, None)
    try:
        dataset = jeju_xlsx.parse_file(path, retrieved_on, file_name=path.name)
        target.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        record.update(outcome="parsed", routeNumber=dataset["routeNumber"], services=len(dataset["services"]))
    except jeju_xlsx.TimetableParseError as error:
        target.unlink(missing_ok=True)
        record.update(outcome="parse_refused", reason=str(error))


def tally(manifest: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for record in manifest:
        counts[record["outcome"]] = counts.get(record["outcome"], 0) + 1
    return counts


def reparse(out: Path) -> int:
    summary = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    for record in summary["timetables"]:
        if record.get("file"):
            parse_into(out, record, summary["retrievedOn"])
    summary["parser"] = {"name": jeju_xlsx.PARSER_NAME, "version": jeju_xlsx.PARSER_VERSION}
    summary["counts"] = tally(summary["timetables"])
    (out / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary["counts"]))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--intermediate")
    parser.add_argument("--reparse", action="store_true", help="parse the files already downloaded; no network")
    args = parser.parse_args()
    if args.reparse:
        return reparse(args.out)
    client = Client(args.intermediate)
    started = dt.datetime.now(KST)
    retrieved_on = started.date().isoformat()
    raw = args.out / "raw"
    raw.mkdir(parents=True, exist_ok=True)

    status, _, page = client.request("GET", "/publicTrafficInformation/generalBusSchedule")
    if status != 200:
        print(f"timetable page: HTTP {status}", file=sys.stderr)
        return 1
    types = list(dict.fromkeys(re.findall(r"showRouteNum\('(\d+)'\)", page.decode("utf-8", "replace"))))
    print(f"route groups on the page: {types}")
    if not types:
        print("no route group on the page; its layout changed", file=sys.stderr)
        return 1

    schedules: dict[str, dict] = {}
    for group in types:
        status, _, body = client.request("POST", "/publicTrafficInformation/getBusRouteNum", {"GROUTE_TYPE": group})
        rows = json_body(status, body, f"getBusRouteNum {group}")
        if not isinstance(rows, list):
            raise RuntimeError(f"getBusRouteNum {group}: expected a list")
        print(f"group {group}: {len(rows)} timetables")
        for row in rows:
            identifier = str(row.get("GSCHEDULE_ID", "")).strip()
            name = str(row.get("GSCHEDULE_NM", "")).strip()
            if not re.fullmatch(r"[A-Za-z0-9_-]+", identifier):
                raise RuntimeError(f"group {group}: unexpected GSCHEDULE_ID {identifier!r}")
            entry = schedules.setdefault(identifier, {"id": identifier, "name": name, "groups": []})
            entry["groups"].append(group)

    manifest = []
    for identifier, entry in sorted(schedules.items()):
        record = dict(entry)
        status, _, body = client.request("POST", "/data/schedule/getGroupScheduleInfo", {"gscheduleId": identifier})
        info = json_body(status, body, f"getGroupScheduleInfo {identifier}")
        if isinstance(info, list) and len(info) == 0:
            record["outcome"] = "no_timetable"
            manifest.append(record)
            continue
        status, kind, body = client.request("GET", f"/data/schedule/downScheduleExcel?gscheduleId={urllib.parse.quote(identifier)}")
        if status != 200 or not body.startswith(b"PK"):
            record.update(outcome="download_failed", httpStatus=status, contentType=kind)
            manifest.append(record)
            continue
        path = raw / f"{identifier}.xlsx"
        path.write_bytes(body)
        record.update(file=f"raw/{path.name}", bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
        parse_into(args.out, record, retrieved_on)
        manifest.append(record)
        print(f"{identifier} {entry['name']}: {record['outcome']}")

    counts = tally(manifest)
    summary = {
        "label": "OFFICIAL_DATED",
        "source": PAGE,
        "dataset": "data.go.kr 3043887",
        "retrievedOn": retrieved_on,
        "retrievedAt": started.isoformat(timespec="seconds"),
        "parser": {"name": jeju_xlsx.PARSER_NAME, "version": jeju_xlsx.PARSER_VERSION},
        "routeGroups": types,
        "counts": counts,
        "timetables": manifest,
    }
    (args.out / "manifest.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
