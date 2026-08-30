import { api } from "@/lib/http";

export type AuthUser = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  created_at: string;
};

type AuthResponse = {
  user: AuthUser;
};

export function login(data: {
  email: string;
  password: string;
  captcha_verify_param: string;
}) {
  return api.post<AuthResponse>("/api/v1/auth/login", {
    body: data,
    skipAuth: true,
  });
}

export function register(data: {
  display_name: string;
  email: string;
  password: string;
  email_code: string;
}) {
  return api.post<AuthResponse>("/api/v1/auth/register", {
    body: data,
    skipAuth: true,
  });
}

export function sendRegistrationEmailCode(data: {
  email: string;
  captcha_verify_param: string;
}) {
  return api.post<{
    message: string;
    retry_after_seconds: number;
    expires_in_seconds: number;
  }>("/api/v1/auth/email-code", {
    body: data,
    skipAuth: true,
  });
}

export function sendForgotPasswordCode(data: { email: string; captcha_verify_param: string }) {
  return api.post<{ message: string; retry_after_seconds: number; expires_in_seconds: number }>("/api/v1/auth/forgot-password/email-code", { body: data, skipAuth: true });
}

export function resetPassword(data: { email: string; email_code: string; password: string }) {
  return api.post<AuthResponse>("/api/v1/auth/forgot-password/reset", { body: data, skipAuth: true });
}

export function getCurrentUser() {
  return api.get<AuthUser>("/api/v1/auth/me", { skipAuth: true });
}

export function logout() {
  return api.post<void>("/api/v1/auth/logout", { skipAuth: true });
}
