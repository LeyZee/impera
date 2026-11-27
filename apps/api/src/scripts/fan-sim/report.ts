import type { FanSheet } from './fan-sheet';
import type { SimEvent, SimResult } from './run';
import { learnedByDay, mouldOf } from './sim';

const BUY_WORDS: Readonly<Record<string, string>> = {
  buys: 'il paie',
  not_wanted: 'il ne veut pas',
  not_enough_desire: 'pas assez d’envie',
  not_enough_trust: 'pas assez confiance',
  no_money: 'plus assez d’argent',
};

type Alarm = Extract<SimEvent, { kind: 'agent_hold' | 'agent_blocked' | 'agent_minor_signal' }>;

function isAlarm(event: SimEvent): event is Alarm {
  return event.kind === 'agent_hold' || event.kind === 'agent_blocked' || event.kind === 'agent_minor_signal';
}

function alarmOf(event: Alarm): { readonly day: number; readonly what: string } {
  switch (event.kind) {
    case 'agent_hold':
      return { day: event.day, what: [event.hold, ...event.detail].join(' ') };
    case 'agent_blocked':
      return { day: event.day, what: ['blocked', ...event.codes].join(' ') };
    case 'agent_minor_signal':
      return { day: event.day, what: 'minor_suspected' };
  }
}

/** What the code measured over the whole run: the judge reads it, Charles reads it, nothing in it is the model's. */
export function measuresOf(sheet: FanSheet, result: SimResult, costUsd: number): Record<string, unknown> {
  const hers = result.events.flatMap((event) => (event.kind === 'creator' ? [event.text] : []));
  const journals = result.events.flatMap((event) => (event.kind === 'journal' ? [event] : []));
  const offers = result.events.flatMap((event) =>
    event.kind === 'creator_media' && /à \d+(?:[.,]\d+)? €/u.test(event.text) ? [event.day] : [],
  );
  const buys = result.events.flatMap((event) => (event.kind === 'buy' ? [event] : []));
  const alarms = result.events.flatMap((event) => (isAlarm(event) ? [event] : []));
  return {
    fan: sheet.id,
    days: result.stateByDay.length === 0 ? 0 : (result.stateByDay.at(-1)?.day ?? 0),
    stopped: result.stopped,
    costUsd: Math.round(costUsd * 1000) / 1000,
    messages: {
      fan: result.events.filter((event) => event.kind === 'fan').length,
      creator: hers.length,
      followUps: result.events.filter((event) => event.kind === 'creator' && event.followUp).length,
      leftOnRead: result.events.filter((event) => event.kind === 'silent').length,
    },
    mould: mouldOf(hers),
    learned: learnedByDay(result.notesByDay),
    sale: {
      paidOffersByDay: offers,
      decisions: buys.map((buy) => ({
        day: buy.day,
        priceEuros: buy.priceEuros,
        decision: BUY_WORDS[buy.decision.kind === 'buys' ? 'buys' : buy.decision.reason],
      })),
      spentEuros: result.spentEuros,
    },
    felt: {
      bot: journals.filter((event) => event.output.feltBot).length,
      wallet: journals.filter((event) => event.output.feltWallet).length,
      understood: journals.filter((event) => event.output.feltUnderstood).length,
      of: journals.length,
    },
    stateByDay: result.stateByDay.map(({ day, state }) => ({ day, ...state })),
    agent: {
      holds: alarms.filter((event) => event.kind === 'agent_hold').length,
      blocked: alarms.filter((event) => event.kind === 'agent_blocked').length,
      minorSignals: alarms.filter((event) => event.kind === 'agent_minor_signal').length,
      failures: result.events.filter((event) => event.kind === 'failure').length,
      alarms: alarms.map(alarmOf),
      ...(sheet.false_alarm_test && { falseAlarms: alarms.length }),
    },
  };
}

function line(event: SimEvent, withJournal: boolean): string[] {
  switch (event.kind) {
    case 'session':
      return [
        '',
        `## Jour ${String(event.day)}, ${event.at}`,
        ...(event.event === null ? [] : [`_${event.event}_`]),
        '',
      ];
    case 'fan':
      return [`**Lui** : ${event.text.replaceAll('\n', ' / ')}`];
    case 'creator':
      return [`**Elle**${event.followUp ? ' (relance)' : ''} : ${event.text.replaceAll('\n', ' / ')}`];
    case 'creator_media':
      return [`**Elle** : ${event.text.replaceAll('\n', ' / ')}`];
    case 'silent':
      return ['_(il ne répond pas)_'];
    case 'journal': {
      if (!withJournal) return [];
      const { output, state } = event;
      const felt = [
        output.feltBot && 'robot',
        output.feltWallet && 'portefeuille',
        output.feltUnderstood && 'compris',
      ]
        .filter(Boolean)
        .join(', ');
      return [
        `> ${output.journal} (envie ${String(state.desire)}, confiance ${String(state.trust)}, agacement ${String(state.annoyance)}${felt === '' ? '' : ` ; ${felt}`})`,
      ];
    }
    case 'buy':
      return [
        `_Achat à ${String(event.priceEuros)} € : ${BUY_WORDS[event.decision.kind === 'buys' ? 'buys' : event.decision.reason] ?? ''}_`,
      ];
    case 'agent_hold':
      return [`_L'agent passe la main (${[event.hold, ...event.detail].join(', ')})_`];
    case 'agent_blocked':
      return [`_Réponse bloquée par les gardes (${event.codes.join(', ')})_`];
    case 'agent_minor_signal':
      return ['_Le cerveau soupçonne un mineur_'];
    case 'failure':
      return [`_Panne du fan simulé (${event.code})_`];
  }
}

/** The conversation as Charles reads it; with the journal, his hidden thoughts under each of his messages. */
export function transcriptOf(sheet: FanSheet, result: SimResult, withJournal: boolean): string {
  return [
    `# ${sheet.label}${withJournal ? ' (avec son journal)' : ''}`,
    '',
    `Ce qu'il teste : ${sheet.tests}`,
    ...result.events.flatMap((event) => line(event, withJournal)),
  ].join('\n');
}
