import type {
  Page,
  ProviderCapabilities,
  ProviderCode,
  ProviderRequestContext,
  ProviderSession,
  RemoteLibraryEntry,
  RemoteProfile,
} from "./types";

export interface ProviderAdapter {
  readonly code: ProviderCode;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly allowedOrigins: readonly string[];

  verifySession(
    session: ProviderSession,
    context: ProviderRequestContext,
  ): Promise<RemoteProfile>;

  listLibrary(
    session: ProviderSession,
    profile: RemoteProfile,
    cursor: string | undefined,
    context: ProviderRequestContext,
  ): Promise<Page<RemoteLibraryEntry>>;
}
