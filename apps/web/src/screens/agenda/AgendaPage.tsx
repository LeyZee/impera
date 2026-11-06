import {
  CREATOR_REPLIES_EMOJI,
  type CreatorAccountShift,
  type CreatorAgenda,
  type CreatorSuggestion,
  type CreatorTask,
  type CreatorTaskWhen,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type JSX } from 'react';

import { AddDialog, type AddPreset } from './AddDialog';
import { DayView } from './DayView';
import { MonthView } from './MonthView';
import { PhoneDialog } from './PhoneDialog';
import { SuggestionDialog, UndatedSuggestions } from './SuggestionCard';
import { DeclineDialog, PlaceDialog } from './SuggestionDialogs';
import { TaskDialog } from './TaskDialog';
import { WeekGrid } from './WeekGrid';
import { WeekList } from './WeekList';
import { moveTask, tickTask, useAgenda, useFlushOnReconnect, useWithPending, type Flushed } from './api';
import { monthLabel, monthOf, monthRange } from './grid';
import { shiftRangeOf, useRepliesShown } from './replies';
import { useWide } from './useWide';
import './agenda.css';

import { useOnline } from '@/pwa/online';
import { useCreatorShifts } from '@/scheduling/api';
import { addDays, dayOf, mondayOf, readerZone, weekLabel, longDay } from '@/scheduling/time';
import { ServerSilent } from '@/shell/ServerSilent';
import { Page, PageHeader } from '@/shell/layout';

export type AgendaView = 'day' | 'week' | 'month';

const NO_SHIFTS: readonly CreatorAccountShift[] = [];

/** On her phone her week is a list and there is no month; on a computer, Semaine is a grid of hours, and Mois. */
const PHONE_VIEWS: readonly (readonly [AgendaView, string])[] = [
  ['day', 'Jour'],
  ['week', 'Ma semaine'],
];
const WIDE_VIEWS: readonly (readonly [AgendaView, string])[] = [
  ['day', 'Jour'],
  ['week', 'Semaine'],
  ['month', 'Mois'],
];

const STEP: Record<AgendaView, readonly [string, string]> = {
  day: ['Jour précédent', 'Jour suivant'],
  week: ['Semaine précédente', 'Semaine suivante'],
  month: ['Mois précédent', 'Mois suivant'],
};

/** What is open over the agenda: one dialog at a time. */
type Open =
  | { readonly kind: 'add'; readonly preset: AddPreset }
  | { readonly kind: 'task'; readonly task: CreatorTask; readonly day: string }
  | { readonly kind: 'decline'; readonly suggestion: CreatorSuggestion }
  | { readonly kind: 'place'; readonly suggestion: CreatorSuggestion }
  | { readonly kind: 'suggestion'; readonly suggestion: CreatorSuggestion }
  | { readonly kind: 'phone' }
  | null;

/**
 * Agenda, the creator's (CR-05, ADR 0042 § 3 and § 8): her day, tasks first; her week as a list on her phone, as a
 * grid of hours on a computer, where a drag creates or moves a task; her month on a computer. Only two words: a tâche
 * and a dispo. She ticks offline; her phone sends it back online. The agency only suggests: she accepts or says « Non
 * merci ». Read in her zone, the one the server answers with.
 */
export function AgendaPage({
  day,
  view,
  onDay,
  onView,
}: {
  /** The day shown, `null` for today. */
  day: string | null;
  view: AgendaView;
  onDay: (day: string | null) => void;
  onView: (view: AgendaView) => void;
}): JSX.Element {
  const client = useQueryClient();
  const wide = useWide();
  const [open, setOpen] = useState<Open>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const today = dayOf(new Date(), readerZone());
  const shown = day ?? today;
  const monday = mondayOf(shown);
  // Mois is a computer's: on her phone, the same link shows her week.
  const seen: AgendaView = view === 'month' && !wide ? 'week' : view;
  const views = wide ? WIDE_VIEWS : PHONE_VIEWS;
  const range = seen === 'month' ? monthRange(shown) : { from: monday, to: addDays(monday, 6) };
  const read = useAgenda(range.from, range.to);
  const { agenda, waiting } = useWithPending(read.data);
  // « Qui répond à tes fans » (CR-05 c3): the shifts of her accounts, a layer she can hide on this device.
  const [repliesShown, setRepliesShown] = useRepliesShown();
  const shiftsRead = useCreatorShifts(
    agenda !== undefined && repliesShown ? shiftRangeOf(range, agenda.timeZone) : null,
  );
  const shifts = repliesShown ? (shiftsRead.data ?? NO_SHIFTS) : NO_SHIFTS;

  const onSent = useCallback(({ refused, expired }: Flushed) => {
    if (expired)
      setNotice('Ta session a expiré : reconnecte-toi, et tes coches faites hors ligne partiront ensuite.');
    else if (refused > 0)
      setNotice(
        refused === 1
          ? 'Une coche faite hors ligne n’a pas pu compter : la tâche a changé, ou elle date de plus de 48 heures.'
          : `${String(refused)} coches faites hors ligne n’ont pas pu compter : les tâches ont changé, ou elles datent de plus de 48 heures.`,
      );
  }, []);
  useFlushOnReconnect(onSent);

  const tick = (task: CreatorTask, on: boolean, onDayOf: string): void => {
    void tickTask(client, task, onDayOf, on).then(onSent);
  };

  const move = (task: CreatorTask, when: CreatorTaskWhen): void => {
    void moveTask(client, task, when).then((moved) => {
      if (!moved)
        setNotice(
          'Le déplacement n’a pas pu se faire : pas de réseau, ou la tâche a changé. Ton agenda est relu.',
        );
    });
  };

  const step = (forward: boolean): void => {
    const sign = forward ? 1 : -1;
    if (seen === 'month') onDay(monthOf(shown, sign));
    else onDay(addDays(shown, seen === 'day' ? sign : 7 * sign));
  };

  const herToday = agenda?.today ?? today;
  // Her kept agenda answers a read without a network: the browser's word says she is offline (CREA-24).
  const online = useOnline();
  const offline = !online || read.isError || (read.isFetched && read.fetchStatus === 'paused');

  return (
    <Page className="ag-page">
      <PageHeader
        eyebrow={seen === 'day' ? longDay(shown) : seen === 'month' ? monthLabel(shown) : weekLabel(monday)}
        title="Agenda"
        actions={
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={agenda === undefined}
            onClick={() => {
              setOpen({ kind: 'add', preset: { day: shown } });
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="ag-icon">
              <path d="M8 3v10M3 8h10" />
            </svg>
            Ajouter
          </button>
        }
      />
      <div className="ag-bar">
        <div
          className="nv-seg nv-glass nv-glass--thin ag-views"
          role="radiogroup"
          aria-label="Affichage"
          style={{
            '--nv-seg-count': views.length,
            '--nv-seg-index': views.findIndex(([one]) => one === seen),
          }}
        >
          <span className="nv-seg__thumb nv-glass nv-glass--thin" aria-hidden="true" />
          {views.map(([one, label]) => (
            <button
              key={one}
              type="button"
              role="radio"
              className="nv-seg__opt"
              aria-checked={one === seen}
              onClick={() => {
                onView(one);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ag-nav">
          <button
            type="button"
            className="ag-arrow"
            aria-label={STEP[seen][0]}
            onClick={() => {
              step(false);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="ag-icon">
              <path d="m10 3-5 5 5 5" />
            </svg>
          </button>
          <button
            type="button"
            className="ag-arrow"
            aria-label={STEP[seen][1]}
            onClick={() => {
              step(true);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="ag-icon">
              <path d="m6 3 5 5-5 5" />
            </svg>
          </button>
          {shown === herToday ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                onDay(null);
              }}
            >
              Aujourd’hui
            </button>
          )}
        </div>
      </div>
      {offline && agenda !== undefined ? (
        <p className="ag-offline" role="status">
          Hors ligne : tu vois ta dernière lecture.
          {waiting > 0
            ? ` ${String(waiting)} ${waiting > 1 ? 'coches partiront' : 'coche partira'} au retour du réseau.`
            : ' Tes coches partiront au retour du réseau.'}
        </p>
      ) : null}
      {notice === null ? null : (
        <p className="ag-notice" role="status">
          {notice}
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setNotice(null);
            }}
          >
            OK
          </button>
        </p>
      )}
      {agenda === undefined ? (
        read.isError ? (
          <ServerSilent
            text="Ton agenda n’a pas pu être lu, et ce téléphone n’en a pas encore de copie."
            onRetry={() => {
              void read.refetch();
            }}
          />
        ) : (
          <div className="ag-skeleton nv-plate" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        )
      ) : (
        <Views
          agenda={agenda}
          view={seen}
          wide={wide}
          day={shown}
          monday={monday}
          onDay={onDay}
          onView={onView}
          onTick={tick}
          onMove={move}
          onOpen={setOpen}
          shifts={shifts}
        />
      )}
      {agenda === undefined ? null : (
        <p className="ag-foot">
          {/* The layer's switch, only once there is something to hide (or to bring back). */}
          {repliesShown && shifts.length === 0 ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                setRepliesShown(!repliesShown);
              }}
            >
              {CREATOR_REPLIES_EMOJI}{' '}
              {repliesShown ? 'Masquer qui répond à tes fans' : 'Voir qui répond à tes fans'}
            </button>
          )}
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm"
            onClick={() => {
              setOpen({ kind: 'phone' });
            }}
          >
            📲 Mon agenda dans mon téléphone
          </button>
        </p>
      )}
      {agenda === undefined || open === null ? null : (
        <Dialogs
          agenda={agenda}
          open={open}
          onOpen={setOpen}
          onClose={() => {
            setOpen(null);
          }}
          onNotice={setNotice}
        />
      )}
    </Page>
  );
}

function Views({
  agenda,
  view,
  wide,
  day,
  monday,
  onDay,
  onView,
  onTick,
  onMove,
  onOpen,
  shifts,
}: {
  agenda: CreatorAgenda;
  view: AgendaView;
  wide: boolean;
  day: string;
  monday: string;
  onDay: (day: string | null) => void;
  onView: (view: AgendaView) => void;
  onTick: (task: CreatorTask, on: boolean, day: string) => void;
  onMove: (task: CreatorTask, when: CreatorTaskWhen) => void;
  onOpen: (open: Open) => void;
  /** Her accounts' shifts, empty while the layer is hidden. */
  shifts: readonly CreatorAccountShift[];
}): JSX.Element {
  const actions = {
    onTick,
    onTask: (task: CreatorTask, onDayOf: string) => {
      onOpen({ kind: 'task', task, day: onDayOf });
    },
    onAdd: (preset: AddPreset) => {
      onOpen({ kind: 'add', preset });
    },
    onDecline: (suggestion: CreatorSuggestion) => {
      onOpen({ kind: 'decline', suggestion });
    },
    onPlace: (suggestion: CreatorSuggestion) => {
      onOpen({ kind: 'place', suggestion });
    },
  };
  const openDay = (one: string): void => {
    onDay(one);
    onView('day');
  };
  if (view === 'day')
    return (
      <DayView
        agenda={agenda}
        day={day}
        monday={monday}
        wide={wide}
        shifts={shifts}
        onDay={onDay}
        onSuggestion={(suggestion) => {
          onOpen({ kind: 'suggestion', suggestion });
        }}
        {...actions}
      />
    );
  if (view === 'month') return <MonthView agenda={agenda} day={day} shifts={shifts} onOpenDay={openDay} />;
  return wide ? (
    // « Sans date » above the grid too: a suggestion with no room has no column of its own (recette des dates).
    <div className="ag-week">
      <UndatedSuggestions agenda={agenda} onDecline={actions.onDecline} onPlace={actions.onPlace} />
      <WeekGrid
        agenda={agenda}
        monday={monday}
        shifts={shifts}
        onOpenDay={openDay}
        onMove={onMove}
        onSuggestion={(suggestion) => {
          onOpen({ kind: 'suggestion', suggestion });
        }}
        {...actions}
      />
    </div>
  ) : (
    <WeekList agenda={agenda} monday={monday} shifts={shifts} onOpenDay={openDay} {...actions} />
  );
}

function Dialogs({
  agenda,
  open,
  onOpen,
  onClose,
  onNotice,
}: {
  agenda: CreatorAgenda;
  open: NonNullable<Open>;
  onOpen: (open: Open) => void;
  onClose: () => void;
  onNotice: (notice: string) => void;
}): JSX.Element {
  switch (open.kind) {
    case 'add':
      return <AddDialog zone={agenda.timeZone} preset={open.preset} onClose={onClose} />;
    case 'task':
      return (
        <TaskDialog agenda={agenda} task={open.task} day={open.day} onClose={onClose} onNotice={onNotice} />
      );
    case 'suggestion':
      return (
        <SuggestionDialog
          agenda={agenda}
          suggestion={open.suggestion}
          onClose={onClose}
          onDecline={(suggestion) => {
            onOpen({ kind: 'decline', suggestion });
          }}
          onPlace={(suggestion) => {
            onOpen({ kind: 'place', suggestion });
          }}
        />
      );
    case 'phone':
      return <PhoneDialog onClose={onClose} />;
    case 'decline':
      return <DeclineDialog suggestion={open.suggestion} onClose={onClose} onNotice={onNotice} />;
    case 'place':
      return (
        <PlaceDialog
          zone={agenda.timeZone}
          suggestion={open.suggestion}
          onClose={onClose}
          onNotice={onNotice}
        />
      );
  }
}
