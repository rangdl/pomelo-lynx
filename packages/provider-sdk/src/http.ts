import { ProviderError } from './errors.js';
import type { ProviderFetch } from './types.js';

const DEFAULT_TIMEOUT_MS = 12_000;

export type ProviderQueryValue = string | number | boolean | null | undefined;

export interface ProviderRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  query?: Record<string, ProviderQueryValue>;
  body?: unknown;
  /** 默认 true；登录/刷新必须显式关闭。 */
  auth?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProviderHttpOptions {
  baseUrl: string;
  fetch: ProviderFetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
  getAccessToken?: () => Promise<string | null> | string | null;
  /** 401 后尝试刷新并返回新 token；返回 null 表示会话已失效。 */
  onUnauthorized?: () => Promise<string | null> | string | null;
}

/** 去掉末尾斜杠与用户误粘贴的 `/api/v1`，得到服务端根地址。 */
export function normalizeProviderBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new ProviderError('provider_invalid_url', '请输入服务器地址');
  }
  if (/\s/.test(value)) {
    throw new ProviderError('provider_invalid_url', '服务器地址不能包含空格');
  }
  const match = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(value);
  if (!match) {
    throw new ProviderError(
      'provider_invalid_url',
      '服务器地址必须是 http:// 或 https:// 地址',
    );
  }
  const authority = match[2] ?? '';
  if (!authority || authority.includes('@')) {
    throw new ProviderError('provider_invalid_url', '服务器地址不能包含凭据');
  }
  let path = (match[3] ?? '').replace(/\/+$/, '');
  if (path.endsWith('/api/v1')) path = path.slice(0, -7);
  else if (path.endsWith('/api')) path = path.slice(0, -4);
  return `${match[1].toLowerCase()}://${authority}${path}`;
}

function appendQuery(
  url: string,
  query?: Record<string, ProviderQueryValue>,
): string {
  if (!query) return url;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }
  if (!parts.length) return url;
  return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

/** 相对路径补 `/api/v1`；绝对 URL 原样保留。 */
export function buildProviderUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, ProviderQueryValue>,
): string {
  const value = path.trim();
  let url = value;
  if (!/^https?:\/\//i.test(value)) {
    const absolutePath = value.startsWith('/') ? value : `/${value}`;
    url = `${baseUrl}${
      absolutePath.startsWith('/api/') ? absolutePath : `/api/v1${absolutePath}`
    }`;
  }
  return appendQuery(url, query);
}

export function isSameProviderOrigin(baseUrl: string, url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return true;
  const base = /^(https?:\/\/[^/?#]+)/i.exec(baseUrl)?.[1]?.toLowerCase();
  const target = /^(https?:\/\/[^/?#]+)/i.exec(url)?.[1]?.toLowerCase();
  return !!base && base === target;
}

/** 日志/错误里统一脱敏 token、Bearer 和查询串凭据。 */
export function redactProviderText(input: string): string {
  return input
    .replace(
      /\b(access_token|refresh_token|token|authorization)=([^&\s]+)/gi,
      '$1=***',
    )
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***')
    .replace(/sl_pat_[A-Za-z0-9._-]+/g, 'sl_pat_***')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '***');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJSON(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(
      'provider_invalid_response',
      '服务器返回的不是有效 JSON',
    );
  }
}

function errorDetail(value: unknown): string {
  if (!isRecord(value)) return '';
  for (const key of ['detail', 'error', 'message']) {
    if (typeof value[key] === 'string' && value[key]) {
      return (value[key] as string).slice(0, 240);
    }
  }
  return '';
}

export class ProviderHttp {
  private readonly baseUrl: string;
  private readonly fetchImpl: ProviderFetch;
  private readonly timeoutMs: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly getAccessToken?: ProviderHttpOptions['getAccessToken'];
  private readonly onUnauthorized?: ProviderHttpOptions['onUnauthorized'];

  constructor(options: ProviderHttpOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultHeaders = options.headers ?? {};
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  async request<T>(
    path: string,
    options: ProviderRequestOptions = {},
  ): Promise<T> {
    const auth = options.auth !== false;
    let token = '';
    if (auth) {
      token = (await this.getAccessToken?.()) ?? '';
      if (!token) {
        throw new ProviderError('provider_auth_required', '请先连接音乐服务器');
      }
    }
    try {
      return await this.send<T>(path, options, token);
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.status === 401 &&
        auth &&
        this.onUnauthorized
      ) {
        const next = await this.onUnauthorized();
        if (!next) {
          throw new ProviderError(
            'provider_session_expired',
            '登录已过期，请重新连接',
            { status: 401 },
          );
        }
        return this.send<T>(path, options, next);
      }
      throw error;
    }
  }

  private async send<T>(
    path: string,
    options: ProviderRequestOptions,
    token: string,
  ): Promise<T> {
    const url = buildProviderUrl(this.baseUrl, path, options.query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.defaultHeaders,
      ...options.headers,
    };
    // 绝对资源可能指向第三方（例如外链歌词）；Bearer 只发给同源地址。
    if (token && isSameProviderOrigin(this.baseUrl, url)) {
      headers.Authorization = `Bearer ${token}`;
    }
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller =
      typeof AbortController === 'function' ? new AbortController() : null;
    let timedOut = false;
    const timeout = options.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, timeout);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: controller?.signal,
      });
    } catch (error) {
      if (timedOut) {
        throw new ProviderError('provider_timeout', '请求超时', {
          retryable: true,
        });
      }
      throw new ProviderError('provider_network', '网络请求失败', {
        detail: redactProviderText(
          error instanceof Error ? error.message : String(error),
        ),
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }

    let text = '';
    try {
      text = await response.text();
    } catch {
      throw new ProviderError('provider_network', '读取响应失败', {
        status: response.status,
        retryable: true,
      });
    }

    if (!response.ok) {
      let payload: unknown = null;
      try {
        payload = parseJSON(text);
      } catch {
        payload = null;
      }
      const detail = redactProviderText(errorDetail(payload));
      if (response.status === 401) {
        throw new ProviderError('provider_session_expired', '登录已过期', {
          status: 401,
          detail,
        });
      }
      if (response.status === 403) {
        throw new ProviderError('provider_forbidden', '没有访问权限', {
          status: 403,
          detail,
        });
      }
      if (response.status === 404) {
        throw new ProviderError('provider_not_found', '资源不存在', {
          status: 404,
          detail,
        });
      }
      throw new ProviderError(
        `provider_http_${response.status}`,
        detail || `服务器返回 HTTP ${response.status}`,
        { status: response.status, detail },
      );
    }

    if (!text) return undefined as T;
    return parseJSON(text) as T;
  }
}
