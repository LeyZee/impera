import type { CreatorLinkCard } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { MeNav } from './MeNav';
import { useMyLinks } from './links-api';

import { middleCut, PLACEMENT_LABELS, sameWords } from '@/creators/links/model';
import { LinkArt } from '@/shell/art/EmptyArt';
import { Page, PageHeader } from '@/shell/layout';
import { Empty, Failure } from '@/shell/states';

import './my-links.css';

/** How long « Copié » stays before the button offers the copy again. */
const COPIED_MS = 2_000;

function Check(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none">
      <path d="M3 8.5l3.2 3.2L13 4.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * One link of hers: its name, where it goes, what it is for in the agency's words, and the address to copy. Never a
 * figure. Where the browser refuses the copy, the address on screen is selected and the button says to copy it by
 * hand: she never believes a copy that did not happen.
 */
function LinkCard({ link }: { link: CreatorLinkCard }): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const address = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => {
      setState('idle');
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  function copy(): void {
    const refused = (): void => {
      if (address.current !== null) window.getSelection()?.selectAllChildren(address.current);
      setState('selected');
    };
    try {
      navigator.clipboard.writeText(link.url).then(() => {
        setState('copied');
      }, refused);
    } catch {
      refused();
    }
  }

  return (
    <li className="nv-plate nv-plate--pad my-links__card">
      <div className="my-links__head">
        <h2 className="nv-h3 my-links__name">{link.name}</h2>
        {/* A name that already says its place needs no chip beside it. */}
        {sameWords(link.name, PLACEMENT_LABELS[link.placement]) ? null : (
          <span className="nv-tag nv-tag--declared">{PLACEMENT_LABELS[link.placement]}</span>
        )}
      </div>
      {link.usageNote === '' ? null : <p className="my-links__note">{link.usageNote}</p>}
      {/* The whole address for a screen reader and for the selection; the eye reads it cut in its middle. */}
      <p className="my-links__address" ref={address} aria-label={link.url}>
        {state === 'selected' ? link.url : middleCut(link.url)}
      </p>
      <button type="button" className="nv-btn nv-btn--soft my-links__copy" onClick={copy}>
        {state === 'copied' ? <Check /> : null}
        <span aria-live="polite">
          {state === 'copied'
            ? 'Copié'
            : state === 'selected'
              ? 'Sélectionné : copie-le à la main'
              : 'Copier'}
        </span>
        {state === 'idle' ? <span className="sr-only"> le lien {link.name}</span> : null}
      </button>
    </li>
  );
}

/**
 * Moi › Mes liens (INS-03, ADR 0121 § 1): the links the agency placed for her, each said in a sentence, each copied
 * in one gesture. A tool, not a dashboard: no figure, no setting.
 */
export function MyLinksPage(): JSX.Element {
  const read = useMyLinks();
  const links = read.data;
  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Mes liens"
        lead="Tes liens à coller, chacun avec l’endroit où il va. Touche « Copier », puis colle-le."
        actions={<MeNav creator />}
      />
      {links === undefined ? (
        read.isError ? (
          <Failure onRetry={() => void read.refetch()} />
        ) : (
          <ul className="my-links" aria-busy="true" aria-label="Lecture de tes liens">
            <li className="nv-plate nv-plate--pad my-links__card my-links__card--loading" />
            <li className="nv-plate nv-plate--pad my-links__card my-links__card--loading" />
          </ul>
        )
      ) : links.length === 0 ? (
        <Empty plate art={<LinkArt />} title="Pas encore de lien">
          Ton agence n’a pas encore placé de lien pour toi. Dès qu’elle le fait, il apparaît ici.
        </Empty>
      ) : (
        <ul className="my-links">
          {links.map((link) => (
            <LinkCard key={link.id} link={link} />
          ))}
        </ul>
      )}
    </Page>
  );
}
