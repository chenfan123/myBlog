import { ApiError } from "@/lib/http/api-error";
import { ApiClient } from "@/lib/http/client";

type ApiClientRuntimeConfig = {
  getAccessToken?: () => null | Promise<null | string> | string;
  onUnauthorized?: (error: ApiError) => Promise<void> | void;
};

const runtimeConfig: ApiClientRuntimeConfig = {};

export const api = new ApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
  headers: {
    Accept: "application/json",
  },
});

api.interceptors.request.use(async (config) => {
  if (config.skipAuth || !runtimeConfig.getAccessToken) {
    return config;
  }

  const token = await runtimeConfig.getAccessToken();

  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }

  return config;
});

api.interceptors.error.use(async (error) => {
  if (
    error instanceof ApiError &&
    error.status === 401 &&
    runtimeConfig.onUnauthorized
  ) {
    await runtimeConfig.onUnauthorized(error);
  }

  return error;
});

export function configureApiClient(config: ApiClientRuntimeConfig) {
  Object.assign(runtimeConfig, config);
}
