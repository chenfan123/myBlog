"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LayoutDashboard, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DropdownMenu } from "radix-ui";

import { Button } from "@/components/ui/button";
import { getCurrentUser, logout, type AuthUser } from "@/lib/auth";
import { ApiError } from "@/lib/http";

const currentUserQueryKey = ["auth", "current-user"] as const;

async function queryCurrentUser() {
  try {
    return await getCurrentUser();
  } catch (error) {
    // 未登录是主页的正常状态，不应让 React Query 持续重试 401。
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function HeaderAccount() {
  const queryClient = useQueryClient();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { data: user, isPending } = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: queryCurrentUser,
    retry: false,
  });

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      queryClient.setQueryData<AuthUser | null>(currentUserQueryKey, null);
    } finally {
      setIsLoggingOut(false);
    }
  }

  if (isPending) {
    return (
      <span
        aria-label="正在读取登录状态"
        className="h-7 w-16 animate-pulse rounded-lg bg-muted"
      />
    );
  }

  if (!user) {
    return (
      <Button asChild size="sm" variant="ghost">
        <Link href="/login">登录</Link>
      </Button>
    );
  }

  return (
    <>
      {user.is_admin ? (
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin">
            <LayoutDashboard />
            <span className="hidden sm:inline">后台</span>
          </Link>
        </Button>
      ) : null}
      {user.is_admin ? (
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
      ) : null}
      <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 gap-2 rounded-full px-1.5 pr-2.5 data-[state=open]:bg-muted"
        >
          <span className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserRound className="size-3.5" />
          </span>
          <span className="hidden max-w-24 truncate text-xs sm:block">
            {user.display_name || user.email}
          </span>
          <ChevronDown className="hidden size-3 text-muted-foreground sm:block" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-60 rounded-2xl border bg-background p-2 shadow-xl shadow-foreground/10 outline-none"
        >
          <div className="px-3 py-2.5">
            <p className="text-sm font-medium">{user.display_name}</p>
            <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            disabled={isLoggingOut}
            onSelect={() => void handleLogout()}
            className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <LogOut className="size-4" />
            {isLoggingOut ? "正在退出…" : "退出登录"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}
