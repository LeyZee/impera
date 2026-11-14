import { CreatorIdSchema, PersonaVersionIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { AnswerInProgress, PlaygroundPersonaNotFound, type PlaygroundEngine } from '../engine';
import { createPlaygroundService } from '../playground-service';

const unused = (): never => {
  throw new Error('not used');
};

function engine(reset: () => never = unused): PlaygroundEngine {
  return {
    state: unused,
    applyPreset: unused,
    reset,
    send: unused,
    rate: unused,
    branch: unused,
    compare: unused,
    patchSituation: unused,
    advance: unused,
    setNotes: unused,
    sendCreatorMedia: unused,
    markDesire: unused,
  };
}

describe('playground service', () => {
  it('keeps one playground per user', () => {
    let built = 0;
    const service = createPlaygroundService({
      invented: () => {
        built += 1;
        return engine();
      },
      ofVersion: unused,
    });
    expect(service.forUser('a')).toBe(service.forUser('a'));
    expect(service.forUser('b')).not.toBe(service.forUser('a'));
    expect(built).toBe(2);
  });

  it('starts a user over on the version chosen, and refuses while an answer runs (PRO-21)', async () => {
    const MIA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
    const V2 = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e2');
    const chosen: unknown[] = [];
    const busy = (): never => {
      throw new AnswerInProgress();
    };
    let first = true;
    const service = createPlaygroundService({
      // The first engine is busy with an answer; the later ones are not.
      invented: () => {
        const made = engine(first ? busy : () => unused());
        first = false;
        return made;
      },
      ofVersion: (choice) => {
        chosen.push(choice);
        if (choice.versionId !== V2) return Promise.reject(new PlaygroundPersonaNotFound());
        return Promise.resolve(engine());
      },
    });
    const busyOne = service.forUser('a');
    await expect(service.choose('a', { creatorId: MIA, versionId: V2 })).rejects.toBeInstanceOf(
      AnswerInProgress,
    );
    expect(service.forUser('a')).toBe(busyOne);
    expect(chosen).toEqual([]);

    // A user with no playground yet chooses straight away.
    const hers = await service.choose('b', { creatorId: MIA, versionId: V2 });
    expect(service.forUser('b')).toBe(hers);
    const unknown = PersonaVersionIdSchema.parse('0199f2a0-0000-7000-8000-0000000000e9');
    await expect(service.choose('c', { creatorId: MIA, versionId: unknown })).rejects.toBeInstanceOf(
      PlaygroundPersonaNotFound,
    );
  });
});
