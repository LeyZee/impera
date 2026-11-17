import { useState, type JSX } from 'react';

import type { InvoiceOutcome, InvoiceRefusal } from './api';

import { useConfirmAgain } from '@/settings/services/ConfirmAgain';

export interface ConfirmedWrite {
  readonly busy: boolean;
  /** The last refusal, to say in words; `null` while a write runs, after it went through, or while the prompt asks. */
  readonly refusal: InvoiceRefusal | null;
  /** The password and the code while a write waits for them (EQ-15), `null` otherwise: shown in place of the form. */
  readonly prompt: JSX.Element | null;
  /**
   * Runs `write`: `onDone` with what the server answered, `onRefused` after a refusal is said. A write the server sends
   * back for want of a recent confirmation is kept while the prompt asks, then run again as it was; « Annuler » gives
   * it up, nothing written.
   */
  readonly send: <T>(
    write: () => Promise<InvoiceOutcome<T>>,
    onDone: (value: T) => Promise<void> | void,
    onRefused?: (refusal: InvoiceRefusal) => Promise<void> | void,
  ) => void;
}

/**
 * A write of the payroll API (the contractor's file, the invoices, Réglages › Facturation) that may ask for the
 * password and the code again (EQ-15, Charles 16/11). The rule is the server's: the page only asks when told.
 */
export function useConfirmedWrite(lead: string): ConfirmedWrite {
  const confirm = useConfirmAgain();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<InvoiceRefusal | null>(null);
  const send: ConfirmedWrite['send'] = (write, onDone, onRefused) => {
    setBusy(true);
    setRefusal(null);
    void write().then(async (outcome) => {
      if (outcome.kind === 'ok') {
        await onDone(outcome.value);
        setBusy(false);
        return;
      }
      setBusy(false);
      if (outcome.kind === 'reauth') {
        confirm.ask(() => {
          send(write, onDone, onRefused);
        });
        return;
      }
      setRefusal(outcome);
      await onRefused?.(outcome);
    });
  };
  return { busy, refusal, prompt: confirm.prompt({ lead, onBusyChange: setBusy }), send };
}
