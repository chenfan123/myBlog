"""向量检索自检：分层 child 或混合检索（三路 + Rerank）。

用法:
    python -m backend.verify_retrieval
    python -m backend.verify_retrieval --query "胃痛反酸挂什么科"
    python -m backend.verify_retrieval --hybrid
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pymilvus import MilvusClient

from backend.config import PROJECT_ROOT, get_settings
from backend.db import get_session_factory
from backend.dept_parent_db import get_dept_parents_by_ids
from backend.embed import build_embeddings, ensure_milvus_database
from backend.retriever import DepartmentRetriever, DeptHit

DEFAULT_QUERIES = [
    "胃痛反酸挂什么科",
    "胸口闷痛怀疑心脏问题",
    "甲状腺结节要看哪个科",
    "孩子发烧咳嗽",
    "皮肤起红疹很痒",
    "关节痛类风湿",
    "失眠焦虑睡不着",
    "体检发现肺结节",
    "乳腺癌术后复查",
    "痔疮便血",
]


@dataclass
class Hit:
    rank: int
    score: float
    dept_name: str
    section: str
    parent_id: str
    text_preview: str
    parent_preview: str | None
    parent_found: bool


def search_hierarchical(
    query: str,
    *,
    top_k: int = 5,
) -> list[Hit]:
    settings = get_settings()
    embed_model = build_embeddings(settings)
    query_vector = embed_model.embed_query(query)

    client = MilvusClient(uri=settings.milvus_uri)
    ensure_milvus_database(client, settings.milvus_db)
    collection = settings.milvus_dept_hier_collection

    raw = client.search(
        collection_name=collection,
        data=[query_vector],
        limit=top_k,
        output_fields=[
            "chunk_id",
            "dept_id",
            "dept_name",
            "section",
            "parent_id",
            "text",
        ],
    )
    hits_raw = raw[0] if raw else []

    parent_ids = [h["entity"]["parent_id"] for h in hits_raw if h["entity"].get("parent_id")]
    factory = get_session_factory()
    with factory() as session:
        parents = get_dept_parents_by_ids(session, parent_ids)

    hits: list[Hit] = []
    for rank, item in enumerate(hits_raw, start=1):
        entity = item["entity"]
        pid = entity.get("parent_id", "")
        parent = parents.get(pid)
        hits.append(
            Hit(
                rank=rank,
                score=float(item["distance"]),
                dept_name=entity.get("dept_name", ""),
                section=entity.get("section", ""),
                parent_id=pid,
                text_preview=_preview(entity.get("text", ""), 120),
                parent_preview=_preview(parent["text"], 120) if parent else None,
                parent_found=parent is not None,
            )
        )
    return hits


def _preview(text: str, n: int) -> str:
    t = " ".join(text.split())
    return t if len(t) <= n else t[: n - 1] + "…"


def _analyze_hits(query: str, hits: list[Hit]) -> dict[str, Any]:
    dept_names = [h.dept_name for h in hits]
    sections = [h.section or "(根)" for h in hits]
    return {
        "query": query,
        "top1": {
            "dept": hits[0].dept_name if hits else None,
            "section": hits[0].section if hits else None,
            "score": hits[0].score if hits else None,
        },
        "unique_depts_top3": len(set(dept_names[:3])),
        "parent_recall": sum(1 for h in hits if h.parent_found) / len(hits) if hits else 0,
        "score_gap_1_2": (hits[0].score - hits[1].score) if len(hits) >= 2 else None,
        "dept_distribution": dict(Counter(dept_names)),
        "section_distribution": dict(Counter(sections)),
    }


def _analyze_hybrid_hits(query: str, hits: list[DeptHit]) -> dict[str, Any]:
    dept_names = [h.dept_name for h in hits]
    return {
        "query": query,
        "mode": "hybrid",
        "top1": {
            "dept": hits[0].dept_name if hits else None,
            "score": hits[0].rerank_score or hits[0].fused_score if hits else None,
            "sources": hits[0].sources if hits else [],
        },
        "unique_depts_top3": len(set(dept_names[:3])),
        "parent_recall": sum(1 for h in hits if h.parent_text) / len(hits) if hits else 0,
        "dept_distribution": dict(Counter(dept_names)),
    }


def run_hybrid_self_check(
    *,
    queries: list[str],
    top_k: int = 5,
    rerank: bool = True,
) -> dict[str, Any]:
    settings = get_settings()
    retriever = DepartmentRetriever()
    report: dict[str, Any] = {
        "mode": "hybrid",
        "milvus": {
            "mapping": f"{settings.milvus_db}.{settings.milvus_mapping_collection}",
            "dept_child": f"{settings.milvus_db}.{settings.milvus_dept_hier_collection}",
        },
        "embedding_model": settings.embedding_model,
        "rerank": rerank,
        "top_k": top_k,
        "queries": [],
        "summary": {},
    }

    parent_ok = 0
    parent_total = 0
    multi_source = 0

    for query in queries:
        hits = retriever.search_departments(query, top_k=top_k, rerank=rerank)
        analysis = _analyze_hybrid_hits(query, hits)
        parent_ok += sum(1 for h in hits if h.parent_text)
        parent_total += len(hits)
        if hits and len(hits[0].sources) > 1:
            multi_source += 1

        report["queries"].append(
            {
                **analysis,
                "hits": [
                    {
                        "rank": h.rank,
                        "dept_name": h.dept_name,
                        "fused_score": h.fused_score,
                        "rerank_score": h.rerank_score,
                        "sources": h.sources,
                        "matched_keywords": h.matched_keywords,
                        "category_label": h.category_label,
                        "evidence_preview": _preview(h.evidence, 120),
                        "parent_preview": _preview(h.parent_text, 80) if h.parent_text else None,
                    }
                    for h in hits
                ],
            }
        )

        print(f"\n{'=' * 60}")
        print(f"Q: {query} [hybrid{'+rerank' if rerank else ''}]")
        for h in hits:
            score = (
                f"rerank={h.rerank_score:.4f}"
                if h.rerank_score is not None
                else f"fused={h.fused_score:.4f}"
            )
            src = "+".join(h.sources)
            print(f"  #{h.rank} {score} | {h.dept_name} | [{src}]")
            if h.matched_keywords:
                print(f"      关键词: {', '.join(h.matched_keywords)}")
            print(f"      依据: {_preview(h.evidence, 100)}")

    report["summary"] = {
        "query_count": len(queries),
        "parent_recall": round(parent_ok / parent_total, 4) if parent_total else 0,
        "top1_multi_source_count": multi_source,
    }

    out = PROJECT_ROOT / "data" / "vectorstore" / "retrieval_hybrid_check.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'=' * 60}")
    print("汇总 [hybrid]")
    print(f"  parent 回查成功率: {report['summary']['parent_recall']:.1%}")
    print(f"  Top1 多源命中: {multi_source}/{len(queries)}")
    print(f"  报告: {out.relative_to(PROJECT_ROOT)}")
    return report


def run_self_check(*, queries: list[str], top_k: int = 5) -> dict[str, Any]:
    settings = get_settings()
    report: dict[str, Any] = {
        "milvus": f"{settings.milvus_db}.{settings.milvus_dept_hier_collection}",
        "embedding_model": settings.embedding_model,
        "top_k": top_k,
        "queries": [],
        "summary": {},
    }

    parent_ok = 0
    parent_total = 0
    top1_scores: list[float] = []
    ambiguous = 0

    for query in queries:
        hits = search_hierarchical(query, top_k=top_k)
        analysis = _analyze_hits(query, hits)
        parent_ok += sum(1 for h in hits if h.parent_found)
        parent_total += len(hits)
        if hits:
            top1_scores.append(hits[0].score)
        if len(hits) >= 2 and hits[0].score - hits[1].score < 0.03:
            ambiguous += 1

        report["queries"].append(
            {
                **analysis,
                "hits": [
                    {
                        "rank": h.rank,
                        "score": round(h.score, 4),
                        "dept_name": h.dept_name,
                        "section": h.section,
                        "parent_id": h.parent_id,
                        "parent_found": h.parent_found,
                        "text_preview": h.text_preview,
                        "parent_preview": h.parent_preview,
                    }
                    for h in hits
                ],
            }
        )

        print(f"\n{'=' * 60}")
        print(f"Q: {query}")
        for h in hits:
            flag = "✓" if h.parent_found else "✗"
            print(
                f"  #{h.rank} score={h.score:.4f} | {h.dept_name} · {h.section or '根'} | parent {flag}"
            )
            print(f"      child: {h.text_preview}")
            if h.parent_preview:
                print(f"      parent: {h.parent_preview}")

    report["summary"] = {
        "query_count": len(queries),
        "parent_recall": round(parent_ok / parent_total, 4) if parent_total else 0,
        "avg_top1_score": round(sum(top1_scores) / len(top1_scores), 4) if top1_scores else 0,
        "min_top1_score": round(min(top1_scores), 4) if top1_scores else 0,
        "max_top1_score": round(max(top1_scores), 4) if top1_scores else 0,
        "ambiguous_queries_top1_top2_lt_0.03": ambiguous,
    }

    out = PROJECT_ROOT / "data" / "vectorstore" / "retrieval_self_check.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{'=' * 60}")
    print("汇总")
    print(f"  parent 回查成功率: {report['summary']['parent_recall']:.1%}")
    print(f"  Top1 分数均值: {report['summary']['avg_top1_score']:.4f} "
          f"(范围 {report['summary']['min_top1_score']:.4f}~{report['summary']['max_top1_score']:.4f})")
    print(f"  Top1/Top2 分差 <0.03 的模糊 query: {ambiguous}/{len(queries)}")
    print(f"  报告: {out.relative_to(PROJECT_ROOT)}")
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="科室检索自检（child 或 hybrid）")
    parser.add_argument("--query", action="append", help="自定义测试问题，可重复")
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument(
        "--hybrid",
        action="store_true",
        help="使用三路混合检索 + Rerank（默认仅 child 向量）",
    )
    parser.add_argument("--no-rerank", action="store_true", help="hybrid 模式下跳过 Rerank")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    queries = args.query or DEFAULT_QUERIES
    if args.hybrid:
        run_hybrid_self_check(queries=queries, top_k=args.top_k, rerank=not args.no_rerank)
    else:
        run_self_check(queries=queries, top_k=args.top_k)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
