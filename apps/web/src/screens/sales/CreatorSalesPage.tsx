import type { CreatorFan } from '@nirvana/contracts';
import type { JSX } from 'react';

import { CreatorReader } from './CreatorReader';
import { useCreatorFans } from './api';
import { fanName, seenOf, unlockedOf } from './view';
import './sales.css';

import { initialOf } from '@/lib/utils';
import { readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader, Panel, PanelSection } from '@/shell/layout';

/**
 * Ventes, the creator's (CR-02 c3, ADR 0042 § 8): her fans, what each unlocked and when he was last seen; a fan
 * opens his conversation, read only. Her earnings and her sales (CR-04) come above them once they exist. No note of
 * a fan: what the agency knows of him is its own (Charles, 03/11).
 */
export function CreatorSalesPage({
  selected,
  onSelect,
}: {
  /** The conversation open, from the address (`?conversation=`), so that « retour » and a reload keep it. */
  selected: string | null;
  onSelect: (conversationId: string | null) => void;
}): JSX.Element {
  const fans = useCreatorFans();
  const now = useNow();
  const zone = readerZone();
  const list = fans.data?.pages.flatMap((page) => page.items) ?? [];
  const open = list.find((fan) => fan.conversationId === selected) ?? null;

  return (
    <Page className={selected === null ? 'vt-page' : 'vt-page vt-page--reading'}>
      <PageHeader
        title="Ventes"
        lead="Tes fans et ce qu’ils ont débloqué. Leur conversation s’ouvre ici, en lecture seule."
      />
      <div className="vt-cols">
        <div className="vt-list">
          {fans.isError && fans.data === undefined ? (
            <ServerSilent
              text="Tes fans n’ont pas pu être lus. Rien ici n’est à jour en attendant."
              onRetry={() => {
                void fans.refetch();
              }}
            />
          ) : fans.data === undefined ? (
            <Panel>
              <PanelSection>
                <div className="vt-skeleton" aria-busy="true" aria-label="Chargement de tes fans">
                  <i />
                  <i />
                  <i />
                </div>
              </PanelSection>
            </Panel>
          ) : (
            <Panel className="nv-enter" title="Tes fans">
              <PanelSection>
                {list.length === 0 ? (
                  <p className="vt-empty">
                    Aucun fan pour l’instant : ils arrivent ici dès leur premier message.
                  </p>
                ) : (
                  <>
                    <p className="vt-note">
                      À côté de chacun, le prix des messages qu’il a débloqués, TVA comprise.
                    </p>
                    <ul className="vt-rows">
                      {list.map((fan) => (
                        <li key={fan.id}>
                          <FanRow
                            fan={fan}
                            seen={seenOf(fan.lastSeenAt, now, zone)}
                            current={fan.conversationId !== null && fan.conversationId === selected}
                            onOpen={onSelect}
                          />
                        </li>
                      ))}
                    </ul>
                    {fans.hasNextPage ? (
                      <button
                        type="button"
                        className="nv-btn nv-btn--plain nv-btn--sm vt-more"
                        disabled={fans.isFetchingNextPage}
                        onClick={() => void fans.fetchNextPage()}
                      >
                        {fans.isFetchingNextPage ? 'Chargement…' : 'Plus de fans'}
                      </button>
                    ) : null}
                  </>
                )}
              </PanelSection>
            </Panel>
          )}
        </div>
        <div className="vt-side">
          {selected === null ? (
            <p className="vt-hint">Choisis un fan pour lire sa conversation.</p>
          ) : (
            <CreatorReader
              key={selected}
              conversationId={selected}
              fallbackName={open === null ? null : fanName(open.displayName)}
              onClose={() => {
                onSelect(null);
              }}
            />
          )}
        </div>
      </div>
    </Page>
  );
}

function FanRow({
  fan,
  seen,
  current,
  onOpen,
}: {
  fan: CreatorFan;
  seen: string;
  current: boolean;
  onOpen: (conversationId: string) => void;
}): JSX.Element {
  const name = fanName(fan.displayName);
  const unlocked = unlockedOf(fan.spent);
  const body = (
    <>
      <span className="nv-avatar" aria-hidden="true">
        {initialOf(name)}
      </span>
      <span className="vt-row__who">
        <b>{name}</b>
        <span className="vt-row__seen">
          {fan.conversationId === null ? `${seen} · pas encore de conversation` : seen}
        </span>
      </span>
      <span className="vt-row__amount nv-num">{unlocked ?? '—'}</span>
    </>
  );
  const { conversationId } = fan;
  return conversationId === null ? (
    <div className="vt-row">{body}</div>
  ) : (
    <button
      type="button"
      className={current ? 'vt-row vt-row--tap is-current' : 'vt-row vt-row--tap'}
      aria-current={current ? 'true' : undefined}
      onClick={() => {
        onOpen(conversationId);
      }}
    >
      {body}
    </button>
  );
}
