import { randomBytes } from 'node:crypto';
import type { CloudDriver } from './steam/contracts.js';
import { DemoCloudDriver } from './demo-driver.js';
import type { CloudFile, DeletePlan } from '../shared/types.js';
import { AppError } from './errors.js';
import {
  encryptToken,
  decryptToken,
  resolveEncryptionKey,
  type SessionTokenPayload,
} from './session-token.js';

export interface StoredPlan extends DeletePlan {
  revision: string;
  names?: string[];
}

export interface ExportTicket {
  appId: number;
  files: CloudFile[];
  expiresAt: number;
  revision: string;
  names?: string[];
}

export interface Session {
  id: string;
  csrfToken: string;
  connectionId: string;
  createdAt: number;
  lastSeen: number;
  driver: CloudDriver;
  plans: Map<string, StoredPlan>;
  exports: Map<string, ExportTicket>;
  busy: boolean;
  activeTransfers: number;
  revoked: boolean;
  abortTransfers: Set<() => void>;
  mode: 'live' | 'demo';
  steamId?: string;
  displayName?: string;
  refreshToken?: string;
}

export const randomId = () => randomBytes(32).toString('base64url');

export class SessionStore {
  private sessions = new Map<string, Session>();
  private tokenCache = new Map<string, Session>();
  private timer: ReturnType<typeof setInterval>;
  private encryptionKey: Buffer;

  constructor(
    private factory: (mode?: 'live' | 'demo') => CloudDriver,
    private ttl: number,
    private max: number,
    private now = Date.now,
    options: { encryptionKey?: Buffer; allowedSteamIds?: string[] } = {},
  ) {
    this.encryptionKey = options.encryptionKey ?? resolveEncryptionKey();
    this.timer = setInterval(() => this.prune(), 30_000);
    this.timer.unref();
  }

  create(options?: {
    mode?: 'live' | 'demo';
    steamId?: string;
    displayName?: string;
    refreshToken?: string;
    driver?: CloudDriver;
    connectionId?: string;
  }): Session {
    this.prune();
    if (this.sessions.size >= this.max) {
      const idle = [...this.sessions.values()]
        .filter(
          (s) =>
            !s.busy &&
            !s.activeTransfers &&
            ['disconnected', 'expired', 'error'].includes(s.driver.getLogin().status),
        )
        .sort((a, b) => a.lastSeen - b.lastSeen)[0];
      if (idle) this.destroy(idle);
    }
    if (this.sessions.size >= this.max) {
      throw new AppError(503, 'SESSION_LIMIT', 'Слишком много активных сессий. Попробуйте позже.');
    }

    const mode = options?.mode ?? 'live';
    let driver = options?.driver;
    if (!driver) {
      driver = mode === 'demo' ? new DemoCloudDriver() : this.factory('live');
    }

    const session: Session = {
      id: randomId(),
      csrfToken: randomId(),
      connectionId: options?.connectionId ?? randomId(),
      createdAt: this.now(),
      lastSeen: this.now(),
      driver,
      plans: new Map(),
      exports: new Map(),
      busy: false,
      activeTransfers: 0,
      revoked: false,
      abortTransfers: new Set(),
      mode,
      steamId: options?.steamId,
      displayName: options?.displayName,
      refreshToken: options?.refreshToken,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  get(idOrToken?: string): Session | undefined {
    if (!idOrToken) return;

    // 1. Check warm token cache (< 0.01ms hit)
    let session = this.tokenCache.get(idOrToken);

    // 2. Check direct session ID lookup (< 0.01ms hit)
    if (!session) {
      session = this.sessions.get(idOrToken);
    }

    // 3. Cold instance miss: attempt AES-256-GCM token decryption
    if (!session) {
      const payload = decryptToken<SessionTokenPayload>(
        idOrToken,
        this.encryptionKey,
        'scm-session',
        this.now(),
      );
      if (payload) {
        session = this.sessions.get(payload.sessionId);
        if (!session) {
          // Rehydrate driver on cold instance
          let driver: CloudDriver;
          if (payload.mode === 'demo') {
            const demo = new DemoCloudDriver();
            void demo.startLogin();
            driver = demo;
          } else {
            driver = this.factory('live');
          }

          session = {
            id: payload.sessionId,
            csrfToken: payload.csrfToken,
            connectionId: payload.connectionId || payload.sessionId,
            createdAt: payload.issuedAt,
            lastSeen: this.now(),
            driver,
            plans: new Map(),
            exports: new Map(),
            busy: false,
            activeTransfers: 0,
            revoked: false,
            abortTransfers: new Set(),
            mode: payload.mode,
            steamId: payload.steamId,
            displayName: payload.displayName,
            refreshToken: payload.refreshToken,
          };
          this.sessions.set(session.id, session);
        }
        this.tokenCache.set(idOrToken, session);
      }
    }

    if (!session) return;
    if (this.expired(session)) {
      this.destroy(session);
      return;
    }

    session.lastSeen = this.now();
    for (const [key, plan] of session.plans) {
      if (plan.expiresAt <= this.now()) session.plans.delete(key);
    }
    for (const [key, ticket] of session.exports) {
      if (ticket.expiresAt <= this.now()) session.exports.delete(key);
    }
    return session;
  }

  issueToken(session: Session): string {
    const login = session.driver.getLogin();
    if (login.user) {
      session.steamId = login.user.steamId;
      session.displayName = login.user.displayName;
    }

    const payload: SessionTokenPayload = {
      purpose: 'scm-session',
      sessionId: session.id,
      csrfToken: session.csrfToken,
      connectionId: session.connectionId,
      mode: session.mode,
      issuedAt: this.now(),
      expiresAt: this.now() + this.ttl,
      ...(session.steamId ? { steamId: session.steamId } : {}),
      ...(session.displayName ? { displayName: session.displayName } : {}),
      ...(session.refreshToken ? { refreshToken: session.refreshToken } : {}),
    };

    const token = encryptToken(payload, this.encryptionKey);
    this.tokenCache.set(token, session);
    return token;
  }

  getKey(): Buffer {
    return this.encryptionKey;
  }

  private expired(session: Session): boolean {
    if (session.busy || session.activeTransfers > 0) return false;
    if (session.driver.getLogin().status !== 'connected' && this.now() - session.createdAt >= 5 * 60_000) {
      return true;
    }
    return this.now() - session.lastSeen >= this.ttl || this.now() - session.createdAt >= 4 * 60 * 60_000;
  }

  destroy(session: Session): void {
    session.revoked = true;
    this.sessions.delete(session.id);
    for (const [token, s] of this.tokenCache) {
      if (s === session) this.tokenCache.delete(token);
    }
    for (const abort of session.abortTransfers) abort();
    session.abortTransfers.clear();
    session.plans.clear();
    session.exports.clear();
    session.driver.close();
  }

  prune(): void {
    for (const session of this.sessions.values()) {
      if (this.expired(session)) this.destroy(session);
    }
  }

  close(): void {
    clearInterval(this.timer);
    for (const session of this.sessions.values()) this.destroy(session);
    this.tokenCache.clear();
  }
}
