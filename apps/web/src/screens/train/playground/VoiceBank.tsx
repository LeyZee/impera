import type { PlaygroundState, VoiceBank, VoiceBankExample } from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type JSX } from 'react';

import { inSentence } from './model';
import type { Playground } from './usePlayground';

/*
 * « Sa banque » (ADR 0102 § 5): her corrections filed as voice examples, on any of her versions: one bank per creator (§ 1). The twelve her voice
 * reads now are read in her real drafts too; « Retirer » takes one out everywhere, kept for history.
 */

const SHOWN = 20;

const DAY = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

/** « 12 lus sur 15 », or « vide » before the first. */
export function bankSummary(bank: Pick<VoiceBank, 'examples'>): string {
  if (bank.examples.length === 0) return 'vide';
  const read = bank.examples.filter((e) => e.isRead).length;
  return `${String(read)} lu${read > 1 ? 's' : ''} sur ${String(bank.examples.length)}`;
}

/** Where the example stands: read by her voice, waiting behind the twelve (the intro says so), or stopped and why. */
export function exampleStatus(example: Pick<VoiceBankExample, 'state' | 'isRead' | 'blockedBy'>): string {
  if (example.state === 'blocked') {
    const why = example.blockedBy.map((v) => inSentence(v.label)).join(', ');
    return why === '' ? 'Arrêté par une garde' : `Arrêté : ${why}`;
  }
  return example.isRead ? 'Lu par sa voix' : 'En réserve';
}

export function VoiceBankFold({
  state,
  pg,
  mayWithdraw = true,
}: {
  state: PlaygroundState;
  pg: Playground;
  /** The owner alone withdraws an example (ADR 0092 § 8); a manager reads her bank. */
  mayWithdraw?: boolean;
}): JSX.Element | null {
  const played = state.persona.played ?? null;
  const queryClient = useQueryClient();
  const [asked, setAsked] = useState<string | null>(null);
  // Said until the next action: the rating that follows, or another « Retirer ».
  const [withdrawnAt, setWithdrawnAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // A lesson filed on screen asks for the bank again.
  const key = ['playground', 'bank', played?.creatorId, played?.versionId, state.rate.rated];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      played === null
        ? Promise.resolve({ examples: [] })
        : pg.client.bank(played.creatorId, played.versionId),
    enabled: played !== null,
    retry: false,
  });
  // The invented persona belongs to no creator: no bank to show (ADR 0102 § 1).
  if (played === null) return null;
  const examples = query.data?.examples ?? [];

  const withdraw = async (id: string): Promise<void> => {
    setFailed(false);
    try {
      const next = await pg.client.withdrawExample(played.creatorId, played.versionId, id);
      queryClient.setQueryData(key, next);
      setWithdrawnAt(state.rate.rated);
    } catch {
      setFailed(true);
    } finally {
      setAsked(null);
    }
  };

  return (
    <details className="nv-disclosure pg-fold pg-fold--sticky">
      <summary>
        <span className="nv-disclosure__title">Sa banque</span>
        <span className="nv-disclosure__sum">
          {query.isError ? 'indisponible' : bankSummary({ examples })}
        </span>
      </summary>
      <div className="nv-disclosure__body">
        <p className="pg-hint">
          Tes corrections rangées en Exemple de voix, toutes versions confondues. Les douze plus récentes que
          ses gardes laissent passer sont lues par sa voix, ici et avec ses vrais fans.
        </p>
        {withdrawnAt === state.rate.rated ? (
          <p className="pg-bank__done" role="status">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
            Exemple retiré. Ses vrais brouillons ne le lisent plus ; ici, ce sera à la prochaine conversation.
          </p>
        ) : null}
        {failed ? (
          <p className="pg-hint pg-hint--warn" role="alert">
            Pas retiré : la banque ne répond pas. Réessaie.
          </p>
        ) : null}
        {examples.length === 0 ? null : (
          <ul className="pg-bank">
            {examples.slice(0, SHOWN).map((example) => (
              <li
                key={example.id}
                className="pg-bank__item"
                data-state={example.isRead ? 'read' : example.state}
              >
                <span className="pg-bank__text">{example.text}</span>
                <span className="pg-bank__meta">
                  {DAY.format(new Date(example.ratedAt))} · après « {example.fanMessage} »
                </span>
                {asked === example.id ? (
                  <span className="pg-bank__confirm">
                    <span>Il ne servira plus nulle part.</span>
                    <span className="pg-bank__actions">
                      <button
                        type="button"
                        className="nv-btn nv-btn--soft nv-btn--sm"
                        onClick={() => {
                          setAsked(null);
                        }}
                      >
                        Garder
                      </button>
                      <button
                        type="button"
                        className="nv-btn nv-btn--soft nv-btn--destructive nv-btn--sm"
                        onClick={() => void withdraw(example.id)}
                      >
                        Retirer
                      </button>
                    </span>
                  </span>
                ) : (
                  <span className="pg-bank__foot">
                    <span className="pg-bank__status">{exampleStatus(example)}</span>
                    {mayWithdraw ? (
                      <button
                        type="button"
                        className="nv-btn nv-btn--soft nv-btn--sm"
                        disabled={asked !== null}
                        onClick={() => {
                          setWithdrawnAt(null);
                          setAsked(example.id);
                        }}
                      >
                        Retirer
                      </button>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {examples.length > SHOWN ? (
          <p className="pg-hint">{`Et ${String(examples.length - SHOWN)} plus anciens.`}</p>
        ) : null}
      </div>
    </details>
  );
}
