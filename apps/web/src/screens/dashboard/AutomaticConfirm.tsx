import { useState, type JSX } from 'react';

import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Dialog } from '@/shell/Dialog';

/**
 * Automatique sends without anyone reading first (recette 05/11, reco 9): whoever turns it on gives the password and
 * the code again when they were not given in the last 10 minutes on this session. Confirmed, the control sends
 * Automatique again; « Annuler », Échap or a tap outside leave the mode as it was. Arrêt never comes here.
 */
export function AutomaticConfirm({
  creatorName,
  onConfirmed,
  onCancel,
}: {
  creatorName: string;
  onConfirmed: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Passer en Automatique" busy={busy} onClose={onCancel}>
      <PasswordPrompt
        lead={`Pour que l’agent réponde seul aux fans de ${creatorName}, confirme ton mot de passe et ton code.`}
        note="Arrêt et Copilote ne demandent rien."
        onConfirmed={onConfirmed}
        onCancel={onCancel}
        onBusyChange={setBusy}
      />
    </Dialog>
  );
}
