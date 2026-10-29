import { describe, expect, it } from 'vitest';

function isOptOut(text: string, keywords: string[]): { matched: boolean; keyword?: string } {
  const normalized = text.trim().toUpperCase();
  for (const keyword of keywords) {
    if (normalized === keyword || normalized.startsWith(`${keyword} `)) {
      return { matched: true, keyword };
    }
  }
  return { matched: false };
}

describe('opt-out detection', () => {
  const keywords = ['STOP', 'UNSUBSCRIBE'];

  it('matches STOP case-insensitively', () => {
    expect(isOptOut('stop', keywords)).toEqual({ matched: true, keyword: 'STOP' });
  });

  it('matches UNSUBSCRIBE with trailing text', () => {
    expect(isOptOut('unsubscribe please', keywords).matched).toBe(true);
  });

  it('does not match partial words', () => {
    expect(isOptOut('PLEASE DONT STOPBY', keywords).matched).toBe(false);
  });

  it('does not match normal replies', () => {
    expect(isOptOut('Yes interested', keywords).matched).toBe(false);
  });
});
