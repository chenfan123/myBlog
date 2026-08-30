"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, Code2 } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiBaseUrl, type ResumeData } from "@/lib/resume";
import { uploadImageToCdn } from "@/lib/cdn-upload";

type Status = { tone: "idle" | "error" | "success"; message: string };

const emptyResume: ResumeData = {
  profile: {
    name: "",
    role: "",
    age: "",
    experience: "",
    education: "",
    phone: "",
    email: "",
    introduction: "",
    avatar_url: "",
    location: "",
    availability: "",
  },
  strengths: [],
  skill_groups: [],
  expectation: { roles: [], location: "", salary: "", availability: "" },
  experiences: [],
  projects: [],
  agent_demos: [],
};

export function AdminEditor() {
  const [resume, setResume] = useState<ResumeData>(emptyResume);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ tone: "idle", message: "" });

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/v1/resume`)
      .then((response) => {
        if (!response.ok) throw new Error("无法读取简历数据");
        return response.json() as Promise<ResumeData>;
      })
      .then(setResume)
      .catch((error: Error) =>
        setStatus({ tone: "error", message: error.message }),
      )
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus({ tone: "idle", message: "" });
    try {
      const payload = prepareResumeForSave(resume);
      const response = await fetch(`${apiBaseUrl}/api/v1/admin/resume`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        throw new Error(
          response.status === 401
            ? "登录状态已失效，请重新登录。"
            : response.status === 403
              ? "当前账户没有管理员权限。"
            : (error?.detail ?? "保存失败。请检查后端服务。"),
        );
      }
      const saved = (await response.json()) as ResumeData;
      setResume(saved);
      setStatus({
        tone: "success",
        message: "保存成功，首页刷新后会显示最新数据。",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <main className="mx-auto max-w-5xl px-6 py-20">正在读取简历数据…</main>
    );

  const updateProfile = (key: keyof ResumeData["profile"], value: string) =>
    setResume((current) => ({
      ...current,
      profile: { ...current.profile, [key]: value },
    }));
  const updateExpectation = (
    key: keyof ResumeData["expectation"],
    value: string | string[],
  ) =>
    setResume((current) => ({
      ...current,
      expectation: { ...current.expectation, [key]: value },
    }));

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setStatus({ tone: "idle", message: "正在上传头像…" });
    try {
      const result = await uploadImageToCdn(file, {
        biz: "appraiser",
        scene: "coin",
      });
      updateProfile("avatar_url", result.url);
      setStatus({
        tone: "success",
        message: "头像上传成功。请点击底部“保存全部修改”写入数据库。",
      });
    } catch (error) {
      setStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "头像上传失败",
      });
    } finally {
      setUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10">
      <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge variant="secondary">ADMIN</Badge>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            简历内容管理
          </h1>
          <p className="mt-3 text-muted-foreground">
            修改后保存到 PostgreSQL，首页将通过 FastAPI 读取最新内容。
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="ghost">
            <Link href="/blog"><BookOpen /> 博客管理</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">返回首页 <ArrowRight /></Link>
          </Button>
        </div>
      </div>

      <EditorSection title="基本信息" description="用于首页首屏和联系方式。">
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["name", "姓名"],
              ["role", "求职岗位"],
              ["age", "年龄"],
              ["experience", "工作年限"],
              ["education", "学历"],
              ["phone", "电话"],
              ["email", "邮箱"],
              ["location", "所在地"],
              ["availability", "求职状态"],
              ["avatar_url", "头像 URL"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                value={resume.profile[key]}
                onChange={(event) => updateProfile(key, event.target.value)}
              />
            </Field>
          ))}
        </div>
        <div className="rounded-xl border bg-background/60 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted text-xs text-muted-foreground">
              {resume.profile.avatar_url ? (
                <img
                  src={resume.profile.avatar_url}
                  alt="头像预览"
                  className="size-full object-contain object-top"
                />
              ) : (
                "暂无头像"
              )}
            </div>
            <div>
              <p className="text-sm font-medium">上传头像到 CDN</p>
              <p className="mt-1 text-xs text-muted-foreground">
                支持 PNG、JPEG、WebP 等格式，最大 10MB。
              </p>
              <input
                ref={avatarInputRef}
                className="mt-3 block text-sm"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/tiff"
                disabled={uploading}
                onChange={(event) => void uploadAvatar(event.target.files?.[0])}
              />
              {uploading ? (
                <p className="mt-2 text-xs text-primary">正在上传…</p>
              ) : null}
            </div>
          </div>
        </div>
        <Field label="个人简介">
          <Textarea
            rows={4}
            value={resume.profile.introduction}
            onChange={(event) =>
              updateProfile("introduction", event.target.value)
            }
          />
        </Field>
      </EditorSection>

      <EditorSection title="个人优势" description="每行一条，适合填写 3–6 条。">
        <LinesField
          value={resume.strengths}
          onChange={(strengths) =>
            setResume((current) => ({ ...current, strengths }))
          }
        />
      </EditorSection>

      <EditorSection title="技术栈" description="可以增加或删除技能分类。">
        <div className="space-y-4">
          {resume.skill_groups.map((group, index) => (
            <RepeaterCard
              key={`skill-group-${index}`}
              title={`技能组 ${index + 1}`}
              onRemove={() =>
                setResume((current) => ({
                  ...current,
                  skill_groups: current.skill_groups.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                }))
              }
            >
              <Field label="分类">
                <Input
                  value={group.title}
                  onChange={(event) =>
                    setResume((current) => ({
                      ...current,
                      skill_groups: current.skill_groups.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, title: event.target.value }
                            : item,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="技能（每行一项）">
                <LinesField
                  value={group.skills}
                  onChange={(skills) =>
                    setResume((current) => ({
                      ...current,
                      skill_groups: current.skill_groups.map(
                        (item, itemIndex) =>
                          itemIndex === index ? { ...item, skills } : item,
                      ),
                    }))
                  }
                />
              </Field>
            </RepeaterCard>
          ))}
        </div>
        <AddButton
          label="增加技能组"
          onClick={() =>
            setResume((current) => ({
              ...current,
              skill_groups: [
                ...current.skill_groups,
                { title: "新技能组", skills: [] },
              ],
            }))
          }
        />
      </EditorSection>

      <EditorSection title="求职期望" description="岗位每行一项。">
        <Field label="目标岗位">
          <LinesField
            value={resume.expectation.roles}
            onChange={(roles) => updateExpectation("roles", roles)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          {(
            [
              ["location", "期望城市"],
              ["salary", "期望薪资"],
              ["availability", "到岗时间"],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <Input
                value={resume.expectation[key]}
                onChange={(event) => updateExpectation(key, event.target.value)}
              />
            </Field>
          ))}
        </div>
      </EditorSection>

      <EditorSection
        title="工作经历"
        description="工作内容和工作业绩均为每行一条。"
      >
        <div className="space-y-4">
          {resume.experiences.map((item, index) => (
            <RepeaterCard
              key={`experience-${index}`}
              title={`工作经历 ${index + 1}`}
              onRemove={() =>
                setResume((current) => ({
                  ...current,
                  experiences: current.experiences.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                }))
              }
            >
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ["company", "公司"],
                    ["role", "岗位"],
                    ["time", "时间"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input
                      value={item[key]}
                      onChange={(event) =>
                        setResume((current) => ({
                          ...current,
                          experiences: current.experiences.map(
                            (entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, [key]: event.target.value }
                                : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
              <Field label="工作内容">
                <LinesField
                  value={item.content}
                  onChange={(content) =>
                    setResume((current) => ({
                      ...current,
                      experiences: current.experiences.map(
                        (entry, itemIndex) =>
                          itemIndex === index ? { ...entry, content } : entry,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="工作业绩">
                <LinesField
                  value={item.achievements}
                  onChange={(achievements) =>
                    setResume((current) => ({
                      ...current,
                      experiences: current.experiences.map(
                        (entry, itemIndex) =>
                          itemIndex === index
                            ? { ...entry, achievements }
                            : entry,
                      ),
                    }))
                  }
                />
              </Field>
            </RepeaterCard>
          ))}
        </div>
        <AddButton
          label="增加工作经历"
          onClick={() =>
            setResume((current) => ({
              ...current,
              experiences: [
                ...current.experiences,
                {
                  company: "",
                  role: "",
                  time: "",
                  content: [],
                  achievements: [],
                },
              ],
            }))
          }
        />
      </EditorSection>

      <EditorSection title="项目经历" description="项目可以动态增删。">
        <div className="space-y-4">
          {resume.projects.map((item, index) => (
            <RepeaterCard
              key={`project-${index}`}
              title={`项目 ${index + 1}`}
              onRemove={() =>
                setResume((current) => ({
                  ...current,
                  projects: current.projects.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                }))
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["name", "项目名称"],
                    ["role", "项目角色"],
                    ["time", "项目时间"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input
                      value={item[key]}
                      onChange={(event) =>
                        setResume((current) => ({
                          ...current,
                          projects: current.projects.map((entry, itemIndex) =>
                            itemIndex === index
                              ? { ...entry, [key]: event.target.value }
                              : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
              <Field label="项目介绍">
                <Textarea
                  value={item.summary}
                  onChange={(event) =>
                    setResume((current) => ({
                      ...current,
                      projects: current.projects.map((entry, itemIndex) =>
                        itemIndex === index
                          ? { ...entry, summary: event.target.value }
                          : entry,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="个人贡献">
                <LinesField
                  value={item.contribution}
                  onChange={(contribution) =>
                    setResume((current) => ({
                      ...current,
                      projects: current.projects.map((entry, itemIndex) =>
                        itemIndex === index
                          ? { ...entry, contribution }
                          : entry,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="技术栈">
                <LinesField
                  value={item.stack}
                  onChange={(stack) =>
                    setResume((current) => ({
                      ...current,
                      projects: current.projects.map((entry, itemIndex) =>
                        itemIndex === index ? { ...entry, stack } : entry,
                      ),
                    }))
                  }
                />
              </Field>
            </RepeaterCard>
          ))}
        </div>
        <AddButton
          label="增加项目"
          onClick={() =>
            setResume((current) => ({
              ...current,
              projects: [
                ...current.projects,
                {
                  index: String(current.projects.length + 1).padStart(2, "0"),
                  name: "",
                  role: "",
                  time: "",
                  summary: "",
                  contribution: [],
                  stack: [],
                },
              ],
            }))
          }
        />
      </EditorSection>

      <EditorSection
        title="Agent Demo"
        description="单独管理 Demo 名称、介绍、状态和链接。"
      >
        <div className="space-y-4">
          {resume.agent_demos.map((item, index) => (
            <RepeaterCard
              key={`agent-demo-${index}`}
              title={`Agent Demo ${index + 1}`}
              onRemove={() =>
                setResume((current) => ({
                  ...current,
                  agent_demos: current.agent_demos.filter(
                    (_, itemIndex) => itemIndex !== index,
                  ),
                }))
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["title", "名称"],
                    ["status", "状态"],
                    ["demo_url", "Demo URL"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <Input
                      value={item[key]}
                      onChange={(event) =>
                        setResume((current) => ({
                          ...current,
                          agent_demos: current.agent_demos.map(
                            (entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, [key]: event.target.value }
                                : entry,
                          ),
                        }))
                      }
                    />
                  </Field>
                ))}
              </div>
              <Field label="介绍">
                <Textarea
                  value={item.description}
                  onChange={(event) =>
                    setResume((current) => ({
                      ...current,
                      agent_demos: current.agent_demos.map(
                        (entry, itemIndex) =>
                          itemIndex === index
                            ? { ...entry, description: event.target.value }
                            : entry,
                      ),
                    }))
                  }
                />
              </Field>
              <Field label="技术标签">
                <LinesField
                  value={item.tags}
                  onChange={(tags) =>
                    setResume((current) => ({
                      ...current,
                      agent_demos: current.agent_demos.map(
                        (entry, itemIndex) =>
                          itemIndex === index ? { ...entry, tags } : entry,
                      ),
                    }))
                  }
                />
              </Field>
            </RepeaterCard>
          ))}
        </div>
        <AddButton
          label="增加 Agent Demo"
          onClick={() =>
            setResume((current) => ({
              ...current,
              agent_demos: [
                ...current.agent_demos,
                {
                  title: "",
                  description: "",
                  tags: [],
                  status: "规划中",
                  demo_url: "",
                },
              ],
            }))
          }
        />
      </EditorSection>

      <div className="sticky bottom-4 z-20 mt-8 flex flex-col gap-3 rounded-2xl border bg-white/95 p-4 shadow-xl backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <p
          className={`text-sm ${status.tone === "error" ? "text-destructive" : status.tone === "success" ? "text-emerald-700" : "text-muted-foreground"}`}
        >
          {status.message || "所有修改会在点击保存后写入数据库。"}
        </p>
        <Button onClick={save} disabled={saving}>
          {saving ? (
            "正在保存…"
          ) : (
            <>
              <Check /> 保存全部修改
            </>
          )}
        </Button>
      </div>
    </main>
  );
}

function EditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 rounded-2xl border bg-white/85 p-5 sm:p-7">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
function LinesField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <Textarea
      rows={Math.max(3, Math.min(7, value.length + 1))}
      value={value.join("\n")}
      onChange={(event) => onChange(event.target.value.split("\n"))}
    />
  );
}
function RepeaterCard({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-background/60 py-0 shadow-none">
      <CardContent className="p-5">
        <div className="mb-5 flex items-center justify-between">
          <span className="flex items-center gap-2 font-mono text-xs">
            <Code2 className="size-4 text-primary" />
            {title}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            删除
          </Button>
        </div>
        <div className="space-y-4">{children}</div>
      </CardContent>
    </Card>
  );
}
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" onClick={onClick}>
      + {label}
    </Button>
  );
}

function prepareResumeForSave(resume: ResumeData) {
  const cleanLines = (items: string[]) =>
    items.map((item) => item.trim()).filter(Boolean);
  return {
    profile: resume.profile,
    strengths: cleanLines(resume.strengths),
    skill_groups: resume.skill_groups.map((group) => ({
      ...group,
      skills: cleanLines(group.skills),
    })),
    expectation: {
      ...resume.expectation,
      roles: cleanLines(resume.expectation.roles),
    },
    experiences: resume.experiences.map((experience) => ({
      ...experience,
      content: cleanLines(experience.content),
      achievements: cleanLines(experience.achievements),
    })),
    projects: resume.projects.map((project) => ({
      ...project,
      contribution: cleanLines(project.contribution),
      stack: cleanLines(project.stack),
    })),
    agent_demos: resume.agent_demos.map((demo) => ({
      ...demo,
      tags: cleanLines(demo.tags),
    })),
  };
}
