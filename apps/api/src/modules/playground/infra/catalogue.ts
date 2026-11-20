import type { AgentScriptView } from '../../agent/index';
import type { Trainer } from '../application/playground-service';

/**
 * The scripts the playground sells from (ADR 0103 § 15-17): her own, read as production reads them, when one of her
 * versions is played; the trial scripts otherwise. Each script with what the fan sees of each step on the platform.
 */

/** A media of a step as he gets it: its ref in her vault (the screen draws it from there), and what it is. */
export interface ShownMedia {
  readonly ref: string;
  readonly kind: 'image' | 'video' | 'audio';
  /** What the brain reads of it once sent: its description; `null` when it has none. */
  readonly description: string | null;
}

/** A step as the platform sends it: its own message, its media, and the ones shown before he buys. */
export interface ShownStep {
  /** The step's message on the platform, sent with its media; empty when it has none. */
  readonly text: string;
  readonly media: readonly ShownMedia[];
  /** The platform's preview of a paid bundle: shown to him before he buys, as on Reveal. */
  readonly teaser: readonly ShownMedia[];
}

/** A script as the agent decides on it (`view`), with its name and what each of its steps shows, by step index. */
export interface PlaygroundScript {
  readonly view: AgentScriptView;
  readonly name: string;
  readonly steps: readonly ShownStep[];
}

/** Why none of her scripts can be played; said in French by `catalogueLabel`. */
export type CatalogueUnavailable = 'no_script' | 'none_ready' | 'several_accounts' | 'unreadable';

/** Her catalogue as the playground reads it: her scripts that production would offer, or why there is none. */
export type HerCatalogue =
  | { readonly kind: 'ready'; readonly scripts: readonly PlaygroundScript[] }
  | { readonly kind: 'none'; readonly reason: CatalogueUnavailable };

/**
 * Her scripts, read for the person who trains (the owner, under her RLS): the composition root builds it from the
 * `scripts` module with the same filter as the agent's (`agentScriptViewOf`). Read again at each of his messages, as
 * production reads her catalogue again at each message.
 */
export type HerScriptsSource = (creatorId: string, trainer: Trainer) => Promise<HerCatalogue>;

/** The scripts a session sells from now: hers (and why there is none) or the trial ones. */
export interface Catalogue {
  readonly source: 'hers' | 'trial';
  readonly scripts: readonly PlaygroundScript[];
  readonly unavailable: CatalogueUnavailable | null;
}
