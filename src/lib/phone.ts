import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export type PhoneNormalizationResult =
  | { ok: true; e164Digits: string; display: string }
  | { ok: false; error: string };

/**
 * Normalize to digits-only E.164 without leading '+', e.g. 919876543210.
 * Default country is India (IN) for Delhi NCR advertiser leads.
 */
export function normalizePhone(
  raw: string,
  defaultCountry: CountryCode = 'IN',
): PhoneNormalizationResult {
  const trimmed = (raw ?? '').toString().trim();
  if (!trimmed) {
    return { ok: false, error: 'Phone number is required' };
  }

  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) {
    return { ok: false, error: `Invalid phone number: ${trimmed}` };
  }

  return {
    ok: true,
    e164Digits: parsed.number.replace(/^\+/, ''),
    display: parsed.formatInternational(),
  };
}

export function phoneFromWhatsAppJid(jid: string): string | null {
  if (!jid) return null;
  const user = jid.split('@')[0] ?? '';
  const digits = user.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}
