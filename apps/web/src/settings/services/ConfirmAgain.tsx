import { useState, type JSX } from 'react';

import { PasswordPrompt } from './PasswordPrompt';

import { confirmationHolds } from '@/auth/session';

/** What a gesture on a member, a rate, pay or billing says before the fields (EQ-15). */
export const MONEY_LEAD = 'Ce geste touche à l’argent : confirme ton mot de passe et ton code.';
export const MEMBER_LEAD = 'Ce geste touche à un membre : confirme ton mot de passe et ton code.';
export const BILLING_LEAD = 'Ce geste touche à la facturation : confirme ton mot de passe et ton code.';

/** A hold's five seconds, the server's answer, and a margin: a confirmation that ends sooner is asked for again first. */
const ASK_FIRST_MARGIN_MS = 60_000;

export interface ConfirmAgain {
  /** Whether a write waits for the password and the code. */
  readonly asking: boolean;
  /**
   * Keeps `again`, the write the server sent back, while the prompt asks; it runs once they are confirmed, and
   * `giveUp` runs instead when the prompt is cancelled.
   */
  readonly ask: (again: () => void, giveUp?: () => void) => void;
  /**
   * For a gesture that waits before it writes (a hold's countdown, recette navigation PARC-02): runs `run` at once when
   * this session's confirmation still holds for `forMs`, otherwise asks first, at the click, and runs it after.
   */
  readonly askFirst: (
    run: () => void,
    options?: { readonly forMs?: number; readonly giveUp?: () => void },
  ) => void;
  /** Gives the write up, as « Annuler » does: for a dialog closed around the prompt. */
  readonly cancel: () => void;
  /** The prompt while a write waits, `null` otherwise: put where the form's foot or body would be. */
  readonly prompt: (options: {
    readonly lead: string | null;
    readonly layout?: 'inline' | 'dialog';
    readonly onBusyChange?: (isBusy: boolean) => void;
  }) => JSX.Element | null;
}

/**
 * A write the server refused for want of a recent confirmation (403 `reauthentication_forbidden`, EQ-15, ADR 0046 § 3):
 * kept here while `PasswordPrompt` asks for the password and the code, then run again; « Annuler » gives it up and
 * nothing was written. The rule is the server's: the page only asks when told.
 */
export function useConfirmAgain(): ConfirmAgain {
  const [again, setAgain] = useState<{ readonly run: () => void; readonly giveUp: () => void } | null>(null);
  const cancel = (): void => {
    setAgain(null);
    again?.giveUp();
  };
  return {
    asking: again !== null,
    ask: (run, giveUp = () => undefined) => {
      setAgain({ run, giveUp });
    },
    askFirst: (run, { forMs = ASK_FIRST_MARGIN_MS, giveUp = () => undefined } = {}) => {
      void confirmationHolds(forMs).then((holds) => {
        if (holds) run();
        else setAgain({ run, giveUp });
      });
    },
    cancel,
    prompt: ({ lead, layout = 'dialog', onBusyChange }) =>
      again === null ? null : (
        <PasswordPrompt
          lead={lead}
          layout={layout}
          {...(onBusyChange === undefined ? {} : { onBusyChange })}
          onConfirmed={() => {
            setAgain(null);
            again.run();
          }}
          onCancel={cancel}
        />
      ),
  };
}
