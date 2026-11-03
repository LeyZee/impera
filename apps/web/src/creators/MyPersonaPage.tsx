import { useBlocker } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { LeaveConfirm } from './LeaveConfirm';
import { useCreators } from './api';
import { PersonaSection } from './persona/PersonaSection';

import { MeNav } from '@/screens/me/MeNav';
import { Page, PageHeader } from '@/shell/layout';

/**
 * Moi › Persona, the creator's own (ADR 0042 § 8: her Persona tab moves into Moi). She reads and saves her persona as
 * before; changes not saved are never lost silently: leaving asks first, as on the owner's sheet.
 */
export function MyPersonaPage(): JSX.Element {
  const query = useCreators();
  // Her account holds exactly one creator (ADR 0042 § 2, checked by the base); the list is hers alone.
  const own = query.data?.[0];
  const [dirty, setDirty] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });

  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Persona"
        lead="Ta fiche : qui tu es, ce que tu aimes, tes limites et ta façon de parler."
        actions={<MeNav creator />}
      />
      <div className="ps-sheet">
        {blocker.status === 'blocked' ? (
          <LeaveConfirm
            onLeave={() => {
              blocker.proceed();
            }}
            onStay={() => {
              blocker.reset();
            }}
          />
        ) : null}
        {query.isError ? (
          <section className="ps-page">
            <div className="nv-plate ps-head">
              <p className="ps-title">Ta fiche ne se charge pas</p>
              <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
              <button
                type="button"
                className="nv-btn nv-btn--soft ps-self-start"
                onClick={() => void query.refetch()}
              >
                Réessayer
              </button>
            </div>
          </section>
        ) : query.isPending ? (
          <section className="ps-page" aria-busy="true">
            <div className="nv-plate ps-head ps-skeleton" />
            <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
          </section>
        ) : (
          <PersonaSection
            key={own?.id ?? 'none'}
            creatorId={own?.id ?? null}
            canSave={own !== undefined}
            creatorName={own?.displayName ?? null}
            timezone={own?.timezone ?? null}
            onDirty={setDirty}
          />
        )}
      </div>
    </Page>
  );
}
