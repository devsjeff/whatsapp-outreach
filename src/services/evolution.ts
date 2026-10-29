import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';

export type WhatsAppConnectionState = 'open' | 'connecting' | 'close' | 'unknown';

type EvolutionRequestOptions = {
  method?: string;
  path: string;
  body?: unknown;
  expectJson?: boolean;
};

export class EvolutionApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'EvolutionApiError';
  }
}

async function evolutionRequest<T = unknown>(options: EvolutionRequestOptions): Promise<T> {
  const env = loadEnv();
  const url = `${env.EVOLUTION_API_URL.replace(/\/$/, '')}${options.path}`;

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      apikey: env.EVOLUTION_API_KEY,
      'Content-Type': 'application/json',
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    throw new EvolutionApiError(
      `Evolution API ${options.method ?? 'GET'} ${options.path} failed with ${response.status}`,
      response.status,
      parsed,
    );
  }

  return parsed as T;
}

function extractQrBase64(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;

  const candidates = [
    obj.base64,
    obj.qrcode,
    obj.qr,
    (obj.qrcode as Record<string, unknown> | undefined)?.base64,
    (obj.instance as Record<string, unknown> | undefined)?.qrcode,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) {
      return candidate.startsWith('data:') ? candidate : `data:image/png;base64,${candidate}`;
    }
  }
  return null;
}

function extractPairingCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  const code = obj.pairingCode ?? obj.code;
  return typeof code === 'string' ? code : null;
}

export async function fetchInstances(): Promise<unknown[]> {
  const env = loadEnv();
  try {
    const result = await evolutionRequest<unknown>({
      path: `/instance/fetchInstances?instanceName=${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
    });
    if (Array.isArray(result)) return result;
    if (result) return [result];
    return [];
  } catch (error) {
    if (error instanceof EvolutionApiError && error.status === 404) {
      return [];
    }
    throw error;
  }
}

export async function getConnectionState(): Promise<{
  state: WhatsAppConnectionState;
  raw: unknown;
}> {
  const env = loadEnv();
  try {
    const raw = await evolutionRequest<{
      instance?: { state?: string; instanceName?: string };
      state?: string;
    }>({
      path: `/instance/connectionState/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
    });

    const stateRaw = (raw.instance?.state ?? raw.state ?? 'unknown').toLowerCase();
    const state: WhatsAppConnectionState =
      stateRaw === 'open' || stateRaw === 'connecting' || stateRaw === 'close'
        ? stateRaw
        : 'unknown';

    return { state, raw };
  } catch (error) {
    if (error instanceof EvolutionApiError && (error.status === 404 || error.status === 400)) {
      return { state: 'close', raw: { error: 'instance_not_found' } };
    }
    throw error;
  }
}

export async function connectInstance(): Promise<{
  created: boolean;
  state: WhatsAppConnectionState;
  qr: { base64: string | null; pairingCode: string | null; raw: unknown };
}> {
  const env = loadEnv();
  const instances = await fetchInstances();
  let created = false;

  if (instances.length === 0) {
    const webhookUrl = `${env.APP_BASE_URL.replace(/\/$/, '')}/api/webhooks/whatsapp`;
    await evolutionRequest({
      method: 'POST',
      path: '/instance/create',
      body: {
        instanceName: env.EVOLUTION_INSTANCE_NAME,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        groupsIgnore: true,
        rejectCall: true,
        alwaysOnline: false,
        readMessages: false,
        syncFullHistory: false,
        webhook: {
          url: webhookUrl,
          byEvents: false,
          base64: false,
          headers: {
            authorization: `Bearer ${env.WHATSAPP_WEBHOOK_SECRET}`,
          },
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        },
      },
    });
    created = true;
    logger.info({ instance: env.EVOLUTION_INSTANCE_NAME }, 'Evolution instance created');
  } else {
    // Ensure webhook is configured on existing instance
    try {
      const webhookUrl = `${env.APP_BASE_URL.replace(/\/$/, '')}/api/webhooks/whatsapp`;
      await evolutionRequest({
        method: 'POST',
        path: `/webhook/set/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
        body: {
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          headers: {
            authorization: `Bearer ${env.WHATSAPP_WEBHOOK_SECRET}`,
          },
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
        },
      });
    } catch (error) {
      logger.warn({ err: error }, 'Failed to refresh Evolution webhook configuration');
    }
  }

  const qrRaw = await evolutionRequest({
    path: `/instance/connect/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
  });
  const { state } = await getConnectionState();

  return {
    created,
    state,
    qr: {
      base64: extractQrBase64(qrRaw),
      pairingCode: extractPairingCode(qrRaw),
      raw: qrRaw,
    },
  };
}

export async function getQrCode(): Promise<{
  state: WhatsAppConnectionState;
  base64: string | null;
  pairingCode: string | null;
  raw: unknown;
}> {
  const env = loadEnv();
  const { state } = await getConnectionState();
  if (state === 'open') {
    return { state, base64: null, pairingCode: null, raw: { message: 'already_connected' } };
  }

  const qrRaw = await evolutionRequest({
    path: `/instance/connect/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
  });

  return {
    state,
    base64: extractQrBase64(qrRaw),
    pairingCode: extractPairingCode(qrRaw),
    raw: qrRaw,
  };
}

export async function disconnectInstance(): Promise<unknown> {
  const env = loadEnv();
  try {
    return await evolutionRequest({
      method: 'DELETE',
      path: `/instance/logout/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
    });
  } catch (error) {
    if (error instanceof EvolutionApiError && error.status === 404) {
      return { message: 'instance_not_found' };
    }
    throw error;
  }
}

export async function sendTextMessage(number: string, text: string): Promise<{
  providerMessageId: string | null;
  raw: unknown;
}> {
  const env = loadEnv();
  const raw = await evolutionRequest<{
    key?: { id?: string };
  }>({
    method: 'POST',
    path: `/message/sendText/${encodeURIComponent(env.EVOLUTION_INSTANCE_NAME)}`,
    body: {
      number,
      text,
      linkPreview: false,
    },
  });

  return {
    providerMessageId: raw?.key?.id ?? null,
    raw,
  };
}

export async function checkEvolutionHealth(): Promise<boolean> {
  try {
    await getConnectionState();
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'Evolution API health check failed');
    return false;
  }
}
