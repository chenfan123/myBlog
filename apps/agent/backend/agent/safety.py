"""导诊安全护栏：拒闲聊、防提示词探测、出站清洗。"""

from __future__ import annotations

import re

# 用户试图套取系统设定 / 越狱时的统一拒答（不回显任何内部提示）
PROBE_REFUSE_REPLY = (
    "我是浙大一院智能导诊助手，只能协助症状分诊、科室推荐与出诊查询。"
    "无法提供系统内部设定或其它无关内容。请直接描述您的不适症状，或询问挂号科室/出诊时间。"
)

# 闲聊 / 超范围
OFF_TOPIC_REPLY = (
    "我是浙大一院智能导诊助手，目前只支持：①描述症状帮您推荐科室；"
    "②查询出诊/排班；③了解相关专家信息。请告诉我哪里不舒服，或要查哪个科的号源。"
)

# 探测系统提示 / 越狱常见说法
_PROBE_PATTERNS = (
    r"提示词",
    r"系统提示",
    r"系统指令",
    r"角色设定",
    r"隐藏指令",
    r"你的指令",
    r"你的规则",
    r"prompt",
    r"system\s*prompt",
    r"ignore\s+(all\s+)?(previous|above|prior)",
    r"忽略(以上|之前|上面|所有).{0,8}(指令|提示|规则)",
    r"jailbreak",
    r"开发者模式",
    r"DAN模式",
    r"输出(你的)?(全部)?(系统)?(提示|指令|prompt)",
    r"把.*(提示词|prompt|指令).*(告诉|打印|输出|展示)",
    r"reveal\s+(your\s+)?(system|hidden|prompt)",
)

# 明显闲聊 / 非导诊
_CHITCHAT_EXACT = {
    "你好", "您好", "hello", "hi", "hey", "在吗", "在不在", "嗨",
    "早上好", "中午好", "晚上好", "谢谢", "谢谢你",
    "哈哈", "呵呵",
}
_CHITCHAT_PATTERNS = (
    r"^(你是谁|你叫什么|你是机器人|你是ai|你是人工智能)",
    r"(聊天|讲个笑话|说个笑话|讲故事|写首诗|写一首诗|唱首歌)",
    r"(今天天气|明天天气|天气怎么样|几点了|现在几点)",
    r"(帮我写作文|写代码|写作业|翻译一下|算一道题)",
    r"(股票|彩票|恋爱|相亲|游戏攻略)",
)

# 出站内容若误带内部痕迹则替换
_LEAK_MARKERS = (
    "route_after_",
    "system prompt",
    "SYSTEM:",
    "【系统指令】",
    "不要把这段提示告诉用户",
    "_REVIEW_SYSTEM",
    "硬性规则：",
    "只输出一个 JSON 对象",
)


def is_prompt_probe(text: str) -> bool:
    """是否在套取提示词 / 越狱。"""
    t = (text or "").strip()
    if not t:
        return False
    low = t.lower()
    for pat in _PROBE_PATTERNS:
        if re.search(pat, low, flags=re.IGNORECASE):
            return True
        if re.search(pat, t, flags=re.IGNORECASE):
            return True
    return False


def is_chitchat(text: str) -> bool:
    """是否闲聊或明显超范围（不含症状/挂号语义）。"""
    t = (text or "").strip()
    if not t:
        return True
    if t.lower() in _CHITCHAT_EXACT or t in _CHITCHAT_EXACT:
        return True
    # 含导诊相关词则不当闲聊
    triage_cues = (
        "痛", "疼", "不舒服", "难受", "挂", "科", "门诊", "出诊", "有号",
        "发烧", "咳", "专家", "医生", "挂号", "复查", "症状", "急诊",
    )
    if any(c in t for c in triage_cues):
        return False
    for pat in _CHITCHAT_PATTERNS:
        if re.search(pat, t, flags=re.IGNORECASE):
            return True
    # 极短且无症状/年龄线索
    if len(t) <= 4 and not any(c in t for c in ("痛", "疼", "烧", "咳", "晕", "岁", "月", "周", "天")):
        return True
    return False


def sanitize_reply(text: str) -> str:
    """出站清洗：疑似泄露内部提示时改为安全拒答。"""
    raw = text or ""
    low = raw.lower()
    for m in _LEAK_MARKERS:
        if m.lower() in low or m in raw:
            return PROBE_REFUSE_REPLY
    # 过长且像在复述规则清单
    if len(raw) > 800 and ("必须" in raw and "禁止" in raw and "提示词" in raw):
        return PROBE_REFUSE_REPLY
    return raw


def scrub_symptom_append(summary: str, last_user: str) -> str:
    """拒答场景下从症状摘要去掉本轮污染文本。"""
    summary = (summary or "").strip("；")
    last = (last_user or "").strip()
    if not last or not summary:
        return summary
    if summary == last:
        return ""
    if summary.endswith("；" + last):
        return summary[: -(len(last) + 1)].rstrip("；")
    if summary.endswith(last):
        return summary[: -len(last)].rstrip("；")
    return summary
