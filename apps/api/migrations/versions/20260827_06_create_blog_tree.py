"""create hierarchical blog nodes"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20260827_06"
down_revision: str | None = "20260825_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "blog_nodes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("slug", sa.String(length=180), nullable=True),
        sa.Column("content", sa.Text(), server_default="", nullable=False),
        sa.Column(
            "is_published", sa.Boolean(), server_default=sa.false(), nullable=False
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_id"], ["blog_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_blog_nodes_kind", "blog_nodes", ["kind"])
    op.create_index("ix_blog_nodes_parent_id", "blog_nodes", ["parent_id"])
    op.create_index("ix_blog_nodes_slug", "blog_nodes", ["slug"])


def downgrade() -> None:
    op.drop_index("ix_blog_nodes_slug", table_name="blog_nodes")
    op.drop_index("ix_blog_nodes_parent_id", table_name="blog_nodes")
    op.drop_index("ix_blog_nodes_kind", table_name="blog_nodes")
    op.drop_table("blog_nodes")
