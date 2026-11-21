import type { CreatorFan } from '@impera/contracts';
import type { JSX } from 'react';

import { CreatorReader } from './CreatorReader';
import { FanInsights, FanInsightsWaitLine } from './FanInsights';
import { useCreatorFanInsights, useCreatorFans } from './api';
import { fanName, seenOf, unlockedOf } from './view';
import './sales.css';

import { initialOf } from '@/lib/utils';
import { readerZone } from '@/scheduling/time';
import { useNow } from '@/scheduling/useNow';
import { ChatArt, FansArt } from '@/shell/art/EmptyArt';
import { Page, PageHeader, Panel, PanelSection } from '@/shell/layout';
import { Empty, Failure, Skeleton, SkeletonCard } from '@/shell/states';

/**
 * Ventes, the creator's (CR-02 c3, ADR 0042 § 8): her fans first, what each unlocked and when he was last seen; a fan
 * opens his conversation, read only. « Qui sont tes fans » comes after them (choice of 21/11). Her earnings and her sales (CR-04) come above them once they exist; until then
 * the price is said « avant parts », what he paid and not what she earns (recette 05/11, reco 20). No note of a fan:
 * what the agency knows of him is its own (Charles, 03/11).
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
  // The same read as the panel's (one cache). Either read failing is the server silent: the page says it once, on
  // top, and the panel and the list say nothing of their own (recette CRE-31, ETA-05).
  const insights = useCreatorFanInsights();
  const silent =
    (fans.isError && fans.data === undefined) || (insights.isError && insights.data === undefined);
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
      {silent ? (
        <Failure
          onRetry={() => {
            void fans.refetch();
            void insights.refetch();
          }}
        />
      ) : null}
      {silent ? null : (
        <div className="vt-cols">
          <div className="vt-list">
            {fans.data === undefined ? (
              <Skeleton label="Chargement de tes fans…">
                <SkeletonCard lines={5} />
              </Skeleton>
            ) : (
              <Panel className="nv-enter" title="Tes fans">
                <PanelSection>
                  {list.length === 0 ? (
                    <Empty art={<FansArt />} title="Aucun fan pour l’instant.">
                      Ils arrivent ici dès leur premier message.
                    </Empty>
                  ) : (
                    <>
                      <p className="vt-note">
                        À côté de chacun, le prix des messages qu’il a débloqués, TVA comprise, avant parts.
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
                      <FanInsightsWaitLine />
                    </>
                  )}
                </PanelSection>
              </Panel>
            )}
          </div>
          <div className="vt-side">
            {selected === null ? (
              <Empty plate art={<ChatArt />} title="Choisis un fan pour lire sa conversation." />
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
      )}
      {/* Her fans first, what they are like after, once there is enough to say it (choice of 21/11). */}
      <FanInsights silent={silent} />
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
      {/* Every fan has his amount on the right, in words when he unlocked nothing (choice of 21/11). */}
      {unlocked === null ? (
        <span className="vt-row__amount vt-row__amount--none">rien débloqué</span>
      ) : (
        <span className="vt-row__amount nv-num">{unlocked}</span>
      )}
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
