import { parse } from 'csv-parse/sync';

export type CsvLeadRow = {
  business_name: string;
  contact_person: string;
  phone: string;
  locality: string;
  category: string;
  rowNumber: number;
};

const REQUIRED_HEADERS = ['business_name', 'contact_person', 'phone', 'locality', 'category'] as const;

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

export function parseLeadsCsv(content: Buffer | string): {
  rows: CsvLeadRow[];
  invalidHeaders: string[];
} {
  const records = parse(content, {
    columns: (headers: string[]) => headers.map(normalizeHeader),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[];

  const first = records[0] ?? {};
  const present = Object.keys(first);
  const invalidHeaders = REQUIRED_HEADERS.filter((h) => !present.includes(h) && records.length > 0);

  // If file is empty, still check by parsing headers only via a second approach
  if (records.length === 0) {
    return { rows: [], invalidHeaders: [] };
  }

  const rows: CsvLeadRow[] = records.map((record, index) => ({
    business_name: record.business_name ?? '',
    contact_person: record.contact_person ?? '',
    phone: record.phone ?? '',
    locality: record.locality ?? '',
    category: record.category ?? '',
    rowNumber: index + 2, // header is row 1
  }));

  return { rows, invalidHeaders };
}

export function validateCsvHeaders(headers: string[]): string[] {
  const normalized = headers.map(normalizeHeader);
  return REQUIRED_HEADERS.filter((h) => !normalized.includes(h));
}
