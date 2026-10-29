export type WindowConfig = {
  timezone: string;
  start: string; // HH:MM
  end: string; // HH:MM
  days: number[]; // 0=Sun ... 6=Sat
};

function getZonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '0';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayMap[get('weekday')] ?? 0,
  };
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

export function isWithinSendingWindow(now: Date, config: WindowConfig): boolean {
  const parts = getZonedParts(now, config.timezone);
  if (!config.days.includes(parts.weekday)) {
    return false;
  }
  const minutes = parts.hour * 60 + parts.minute;
  const start = parseHm(config.start);
  const end = parseHm(config.end);
  return minutes >= start && minutes < end;
}

/**
 * Returns milliseconds until the next allowed send moment in the configured timezone.
 */
export function msUntilNextSendingWindow(now: Date, config: WindowConfig): number {
  if (isWithinSendingWindow(now, config)) {
    return 0;
  }

  const parts = getZonedParts(now, config.timezone);
  const startMinutes = parseHm(config.start);

  for (let offset = 0; offset <= 8; offset += 1) {
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const probeParts = getZonedParts(probe, config.timezone);
    if (!config.days.includes(probeParts.weekday)) continue;

    // Same calendar day but before window start
    if (offset === 0) {
      const currentMinutes = parts.hour * 60 + parts.minute;
      if (currentMinutes < startMinutes && config.days.includes(parts.weekday)) {
        const waitMinutes = startMinutes - currentMinutes;
        return (waitMinutes * 60 - parts.second) * 1000;
      }
      continue;
    }

    // Approximate: wait until start of that day window
    const daysAhead = offset;
    const approx =
      daysAhead * 24 * 60 * 60 * 1000 -
      (parts.hour * 60 + parts.minute) * 60 * 1000 -
      parts.second * 1000 +
      startMinutes * 60 * 1000;
    return Math.max(approx, 60_000);
  }

  return 60 * 60 * 1000;
}

export function dailyCounterKey(prefix: string, now: Date, timeZone: string): string {
  const parts = getZonedParts(now, timeZone);
  const y = parts.year;
  const m = String(parts.month).padStart(2, '0');
  const d = String(parts.day).padStart(2, '0');
  return `${prefix}:${y}-${m}-${d}`;
}
