import { describe, expect, it } from 'vitest';
import { parseLeadsCsv } from '../../src/services/csv.js';

describe('parseLeadsCsv', () => {
  it('parses valid CSV rows', () => {
    const csv = [
      'business_name,contact_person,phone,locality,category',
      'Acme Motors,Riya,9876543210,Saket,Auto',
      'Beta Cafe,,9123456789,Hauz Khas,F&B',
    ].join('\n');

    const { rows, invalidHeaders } = parseLeadsCsv(csv);
    expect(invalidHeaders).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.business_name).toBe('Acme Motors');
    expect(rows[1]?.contact_person).toBe('');
  });

  it('detects missing headers', () => {
    const csv = 'name,phone\nAcme,9876543210\n';
    const { invalidHeaders } = parseLeadsCsv(csv);
    expect(invalidHeaders.length).toBeGreaterThan(0);
  });
});
