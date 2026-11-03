import {
  AgentModeResultSchema,
  ApiErrorSchema,
  AutomaticMissingSchema,
  type AgentMode,
  type AgentModeResult,
  type Dashboard as ApiDashboard,
} from '@impera/contracts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { z } from 'zod';

import { missingRows } from './mode';

const MissingSchema = z.array(AutomaticMissingSchema);

/** A change the server refused or could not make, with the sentence the screen shows. */
class ModeNotChanged extends Error {}

const OFFLINE = 'Le mode n’a pas changé : le serveur ne répond pas. Réessaie dans un instant.';
const FORBIDDEN = 'Le mode n’a pas changé : tu n’as pas la main sur cette créatrice.';
/** Copilote asked, Arrêt kept: an operator's global switch holds every creator. */
const GLOBAL_STOP = 'L’agent reste arrêté : un arrêt général est posé pour toutes les créatrices.';

/** `PUT /v1/agent/mode`. Throws `ModeNotChanged` with a French sentence on any refusal. */
async function putAgentMode(creatorId: string, mode: AgentMode): Promise<AgentModeResult> {
  const response = await fetch('/v1/agent/mode', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ creatorId, mode }),
  }).catch(() => null);
  if (response === null) throw new ModeNotChanged(OFFLINE);
  if (response.ok) return AgentModeResultSchema.parse(await response.json());
  if (response.status === 409) {
    // Automatique still locked (ADR 0019): what is missing, with the server's figures, or else its own sentence.
    const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (body.success) {
      const missing = MissingSchema.safeParse(body.data.error.details['missing']);
      const rows = missing.success ? missingRows({ open: false, missing: missing.data }) : [];
      throw new ModeNotChanged(
        rows.length === 0
          ? body.data.error.message
          : `Automatique reste fermé : ${rows.map(([label, value]) => `${label.toLowerCase()} ${value}`).join(', ')}.`,
      );
    }
  }
  throw new ModeNotChanged(response.status === 403 ? FORBIDDEN : OFFLINE);
}

/** Puts the server's answer on every period of her Dashboard, then reads them again for the rest. */
async function settle(client: QueryClient, creatorId: string, result: AgentModeResult): Promise<void> {
  const key = ['dashboard', creatorId];
  // A read sent before the change would land after it and put the old mode back (an Arrêt lost): dropped first.
  await client.cancelQueries({ queryKey: key });
  client.setQueriesData<ApiDashboard>({ queryKey: key }, (before) =>
    before === undefined ? before : { ...before, mode: result.mode, globalStop: result.globalStop },
  );
  await client.invalidateQueries({ queryKey: key });
}

export interface ModeWriter {
  readonly setMode: (mode: AgentMode) => void;
  readonly pending: boolean;
  /**
   * What the screen must say after a change: a refusal, or Arrêt kept by the global switch. Gone once the page has
   * read the server again, which then says what holds.
   */
  readonly notice: string | null;
}

/**
 * The Dashboard control's one door to the server: no change shows before the server has made it. `read` is when
 * the server last answered the page: a notice holds only until the next answer.
 */
export function useAgentModeWriter(creatorId: string | null, read: number): ModeWriter {
  const client = useQueryClient();
  // Each notice remembers the answer it was said on, and goes once the page holds a newer one.
  const [said, setSaid] = useState<{ readonly text: string; readonly on: number } | null>(null);
  const mutation = useMutation({
    mutationFn: async ({ mode }: { mode: AgentMode; on: number }) => {
      // The sample has no creator: nothing to write.
      if (creatorId === null) throw new ModeNotChanged(OFFLINE);
      setSaid(null);
      return putAgentMode(creatorId, mode);
    },
    onSuccess: async (result, { mode, on }) => {
      if (result.globalStop && mode !== 'stop') setSaid({ text: GLOBAL_STOP, on });
      if (creatorId !== null) await settle(client, creatorId, result);
    },
    onError: (error, { on }) => {
      setSaid({ text: error instanceof ModeNotChanged ? error.message : OFFLINE, on });
    },
  });
  const { mutate } = mutation;
  const setMode = useCallback(
    (mode: AgentMode) => {
      mutate({ mode, on: read });
    },
    [mutate, read],
  );
  const notice = said !== null && said.on === read ? said.text : null;
  return { setMode, pending: mutation.isPending, notice };
}
