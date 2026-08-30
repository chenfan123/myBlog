from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class Profile(BaseModel):
    name: str
    role: str
    age: str
    experience: str
    education: str
    phone: str
    email: str
    introduction: str
    avatar_url: str = ""
    location: str = ""
    availability: str = "开放机会"


class SkillGroup(BaseModel):
    title: str
    skills: list[str] = Field(default_factory=list)


class Experience(BaseModel):
    company: str
    role: str
    time: str
    content: list[str] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)


class Project(BaseModel):
    index: str
    name: str
    role: str
    time: str
    summary: str
    contribution: list[str] = Field(default_factory=list)
    stack: list[str] = Field(default_factory=list)


class AgentDemo(BaseModel):
    title: str
    description: str
    tags: list[str] = Field(default_factory=list)
    status: str
    demo_url: str = ""


class Expectation(BaseModel):
    roles: list[str] = Field(default_factory=list)
    location: str = ""
    salary: str = ""
    availability: str = ""


class ResumeData(BaseModel):
    profile: Profile
    strengths: list[str] = Field(default_factory=list)
    skill_groups: list[SkillGroup] = Field(default_factory=list)
    expectation: Expectation
    experiences: list[Experience] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    agent_demos: list[AgentDemo] = Field(default_factory=list)


class ResumeResponse(ResumeData):
    model_config = ConfigDict(from_attributes=True)

    updated_at: datetime | None = None
