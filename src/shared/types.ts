export type LoginStatus = 'disconnected' | 'awaiting_confirmation' | 'connecting' | 'connected' | 'expired' | 'error';
export interface LoginInfo {
  status: LoginStatus;
  qrDataUrl?: string;
  expiresAt?: number;
  user?: { steamId: string; displayName: string };
  error?: string;
}
export interface CloudGame {
  appId: number;
  name: string;
  /** Null means Steam's legacy Cloud inventory RPC is unavailable; game was not yet checked individually. */
  fileCount: number | null;
  totalBytes: number | null;
}
export interface CloudFile {
  name: string;
  size: number;
  modifiedAt: number;
  sha: string;
}
export interface FileListing {
  appId: number;
  files: CloudFile[];
  revision: string;
}
export interface DeleteResult {
  deleted: string[];
  failed: { name: string; message: string }[];
  batchCompleted: boolean;
}
export interface DeletePlan {
  planId: string;
  appId: number;
  files: CloudFile[];
  totalBytes: number;
  expiresAt: number;
  confirmation: string;
}
export interface SessionInfo {
  csrfToken: string;
  mode: 'live' | 'demo';
  login: LoginInfo;
}
