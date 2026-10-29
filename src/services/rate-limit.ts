import { loadEnv } from '../config/env.js';
import { dailyCounterKey } from '../lib/time-window.js';
import { getRedis } from '../queue/connection.js';

const LAST_SENT_KEY = 'outreach:last_sent_at';
const NEXT_GAP_KEY = 'outreach:next_gap_ms';
const PAUSED_KEY = 'outreach:paused';

function randomDelayMs(minSeconds: number, maxSeconds: number): number {
  const min = minSeconds * 1000;
  const max = maxSeconds * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function isOutreachPaused(): Promise<boolean> {
  const value = await getRedis().get(PAUSED_KEY);
  return value === '1';
}

export async function setOutreachPaused(paused: boolean): Promise<void> {
  const redis = getRedis();
  if (paused) {
    await redis.set(PAUSED_KEY, '1');
  } else {
    await redis.del(PAUSED_KEY);
  }
}

export async function getDailySentCount(now = new Date()): Promise<number> {
  const env = loadEnv();
  const key = dailyCounterKey('outreach:daily', now, env.TIMEZONE);
  const value = await getRedis().get(key);
  return value ? Number(value) : 0;
}

/**
 * Atomically reserve a send slot if under daily cap and the randomized gap elapsed.
 * On success, stores a new random 30–60s (configurable) gap for the next send.
 */
export async function tryReserveSendSlot(now = new Date()): Promise<
  | { ok: true; dailyCount: number; nextGapMs: number }
  | { ok: false; reason: 'paused' | 'daily_cap' | 'min_delay'; waitMs?: number; dailyCount?: number }
> {
  const env = loadEnv();
  const redis = getRedis();

  if (await isOutreachPaused()) {
    return { ok: false, reason: 'paused' };
  }

  const dailyKey = dailyCounterKey('outreach:daily', now, env.TIMEZONE);
  const nextGapMs = randomDelayMs(env.MIN_MESSAGE_DELAY_SECONDS, env.MAX_MESSAGE_DELAY_SECONDS);
  const nowMs = now.getTime();
  const floorGapMs = env.MIN_MESSAGE_DELAY_SECONDS * 1000;

  // Lua: enforce stored gap (or floor), then increment daily + set last send + next gap.
  const script = `
    local paused = redis.call('GET', KEYS[1])
    if paused == '1' then
      return {0, 'paused', 0, 0, 0}
    end

    local last = redis.call('GET', KEYS[2])
    local nowMs = tonumber(ARGV[1])
    local floorGap = tonumber(ARGV[2])
    local storedGap = tonumber(redis.call('GET', KEYS[4]) or ARGV[2])
    local requiredGap = math.max(floorGap, storedGap)

    if last then
      local elapsed = nowMs - tonumber(last)
      if elapsed < requiredGap then
        return {0, 'min_delay', requiredGap - elapsed, tonumber(redis.call('GET', KEYS[3]) or '0'), 0}
      end
    end

    local count = tonumber(redis.call('GET', KEYS[3]) or '0')
    local limit = tonumber(ARGV[3])
    if count >= limit then
      return {0, 'daily_cap', 0, count, 0}
    end

    count = redis.call('INCR', KEYS[3])
    if count == 1 then
      redis.call('EXPIRE', KEYS[3], 172800)
    end
    redis.call('SET', KEYS[2], ARGV[1])
    redis.call('SET', KEYS[4], ARGV[4])
    return {1, 'ok', 0, count, tonumber(ARGV[4])}
  `;

  const result = (await redis.eval(
    script,
    4,
    PAUSED_KEY,
    LAST_SENT_KEY,
    dailyKey,
    NEXT_GAP_KEY,
    String(nowMs),
    String(floorGapMs),
    String(env.DAILY_MESSAGE_LIMIT),
    String(nextGapMs),
  )) as [number, string, number, number, number];

  const [ok, reason, waitMs, dailyCount, storedNextGap] = result;
  if (ok === 1) {
    return { ok: true, dailyCount: Number(dailyCount), nextGapMs: Number(storedNextGap) };
  }

  return {
    ok: false,
    reason: reason as 'paused' | 'daily_cap' | 'min_delay',
    waitMs: Number(waitMs) || undefined,
    dailyCount: Number(dailyCount) || 0,
  };
}

export async function releaseSendSlot(now = new Date()): Promise<void> {
  const env = loadEnv();
  const key = dailyCounterKey('outreach:daily', now, env.TIMEZONE);
  const redis = getRedis();
  const count = await redis.decr(key);
  if (count < 0) {
    await redis.set(key, '0');
  }
}
