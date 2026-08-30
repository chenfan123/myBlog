"""多轮问诊 CLI。

用法:
    python -m backend.agent_cli
    python -m backend.agent_cli --once "胃痛反酸挂什么科"
"""

from __future__ import annotations

import argparse
import json

from backend.agent.session import new_session_id, run_turn


def main() -> int:
    parser = argparse.ArgumentParser(description="浙大一院导诊 Agent CLI")
    parser.add_argument("--once", help="单轮测试文本")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    sid = new_session_id()
    if args.once:
        result = run_turn(sid, args.once)
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            _print_result(result)
        return 0

    print(f"会话 {sid}（输入 quit 退出）")
    print("免责声明：导诊建议非医学诊断，紧急请拨打 120。")
    while True:
        try:
            text = input("\n您：").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not text:
            continue
        if text.lower() in {"quit", "exit", "q"}:
            break
        result = run_turn(sid, text)
        _print_result(result)
    return 0


def _print_result(result: dict) -> None:
    print(f"\n助手[{result['stage']}|intent={result.get('intent')}]：")
    print(result.get("reply") or "")
    rec = result.get("recommendation")
    if rec and rec.get("primary"):
        print(f"（结构化主推：{rec['primary'].get('deptName')}）")


if __name__ == "__main__":
    raise SystemExit(main())
