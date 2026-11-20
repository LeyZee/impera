import type {
  InstagramAccountCapabilities,
  InstagramMedia,
  InstagramMediaRef,
  LiveStory,
  MediaInsightNumbers,
} from '@impera/contracts';

import type { InstagramInsightsPort } from '../../domain/instagram-insights';

type Method = 'listMedia' | 'readInsights' | 'listLiveStories';

/**
 * Her Instagram account in memory, read only (ADR 0120 § 1): the media, numbers and stories a test seeds, and an
 * outage on demand. Invented data only. Like the port, it has nothing that publishes, comments or sends.
 */
export class FakeInstagramInsights implements InstagramInsightsPort {
  readonly capabilities: InstagramAccountCapabilities;
  private readonly media = new Map<InstagramMediaRef, InstagramMedia>();
  private readonly numbers = new Map<InstagramMediaRef, MediaInsightNumbers>();
  private stories: LiveStory[] = [];
  private outage: Error | null = null;
  /** The calls made, in order: a test reads them to check what was asked of Meta, and how many times. */
  readonly calls: { readonly method: Method; readonly media: InstagramMediaRef | null }[] = [];

  /** Read only unless a test says the second consent was given. */
  constructor(capabilities: Partial<InstagramAccountCapabilities> = {}) {
    this.capabilities = { read: true, publish: false, ...capabilities };
  }

  seedMedia(media: InstagramMedia, numbers: MediaInsightNumbers): this {
    this.media.set(media.ref, media);
    this.numbers.set(media.ref, numbers);
    return this;
  }

  /** The numbers of a media moved on, as they do between two nights. */
  setNumbers(media: InstagramMediaRef, numbers: MediaInsightNumbers): this {
    this.numbers.set(media, numbers);
    return this;
  }

  seedStories(...stories: readonly LiveStory[]): this {
    this.stories = [...this.stories, ...stories];
    return this;
  }

  /** Every call fails with `error` until `restore()`. */
  failWith(error: Error): this {
    this.outage = error;
    return this;
  }

  restore(): this {
    this.outage = null;
    return this;
  }

  listMedia(since: Date): Promise<readonly InstagramMedia[]> {
    return this.run('listMedia', null, () =>
      [...this.media.values()].filter((media) => Date.parse(media.publishedAt) >= since.getTime()),
    );
  }

  readInsights(media: InstagramMediaRef): Promise<MediaInsightNumbers> {
    return this.run('readInsights', media, () => {
      const numbers = this.numbers.get(media);
      if (numbers === undefined) throw new Error('fake instagram: unknown media');
      return numbers;
    });
  }

  listLiveStories(): Promise<readonly LiveStory[]> {
    return this.run('listLiveStories', null, () => [...this.stories]);
  }

  private run<T>(method: Method, media: InstagramMediaRef | null, act: () => T): Promise<T> {
    this.calls.push({ method, media });
    try {
      if (!this.capabilities.read) throw new Error('fake instagram: reading is not granted');
      if (this.outage !== null) throw this.outage;
      return Promise.resolve(act());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
