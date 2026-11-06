import type { OpenSession, UserRole } from '@impera/contracts';

/** « à l’instant », « il y a 12 min », « il y a 3 h », « il y a 2 j »: when a session was last used, the number never cut from its unit. */
export function ago(at: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(at).getTime()) / 60_000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il\u00a0y\u00a0a\u00a0${String(minutes)}\u00a0min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il\u00a0y\u00a0a\u00a0${String(hours)}\u00a0h`;
  return `il\u00a0y\u00a0a\u00a0${String(Math.floor(hours / 24))}\u00a0j`;
}

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  owner: 'Propriétaire',
  // A person, not a group: the account of someone of the team (recette SEC-16).
  operator: 'Membre de l’équipe',
  creator: 'Créatrice',
};

/** « 1 session ouverte », « 3 sessions ouvertes », « Aucune session ouverte ». */
export function sessionsText(count: number): string {
  if (count === 0) return 'Aucune session ouverte';
  return `${String(count)} session${count === 1 ? '' : 's'} ouverte${count === 1 ? '' : 's'}`;
}

/** What closing sessions ended, said once it is done. */
export function closedText(sessions: number, trustedDevices: number): string {
  const closed =
    sessions === 0
      ? 'Aucune autre session n’était ouverte'
      : sessionsText(sessions).replace(' ouverte', ' fermée');
  if (trustedDevices === 0) return `${closed}.`;
  return `${closed}, et ${String(trustedDevices)} appareil${trustedDevices === 1 ? '' : 's'} de confiance oublié${trustedDevices === 1 ? '' : 's'}.`;
}

/** « 1 clé d’accès », « 2 clés d’accès », « Aucune clé d’accès ». */
export function passkeysText(count: number): string {
  if (count === 0) return 'Aucune clé d’accès';
  return `${String(count)}\u00a0clé${count === 1 ? '' : 's'} d’accès`;
}

/** « 2 nov. 2026 », « 1er nov. 2026 »: the day a key was added. */
export function dayText(at: string): string {
  const text = new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  // « 1er nov. 2026 », never « 1 nov. »
  return text.replace(/^1 /u, '1er ');
}

/** Sessions of one device on one network: a browser that signs in often leaves many, read as one line. */
export interface SessionGroup {
  readonly key: string;
  readonly device: string;
  readonly network: string | null;
  readonly current: boolean;
  readonly ids: readonly string[];
  readonly lastActiveAt: string;
}

/**
 * This device's session first, alone (it closes by signing out), then the others gathered by device and network,
 * the most recently used first (recette SEC-16: 26 lines « Appareil inconnu » drowned the rest of the screen).
 */
export function sessionGroups(sessions: readonly OpenSession[]): SessionGroup[] {
  const current: SessionGroup[] = [];
  const others = new Map<string, SessionGroup>();
  for (const session of sessions) {
    if (session.current) {
      current.push({ ...groupOf(session, `current:${session.id}`) });
      continue;
    }
    const key = `${session.device}\u0000${session.network ?? ''}`;
    const before = others.get(key);
    others.set(
      key,
      before === undefined
        ? groupOf(session, key)
        : {
            ...before,
            ids: [...before.ids, session.id],
            lastActiveAt:
              before.lastActiveAt > session.lastActiveAt ? before.lastActiveAt : session.lastActiveAt,
          },
    );
  }
  const byRecent = [...others.values()].sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
  return [...current, ...byRecent];
}

function groupOf(session: OpenSession, key: string): SessionGroup {
  return {
    key,
    device: session.device,
    network: session.network,
    current: session.current,
    ids: [session.id],
    lastActiveAt: session.lastActiveAt,
  };
}
