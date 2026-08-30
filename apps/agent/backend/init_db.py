"""创建 Agent 运行所需的 PostgreSQL 表。

这个脚本只负责建表，不会删除或覆盖已有数据，适合在容器启动时执行。
"""

from backend.dept_parent_db import init_tables as init_parent_tables
from backend.mapping_db import init_tables as init_mapping_tables
from backend.schedule_db import init_tables as init_schedule_tables


def main() -> None:
    init_mapping_tables()
    init_parent_tables()
    init_schedule_tables()
    print("Agent PostgreSQL tables are ready")


if __name__ == "__main__":
    main()
