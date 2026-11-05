import { statfs } from 'node:fs/promises';

import type { ScratchRoom } from '../../domain/ports';

/** The bytes an unprivileged process may still write in `dir`. */
async function freeBytesOf(dir: string): Promise<number> {
  const disk = await statfs(dir);
  return disk.bavail * disk.bsize;
}

/**
 * The room of one worker process on the disk of `dir` (ADR 0070 § 4): what the disk has free, less what the jobs
 * running in this process have taken and not yet given back. The count and the check happen together, after the
 * disk is read, so that two jobs starting at once never both take the same bytes.
 */
export function createScratchRoom(dir: string, freeBytes = freeBytesOf): ScratchRoom {
  let taken = 0;
  return {
    async take(bytes) {
      const free = await freeBytes(dir);
      if (free - taken < bytes) return null;
      taken += bytes;
      let given = false;
      return () => {
        if (given) return;
        given = true;
        taken -= bytes;
      };
    },
  };
}
