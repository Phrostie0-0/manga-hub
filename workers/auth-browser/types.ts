import type { ProviderCode, ProviderSession, RemoteProfile } from "../../packages/connectors/src";

export type CapturedProviderSession = {
  provider: ProviderCode;
  session: ProviderSession;
  profile: RemoteProfile;
};

export type AuthBrowserOptions = {
  timeoutMs?: number;
  headless?: boolean;
  signal?: AbortSignal;
};

export interface AuthBrowserTransport {
  captureSession(options?: AuthBrowserOptions): Promise<CapturedProviderSession>;
}
