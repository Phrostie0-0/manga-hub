export class ProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderError";
    this.code = code;
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(message = "Provider session is no longer valid") {
    super("REAUTH_REQUIRED", message);
    this.name = "ProviderAuthError";
  }
}

export class ProviderRateLimitError extends ProviderError {
  readonly retryAfterMs?: number;

  constructor(retryAfterMs?: number) {
    super("RATE_LIMITED", "Provider rate limit reached");
    this.name = "ProviderRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class ProviderChallengeError extends ProviderError {
  constructor(message = "Provider requires an interactive challenge") {
    super("NEEDS_ATTENTION", message);
    this.name = "ProviderChallengeError";
  }
}

export class ProviderResponseError extends ProviderError {
  constructor(message: string, options?: ErrorOptions) {
    super("INVALID_RESPONSE", message, options);
    this.name = "ProviderResponseError";
  }
}
