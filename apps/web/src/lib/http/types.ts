export type HttpMethod =
  | "DELETE"
  | "GET"
  | "PATCH"
  | "POST"
  | "PUT";

export type QueryParams = Record<
  string,
  boolean | null | number | string | undefined
>;

export type ParseAs = "arrayBuffer" | "blob" | "json" | "response" | "text";

export type ApiRequestConfig = Omit<RequestInit, "body" | "method"> & {
  body?: BodyInit | Record<string, unknown> | null;
  method?: HttpMethod;
  params?: QueryParams;
  parseAs?: ParseAs;
  skipAuth?: boolean;
};

export type NormalizedRequestConfig = ApiRequestConfig & {
  headers: Headers;
  method: HttpMethod;
  url: string;
};

export type RequestInterceptor = (
  config: NormalizedRequestConfig,
) => NormalizedRequestConfig | Promise<NormalizedRequestConfig>;

export type ResponseInterceptor = (
  response: Response,
  config: NormalizedRequestConfig,
) => Response | Promise<Response>;

export type ErrorInterceptor = (
  error: unknown,
  config: NormalizedRequestConfig,
) => unknown | Promise<unknown>;
