import { useId, useState, type JSX } from 'react';

import { useCreators } from '@/creators/api';
import { LinkHours } from '@/creators/links/LinkHours';
import { LinksSection } from '@/creators/links/LinksSection';
import '@/creators/persona/persona.css';
import { Select } from '@/shell/Select';
import { Page, PageHeader } from '@/shell/layout';
import { Empty, Failure, Skeleton, SkeletonCard } from '@/shell/states';

/**
 * Agence › Trafic (ADR 0134 § 5, ADR 0149 § 2, ADR 0121 § 4): what brings fans to a creator, the owner's and an active
 * manager's. Its first screen is her redirect links (INS-03), which sat in her sheet before its seven tabs. One creator
 * at a time: the one the menu's selector is set on, or on « Toutes » the one picked here.
 */
export function TrafficPage({
  scoped = null,
  canEdit,
}: {
  /** The creator the menu's selector is set on (ADR 0134 § 3), or null on « Toutes »: the page then asks which one. */
  scoped?: string | null;
  /** The owner alone sets a link (ADR 0080 § 6); a manager reads. */
  canEdit: boolean;
}): JSX.Element {
  const creatorsQuery = useCreators();
  const creators = creatorsQuery.data ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const creatorId = scoped ?? chosen ?? creators[0]?.id ?? null;
  const creator = creators.find((one) => one.id === creatorId);
  const id = useId();

  return (
    <Page>
      <PageHeader
        title="Trafic"
        lead={`Ce qui amène des fans à ${creator?.displayName ?? 'une créatrice'}, à commencer par ses liens.`}
        actions={
          creators.length > 1 && creatorId !== null && scoped === null ? (
            <>
              <label className="sr-only" htmlFor={`${id}-creator`}>
                Créatrice
              </label>
              <Select<string>
                id={`${id}-creator`}
                value={creatorId}
                options={creators.map((one) => ({ value: one.id, label: one.displayName }))}
                onChange={(next) => {
                  setChosen(next);
                }}
              />
            </>
          ) : undefined
        }
      />
      <div className="ps-sheet">
        <section className="ps-page" aria-label="Liens">
          {creatorsQuery.isError ? (
            <Failure
              onRetry={() => {
                void creatorsQuery.refetch();
              }}
            />
          ) : creatorsQuery.isPending ? (
            <Skeleton>
              <SkeletonCard lines={4} />
            </Skeleton>
          ) : creator === undefined ? (
            <Empty plate title="Aucune créatrice pour l’instant">
              Ses liens arrivent ici dès qu’une créatrice t’est confiée.
            </Empty>
          ) : (
            <>
              <LinkHours key={`hours-${creator.id}`} creatorId={creator.id} />
              <LinksSection
                key={creator.id}
                creatorId={creator.id}
                creatorName={creator.displayName}
                canEdit={canEdit}
              />
            </>
          )}
        </section>
      </div>
    </Page>
  );
}
