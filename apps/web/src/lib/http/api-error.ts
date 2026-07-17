export type ApiErrorPayload = {
  code?: string;
  details?: unknown;
  message?: string;
};

export class ApiError extends Error {
  readonly payload?: ApiErrorPayload | unknown;
  readonly response?: Response;
  readonly status: number;
  readonly statusText: string;

  constructor(response: Response, payload?: ApiErrorPayload | unknown) {
    super(getErrorMessage(response, payload));
    this.name = "ApiError";
    this.payload = payload;
    this.response = response;
    this.status = response.status;
    this.statusText = response.statusText;
  }
}

function getErrorMessage(
  response: Response,
  payload?: ApiErrorPayload | unknown,
) {
  if (isApiErrorPayload(payload) && payload.message) {
    return payload.message;
  }

  return response.statusText || `Request failed with status ${response.status}`;
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return typeof payload === "object" && payload !== null;
}
