import { describe, expect, it } from 'vitest';

import { createFfmpegMediaTools, missingMediaBinaries } from '../ffmpeg-media-tools';

// No ffmpeg needed here: binaries that do not exist stand for a machine without it.
const NOWHERE = { ffmpeg: 'nirvana-no-such-ffmpeg', ffprobe: 'nirvana-no-such-ffprobe' };

describe('media binaries', () => {
  it('names the binaries that cannot be run', async () => {
    expect(await missingMediaBinaries(NOWHERE)).toEqual(['ffmpeg', 'ffprobe']);
  });

  it('says ffmpeg is missing instead of spawn ENOENT', async () => {
    const tools = createFfmpegMediaTools(NOWHERE);
    await expect(tools.probe(new Uint8Array([1]))).rejects.toThrow(/nirvana-no-such-ffprobe absent/);
    await expect(tools.toJpeg(new Uint8Array([1]))).rejects.toThrow(/nirvana-no-such-ffmpeg absent/);
  });
});
