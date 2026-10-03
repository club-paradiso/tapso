#!/usr/bin/env python3
"""Generate the Korean public-holiday calendar TAPSO uses to pick a timetable's day type.

    pip install holidays==0.105
    python3 scripts/calendar/generate_kr_holidays.py > services/api/data/kr-public-holidays.json

The dates come from the `holidays` library (python-holidays), category PUBLIC,
which implements 관공서의 공휴일에 관한 규정 and 공휴일에 관한 법률 including
substitute holidays (대체공휴일) and election days, with lunar dates computed
from its Korean lunisolar tables. The library's own cited sources are copied
into the file. A date the library marks as estimated ("추정") is refused.

What a library cannot know: 임시공휴일 designated by a cabinet decision after
its release. Those go in OVERRIDES below, each with the announcement that
designated it, and the file's `validThrough` bounds what TAPSO may claim.
"""

from __future__ import annotations

import json
import sys

import holidays

FIRST_YEAR, LAST_YEAR = 2024, 2028
# {"date": "YYYY-MM-DD", "name": "...", "source": "<announcement URL>"} to add;
# {"date": ..., "reason": ...} to remove. Empty until an announcement is read.
OVERRIDES: dict[str, list[dict[str, str]]] = {"add": [], "remove": []}

SOURCES = [
    "https://www.law.go.kr/법령/관공서의%20공휴일에%20관한%20규정",
    "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=283311&ancYd=20260210 (공휴일에 관한 법률, 2026 amendment)",
    "https://www.mpm.go.kr/mpm/comm/newsPress/newsPressRelease/?boardId=bbs_0000000000000029&cntId=4250&mode=view (인사혁신처: Labor Day and Constitution Day substitute holidays)",
]


def main() -> int:
    calendar = holidays.KR(years=range(FIRST_YEAR, LAST_YEAR + 1), categories=(holidays.PUBLIC,), language="ko")
    entries = []
    for day, name in sorted(calendar.items()):
        if "추정" in name:
            print(f"refusing an estimated date: {day} {name}", file=sys.stderr)
            return 1
        entries.append({"date": day.isoformat(), "name": name})
    removed = {item["date"] for item in OVERRIDES["remove"]}
    entries = [entry for entry in entries if entry["date"] not in removed]
    entries += [{"date": item["date"], "name": item["name"], "source": item["source"]} for item in OVERRIDES["add"]]
    entries.sort(key=lambda entry: entry["date"])
    json.dump(
        {
            "schemaVersion": "tapso-kr-public-holidays-v1",
            "label": "OFFICIAL_DERIVED",
            "jurisdiction": "KR",
            "category": "관공서의 공휴일 (public holidays, including substitute holidays and election days)",
            "validFrom": f"{FIRST_YEAR}-01-01",
            "validThrough": f"{LAST_YEAR}-12-31",
            "generator": {"library": "holidays", "version": holidays.__version__, "category": "public"},
            "sources": SOURCES,
            "overrides": OVERRIDES,
            "holidays": entries,
        },
        sys.stdout,
        ensure_ascii=False,
        indent=1,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
