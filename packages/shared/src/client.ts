/** Tiny typed fetch client shared by the three frontends. Browser-only (uses localStorage + fetch). */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiClient {
  baseUrl: string;
  getToken(): string | null;
  setToken(t: string): void;
  clearToken(): void;
  get<T>(path: string, headers?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  patch<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T>;
  /** Fetch a protected file (e.g. CSV) and return it as text. */
  text(path: string): Promise<string>;
}

export function createApiClient(opts: { baseUrl: string; tokenKey: string; onUnauthorized?: () => void }): ApiClient {
  const base = opts.baseUrl.replace(/\/$/, '') + '/api/v1';
  const getToken = () => {
    try {
      return localStorage.getItem(opts.tokenKey);
    } catch {
      return null;
    }
  };

  async function raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const token = getToken();
    let res: Response;
    try {
      res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection.');
    }
    if (!res.ok) {
      let code = 'ERROR';
      let message = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        code = j?.error?.code ?? code;
        message = j?.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 401 && token) opts.onUnauthorized?.();
      throw new ApiError(res.status, code, message);
    }
    return res;
  }

  const json = async <T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => (await raw(method, path, body, headers)).json() as Promise<T>;

  return {
    baseUrl: opts.baseUrl,
    getToken,
    setToken: (t) => localStorage.setItem(opts.tokenKey, t),
    clearToken: () => localStorage.removeItem(opts.tokenKey),
    get: (p, h) => json('GET', p, undefined, h),
    post: (p, b, h) => json('POST', p, b ?? {}, h),
    patch: (p, b, h) => json('PATCH', p, b ?? {}, h),
    text: async (p) => (await raw('GET', p)).text(),
  };
}
