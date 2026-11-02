import type { Readable } from 'node:stream';
import type { CloudFile, CloudGame, DeleteResult, LoginInfo } from '../../shared/types.js';

export interface DriverListing {
  appId: number;
  files: CloudFile[];
  changeNumber: string;
}
export interface CloudDriver {
  startLogin(): Promise<void>;
  getLogin(): LoginInfo;
  listGames(): Promise<CloudGame[]>;
  listFiles(appId: number): Promise<DriverListing>;
  downloadFile(appId: number, file: CloudFile): Promise<{ stream: Readable; size: number }>;
  deleteFiles(appId: number, files: CloudFile[]): Promise<DeleteResult>;
  close(): void;
}
