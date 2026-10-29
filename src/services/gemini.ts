import { loadEnv } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { renderMessageTemplate, type TemplateVars } from '../lib/template.js';

export type GeminiLeadContext = TemplateVars & {
  category?: string | null;
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  error?: {
    message?: string;
    code?: number;
    status?: string;
  };
};

export function isGeminiConfigured(): boolean {
  const env = loadEnv();
  return Boolean(env.GEMINI_API_KEY);
}

export function getGeminiStatus(): {
  configured: boolean;
  enabled: boolean;
  model: string;
} {
  const env = loadEnv();
  return {
    configured: Boolean(env.GEMINI_API_KEY),
    enabled: env.GEMINI_MESSAGE_GENERATION && Boolean(env.GEMINI_API_KEY),
    model: env.GEMINI_MODEL,
  };
}

function buildOutreachPrompt(lead: GeminiLeadContext, fallbackTemplate: string): string {
  const name =
    lead.contact_person?.trim() || lead.business_name.trim() || 'the business';
  return [
    'You write short WhatsApp outreach messages for Backseat Network.',
    'Backseat Network sells in-cab headrest screen advertising across Delhi NCR.',
    'Return ONLY the message body. No markdown, no quotes, no subject line.',
    'Constraints:',
    '- TEXT ONLY, under 500 characters preferred, max 900 characters',
    '- Personalized, professional, concise',
    '- Mention the locality naturally',
    '- Offer a soft ask to learn more / pilot interest',
    '- End with: Reply STOP if you do not wish to receive further messages.',
    '- Do not invent prices, fleet size claims, or fake case studies',
    '- Do not mention you are an AI',
    '',
    `Business name: ${lead.business_name}`,
    `Contact person: ${lead.contact_person?.trim() || 'unknown'}`,
    `Greeting name: ${name}`,
    `Locality: ${lead.locality}`,
    `Category: ${lead.category?.trim() || 'local business'}`,
    '',
    'Style reference template (adapt; do not copy verbatim unless needed):',
    fallbackTemplate,
  ].join('\n');
}

function extractText(payload: GeminiGenerateResponse): string | null {
  const parts = payload.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return text.length > 0 ? text : null;
}

function sanitizeGeneratedMessage(raw: string): string {
  let text = raw.trim();
  // Strip accidental markdown fences / surrounding quotes
  text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1).trim();
  }
  if (text.length > 900) {
    text = `${text.slice(0, 897).trim()}...`;
  }
  const upper = text.toUpperCase();
  if (!upper.includes('STOP')) {
    text = `${text}\n\nReply STOP if you do not wish to receive further messages.`;
  }
  return text;
}

/**
 * Calls Gemini generateContent. Never logs the API key.
 */
export async function generateContent(prompt: string): Promise<string> {
  const env = loadEnv();
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const model = encodeURIComponent(env.GEMINI_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 512,
      },
    }),
  });

  const payload = (await response.json()) as GeminiGenerateResponse;

  if (!response.ok) {
    const message = payload.error?.message ?? `Gemini HTTP ${response.status}`;
    throw new Error(message);
  }

  const text = extractText(payload);
  if (!text) {
    throw new Error('Gemini returned empty content');
  }
  return text;
}

/**
 * Build outreach body: Gemini when enabled, otherwise static template.
 * On Gemini failure, falls back to the campaign template.
 */
export async function composeOutreachMessage(
  lead: GeminiLeadContext,
  fallbackTemplate: string,
): Promise<{ body: string; source: 'gemini' | 'template' }> {
  const env = loadEnv();
  const templateBody = renderMessageTemplate(fallbackTemplate, lead);

  if (!env.GEMINI_MESSAGE_GENERATION || !env.GEMINI_API_KEY) {
    return { body: templateBody, source: 'template' };
  }

  try {
    const prompt = buildOutreachPrompt(lead, fallbackTemplate);
    const generated = sanitizeGeneratedMessage(await generateContent(prompt));
    return { body: generated, source: 'gemini' };
  } catch (error) {
    logger.warn({ err: error }, 'Gemini message generation failed — using template fallback');
    return { body: templateBody, source: 'template' };
  }
}
