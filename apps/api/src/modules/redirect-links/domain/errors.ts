/** What the module refuses, by its own names: the route turns each into its HTTP answer. */
export type RedirectLinkFault = 'name_taken' | 'too_many_links' | 'link_not_found';

export class RedirectLinkError extends Error {
  constructor(readonly fault: RedirectLinkFault) {
    super(fault);
    this.name = 'RedirectLinkError';
  }
}
