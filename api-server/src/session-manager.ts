import { createDiagramSession } from './kotlin-bridge';

interface SessionEntry {
  id: string;
  session: any; // DiagramSession from Kotlin/JS
  createdAt: number;
  lastAccessedAt: number;
}

const MAX_SESSIONS = 20;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let sessions = new Map<string, SessionEntry>();
let nextId = 1;

function generateId(): string {
  return `session-${nextId++}`;
}

function cleanExpired(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastAccessedAt > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}

export function createSession(): { id: string } {
  cleanExpired();
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`Maximum ${MAX_SESSIONS} concurrent sessions reached. Delete unused sessions.`);
  }
  const id = generateId();
  const session = createDiagramSession();
  sessions.set(id, {
    id,
    session,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  });
  return { id };
}

export function getSession(id: string): any {
  const entry = sessions.get(id);
  if (!entry) {
    return null;
  }
  entry.lastAccessedAt = Date.now();
  return entry.session;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): Array<{ id: string; createdAt: number; lastAccessedAt: number }> {
  cleanExpired();
  return Array.from(sessions.values()).map(e => ({
    id: e.id,
    createdAt: e.createdAt,
    lastAccessedAt: e.lastAccessedAt,
  }));
}
