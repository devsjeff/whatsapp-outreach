import { describe, expect, it } from 'vitest';

/**
 * Mirrors the QR extraction logic used by the Evolution client.
 * Ensures we never invent a fake QR — only pass through provider values.
 */
function extractQrBase64(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const candidates = [
    obj.base64,
    obj.qrcode,
    obj.qr,
    (obj.qrcode as Record<string, unknown> | undefined)?.base64,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate.startsWith('data:') ? candidate : `data:image/png;base64,${candidate}`;
    }
  }
  return null;
}

describe('QR extraction', () => {
  it('returns null when Evolution provides no QR', () => {
    expect(extractQrBase64({ pairingCode: null })).toBeNull();
  });

  it('wraps raw base64 as a data URL', () => {
    expect(extractQrBase64({ base64: 'abc123' })).toBe('data:image/png;base64,abc123');
  });

  it('keeps existing data URLs', () => {
    expect(extractQrBase64({ base64: 'data:image/png;base64,xyz' })).toBe(
      'data:image/png;base64,xyz',
    );
  });
});
