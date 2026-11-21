import { describe, expect, it } from 'vitest';

import {
  InstagramMediaSchema,
  LiveStorySchema,
  META_PUBLISH_SCOPES,
  META_READ_SCOPES,
  MediaInsightSnapshotSchema,
  SNAPSHOT_AGES,
} from './instagram-insights';

const numbers = {
  views: 1200,
  reach: 900,
  likes: 80,
  comments: 4,
  shares: 6,
  saves: 9,
  reposts: null,
  skipRate: 0.4,
};

describe('what is read of her Instagram account (ADR 0120 § 1 and § 2)', () => {
  it('asks to read first, and never for a messaging right', () => {
    const all: readonly string[] = [...META_READ_SCOPES, ...META_PUBLISH_SCOPES];
    expect(META_READ_SCOPES).toEqual(['instagram_business_basic', 'instagram_business_manage_insights']);
    expect(all.some((scope) => scope.includes('message'))).toBe(false);
  });

  it('keeps a reading at four ages', () => {
    expect(SNAPSHOT_AGES).toEqual(['1h', '24h', '48h', '7d']);
    const snapshot = { mediaRef: 'media-1', age: '48h', readAt: '2026-11-18T03:00:00.000Z', numbers };
    expect(MediaInsightSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(MediaInsightSnapshotSchema.safeParse({ ...snapshot, age: '72h' }).success).toBe(false);
    expect(MediaInsightSnapshotSchema.safeParse({ ...snapshot, numbers: null }).success).toBe(true);
  });

  it('keeps numbers only: a field that would carry a commenter is refused', () => {
    const snapshot = { mediaRef: 'media-1', age: '1h', readAt: '2026-11-16T03:00:00.000Z', numbers };
    expect(
      MediaInsightSnapshotSchema.safeParse({ ...snapshot, numbers: { ...numbers, topCommenter: 'someone' } })
        .success,
    ).toBe(false);
    expect(
      MediaInsightSnapshotSchema.safeParse({ ...snapshot, numbers: { ...numbers, views: -1 } }).success,
    ).toBe(false);
    expect(
      MediaInsightSnapshotSchema.safeParse({ ...snapshot, numbers: { ...numbers, skipRate: 1.2 } }).success,
    ).toBe(false);
  });

  it('reads a media with its kind and its caption, and nothing else', () => {
    const media = { ref: 'media-1', kind: 'reel', caption: null, publishedAt: '2026-11-16T02:00:00.000Z' };
    expect(InstagramMediaSchema.safeParse(media).success).toBe(true);
    expect(InstagramMediaSchema.safeParse({ ...media, kind: 'story' }).success).toBe(false);
    expect(InstagramMediaSchema.safeParse({ ...media, comments: ['a text'] }).success).toBe(false);
  });

  it('reads a story online by its name, its hour and its numbers', () => {
    const story = { ref: 'story-1', publishedAt: '2026-11-16T09:00:00.000Z', views: 300, reach: 250 };
    expect(LiveStorySchema.safeParse(story).success).toBe(true);
    expect(LiveStorySchema.safeParse({ ...story, viewers: ['someone'] }).success).toBe(false);
  });
});
