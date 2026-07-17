import { ApiError } from "@/lib/http/api-error";
import type {
  ApiRequestConfig,
  ErrorInterceptor,
  NormalizedRequestConfig,
  RequestInterceptor,
  ResponseInterceptor,
} from "@/lib/http/types";

type ApiClientOptions = {
  baseUrl?: string;
  headers?: HeadersInit;
};

type InterceptorStore = {
  error: Set<ErrorInterceptor>;
  request: Set<RequestInterceptor>;
  response: Set<ResponseInterceptor>;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Headers;
  private readonly interceptorStore: InterceptorStore = {
    error: new Set(),
    request: new Set(),
    response: new Set(),
  };

  readonly interceptors = {
    error: {
      use: (interceptor: ErrorInterceptor) =>
        this.useInterceptor("error", interceptor),
    },
    request: {
      use: (interceptor: RequestInterceptor) =>
        this.useInterceptor("request", interceptor),
    },
    response: {
      use: (interceptor: ResponseInterceptor) =>
        this.useInterceptor("response", interceptor),
    },
  };

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.defaultHeaders = new Headers(options.headers);
  }

  delete<TData>(url: string, config?: ApiRequestConfig) {
    return this.request<TData>(url, { ...config, method: "DELETE" });
  }

  get<TData>(url: string, config?: ApiRequestConfig) {
    return this.request<TData>(url, { ...config, method: "GET" });
  }

  patch<TData>(url: string, config?: ApiRequestConfig) {
    return this.request<TData>(url, { ...config, method: "PATCH" });
  }

  post<TData>(url: string, config?: ApiRequestConfig) {
    return this.request<TData>(url, { ...config, method: "POST" });
  }

  put<TData>(url: string, config?: ApiRequestConfig) {
    return this.request<TData>(url, { ...config, method: "PUT" });
  }

  async request<TData>(url: string, config: ApiRequestConfig = {}) {
    let normalizedConfig = this.normalizeConfig(url, config);

    for (const interceptor of this.interceptorStore.request) {
      normalizedConfig = await interceptor(normalizedConfig);
    }

    try {
      const response = await fetch(normalizedConfig.url, {
        ...normalizedConfig,
        body: this.serializeBody(normalizedConfig),
        headers: normalizedConfig.headers,
      });

      let interceptedResponse = response;

      for (const interceptor of this.interceptorStore.response) {
        interceptedResponse = await interceptor(
          interceptedResponse,
          normalizedConfig,
        );
      }

      if (!interceptedResponse.ok) {
        throw new ApiError(
          interceptedResponse,
          await this.parseErrorPayload(interceptedResponse),
        );
      }

      return this.parseResponse<TData>(interceptedResponse, normalizedConfig);
    } catch (error) {
      let interceptedError = error;

      for (const interceptor of this.interceptorStore.error) {
        interceptedError = await interceptor(interceptedError, normalizedConfig);
      }

      throw interceptedError;
    }
  }

  private buildUrl(path: string, params: ApiRequestConfig["params"]) {
    if (!this.baseUrl && !isAbsoluteUrl(path)) {
      return buildRelativeUrl(path, params);
    }

    const url = isAbsoluteUrl(path)
      ? new URL(path)
      : new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);

    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });

    return url.toString();
  }

  private normalizeConfig(
    url: string,
    config: ApiRequestConfig,
  ): NormalizedRequestConfig {
    const headers = new Headers(this.defaultHeaders);

    new Headers(config.headers).forEach((value, key) => {
      headers.set(key, value);
    });

    const method = config.method ?? "GET";

    if (hasJsonBody(config.body) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    return {
      ...config,
      headers,
      method,
      url: this.buildUrl(url, config.params),
    };
  }

  private async parseErrorPayload(response: Response) {
    const responseClone = response.clone();
    const contentType = responseClone.headers.get("Content-Type");

    try {
      if (contentType?.includes("application/json")) {
        return await responseClone.json();
      }

      return await responseClone.text();
    } catch {
      return undefined;
    }
  }

  private async parseResponse<TData>(
    response: Response,
    config: NormalizedRequestConfig,
  ) {
    if (config.parseAs === "response") {
      return response as TData;
    }

    if (response.status === 204) {
      return undefined as TData;
    }

    if (config.parseAs === "blob") {
      return (await response.blob()) as TData;
    }

    if (config.parseAs === "arrayBuffer") {
      return (await response.arrayBuffer()) as TData;
    }

    if (config.parseAs === "text") {
      return (await response.text()) as TData;
    }

    const contentType = response.headers.get("Content-Type");

    if (contentType?.includes("application/json")) {
      return (await response.json()) as TData;
    }

    return (await response.text()) as TData;
  }

  private serializeBody(config: NormalizedRequestConfig) {
    if (config.method === "GET" || config.body === null) {
      return undefined;
    }

    if (hasJsonBody(config.body)) {
      return JSON.stringify(config.body);
    }

    return config.body;
  }

  private useInterceptor<TType extends keyof InterceptorStore>(
    type: TType,
    interceptor: InterceptorStore[TType] extends Set<infer TInterceptor>
      ? TInterceptor
      : never,
  ) {
    this.interceptorStore[type].add(interceptor as never);

    return () => {
      this.interceptorStore[type].delete(interceptor as never);
    };
  }
}

function hasJsonBody(
  body: ApiRequestConfig["body"],
): body is Record<string, unknown> {
  return (
    typeof body === "object" &&
    body !== null &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof Blob) &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams)
  );
}

function isAbsoluteUrl(url: string) {
  return /^https?:\/\//i.test(url);
}

function buildRelativeUrl(path: string, params: ApiRequestConfig["params"]) {
  const [pathname, existingQuery = ""] = path.split("?");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const searchParams = new URLSearchParams(existingQuery);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();

  return query ? `${normalizedPath}?${query}` : normalizedPath;
}
