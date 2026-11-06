import { describe, expect, it } from 'vitest';

import { cleanPastedSecret, pastedSecret } from './pasted-secret';
import { SaveProviderKeyBodySchema } from './providers';
import { SaveSalesFeedKeyBodySchema } from './sales-feed';
import { SaveTelegramTokenBodySchema } from './telegram';

const KEY = 'xai-recetteinventee0000000000000000';

describe('a pasted key (recette 07/11, Bilan, remarque 6)', () => {
  it.each([
    [KEY, KEY],
    [`  ${KEY}\n`, KEY],
    [`Bearer ${KEY}`, KEY],
    [`bearer   ${KEY}`, KEY],
    [`"${KEY}"`, KEY],
    [`'${KEY}'`, KEY],
    [`\`${KEY}\``, KEY],
    [`“${KEY}”`, KEY],
    [`« ${KEY} »`, KEY],
    [`Bearer "${KEY}"`, KEY],
  ])('reads %j as the key alone', (pasted, expected) => {
    expect(cleanPastedSecret(pasted)).toBe(expected);
  });

  it('leaves a quote that does not close, or one inside the key, as it is', () => {
    expect(cleanPastedSecret(`"${KEY}`)).toBe(`"${KEY}`);
    expect(cleanPastedSecret(`ab"cd`)).toBe(`ab"cd`);
  });

  it('cleans the three key fields and still refuses one left empty', () => {
    expect(SaveProviderKeyBodySchema.parse({ key: `Bearer ${KEY}` }).key).toBe(KEY);
    expect(SaveSalesFeedKeyBodySchema.parse({ key: '"rvl_recetteinventee000"' }).key).toBe(
      'rvl_recetteinventee000',
    );
    expect(SaveTelegramTokenBodySchema.parse({ token: " '123456:recette-ok' " }).token).toBe(
      '123456:recette-ok',
    );
    expect(SaveProviderKeyBodySchema.safeParse({ key: '""' }).success).toBe(false);
    expect(SaveProviderKeyBodySchema.safeParse({ key: 'Bearer ' }).success).toBe(false);
    expect(pastedSecret(8).safeParse('123456789').success).toBe(false);
  });
});
