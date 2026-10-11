"""add markdown theme to blog posts"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261011_08"
down_revision: str | None = "20261011_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "blog_nodes",
        sa.Column(
            "markdown_theme",
            sa.String(length=32),
            server_default="editorial",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("blog_nodes", "markdown_theme")
