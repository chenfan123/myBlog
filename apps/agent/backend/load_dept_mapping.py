"""从旧 JSONL 迁移映射到 PostgreSQL（legacy，常规请用 extract 直接入库）。

常规 pipeline:
    python -m backend.extract_dept_mapping   # 抽取 → PG
    python -m backend.embed --target mappings
"""

from __future__ import annotations

from backend.mapping_db import LEGACY_MAPPINGS_JSONL, LOAD_MANIFEST, load_all


def main() -> int:
    manifest = load_all()
    print("---")
    print(f"映射: {manifest['mapping_count']} 条 → zy91_dept_mappings")
    print(f"来源: {manifest.get('source_jsonl', LEGACY_MAPPINGS_JSONL)}")
    print(f"Manifest: {LOAD_MANIFEST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
