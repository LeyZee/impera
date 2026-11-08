import type { FanCardEntry, FanCardFieldSpec, FanCardGroup, FanCardView } from '@impera/contracts';

import {
  entryOf,
  ESSENTIALS,
  groupLine,
  PANEL_GROUPS,
  restOf,
  sourceLine,
  specOf,
  toCheckCount,
  valueText,
} from '../../lib/copilot/card';
import { h } from '../../lib/dom';

/**
 * One screen of the copilot side panel (ADR 0086). Pure: the same state draws the same nodes; main.ts follows the tab
 * and reads the CRM. Text always goes in as text: a value of the card, his words, are data, never markup.
 */
export type PanelScreen =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  /** The tab is not a Reveal conversation. */
  | { readonly kind: 'no_conversation' }
  /** § 2: a conversation Impera has not read yet. */
  | { readonly kind: 'unknown' }
  /** § 7: a chatter out of his shift on her. */
  | { readonly kind: 'off_shift' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'down' }
  | {
      readonly kind: 'conversation';
      /** Her switch « Fiche du fan dans l'extension » (§ 6). */
      readonly cardOn: boolean;
      /** Null while it is read the first time. */
      readonly card: FanCardView | 'forbidden' | 'down' | null;
      readonly openGroups: ReadonlySet<FanCardGroup>;
      readonly now: Date;
    };

export interface PanelActions {
  readonly openCrm: () => void;
  readonly toggleGroup: (group: FanCardGroup, open: boolean) => void;
}

const NOTICES: Readonly<
  Record<
    Exclude<PanelScreen['kind'], 'conversation' | 'loading'>,
    { title: string; text: string; tone?: 'amber' }
  >
> = {
  signed_out: {
    title: 'Connecte-toi au CRM',
    text: 'Le panneau lit la fiche du fan avec ta session du CRM.',
  },
  no_conversation: {
    title: 'Ouvre une conversation dans Reveal',
    text: 'Le panneau suit la conversation ouverte, sans clic de ta part.',
  },
  unknown: {
    title: 'Impera n’a pas encore lu cette conversation',
    text: 'Elle apparaîtra ici dès qu’Impera l’aura lue.',
  },
  off_shift: {
    title: 'Tu n’es pas en poste sur cette créatrice',
    text: 'Le panneau s’ouvre pendant ton shift.',
  },
  forbidden: {
    title: 'Cette créatrice ne t’est pas ouverte',
    text: 'Demande à ton responsable si c’est une erreur.',
  },
  conflict: {
    title: 'Deux créatrices ont cette conversation',
    text: 'Ouvre-la depuis le CRM pour savoir laquelle.',
    tone: 'amber',
  },
  down: { title: 'Le CRM ne répond pas', text: 'Le panneau réessaie tout seul.', tone: 'amber' },
};

function notice(kind: keyof typeof NOTICES): HTMLElement {
  const { title, text, tone } = NOTICES[kind];
  return h(
    'section',
    {
      class: 'cp-notice',
      'data-kind': kind,
      'data-tone': tone,
      role: tone === 'amber' ? 'status' : undefined,
    },
    h('p', { class: 'cp-notice__title' }, title),
    h('p', { class: 'cp-notice__text' }, text),
    kind === 'signed_out'
      ? h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--soft nv-btn--sm', 'data-action': 'crm' },
          'Ouvrir le CRM',
        )
      : null,
  );
}

/** His words a value rests on (ADR 0085 § 5): shown as his, after « Il a écrit ». */
function quote(text: string | null): HTMLElement | null {
  return text === null ? null : h('span', { class: 'cp-field__quote' }, 'Il a écrit : ', h('q', {}, text));
}

function field(spec: FanCardFieldSpec, entry: FanCardEntry, now: Date): HTMLElement {
  const { current, toCheck } = entry;
  return h(
    'li',
    { class: 'cp-field', 'data-field': spec.field },
    h('span', { class: 'cp-field__label' }, spec.label),
    current === null
      ? h(
          'span',
          { class: 'cp-field__empty' },
          spec.learning === 'observe' ? 'Pas encore deviné' : 'Pas encore su',
        )
      : h('span', { class: 'cp-field__value' }, valueText(spec.field, current.items)),
    current === null ? null : h('span', { class: 'cp-field__source' }, sourceLine(current, now)),
    current === null ? null : quote(current.sourceQuote),
    ...toCheck.map((value) =>
      h(
        'span',
        { class: 'cp-field__check' },
        `À vérifier : l’agent a lu « ${valueText(spec.field, value.items)} »`,
        quote(value.sourceQuote),
      ),
    ),
  );
}

function cardNodes(
  card: FanCardView,
  openGroups: ReadonlySet<FanCardGroup>,
  now: Date,
  actions: PanelActions,
): HTMLElement[] {
  const checks = toCheckCount(card.fields);
  const essentials = ESSENTIALS.map((name) => {
    const spec = specOf(name);
    return spec === undefined ? null : field(spec, entryOf(card.fields, name), now);
  }).filter((node): node is HTMLElement => node !== null);
  return [
    h(
      'header',
      { class: 'cp-head' },
      h('h1', { class: 'cp-head__title' }, 'Fiche du fan'),
      checks === 0 ? null : h('span', { class: 'cp-head__check' }, `${String(checks)} à vérifier`),
    ),
    h('ul', { class: 'cp-fields cp-fields--essentials', 'aria-label': 'L’essentiel' }, ...essentials),
    ...PANEL_GROUPS.map(({ group, title }) => {
      const details = h(
        'details',
        { class: 'cp-group', 'data-group': group, open: openGroups.has(group) },
        h(
          'summary',
          {},
          h('span', { class: 'cp-group__title' }, title),
          h('span', { class: 'cp-group__sum' }, groupLine(card.fields, group)),
        ),
        h(
          'ul',
          { class: 'cp-fields' },
          ...restOf(group).map((spec) => field(spec, entryOf(card.fields, spec.field), now)),
        ),
      );
      details.addEventListener('toggle', () => {
        actions.toggleGroup(group, details.open);
      });
      return details;
    }),
  ];
}

function conversation(
  screen: Extract<PanelScreen, { kind: 'conversation' }>,
  actions: PanelActions,
): HTMLElement[] {
  if (!screen.cardOn)
    return [
      h(
        'section',
        { class: 'cp-notice', 'data-kind': 'card_off' },
        h('p', { class: 'cp-notice__title' }, 'La fiche du fan est éteinte pour cette créatrice'),
        h('p', { class: 'cp-notice__text' }, 'Elle s’allume dans Créatrices › Agent.'),
      ),
    ];
  if (screen.card === null)
    return [h('p', { class: 'cp-loading', 'aria-busy': 'true' }, 'Lecture de la fiche…')];
  if (screen.card === 'forbidden') return [notice('forbidden')];
  if (screen.card === 'down') return [notice('down')];
  return cardNodes(screen.card, screen.openGroups, screen.now, actions);
}

export function render(root: HTMLElement, screen: PanelScreen, actions: PanelActions): void {
  const nodes =
    screen.kind === 'loading'
      ? [h('p', { class: 'cp-loading', 'aria-busy': 'true' }, 'Un instant…')]
      : screen.kind === 'conversation'
        ? conversation(screen, actions)
        : [notice(screen.kind)];
  // Kept open groups keep their place: the panel draws over itself, without scrolling back up (§ 10).
  const scroll = root.scrollTop;
  root.replaceChildren(...nodes);
  root.scrollTop = scroll;
  root.querySelector('[data-action="crm"]')?.addEventListener('click', actions.openCrm);
}
