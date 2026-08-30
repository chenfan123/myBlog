from sqlalchemy.orm import Session

from app.models.resume import ResumeContent
from app.schemas.resume import ResumeData, ResumeResponse


def get_resume(db: Session) -> ResumeResponse | None:
    content = db.get(ResumeContent, 1)
    if content is None:
        return None
    return ResumeResponse.model_validate(
        {**content.data, "updated_at": content.updated_at}
    )


def save_resume(db: Session, resume: ResumeData) -> ResumeResponse:
    content = db.get(ResumeContent, 1)
    payload = resume.model_dump(mode="json")
    if content is None:
        content = ResumeContent(id=1, data=payload)
        db.add(content)
    else:
        content.data = payload
    db.commit()
    db.refresh(content)
    return ResumeResponse.model_validate(
        {**content.data, "updated_at": content.updated_at}
    )
