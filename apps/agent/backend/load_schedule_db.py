"""将排班/医生 JSON 导入 PostgreSQL。

用法（在项目根目录，需 Docker PostgreSQL 已启动且 .env 配置 DATABASE_URL）:
    python -m backend.load_schedule_db
"""

from __future__ import annotations

from backend.schedule_db import LOAD_MANIFEST, load_all


def main() -> int:
    manifest = load_all()
    print("---")
    print(f"医生: {manifest['doctors']} 条 → zy91_doctors")
    print(f"排班: {manifest['schedule_entries']} 条 → zy91_schedule_entries")
    print(f"Manifest: {LOAD_MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
