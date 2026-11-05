import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { MeNav } from './MeNav';

import { CalendarLinkBody, SHIFT_LINK_WORDS } from '@/scheduling/CalendarLinkBody';
import { Page, PageHeader, Panel, PanelSection } from '@/shell/layout';

/**
 * Moi › Calendrier (CR-12, ADR 0045 § 5): the member's own shifts in the calendar of their phone, through a secret,
 * read-only link (`CalendarLinkBody`). « Calendrier », not « Agenda »: the glossary keeps « agenda » for the
 * creator's (CR-05), whose link lives in her Agenda.
 */
export function MyCalendarLinkPage({ user }: { user: Me }): JSX.Element {
  return (
    <Page>
      <PageHeader
        eyebrow="Moi"
        title="Calendrier"
        lead="Tes shifts dans le calendrier de ton téléphone, mis à jour tout seuls."
        actions={<MeNav manager={user.teamScope === 'agency'} />}
      />
      {/* In a column, as Moi › Sécurité: the panel keeps its own height instead of filling the page. */}
      <div className="flex flex-col gap-4">
        <Panel title="Mes shifts dans mon calendrier" eyebrow="iPhone, Mac, Google Agenda">
          <PanelSection>
            <CalendarLinkBody words={SHIFT_LINK_WORDS} />
          </PanelSection>
        </Panel>
      </div>
    </Page>
  );
}
