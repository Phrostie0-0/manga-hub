export type ProviderCode = "remanga" | "mangalib" | "readmanga" | "inkstory";

export type ProviderCapabilities = {
  libraryRead: boolean;
  progressRead: boolean;
  explicitReadSet: boolean;
  lastReadOnly: boolean;
  deltaSync: boolean;
  browserRequired: boolean;
};

export type ProviderCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export type ProviderOriginState = {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
};

export type ProviderSession = {
  formatVersion: 1;
  cookies: ProviderCookie[];
  origins: ProviderOriginState[];
  accessToken?: string;
  userAgent?: string;
  createdAt: string;
  knownExpiresAt?: string;
};

export type RemoteProfile = {
  externalId: string;
  displayName: string;
};

export type RemoteProgress =
  | {
      kind: "explicit-read-set";
      chapterExternalIds: string[];
      observedAt: string;
    }
  | {
      kind: "last-read";
      lastReadLabel?: string;
      lastReadExternalId?: string;
      readCount?: number;
      totalCount?: number;
      observedAt: string;
    }
  | {
      kind: "status-only";
      completed: boolean;
      observedAt: string;
    };

export type RemoteLibraryEntry = {
  externalId: string;
  sourceUrl: string;
  title: string;
  aliases: string[];
  remoteStatus: string;
  remoteUpdatedAt?: string;
  progress: RemoteProgress;
  fingerprint: string;
};

export type Page<T> = {
  items: T[];
  nextCursor?: string;
};

export type ProviderRequestContext = {
  fetch: typeof globalThis.fetch;
  signal?: AbortSignal;
  now?: () => Date;
};
