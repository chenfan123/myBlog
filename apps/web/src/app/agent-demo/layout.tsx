import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getUserVerificationStatus } from "@/lib/server/user-auth";

export default async function AgentDemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const authStatus = await getUserVerificationStatus(cookieStore.toString());

  if (authStatus === 401) {
    redirect("/login?next=/agent-demo/medical-triage");
  }

  if (authStatus !== 200) {
    redirect("/");
  }

  return children;
}
