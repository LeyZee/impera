import { useLiveDashboard } from './live';
import type { AgentMode, AutomaticGate } from './mode';

/**
 * The agent's mode as the server gives it, or why there is none: `loading` until it answers, `unavailable` when it
 * fails, `empty` when no creator exists yet. Nothing here makes a mode up.
 */
export type AgentModeView =
  | {
      readonly source: 'live';
      readonly mode: AgentMode;
      readonly automatic: AutomaticGate;
      /** Why nothing runs whatever the mode, or null when Reveal is read and a voice answers. */
      readonly stalled: string | null;
      /** Whose agent: the pill names her when the account follows several (DASH-03). */
      readonly creatorName: string;
    }
  | { readonly source: 'loading' | 'unavailable' | 'empty' };

/**
 * The one door to the agent's mode for the bar's pill: it reads the same `GET /v1/dashboard` as the Dashboard, so
 * both always say the same thing. The Dashboard's control writes it (`agent/write.ts`).
 */
export function useAgentMode(): AgentModeView {
  const live = useLiveDashboard();
  if (live.kind === 'live') {
    const { reveal, voice } = live.data;
    // The Dashboard's own rule: never read once means not linked yet, read then lost means disconnected.
    const stalled = !reveal.connected
      ? reveal.lastReadAt === null
        ? 'Reveal n’est pas encore relié'
        : 'Reveal est déconnecté'
      : reveal.late
        ? 'Reveal n’est plus lu depuis plusieurs minutes'
        : voice.ok
          ? null
          : voice.keyMissing
            ? 'l’IA qui écrit attend sa clé'
            : 'l’IA qui écrit ne répond pas';
    return {
      source: 'live',
      mode: live.data.mode,
      automatic: live.data.automatic,
      stalled,
      creatorName: live.data.creator.name,
    };
  }
  return { source: live.kind };
}
