"""promote all existing users to administrators"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_05"
down_revision: str | None = "20260808_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 只影响迁移执行时已经存在的记录；以后注册仍使用字段默认值 False。
    op.execute(sa.text("UPDATE users SET is_admin = true"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE users SET is_admin = false"))
