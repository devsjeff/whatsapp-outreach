import { describe, expect, it } from 'vitest';
import { normalizePhone, phoneFromWhatsAppJid } from '../../src/lib/phone.js';

describe('normalizePhone', () => {
  it('normalizes Indian mobile numbers to E.164 digits', () => {
    const result = normalizePhone('9876543210', 'IN');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.e164Digits).toBe('919876543210');
    }
  });

  it('accepts already international numbers', () => {
    const result = normalizePhone('+91 98765 43210', 'IN');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.e164Digits).toBe('919876543210');
    }
  });

  it('rejects invalid numbers', () => {
    const result = normalizePhone('123', 'IN');
    expect(result.ok).toBe(false);
  });
});

describe('phoneFromWhatsAppJid', () => {
  it('extracts digits from jid', () => {
    expect(phoneFromWhatsAppJid('919876543210@s.whatsapp.net')).toBe('919876543210');
  });

  it('returns null for empty jid', () => {
    expect(phoneFromWhatsAppJid('')).toBeNull();
  });
});
