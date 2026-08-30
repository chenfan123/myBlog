"""急诊危重红旗识别（规则兜底）。

PRD F2：每轮对话先跑急诊判断；命中则强提示 + 阻断常规分诊。
原则：规则优先于模型，宁误报不漏报。

用法:
    python -m backend.emergency --text "剧烈胸痛大汗淋漓"
    from backend.emergency import assess_emergency
"""

from __future__ import annotations

import argparse
import re
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class RedFlagRule:
    """单条红旗规则。"""

    category: str
    label: str  # 中文类别名，用于提示
    patterns: tuple[str, ...]  # 正则；任一命中即触发该类


@dataclass
class EmergencyResult:
    """急诊评估结果（供 LangGraph / API 消费）。"""

    triggered: bool
    categories: list[str] = field(default_factory=list)
    category_labels: list[str] = field(default_factory=list)
    matched_terms: list[str] = field(default_factory=list)
    message: str = ""
    block_routine: bool = False
    high_risk: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# 与 PRD 对齐的规则表（偏召回）
_RULES: tuple[RedFlagRule, ...] = (
    RedFlagRule(
        category="chest_pain",
        label="可疑急性胸痛/心脏急症",
        patterns=(
            r"剧烈.{0,4}胸痛",
            r"突发.{0,4}胸痛",
            r"持续.{0,4}胸痛",
            r"胸痛.{0,8}(大汗|冷汗|濒死|放射|压榨)",
            r"(大汗|冷汗).{0,8}胸痛",
            r"胸口剧痛",
            r"心前区剧痛",
            r"压榨样胸",
            r"胸痛",  # 宁误报：单独「胸痛」也触发
        ),
    ),
    RedFlagRule(
        category="consciousness",
        label="意识障碍/抽搐",
        patterns=(
            r"意识(不清|模糊|丧失|障碍)",
            r"昏迷",
            r"晕倒",
            r"昏厥",
            r"抽搐",
            r"癫痫大发作",
            r"呼之不应",
            r"不省人事",
        ),
    ),
    RedFlagRule(
        category="respiratory",
        label="严重呼吸困难/窒息",
        patterns=(
            r"喘不上气",
            r"呼吸困难",
            r"呼吸急促",
            r"窒息",
            r"憋得慌",
            r"嘴唇发紫",
            r"口唇紫绀",
            r"不能平卧.*喘",
            r"急性呼吸窘迫",
        ),
    ),
    RedFlagRule(
        category="bleeding",
        label="大出血/呕血便血",
        patterns=(
            r"大出血",
            r"大量呕血",
            r"呕血",
            r"大量便血",
            r"柏油样便",
            r"喷射状出血",
            r"鲜血喷出",
            r"止血不止",
            r"流血不止",
        ),
    ),
    RedFlagRule(
        category="stroke",
        label="疑似卒中",
        patterns=(
            r"突发.{0,6}(口角歪斜|说话不清|说不出话|言语不清)",
            r"一侧(肢体)?(无力|偏瘫|麻木)",
            r"突然.{0,4}(偏瘫|瘫痪)",
            r"说话不利索",
            r"面瘫",
            r"卒中",
            r"中风发作",
            r"脑梗急性",
        ),
    ),
    RedFlagRule(
        category="acute_abdomen",
        label="急腹症迹象",
        patterns=(
            r"板状腹",
            r"剧烈腹痛",
            r"突发剧痛.*腹",
            r"腹痛.{0,6}(板状|腹膜刺激|拒按)",
            r"急腹症",
            r"胃穿孔",
            r"肠穿孔",
        ),
    ),
    RedFlagRule(
        category="fever_meningeal",
        label="高热伴危险征象",
        patterns=(
            r"(高热|发热|发烧).{0,12}(颈强直|脖子硬|皮疹|出血点|抽搐|惊厥)",
            r"(颈强直|脖子硬).{0,12}(发热|高热|发烧)",
            r"瘀点瘀斑.{0,6}(发热|高热|发烧)",
            r"高热惊厥",
            r"发热伴颈抵抗",
        ),
    ),
    RedFlagRule(
        category="trauma",
        label="严重外伤/烧伤",
        patterns=(
            r"严重外伤",
            r"多发伤",
            r"车祸.{0,6}(昏迷|骨折|大出血)",
            r"高空坠落",
            r"严重烧伤",
            r"大面积烧伤",
            r"刀刺伤",
            r"开放性颅脑",
        ),
    ),
    RedFlagRule(
        category="anaphylaxis_poisoning",
        label="过敏休克/疑似中毒",
        patterns=(
            r"过敏性休克",
            r"过敏休克",
            r"喉头水肿",
            r"全身风团.*呼吸困难",
            r"药物中毒",
            r"农药中毒",
            r"服毒",
            r"过量服药",
            r"一氧化碳中毒",
            r"煤气中毒",
        ),
    ),
)

_COMPILED: list[tuple[RedFlagRule, list[re.Pattern[str]]]] = [
    (rule, [re.compile(p) for p in rule.patterns]) for rule in _RULES
]

_DISCLAIMER = (
    "本提示仅为导诊安全提醒，不能替代医生诊查与急救处置。"
)


def build_emergency_message(*, category_labels: list[str]) -> str:
    """构造面向患者的急诊强提示。"""
    labels = "、".join(category_labels) if category_labels else "危急重症迹象"
    return (
        f"根据您描述的情况，系统识别到可能的【{labels}】相关危急信号。\n"
        "请立即拨打 120，或尽快前往就近医院急诊科就诊，不要等待线上导诊完成。\n"
        "在专业人员到达前，请尽量保持冷静，避免自行用药或剧烈活动。\n"
        f"{_DISCLAIMER}"
    )


def assess_emergency(text: str) -> EmergencyResult:
    """对用户文本做急诊红旗评估。

    Args:
        text: 当轮用户输入（调用方可将多轮关键句拼接后传入）。
    """
    raw = (text or "").strip()
    if not raw:
        return EmergencyResult(triggered=False)

    categories: list[str] = []
    labels: list[str] = []
    matched: list[str] = []

    for rule, patterns in _COMPILED:
        for pat in patterns:
            m = pat.search(raw)
            if m:
                if rule.category not in categories:
                    categories.append(rule.category)
                    labels.append(rule.label)
                term = m.group(0)
                if term not in matched:
                    matched.append(term)
                break  # 该类已命中，看下一类

    if not categories:
        return EmergencyResult(triggered=False)

    return EmergencyResult(
        triggered=True,
        categories=categories,
        category_labels=labels,
        matched_terms=matched,
        message=build_emergency_message(category_labels=labels),
        block_routine=True,
        high_risk=True,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="急诊红旗规则检测")
    parser.add_argument("--text", required=True, help="用户症状描述")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    return parser.parse_args()


def main() -> int:
    import json

    args = parse_args()
    result = assess_emergency(args.text)
    if args.json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
    else:
        print(f"triggered={result.triggered} block_routine={result.block_routine} "
              f"high_risk={result.high_risk}")
        if result.triggered:
            print(f"categories={result.categories}")
            print(f"matched={result.matched_terms}")
            print("---")
            print(result.message)
        else:
            print("未命中急诊红旗，可继续常规导诊。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
