import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { CloudDriver, DriverListing } from './steam/contracts.js';
import type { CloudFile, CloudGame, LoginInfo } from '../shared/types.js';

const templates = [
  {
    appId: 949230,
    name: 'Cities: Skylines II',
    names: [
      'Saves/Cedar Valley.cok',
      'Saves/Cedar Valley.cok.cid',
      'Saves/Autosave-01.cok',
      'Saves/Autosave-02.cok',
      'Saves/Old Town.cok',
      'Settings.coc',
    ],
  },
  {
    appId: 1086940,
    name: "Baldur's Gate 3",
    names: ['Save_01.lsv', 'Save_02.lsv'],
  },
  {
    appId: 1245620,
    name: 'ELDEN RING',
    names: ['ER0000.sl2', 'ER0000.sl2.bak'],
  },
];

export class DemoCloudDriver implements CloudDriver {
  private connected = false;
  private revision = 0;
  private data = new Map<number, Map<string, Buffer>>(
    templates.map((g) => [
      g.appId,
      new Map(
        g.names.map((name, i) => [
          name,
          Buffer.from(
            `DEMO ONLY — this is not a real game save. ${name}\n`.repeat(
              300 + i * 700,
            ),
          ),
        ]),
      ),
    ]),
  );

  async startLogin() {
    this.connected = true;
  }

  getLogin(): LoginInfo {
    return this.connected
      ? {
          status: 'connected',
          user: {
            steamId: '76561198000000000',
            displayName: 'Demo Account',
          },
        }
      : { status: 'disconnected' };
  }

  async listGames(): Promise<CloudGame[]> {
    return templates.map((g) => ({
      appId: g.appId,
      name: g.name,
      fileCount: this.data.get(g.appId)!.size,
      totalBytes: [...this.data.get(g.appId)!.values()].reduce(
        (sum, b) => sum + b.length,
        0,
      ),
    }));
  }

  async listFiles(appId: number): Promise<DriverListing> {
    return {
      appId,
      changeNumber: String(this.revision),
      files: [...(this.data.get(appId) || [])].map(([name, bytes], index) => ({
        name,
        size: bytes.length,
        modifiedAt: 1793574000 - index * 86400,
        sha: createHash('sha1').update(bytes).digest('hex'),
      })),
    };
  }

  async downloadFile(appId: number, file: CloudFile) {
    const bytes = this.data.get(appId)?.get(file.name);
    if (!bytes) throw new Error('Missing demo file');
    return { stream: Readable.from(bytes), size: bytes.length };
  }

  async deleteFiles(appId: number, files: CloudFile[]) {
    const deleted: string[] = [];
    const failed: { name: string; message: string }[] = [];
    for (const file of files) {
      if (this.data.get(appId)?.delete(file.name)) deleted.push(file.name);
      else failed.push({ name: file.name, message: 'Демо-файл уже удалён.' });
    }
    this.revision++;
    return { deleted, failed, batchCompleted: true };
  }

  close() {
    this.connected = false;
    this.data.clear();
  }
}
