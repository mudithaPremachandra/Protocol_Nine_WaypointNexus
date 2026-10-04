export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Thin fetch wrapper: same-origin cookies, JSON in and out, readable errors. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, (data as { details?: unknown }).details);
  return data as T;
}

export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
