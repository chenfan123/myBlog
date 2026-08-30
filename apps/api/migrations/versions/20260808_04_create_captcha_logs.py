"""create captcha verification logs"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260808_04"
down_revision: str | None = "20260808_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "captcha_verification_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("email_digest", sa.String(length=64), nullable=False),
        sa.Column("user_ip", sa.String(length=45), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("response_code", sa.String(length=32), nullable=True),
        sa.Column("response_message", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_captcha_verification_logs_created_at"),
        "captcha_verification_logs",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_captcha_verification_logs_email_digest"),
        "captcha_verification_logs",
        ["email_digest"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_captcha_verification_logs_email_digest"),
        table_name="captcha_verification_logs",
    )
    op.drop_index(
        op.f("ix_captcha_verification_logs_created_at"),
        table_name="captcha_verification_logs",
    )
    op.drop_table("captcha_verification_logs")
