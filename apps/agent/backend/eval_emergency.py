"""急诊红旗规则评测：应触发样本的触发率（PRD ≥95%）。

用法:
    python -m backend.eval_emergency
    python -m backend.eval_emergency --golden data/eval/golden_emergency.jsonl
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import PROJECT_ROOT
from backend.emergency import assess_emergency

DEFAULT_GOLDEN = PROJECT_ROOT / "data" / "eval" / "golden_emergency.jsonl"
DEFAULT_REPORT = PROJECT_ROOT / "data" / "eval" / "emergency_eval_report.json"
THRESHOLD_TRIGGER_RATE = 0.95


def load_cases(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        raise FileNotFoundError(f"缺少安全标注集: {path}")
    cases: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            cases.append(json.loads(line))
    return cases


def run_eval(*, golden_path: Path = DEFAULT_GOLDEN) -> dict[str, Any]:
    golden_path = Path(golden_path)
    if not golden_path.is_absolute():
        golden_path = PROJECT_ROOT / golden_path

    cases = load_cases(golden_path)
    positive = [c for c in cases if c.get("expect_trigger")]
    negative = [c for c in cases if not c.get("expect_trigger")]

    pos_hits = 0
    neg_false = 0
    details: list[dict[str, Any]] = []

    print(f"安全标注集: {golden_path.relative_to(PROJECT_ROOT)} "
          f"(应触发 {len(positive)} / 负例 {len(negative)})")
    print("=" * 64)

    for case in cases:
        result = assess_emergency(case["text"])
        expect = bool(case.get("expect_trigger"))
        ok = result.triggered == expect
        if expect and result.triggered:
            pos_hits += 1
        if (not expect) and result.triggered:
            neg_false += 1

        mark = "✓" if ok else "✗"
        print(f"{mark} {case['id']} expect={expect} got={result.triggered} | {case['text']}")
        if result.triggered:
            print(f"    cats={result.categories} matched={result.matched_terms}")

        details.append(
            {
                "id": case["id"],
                "text": case["text"],
                "expect_trigger": expect,
                "triggered": result.triggered,
                "ok": ok,
                "categories": result.categories,
                "matched_terms": result.matched_terms,
                "block_routine": result.block_routine,
                "high_risk": result.high_risk,
            }
        )

    trigger_rate = pos_hits / len(positive) if positive else 0.0
    false_alarm_rate = neg_false / len(negative) if negative else 0.0
    passed = trigger_rate >= THRESHOLD_TRIGGER_RATE

    summary = {
        "n_positive": len(positive),
        "n_negative": len(negative),
        "trigger_rate": round(trigger_rate, 4),
        "false_alarm_rate": round(false_alarm_rate, 4),
        "threshold_trigger_rate": THRESHOLD_TRIGGER_RATE,
        "pass": passed,
        "miss_positive_ids": [
            d["id"] for d in details if d["expect_trigger"] and not d["triggered"]
        ],
        "false_positive_ids": [
            d["id"] for d in details if (not d["expect_trigger"]) and d["triggered"]
        ],
    }

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "golden": str(golden_path.relative_to(PROJECT_ROOT)),
        "summary": summary,
        "cases": details,
    }
    DEFAULT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print("=" * 64)
    print(f"应触发触发率: {trigger_rate:.1%}  (门槛 ≥{THRESHOLD_TRIGGER_RATE:.0%})  "
          f"{'PASS' if passed else 'FAIL'}")
    print(f"负例误报率:   {false_alarm_rate:.1%}  (参考，PRD 优先保召回)")
    if summary["miss_positive_ids"]:
        print(f"漏判: {', '.join(summary['miss_positive_ids'])}")
    if summary["false_positive_ids"]:
        print(f"误报: {', '.join(summary['false_positive_ids'])}")
    print(f"报告: {DEFAULT_REPORT.relative_to(PROJECT_ROOT)}")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="急诊红旗安全评测")
    parser.add_argument("--golden", type=Path, default=DEFAULT_GOLDEN)
    args = parser.parse_args()
    report = run_eval(golden_path=args.golden)
    return 0 if report["summary"]["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
