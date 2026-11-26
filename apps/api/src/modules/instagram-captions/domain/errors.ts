/** Every model failed on a caption: the job is tried again. */
export class CaptionWritingFailed extends Error {
  override readonly name = 'CaptionWritingFailed';
}
