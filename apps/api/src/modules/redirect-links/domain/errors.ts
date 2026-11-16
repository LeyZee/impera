/** What the module refuses, by its own names: the route turns each into its HTTP answer. */
/** `forbidden`: the person is neither the owner nor an active manager, or the creator does not exist. */
export type RedirectLinkFault = 'name_taken' | 'too_many_links' | 'link_not_found' | 'forbidden';

export class RedirectLinkError extends Error {
  constructor(readonly fault: RedirectLinkFault) {
    super(fault);
    this.name = 'RedirectLinkError';
  }
}
