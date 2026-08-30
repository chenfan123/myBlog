import { AdminEditor } from "@/components/admin/admin-editor";
import { getAdminVerificationStatus } from "@/lib/server/admin-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const metadata = { title: "简历后台｜CHEN.DEV" };

export default async function AdminPage() {
  const cookieStore = await cookies();
  const status = await getAdminVerificationStatus(cookieStore.toString());
  if (status === 401) redirect("/login?next=/admin");
  if (status !== 204) redirect("/");

  return <AdminEditor />;
}
