"""知识库检索质量评估：Top1 / Top3 命中率（准确率）。

按 PRD 门槛：
    Top-1 准确率 ≥ 70%
    Top-3 准确率 ≥ 90%
    主推落在医技平台/非法科室的误推率 = 0

标注集格式（JSONL，每行一条）:
    {
      "id": "q001",
      "query": "甲状腺结节要看哪个科",
      "primary": ["甲状腺外科"],           # Top1 期望主推（任一命中即算 Top1@primary）
      "acceptable": ["甲状腺外科", "内分泌科"],  # Top3 可接受集合（含 primary）
      "category": "甲状腺"                 # 可选，用于分科室统计
    }

指标定义:
    Top1@primary     Top1 科室 ∈ primary
    Top1@acceptable  Top1 科室 ∈ acceptable（更宽松）
    Top3@acceptable  Top1~Top3 中任一 ∈ acceptable
    误推率           Top1 落在医技平台科室或非白名单科室

用法:
    python -m backend.eval_retrieval
    python -m backend.eval_retrieval --golden data/eval/golden_dept_queries.jsonl
    python -m backend.eval_retrieval --no-rerank --top-k 5
    python -m backend.eval_retrieval --limit 10   # 调试只跑前 N 条
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import PROJECT_ROOT
from backend.dept_whitelist import CLINICAL_DEPT_NAMES, PLATFORM_DEPT_NAMES, is_recommendable_dept
from backend.retriever import DepartmentRetriever, DeptHit

DEFAULT_GOLDEN = PROJECT_ROOT / "data" / "eval" / "golden_dept_queries.jsonl"
DEFAULT_REPORT = PROJECT_ROOT / "data" / "eval" / "retrieval_eval_report.json"

# PRD 上线门槛
THRESHOLD_TOP1 = 0.70
THRESHOLD_TOP3 = 0.90


@dataclass
class GoldenCase:
    id: str
    query: str
    primary: list[str]
    acceptable: list[str]
    category: str = ""
    notes: str = ""


@dataclass
class CaseResult:
    id: str
    query: str
    category: str
    primary: list[str]
    acceptable: list[str]
    predicted: list[str]
    top1: str | None
    top1_hit_primary: bool
    top1_hit_acceptable: bool
    top3_hit_acceptable: bool
    illegal_top1: bool  # 医技平台或非临床白名单
    sources_top1: list[str] = field(default_factory=list)
    scores: list[dict[str, Any]] = field(default_factory=list)


def load_golden(path: Path) -> list[GoldenCase]:
    if not path.is_file():
        raise FileNotFoundError(f"缺少标注集: {path}")
    cases: list[GoldenCase] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        data = json.loads(line)
        primary = list(data.get("primary") or [])
        acceptable = list(data.get("acceptable") or primary)
        # 保证 primary ⊆ acceptable
        for p in primary:
            if p not in acceptable:
                acceptable.append(p)
        if not primary:
            raise ValueError(f"{path}:{line_no} 缺少 primary")
        cases.append(
            GoldenCase(
                id=str(data.get("id") or f"line{line_no}"),
                query=data["query"].strip(),
                primary=primary,
                acceptable=acceptable,
                category=data.get("category") or "",
                notes=data.get("notes") or "",
            )
        )
    return cases


def _predicted_names(hits: list[DeptHit], top_k: int) -> list[str]:
    return [h.dept_name for h in hits[:top_k]]


def evaluate_case(
    case: GoldenCase,
    hits: list[DeptHit],
    *,
    top_k: int = 3,
) -> CaseResult:
    predicted = _predicted_names(hits, top_k)
    top1 = predicted[0] if predicted else None
    top1_hit_primary = top1 in case.primary if top1 else False
    top1_hit_acceptable = top1 in case.acceptable if top1 else False
    top3_hit_acceptable = any(d in case.acceptable for d in predicted)

    illegal = False
    if top1:
        # 医技平台或非临床白名单 → 误推
        illegal = top1 in PLATFORM_DEPT_NAMES or not is_recommendable_dept(top1)

    scores = []
    for h in hits[:top_k]:
        scores.append(
            {
                "rank": h.rank,
                "dept_name": h.dept_name,
                "fused_score": h.fused_score,
                "rerank_score": h.rerank_score,
                "sources": h.sources,
            }
        )

    return CaseResult(
        id=case.id,
        query=case.query,
        category=case.category,
        primary=case.primary,
        acceptable=case.acceptable,
        predicted=predicted,
        top1=top1,
        top1_hit_primary=top1_hit_primary,
        top1_hit_acceptable=top1_hit_acceptable,
        top3_hit_acceptable=top3_hit_acceptable,
        illegal_top1=illegal,
        sources_top1=list(hits[0].sources) if hits else [],
        scores=scores,
    )


def summarize(results: list[CaseResult]) -> dict[str, Any]:
    n = len(results)
    if n == 0:
        return {"n": 0}

    top1_p = sum(1 for r in results if r.top1_hit_primary) / n
    top1_a = sum(1 for r in results if r.top1_hit_acceptable) / n
    top3_a = sum(1 for r in results if r.top3_hit_acceptable) / n
    illegal = sum(1 for r in results if r.illegal_top1) / n

    by_cat: dict[str, dict[str, float]] = {}
    cat_groups: dict[str, list[CaseResult]] = defaultdict(list)
    for r in results:
        cat_groups[r.category or "未分类"].append(r)
    for cat, group in sorted(cat_groups.items()):
        m = len(group)
        by_cat[cat] = {
            "n": m,
            "top1_primary": round(sum(1 for r in group if r.top1_hit_primary) / m, 4),
            "top1_acceptable": round(sum(1 for r in group if r.top1_hit_acceptable) / m, 4),
            "top3_acceptable": round(sum(1 for r in group if r.top3_hit_acceptable) / m, 4),
        }

    miss_top1 = [r for r in results if not r.top1_hit_primary]
    miss_top3 = [r for r in results if not r.top3_hit_acceptable]
    illegal_cases = [r for r in results if r.illegal_top1]

    return {
        "n": n,
        "top1_primary": round(top1_p, 4),
        "top1_acceptable": round(top1_a, 4),
        "top3_acceptable": round(top3_a, 4),
        "illegal_top1_rate": round(illegal, 4),
        "thresholds": {
            "top1": THRESHOLD_TOP1,
            "top3": THRESHOLD_TOP3,
            "illegal": 0.0,
        },
        "pass": {
            # PRD 口径：Top1 用 primary，Top3 用 acceptable
            "top1": top1_p >= THRESHOLD_TOP1,
            "top3": top3_a >= THRESHOLD_TOP3,
            "illegal": illegal == 0.0,
        },
        "by_category": by_cat,
        "miss_top1_ids": [r.id for r in miss_top1],
        "miss_top3_ids": [r.id for r in miss_top3],
        "illegal_ids": [r.id for r in illegal_cases],
        "top1_pred_distribution": dict(Counter(r.top1 for r in results if r.top1)),
    }


def run_eval(
    *,
    golden_path: Path = DEFAULT_GOLDEN,
    top_k: int = 3,
    rerank: bool = True,
    limit: int | None = None,
) -> dict[str, Any]:
    golden_path = Path(golden_path)
    if not golden_path.is_absolute():
        golden_path = PROJECT_ROOT / golden_path
    cases = load_golden(golden_path)
    if limit is not None:
        cases = cases[:limit]

    retriever = DepartmentRetriever()
    results: list[CaseResult] = []

    try:
        golden_display = str(golden_path.relative_to(PROJECT_ROOT))
    except ValueError:
        golden_display = str(golden_path)

    print(f"标注集: {golden_display} ({len(cases)} 条)")
    print(f"模式: hybrid{'+rerank' if rerank else ''}  top_k={top_k}")
    print("=" * 72)

    for i, case in enumerate(cases, start=1):
        hits = retriever.search_departments(case.query, top_k=top_k, rerank=rerank)
        result = evaluate_case(case, hits, top_k=top_k)
        results.append(result)

        mark1 = "✓" if result.top1_hit_primary else ("≈" if result.top1_hit_acceptable else "✗")
        mark3 = "✓" if result.top3_hit_acceptable else "✗"
        illegal = " ⚠非法" if result.illegal_top1 else ""
        print(
            f"[{i:02d}/{len(cases)}] {mark1}Top1 {mark3}Top3{illegal} | {case.id} | {case.query}"
        )
        print(f"         pred={result.predicted}  expect_primary={case.primary}")

    summary = summarize(results)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "golden": golden_display,
        "rerank": rerank,
        "top_k": top_k,
        "summary": summary,
        "cases": [asdict(r) for r in results],
    }

    DEFAULT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print("=" * 72)
    print("汇总")
    print(f"  样本数:              {summary['n']}")
    print(f"  Top1@primary:        {summary['top1_primary']:.1%}  "
          f"(门槛 ≥{THRESHOLD_TOP1:.0%})  "
          f"{'PASS' if summary['pass']['top1'] else 'FAIL'}")
    print(f"  Top1@acceptable:     {summary['top1_acceptable']:.1%}  (宽松参考)")
    print(f"  Top3@acceptable:     {summary['top3_acceptable']:.1%}  "
          f"(门槛 ≥{THRESHOLD_TOP3:.0%})  "
          f"{'PASS' if summary['pass']['top3'] else 'FAIL'}")
    print(f"  误推率(平台/非法):   {summary['illegal_top1_rate']:.1%}  "
          f"(门槛 =0%)  "
          f"{'PASS' if summary['pass']['illegal'] else 'FAIL'}")
    if summary["miss_top1_ids"]:
        print(f"  Top1 未命中:         {', '.join(summary['miss_top1_ids'])}")
    if summary["miss_top3_ids"]:
        print(f"  Top3 未命中:         {', '.join(summary['miss_top3_ids'])}")
    print(f"  报告: {DEFAULT_REPORT.relative_to(PROJECT_ROOT)}")

    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="知识库检索 Top1/Top3 质量评估")
    parser.add_argument(
        "--golden",
        type=Path,
        default=DEFAULT_GOLDEN,
        help="标注 JSONL 路径",
    )
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--no-rerank", action="store_true")
    parser.add_argument("--limit", type=int, default=None, help="只评前 N 条（调试）")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = run_eval(
        golden_path=args.golden,
        top_k=args.top_k,
        rerank=not args.no_rerank,
        limit=args.limit,
    )
    summary = report["summary"]
    # 任一硬门槛未过则非 0 退出，便于 CI
    ok = summary["pass"]["top1"] and summary["pass"]["top3"] and summary["pass"]["illegal"]
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
