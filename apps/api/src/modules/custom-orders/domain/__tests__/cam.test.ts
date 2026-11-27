import { describe, expect, it } from 'vitest';

import {
  CAM_MARGIN_MINUTES,
  CAM_NOTICE_MINUTES,
  bookedAsBusy,
  camSlotOf,
  needsCamSlot,
  type CamInterval,
  type CamSlotPorts,
} from '../cam';

/* Neutral test instants, never a real creator's week (ADR 0010). */
const at = (iso: string): Date => new Date(iso);
const NOW = at('2030-03-04T20:00:00Z');

/** A port that hands back what it is asked for, and remembers each ask. */
function ports(over: Partial<CamSlotPorts> & { rooms?: (CamInterval | null)[] }): {
  ports: CamSlotPorts;
  asks: Parameters<CamSlotPorts['room']>[0][];
} {
  const asks: Parameters<CamSlotPorts['room']>[0][] = [];
  const rooms = [...(over.rooms ?? [])];
  return {
    asks,
    ports: {
      room: (ask) => {
        asks.push(ask);
        return Promise.resolve(rooms.shift() ?? null);
      },
      absence: over.absence ?? (() => Promise.resolve(null)),
      booked: over.booked ?? (() => Promise.resolve([])),
    },
  };
}

describe('a fan’s cam slot (ADR 0159 § 5)', () => {
  it('is « tout de suite » when her dispo cam has room within the hour', async () => {
    const { ports: p, asks } = ports({
      rooms: [{ startsAt: at('2030-03-04T20:15:00Z'), endsAt: at('2030-03-04T20:45:00Z') }],
    });
    expect(await camSlotOf(p, 30, NOW)).toEqual({
      startsAt: at('2030-03-04T20:15:00Z'),
      endsAt: at('2030-03-04T20:45:00Z'),
      soon: true,
    });
    // Never sooner than the notice she needs to get ready.
    expect(asks[0]?.from).toEqual(new Date(NOW.getTime() + CAM_NOTICE_MINUTES * 60_000));
    expect(asks[0]?.minutes).toBe(30);
  });

  it('is another slot when her next dispo cam opens later', async () => {
    const { ports: p } = ports({
      rooms: [{ startsAt: at('2030-03-05T20:00:00Z'), endsAt: at('2030-03-05T20:30:00Z') }],
    });
    expect((await camSlotOf(p, 30, NOW))?.soon).toBe(false);
  });

  it('promises no hour when no dispo cam has room', async () => {
    expect(await camSlotOf(ports({ rooms: [null] }).ports, 30, NOW)).toBeNull();
    expect(await camSlotOf(ports({ rooms: [] }).ports, 0, NOW)).toBeNull();
  });

  it('keeps a booked cam and its margin out', async () => {
    const booked = { startsAt: at('2030-03-04T20:30:00Z'), endsAt: at('2030-03-04T21:00:00Z') };
    const { ports: p, asks } = ports({ booked: () => Promise.resolve([booked]), rooms: [null] });
    await camSlotOf(p, 30, NOW);
    const margin = CAM_MARGIN_MINUTES * 60_000;
    expect(asks[0]?.busy).toEqual([
      {
        startsAt: new Date(booked.startsAt.getTime() - margin),
        endsAt: new Date(booked.endsAt.getTime() + margin),
      },
    ]);
    expect(bookedAsBusy([])).toEqual([]);
  });

  it('steps over her absence to the day after it', async () => {
    const away = at('2030-03-04T20:15:00Z');
    const { ports: p, asks } = ports({
      rooms: [
        { startsAt: away, endsAt: at('2030-03-04T20:45:00Z') },
        { startsAt: at('2030-03-08T20:00:00Z'), endsAt: at('2030-03-08T20:30:00Z') },
      ],
      absence: (instant) =>
        Promise.resolve(instant.getTime() === away.getTime() ? { until: '2030-03-07' } : null),
    });
    expect(await camSlotOf(p, 30, NOW)).toMatchObject({ startsAt: at('2030-03-08T20:00:00Z'), soon: false });
    expect(asks.map((ask) => ask.after)).toEqual([null, '2030-03-07']);
  });

  it('gives up rather than loop when the absence does not move', async () => {
    const room = { startsAt: at('2030-03-04T20:15:00Z'), endsAt: at('2030-03-04T20:45:00Z') };
    const { ports: p } = ports({
      rooms: [room, room, room],
      absence: () => Promise.resolve({ until: '2030-03-04' }),
    });
    expect(await camSlotOf(p, 30, NOW)).toBeNull();
  });

  it('takes a call and a video call, never a video', () => {
    expect(needsCamSlot('video_call_talk')).toBe(true);
    expect(needsCamSlot('call')).toBe(true);
    expect(needsCamSlot('video')).toBe(false);
    expect(needsCamSlot(null)).toBe(false);
  });
});
