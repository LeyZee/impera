import { MEDIA_VOCABULARY_VERSION, type MediaDescription, type PlaygroundMedia } from '@impera/contracts';

/**
 * A media the trainer described in a few words, as the agent sees a described one. Nothing is claimed beyond
 * the words: intensity and cast not visible, no anatomy, low confidence. Flags are kept, to test the handoff.
 */
export function completeMedia(media: PlaygroundMedia): MediaDescription {
  return {
    vocabularyVersion: MEDIA_VOCABULARY_VERSION,
    kind: media.kind,
    factualDescription: media.factualDescription,
    durationS: null,
    segments: [],
    intensity: 'not_visible',
    anatomyVisible: [],
    castMode: 'not_visible',
    mood: [],
    setting: null,
    audio: null,
    textVisible: null,
    quality: 'acceptable',
    confidenceLow: true,
    notVisible: false,
    flags: media.flags ?? [],
  };
}
