"""将科室 parent 块导入 PostgreSQL。

用法（在项目根目录，需 Docker PostgreSQL 已启动且 .env 配置 DATABASE_URL）:
    python -m backend.chunk --hierarchical
    python -m backend.load_dept_parents
"""

from __future__ import annotations

from backend.dept_parent_db import LOAD_MANIFEST, load_all


def main() -> int:
    manifest = load_all()
    print("---")
    print(f"parent: {manifest['parent_count']} 条 → zy91_dept_parents")
    print(f"Manifest: {LOAD_MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
