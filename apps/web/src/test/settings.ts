import type { SchedulingSettings } from '@nirvana/contracts';

/**
 * The planning settings a test serves: one version of créneaux of `length` minutes from `start` (ADR 0049 § 1), the
 * module's default when nothing is given (four of 6 h from midnight, Paris, a quarter of an hour of margin).
 */
export function settingsOf({
  timeZone = 'Europe/Paris',
  start = 0,
  length = 360,
  accessMarginMinutes = 15,
}: {
  timeZone?: string;
  start?: number;
  length?: number;
  accessMarginMinutes?: number;
} = {}): SchedulingSettings {
  return {
    timeZone,
    accessMarginMinutes,
    versions: [
      {
        id: null,
        effectiveAt: null,
        seats: [],
        slots: Array.from({ length: 1440 / length }, (_, index) => ({
          startMinute: (start + index * length) % 1440,
          endMinute: (start + (index + 1) * length) % 1440,
          name: null,
        })),
      },
    ],
  };
}
