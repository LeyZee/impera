import type { ShiftReportId } from '@nirvana/contracts';
import { useNavigate } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type JSX,
  type ReactNode,
} from 'react';

/**
 * A report panel opened again as it was, from the hold's island (« Annuler », « Rouvrir »), wherever the reader went
 * since: on its screen at once when that screen is shown, else after going back to it (EQ-03). The island outlives the
 * screens, so the panel it reopens cannot live in the screen that opened it.
 */

/** What the panel was holding when it closed, to open it again as it was: after « Annuler », or a refusal. */
export interface ReportDraft {
  readonly id: ShiftReportId;
  readonly correcting: boolean;
  readonly amount: string;
  readonly comment: string;
  readonly incidentOn: boolean;
  readonly incident: string;
}

/** The screens that open a report panel. */
export type ReportScreen = '/aujourdhui' | '/planning' | '/equipe/rapports';

export interface Reopening {
  readonly screen: ReportScreen;
  readonly shiftId: string;
  /** The member whose report the agency corrects; `null` for the member's own. */
  readonly memberName: string | null;
  readonly draft: ReportDraft;
}

interface Reopener {
  readonly reopen: (what: Reopening) => void;
  /** Its screen opens the panel while it is shown, and takes the one waiting for it when it comes back. */
  readonly listen: (screen: ReportScreen, open: (what: Reopening) => void) => () => void;
}

const ReopenContext = createContext<Reopener | null>(null);

/** Above every screen, beside the hold (the shell mounts both once). */
export function ReopenProvider({ children }: { children: ReactNode }): JSX.Element {
  const navigate = useNavigate();
  const listeners = useRef(new Map<ReportScreen, (what: Reopening) => void>());
  const waiting = useRef<Reopening | null>(null);

  const reopen = useCallback(
    (what: Reopening): void => {
      const open = listeners.current.get(what.screen);
      if (open !== undefined) {
        open(what);
        return;
      }
      waiting.current = what;
      void navigate({ to: what.screen });
    },
    [navigate],
  );

  const listen = useCallback((screen: ReportScreen, open: (what: Reopening) => void): (() => void) => {
    listeners.current.set(screen, open);
    const now = waiting.current;
    if (now?.screen === screen) {
      waiting.current = null;
      open(now);
    }
    return () => {
      if (listeners.current.get(screen) === open) listeners.current.delete(screen);
    };
  }, []);

  const reopener = useMemo(() => ({ reopen, listen }), [reopen, listen]);
  return <ReopenContext.Provider value={reopener}>{children}</ReopenContext.Provider>;
}

function useReopener(): Reopener {
  const reopener = useContext(ReopenContext);
  if (reopener === null) throw new Error('A report panel needs the shell’s ReopenProvider');
  return reopener;
}

/** Opens a report panel again on its screen, from wherever the reader is. */
export function useReopen(): (what: Reopening) => void {
  return useReopener().reopen;
}

/** The screen `screen` opens its report panel as `open` says, while it is shown and when it comes back. */
export function useReopening(screen: ReportScreen, open: (what: Reopening) => void): void {
  const { listen } = useReopener();
  const latest = useRef(open);
  useEffect(() => {
    latest.current = open;
  });
  useEffect(
    () =>
      listen(screen, (what) => {
        latest.current(what);
      }),
    [listen, screen],
  );
}
