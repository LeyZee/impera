import { DomainError } from '@impera/contracts';

/** Every model failed on a caption: the job is tried again. */
export class CaptionWritingFailed extends Error {
  override readonly name = 'CaptionWritingFailed';
}

/** A hint her screen does not offer for a caption. */
export class CaptionHintUnknown extends DomainError {
  constructor() {
    super('caption_hint_unprocessable', 'Cette indication n’est pas proposée');
  }
}
