import { describe, expect, it } from 'vitest';
import {
  renderMessageTemplate,
  resolveContactName,
  validateTemplateFields,
} from '../../src/lib/template.js';

describe('template helpers', () => {
  it('prefers contact person over business name', () => {
    expect(
      resolveContactName({
        business_name: 'Acme Motors',
        contact_person: 'Riya',
        locality: 'Saket',
      }),
    ).toBe('Riya');
  });

  it('falls back to business name', () => {
    expect(
      resolveContactName({
        business_name: 'Acme Motors',
        contact_person: null,
        locality: 'Saket',
      }),
    ).toBe('Acme Motors');
  });

  it('interpolates variables safely', () => {
    const text = renderMessageTemplate(
      'Hi {{contact_person_or_business_name}} in {{locality}}',
      {
        business_name: 'Acme',
        contact_person: '',
        locality: 'Karol Bagh',
      },
    );
    expect(text).toBe('Hi Acme in Karol Bagh');
  });

  it('rejects unknown placeholders', () => {
    expect(() =>
      renderMessageTemplate('Hello {{unknown}}', {
        business_name: 'Acme',
        locality: 'Saket',
      }),
    ).toThrow(/Unknown template variable/);
  });

  it('validates required fields', () => {
    expect(
      validateTemplateFields({
        business_name: '',
        locality: '',
      }),
    ).toEqual(
      expect.arrayContaining(['business_name is required', 'locality is required']),
    );
  });
});
