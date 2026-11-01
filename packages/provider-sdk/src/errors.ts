export type ProviderErrorCode =
  | 'provider_invalid_url'
  | 'provider_invalid_credentials'
  | 'provider_auth_required'
  | 'provider_login_failed'
  | 'provider_session_expired'
  | 'provider_forbidden'
  | 'provider_not_found'
  | 'provider_timeout'
  | 'provider_network'
  | 'provider_invalid_response'
  | 'provider_unsupported'
  | `provider_http_${number}`;

export interface ProviderErrorOptions {
  status?: number;
  detail?: string;
  retryable?: boolean;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = options.status;
    this.detail = options.detail;
    this.retryable = options.retryable ?? false;
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
