import type { UserRole } from '@impera/contracts';

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
  operator: 'Équipe',
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
