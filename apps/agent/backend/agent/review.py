"""推荐科室 LLM 复核：只能在检索候选中择一，不可虚构科室。"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from backend.llm import build_chat_model


@dataclass
class ReviewResult:
    accepted: bool
    primary_idx: int = 0
    alt_idx: int | None = 1
    reason: str = ""
    reject_reason: str = ""
    raw: str = ""


_REVIEW_SYSTEM = (
    "你是医院导诊质控复核员。任务：根据患者症状描述，从「候选科室列表」中选出最合适的主推"
    "与可选备选。硬性规则：\n"
    "1. 只能使用候选列表中的科室，禁止编造列表外的科室名；\n"
    "2. 不得诊断疾病、不得开药；\n"
    "3. 若候选整体都不合理或信息不足，必须拒绝推荐；\n"
    "4. 若主推偏向肿瘤外科/肿瘤内科/放疗等重大专科，但患者未提供年龄或关键病史，必须 accept=false；\n"
    "5. 只输出一个 JSON 对象，不要 Markdown，不要解释。\n"
    "说明：专科路由先验已由系统规则层处理，你只需在候选中做合理性复核与排序微调。"
)


def review_department_candidates(
    *,
    symptom_summary: str,
    candidates: list[dict[str, Any]],
) -> ReviewResult:
    """对检索候选做 LLM 复核。

    Returns:
        ReviewResult.accepted=False 时应走兜底；True 时按 primary_idx/alt_idx 取候选。
        LLM 调用失败时 fail-open：接受检索 Top1（仍不虚构科室）；但重大专科缺年龄时 fail-closed。
    """
    if not candidates:
        return ReviewResult(accepted=False, reject_reason="无候选")

    from backend.agent.sufficiency import has_age_info, is_high_stakes_dept

    # 规则闸：肿瘤等重大专科缺年龄，直接拒绝（不交给模型强推）
    top_name = candidates[0].get("dept_name") or ""
    if is_high_stakes_dept(top_name) and not has_age_info(symptom_summary or ""):
        return ReviewResult(
            accepted=False,
            reject_reason="重大专科推荐前缺少年龄等信息",
        )

    lines = []
    for i, c in enumerate(candidates):
        lines.append(
            f"{i}. {c.get('dept_name')} | 分={c.get('score')} | "
            f"标签={c.get('category_label') or '-'} | "
            f"依据={_clip(c.get('evidence') or '', 100)}"
        )
    user = (
        f"患者描述：{symptom_summary or '（空）'}\n"
        f"候选科室：\n" + "\n".join(lines) + "\n\n"
        "请输出 JSON，字段：\n"
        '{"accept":true/false,"primary_idx":0,"alt_idx":1或null,'
        '"reason":"一句话理由","reject_reason":"拒绝时填写"}\n'
        "primary_idx/alt_idx 必须是候选下标；accept=false 时可不填下标。"
    )

    try:
        llm = build_chat_model(temperature=0)
        msg = llm.invoke(
            [
                {"role": "system", "content": _REVIEW_SYSTEM},
                {"role": "user", "content": user},
            ]
        )
        raw = getattr(msg, "content", str(msg)).strip()
        data = _parse_json_obj(raw)
        if not data:
            return ReviewResult(
                accepted=True,
                primary_idx=0,
                alt_idx=1 if len(candidates) > 1 else None,
                reason="复核解析失败，沿用检索排序",
                raw=raw,
            )

        if not bool(data.get("accept", False)):
            return ReviewResult(
                accepted=False,
                reject_reason=str(data.get("reject_reason") or "复核未通过"),
                raw=raw,
            )

        n = len(candidates)
        primary_idx = _safe_idx(data.get("primary_idx"), n, default=0)
        alt_raw = data.get("alt_idx", None)
        if alt_raw is None or alt_raw == "null":
            alt_idx = 1 if n > 1 and primary_idx != 1 else (None if n <= 1 else 0)
            if alt_idx == primary_idx:
                alt_idx = next((i for i in range(n) if i != primary_idx), None)
        else:
            alt_idx = _safe_idx(alt_raw, n, default=None)
            if alt_idx == primary_idx:
                alt_idx = next((i for i in range(n) if i != primary_idx), None)

        return ReviewResult(
            accepted=True,
            primary_idx=primary_idx,
            alt_idx=alt_idx,
            reason=str(data.get("reason") or "").strip(),
            raw=raw,
        )
    except Exception as exc:
        return ReviewResult(
            accepted=True,
            primary_idx=0,
            alt_idx=1 if len(candidates) > 1 else None,
            reason=f"复核服务暂不可用，沿用检索排序（{type(exc).__name__}）",
            raw="",
        )


def _safe_idx(value: Any, n: int, default: int | None) -> int | None:
    try:
        idx = int(value)
    except (TypeError, ValueError):
        return default
    if idx < 0 or idx >= n:
        return default
    return idx


def _parse_json_obj(text: str) -> dict[str, Any] | None:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t)
        t = re.sub(r"\s*```$", "", t)
    try:
        obj = json.loads(t)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None


def _clip(text: str, n: int) -> str:
    t = " ".join(text.split())
    return t if len(t) <= n else t[: n - 1] + "…"
