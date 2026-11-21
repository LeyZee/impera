import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { Page, PageHeader, Panel, PanelSection } from '../shell/layout';

/**
 * /extension/lier (ADR 0067, amendement du 19/11): the page the extension recognises by the tab's own address. It only
 * says where to click; the extension reads nothing it shows, and it cannot learn the link is made (no channel between
 * a page and the extension, which any site could use), so it keeps its way back to the guide.
 */

/** The browser's bar, drawn with the design system's tokens, never a capture: the icon in sight, or behind the puzzle. */
function BarSketch({ hidden }: { readonly hidden: boolean }): JSX.Element {
  return (
    <svg
      className="nv-ext-link__sketch"
      // Cropped to the bar's outer edge (stroke included): the sketch starts exactly where its caption does.
      viewBox={hidden ? '3.5 7.5 233 97.5' : '3.5 7.5 233 37'}
      role="img"
      aria-label={
        hidden
          ? 'La pièce de puzzle, à droite de la barre d’adresse, ouvre la liste des extensions : Impera y est.'
          : 'L’icône Impera, à droite de la barre d’adresse.'
      }
    >
      <rect className="nv-ext-link__bar" x="4" y="8" width="232" height="36" rx="10" />
      <rect className="nv-ext-link__field" x="14" y="16" width="140" height="20" rx="10" />
      <rect className="nv-ext-link__text" x="26" y="24" width="72" height="4" rx="2" />
      {/* The puzzle piece. */}
      <path
        className={hidden ? 'nv-ext-link__puzzle nv-ext-link__target' : 'nv-ext-link__puzzle'}
        d="M171 20h5a3 3 0 0 1 6 0h5v5a3 3 0 0 1 0 6v5h-5a3 3 0 0 0-6 0h-5v-5a3 3 0 0 0 0-6z"
      />
      {hidden ? (
        <g>
          <rect className="nv-ext-link__menu" x="108" y="50" width="120" height="54" rx="10" />
          <rect className="nv-ext-link__row" x="116" y="58" width="104" height="18" rx="6" />
          <image href="/impera-mark.svg" x="121" y="60" width="14" height="14" />
          <text className="nv-ext-link__label" x="146" y="71">
            Impera
          </text>
          <rect className="nv-ext-link__text" x="122" y="88" width="64" height="4" rx="2" />
          <circle className="nv-ext-link__ring" cx="128" cy="67" r="9.5" />
        </g>
      ) : (
        <g>
          <image href="/impera-mark.svg" x="199" y="17" width="18" height="18" />
          <circle className="nv-ext-link__ring" cx="208" cy="26" r="13" />
        </g>
      )}
    </svg>
  );
}

export function ExtensionLinkPage(): JSX.Element {
  // The popup's own words: a host in full, or this computer (ADR 0067, amendement du 19/11 § 3).
  const host = window.location.hostname;
  const crm = host === 'localhost' || host === '127.0.0.1' ? 'au CRM de cet ordinateur' : `à ${host}`;
  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          // Reached from the guide: the way back is the guide (avis Design du 19/11), not the rail's.
          <Link to="/aide/extension" className="nv-btn nv-btn--plain nv-btn--sm nv-offrail-back">
            ← Extension
          </Link>
        }
        title="Relier l’extension à ce CRM"
        lead="Clique sur l’icône Impera en haut à droite de ton navigateur."
      />
      <div className="nv-help-install nv-ext-link">
        <Panel>
          <PanelSection className="nv-ext-link__cases">
            {/* Each caption above its sketch, as a small title, on one line on both sides (avis Design du 19/11). */}
            <figure className="nv-ext-link__case">
              <figcaption>Épinglée : elle est dans la barre du navigateur.</figcaption>
              <BarSketch hidden={false} />
            </figure>
            <figure className="nv-ext-link__case">
              <figcaption>Pas épinglée : la pièce de puzzle, puis Impera.</figcaption>
              <BarSketch hidden />
            </figure>
          </PanelSection>
          <PanelSection>
            <p className="nv-ext-link__then">
              L’extension te demande « Relier l’extension {crm} ? ». Clique « Relier », puis accepte la
              question du navigateur.
            </p>
          </PanelSection>
        </Panel>
        <p className="nv-help-install__note">
          Rien ne se passe ? Ton extension est peut-être déjà reliée : regarde la pastille en haut du popup.
        </p>
      </div>
    </Page>
  );
}
