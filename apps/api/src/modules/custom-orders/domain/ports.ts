import type { CreatorId, CustomPriceGrid, CustomPriceGridView, UserId } from '@impera/contracts';

/** Who saves her grid: the owner, checked again in the base on each call. */
export interface CustomPriceActor {
  readonly userId: UserId;
  readonly ip: string;
}

type SaveGridResult =
  | { readonly kind: 'saved'; readonly view: CustomPriceGridView }
  /** Another version was saved since the one the screen read: nothing written. */
  | { readonly kind: 'conflict'; readonly current: number };

/** Her grid of custom prices (ADR 0159 § C), one version per save. */
export interface CustomPriceGridStore {
  /** Her grid in force, the empty one before any save; null when the creator does not exist or is not the owner's. */
  read(creatorId: CreatorId, actor: CustomPriceActor): Promise<CustomPriceGridView | null>;
  /** A new version on top of `baseVersion`; null for the same refusals as `read`. */
  save(
    creatorId: CreatorId,
    baseVersion: number,
    grid: CustomPriceGrid,
    actor: CustomPriceActor,
  ): Promise<SaveGridResult | null>;
}
