export type Profile = {
  name: string;
  role: string;
  age: string;
  experience: string;
  education: string;
  phone: string;
  email: string;
  introduction: string;
  avatar_url: string;
  location: string;
  availability: string;
};

export type SkillGroup = { title: string; skills: string[] };
export type Experience = { company: string; role: string; time: string; content: string[]; achievements: string[] };
export type Project = { index: string; name: string; role: string; time: string; summary: string; contribution: string[]; stack: string[] };
export type AgentDemo = { title: string; description: string; tags: string[]; status: string; demo_url: string };
export type Expectation = { roles: string[]; location: string; salary: string; availability: string };

export type ResumeData = {
  profile: Profile;
  strengths: string[];
  skill_groups: SkillGroup[];
  expectation: Expectation;
  experiences: Experience[];
  projects: Project[];
  agent_demos: AgentDemo[];
  updated_at?: string | null;
};

const publicApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const apiBaseUrl =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ?? publicApiBaseUrl)
    : publicApiBaseUrl;

export async function fetchResume(): Promise<ResumeData | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/resume`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    return (await response.json()) as ResumeData;
  } catch {
    return null;
  }
}

export { apiBaseUrl };
