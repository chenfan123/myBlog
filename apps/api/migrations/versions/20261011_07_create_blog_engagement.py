"""create blog comments and likes"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261011_07"
down_revision: str | None = "20260827_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "blog_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("author_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["blog_comments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["post_id"], ["blog_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_blog_comments_author_id", "blog_comments", ["author_id"])
    op.create_index("ix_blog_comments_parent_id", "blog_comments", ["parent_id"])
    op.create_index("ix_blog_comments_post_id", "blog_comments", ["post_id"])

    op.create_table(
        "blog_post_likes",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("post_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["post_id"], ["blog_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("post_id", "user_id", name="uq_blog_post_like_user"),
    )
    op.create_index("ix_blog_post_likes_post_id", "blog_post_likes", ["post_id"])
    op.create_index("ix_blog_post_likes_user_id", "blog_post_likes", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_blog_post_likes_user_id", table_name="blog_post_likes")
    op.drop_index("ix_blog_post_likes_post_id", table_name="blog_post_likes")
    op.drop_table("blog_post_likes")
    op.drop_index("ix_blog_comments_post_id", table_name="blog_comments")
    op.drop_index("ix_blog_comments_parent_id", table_name="blog_comments")
    op.drop_index("ix_blog_comments_author_id", table_name="blog_comments")
    op.drop_table("blog_comments")
