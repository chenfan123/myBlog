"""add user admin flag"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260808_03"
down_revision: str | None = "20260808_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("is_admin", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("users", "is_admin")
