import { tmpdir } from 'node:os';

import type { Database } from '@impera/db';
import type { LlmGateway } from '@impera/llm';

import { createDropDescriber, type FileMediaTools } from '../application/describe-drop';
import {
  describeVault,
  type VaultDescribeDeps,
  type VaultDescribeRun,
  type VaultFileRead,
} from '../application/describe-vault';

import { createFfmpegFileTools, remuxVaultStream } from './ffmpeg-media-tools';
import { createGatewayDropSenser, createGatewayTranscriber } from './gateway-senser';
import { createDrizzleVaultDescribeStore, enqueueVaultDescribe } from './vault-describe-store';

/** The description of her platform's vault (ADR 0113), for the media module's jobs. */
export interface VaultDescriptions {
  /** `media.describe_vault`: one lot of an account's vault. Counts, for the log. */
  run(job: { readonly platformAccountId: string; readonly correlationId: string }): Promise<VaultDescribeRun>;
  /** A run queued behind a vault sync; one already waiting keeps its time. */
  enqueue(job: {
    readonly creatorId: string;
    readonly platformAccountId: string;
    readonly correlationId: string;
  }): Promise<void>;
}

export function createVaultDescriptions(deps: {
  readonly adminDb: Database;
  readonly gateway: Pick<LlmGateway, 'describeDrop' | 'transcribe'>;
  /** The connectors' read of one vault file (`VaultFiles.fetch`), wired by the composition root. */
  readonly read: VaultFileRead;
  /** The content drops' reduced picture (`ContentDropsModule.picture`), wired by the composition root. */
  readonly picture: VaultDescribeDeps['picture'];
  /** The content drops' removal of that picture (`ContentDropsModule.unpicture`). */
  readonly unpicture: VaultDescribeDeps['unpicture'];
  /** Tests only: other tools than ffmpeg's. */
  readonly tools?: FileMediaTools;
  /** Where each file is read, in a folder of its own; the system's temporary folder by default. */
  readonly scratchDir?: string;
  readonly now?: () => Date;
}): VaultDescriptions {
  const store = createDrizzleVaultDescribeStore(deps.adminDb);
  const tools = deps.tools ?? createFfmpegFileTools();
  const describer = createDropDescriber({
    sense: createGatewayDropSenser(deps.gateway),
    transcribe: createGatewayTranscriber(deps.gateway),
    tools,
  });
  return {
    run: (job) =>
      describeVault(
        {
          store,
          read: deps.read,
          describer,
          tools,
          remux: (path, out) => remuxVaultStream(path, out),
          picture: deps.picture,
          unpicture: deps.unpicture,
          scratchDir: deps.scratchDir ?? tmpdir(),
          now: deps.now ?? (() => new Date()),
        },
        job,
      ),
    enqueue: (job) => enqueueVaultDescribe(deps.adminDb, job),
  };
}
