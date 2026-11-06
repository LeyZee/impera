import { ScriptStructureSchema, type ScriptMoment, type ScriptStructure } from '@impera/contracts';

import { scriptSegments } from '@/screens/content/fixtures';

/* An invented structure of the library (ADR 0010): never one of the agency's. */
export const structureOf = (id: string, name: string, moment: ScriptMoment): ScriptStructure =>
  ScriptStructureSchema.parse({
    id,
    reservedCreatorId: null,
    current: {
      id: id.replace(/.$/u, 'f'),
      version: 1,
      name,
      moment,
      color: { primary: '#2a1f3d', secondary: '#f4eefa', accent: '#c084fc' },
      segments: scriptSegments,
      frozen: true,
      updatedAt: '2026-11-01T09:00:00.000Z',
    },
    createdAt: '2026-11-01T09:00:00.000Z',
  });
