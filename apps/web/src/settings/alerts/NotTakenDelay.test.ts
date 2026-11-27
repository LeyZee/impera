import { describe, expect, it } from 'vitest';

import { delayText, parseDelay } from './NotTakenDelay';

describe('the delay of « Chatteur pas là »', () => {
  it('says minutes as the card does', () => {
    expect(delayText(5)).toBe('5 min');
    expect(delayText(60)).toBe('1 h');
    expect(delayText(95)).toBe('1 h 35');
    expect(delayText(125)).toBe('2 h 05');
  });

  it('reads only whole minutes within the contract’s bounds', () => {
    expect(parseDelay(' 15 ')).toBe(15);
    expect(parseDelay('5')).toBe(5);
    expect(parseDelay('240')).toBe(240);
    expect(parseDelay('4')).toBeNull();
    expect(parseDelay('241')).toBeNull();
    expect(parseDelay('12,5')).toBeNull();
    expect(parseDelay('')).toBeNull();
  });
});
