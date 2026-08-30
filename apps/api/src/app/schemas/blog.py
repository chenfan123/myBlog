"""博客树与 Markdown 文档接口模型。"""

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

BlogNodeKind = Literal["folder", "document"]


class BlogNodeCreate(BaseModel):
    parent_id: uuid.UUID | None = None
    kind: BlogNodeKind
    name: str = Field(min_length=1, max_length=160)

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        return value.strip()


class BlogNodeUpdate(BaseModel):
    parent_id: uuid.UUID | None = None
    name: str | None = Field(default=None, min_length=1, max_length=160)
    slug: str | None = Field(default=None, max_length=180)
    content: str | None = Field(default=None, max_length=2_000_000)
    is_published: bool | None = None
    sort_order: int | None = None

    @field_validator("name", "slug")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class BlogNodeSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    parent_id: uuid.UUID | None
    kind: BlogNodeKind
    name: str
    slug: str | None
    is_published: bool
    sort_order: int
    updated_at: datetime


class BlogNodeDetail(BlogNodeSummary):
    content: str
    created_at: datetime
    published_at: datetime | None
