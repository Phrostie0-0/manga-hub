import type {
  ProviderCode,
  ProviderSession,
  RemoteLibraryEntry,
  RemoteProfile,
} from "../../../packages/connectors/src/types";

export type SyncMode = "initial" | "incremental" | "reconcile";

export type SyncConnection = {
  id: string;
  userId: string;
  provider: ProviderCode;
  session: ProviderSession;
  remoteProfile?: RemoteProfile;
  cursor?: string;
};

export type SyncRunRecord = {
  id: string;
  connectionId: string;
  mode: SyncMode;
};

export interface SyncRepository {
  beginRun(connection: SyncConnection, mode: SyncMode): Promise<SyncRunRecord>;
  saveRemoteProfile(connectionId: string, profile: RemoteProfile): Promise<void>;
  saveLibraryPage(input: {
    runId: string;
    connection: SyncConnection;
    profile: RemoteProfile;
    items: RemoteLibraryEntry[];
    observedAt: Date;
  }): Promise<void>;
  saveCursor(connectionId: string, cursor: string | undefined): Promise<void>;
  completeRun(input: {
    runId: string;
    importedItems: number;
    completedAt: Date;
  }): Promise<void>;
  failRun(input: {
    runId: string;
    code: string;
    safeMessage: string;
    failedAt: Date;
  }): Promise<void>;
  setConnectionState(input: {
    connectionId: string;
    state: "active" | "reauth_required" | "needs_attention" | "rate_limited" | "degraded";
    nextSyncAt?: Date;
  }): Promise<void>;
}
