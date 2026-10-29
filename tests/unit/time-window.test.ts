import { describe, expect, it } from 'vitest';
import { isWithinSendingWindow } from '../../src/lib/time-window.js';

describe('isWithinSendingWindow', () => {
  const config = {
    timezone: 'Asia/Kolkata',
    start: '10:00',
    end: '18:30',
    days: [1, 2, 3, 4, 5, 6],
  };

  it('returns true for a weekday mid-window moment', () => {
    // 2024-06-03 was a Monday; 12:00 IST = 06:30 UTC
    const date = new Date('2024-06-03T06:30:00.000Z');
    expect(isWithinSendingWindow(date, config)).toBe(true);
  });

  it('returns false outside the window', () => {
    // 08:00 IST Monday = 02:30 UTC
    const date = new Date('2024-06-03T02:30:00.000Z');
    expect(isWithinSendingWindow(date, config)).toBe(false);
  });

  it('returns false on Sunday', () => {
    // 2024-06-02 Sunday 12:00 IST
    const date = new Date('2024-06-02T06:30:00.000Z');
    expect(isWithinSendingWindow(date, config)).toBe(false);
  });
});
