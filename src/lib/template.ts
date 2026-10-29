export type TemplateVars = {
  contact_person?: string | null;
  business_name: string;
  locality: string;
  category?: string | null;
  phone?: string | null;
};

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function resolveContactName(vars: TemplateVars): string {
  const person = vars.contact_person?.trim();
  if (person) return person;
  return vars.business_name.trim();
}

export function renderMessageTemplate(template: string, vars: TemplateVars): string {
  const map: Record<string, string> = {
    contact_person: vars.contact_person?.trim() ?? '',
    business_name: vars.business_name.trim(),
    contact_person_or_business_name: resolveContactName(vars),
    locality: vars.locality.trim(),
    category: vars.category?.trim() ?? '',
    phone: vars.phone?.trim() ?? '',
  };

  return template.replace(PLACEHOLDER_RE, (_match, key: string) => {
    if (!(key in map)) {
      throw new Error(`Unknown template variable: {{${key}}}`);
    }
    const value = map[key];
    if (!value && (key === 'locality' || key === 'business_name' || key === 'contact_person_or_business_name')) {
      throw new Error(`Missing required template field: ${key}`);
    }
    return value;
  });
}

export function validateTemplateFields(vars: TemplateVars): string[] {
  const errors: string[] = [];
  if (!vars.business_name?.trim()) errors.push('business_name is required');
  if (!vars.locality?.trim()) errors.push('locality is required');
  if (!resolveContactName(vars)) errors.push('contact_person or business_name is required');
  return errors;
}
