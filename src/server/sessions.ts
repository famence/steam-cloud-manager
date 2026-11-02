import { randomBytes } from 'node:crypto';
import type { CloudDriver } from './steam/contracts.js';
import type { CloudFile, DeletePlan } from '../shared/types.js';
import { AppError } from './errors.js';

export interface StoredPlan extends DeletePlan { revision: string }
export interface ExportTicket { appId: number; files: CloudFile[]; expiresAt: number; revision: string }
export interface Session {
  id: string;
  csrfToken: string;
  createdAt: number;
  lastSeen: number;
  driver: CloudDriver;
  plans: Map<string, StoredPlan>;
  exports: Map<string, ExportTicket>;
  busy: boolean;
  activeTransfers: number;
  revoked: boolean;
  abortTransfers: Set<() => void>;
}
export const randomId = () => randomBytes(32).toString('base64url');

export class SessionStore {
  private sessions = new Map<string, Session>();
  private timer: ReturnType<typeof setInterval>;
  constructor(private factory: () => CloudDriver, private ttl: number, private max: number, private now = Date.now) {
    this.timer = setInterval(() => this.prune(), 30_000);
    this.timer.unref();
  }
  create() {
    this.prune();
    if (this.sessions.size >= this.max) {
      const idle = [...this.sessions.values()].filter((s) => !s.busy && !s.activeTransfers
        && ['disconnected', 'expired', 'error'].includes(s.driver.getLogin().status))
        .sort((a, b) => a.lastSeen - b.lastSeen)[0];
      if (idle) this.destroy(idle);
    }
    if (this.sessions.size >= this.max) throw new AppError(503, 'SESSION_LIMIT', 'Слишком много активных сессий. Попробуйте позже.');
    const session: Session = {
      id: randomId(), csrfToken: randomId(), createdAt: this.now(), lastSeen: this.now(),
      driver: this.factory(), plans: new Map(), exports: new Map(), busy: false,
      activeTransfers: 0, revoked: false, abortTransfers: new Set(),
    };
    this.sessions.set(session.id, session);
    return session;
  }
  get(id?: string) {
    if (!id) return;
    const session = this.sessions.get(id);
    if (!session) return;
    if (this.expired(session)) { this.destroy(session); return; }
    session.lastSeen = this.now();
    for (const [key, plan] of session.plans) if (plan.expiresAt <= this.now()) session.plans.delete(key);
    for (const [key, ticket] of session.exports) if (ticket.expiresAt <= this.now()) session.exports.delete(key);
    return session;
  }
  private expired(session: Session) {
    if (session.busy || session.activeTransfers > 0) return false;
    if (session.driver.getLogin().status !== 'connected' && this.now() - session.createdAt >= 5 * 60_000) return true;
    return this.now() - session.lastSeen >= this.ttl || this.now() - session.createdAt >= 4 * 60 * 60_000;
  }
  destroy(session: Session) {
    session.revoked = true;
    this.sessions.delete(session.id);
    for (const abort of session.abortTransfers) abort();
    session.abortTransfers.clear();
    session.plans.clear(); session.exports.clear();
    session.driver.close();
  }
  prune() { for (const session of this.sessions.values()) if (this.expired(session)) this.destroy(session); }
  close() { clearInterval(this.timer); for (const session of this.sessions.values()) this.destroy(session); }
}
