import { describe, expect, it } from 'vitest';

import { LLM_PACKAGE } from './index';

describe('@impera/llm', () => {
  it('resolves through the workspace', () => {
    expect(LLM_PACKAGE).toBe('@impera/llm');
  });
});
