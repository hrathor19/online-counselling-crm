import { createHmac } from 'crypto';
import { Prisma, type LeadIntegration, type LeadIntegrationTrigger } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptSecret, encryptSecret, maskSecret, SECRET_UNCHANGED_SENTINEL } from '@/lib/integration-crypto';
import { renderTemplate, renderText } from '@/lib/lead-integration-template';
import { buildLeadTemplateData } from '@/lib/lead-integration-data';
import { assertPublicHttpUrl } from '@/lib/url-guard';

export interface IntegrationHeader {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface IntegrationParam {
  key: string;
  value: string;
}

export interface ExecuteResult {
  success: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  /** True when trying again could succeed: a network error, a timeout, or HTTP
   * 408/425/429/5xx. A 4xx means the receiver rejected the data, and a bad
   * template or blocked URL is our own configuration — retrying fixes neither. */
  retryable: boolean;
}

interface ExecuteOptions {
  leadId?: string | null;
  isTest?: boolean;
  retryOfLogId?: string;
  /** Automatic delivery attempt number, recorded on the log row. */
  attempt?: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

const MAX_STORED_RESPONSE_LENGTH = 5000;

/** Never send a decrypted secret header value back to the browser — mask it with a stable sentinel the save flow recognizes as "unchanged". */
export function sanitizeHeadersForClient(headers: IntegrationHeader[]): IntegrationHeader[] {
  return headers.map((h) => (h.isSecret ? { ...h, value: SECRET_UNCHANGED_SENTINEL } : h));
}

/**
 * Prepares a header list from the client for storage: plain values pass
 * through, secret values are encrypted — unless the client echoed back the
 * "unchanged" sentinel (the admin didn't touch that field), in which case
 * the existing encrypted value at the same position is kept as-is.
 */
export function prepareHeadersForStorage(
  headers: IntegrationHeader[],
  existingHeaders: IntegrationHeader[] = []
): IntegrationHeader[] {
  return headers.map((h, i) => {
    if (!h.isSecret) return h;
    if (h.value === SECRET_UNCHANGED_SENTINEL) {
      return { ...h, value: existingHeaders[i]?.isSecret ? existingHeaders[i].value : encryptSecret('') };
    }
    return { ...h, value: encryptSecret(h.value) };
  });
}

/**
 * Fans out a lead to every active integration configured for `trigger`.
 * Fire-and-forget from the caller's perspective (never throws) — this app
 * has no job queue, and it runs on a persistent PM2 Node process (not
 * serverless), so a call kicked off without `await` right before an API
 * route returns keeps running in the background after the response is
 * sent. A slow/down third-party API therefore never delays or breaks the
 * lead-creation flow that triggered it.
 */
export async function pushLeadToIntegrations(leadId: string, trigger: LeadIntegrationTrigger): Promise<void> {
  try {
    const integrations = await prisma.leadIntegration.findMany({ where: { trigger, isActive: true } });
    if (integrations.length === 0) return;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        profile: true,
        referredBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true, email: true, employeeCode: true } },
      },
    });
    if (!lead) return;

    const data = await buildLeadTemplateData(lead);
    await Promise.all(
      integrations.map((integration) => executeIntegration(integration, data, { leadId, isTest: false }))
    );
  } catch (err) {
    console.error('[lead-integration-engine] pushLeadToIntegrations failed', err);
  }
}

/**
 * Renders and sends one integration's request, and always writes a
 * LeadIntegrationLog row (success or failure) so pushes are auditable.
 * Used for real triggered pushes, manual "Test & Send", and retries.
 */
export async function executeIntegration(
  integration: LeadIntegration,
  data: Record<string, unknown>,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const baseLog = {
    integrationId: integration.id,
    leadId: options.leadId ?? null,
    isTest: options.isTest ?? false,
    retryOfLogId: options.retryOfLogId ?? null,
    attempt: options.attempt ?? 1,
  };

  let url: URL;
  const renderedHeaders: Record<string, string> = {};
  // Secret header values are never written back to the log in plaintext —
  // that would silently undermine encrypting them at rest in the config.
  const logHeaders: Record<string, string> = {};

  try {
    const headers = ((integration.headers as unknown as IntegrationHeader[]) ?? []).filter((h) => h.key);
    const params = ((integration.queryParams as unknown as IntegrationParam[]) ?? []).filter((p) => p.key);

    for (const h of headers) {
      const plain = h.isSecret ? decryptSecret(h.value) : h.value;
      const finalValue = renderText(plain, data);
      renderedHeaders[h.key] = finalValue;
      logHeaders[h.key] = h.isSecret ? maskSecret() : finalValue;
    }

    url = new URL(renderText(integration.url, data));
    for (const p of params) {
      url.searchParams.set(renderText(p.key, data), renderText(p.value, data));
    }
    await assertPublicHttpUrl(url);
  } catch (err) {
    const errorMessage = `Failed to build request: ${err instanceof Error ? err.message : 'Unknown error'}`;
    await prisma.leadIntegrationLog
      .create({
        data: {
          ...baseLog,
          requestUrl: integration.url,
          requestMethod: integration.method,
          requestHeaders: logHeaders as Prisma.InputJsonValue,
          requestBody: '',
          success: false,
          errorMessage,
        },
      })
      .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));
    return { success: false, responseStatus: null, responseBody: null, errorMessage, retryable: false };
  }

  const { output: renderedBody, valid, error: bodyError } = renderTemplate(integration.bodyTemplate, data);

  const logShared = {
    ...baseLog,
    requestUrl: url.toString(),
    requestMethod: integration.method,
    requestHeaders: logHeaders as Prisma.InputJsonValue,
    requestBody: renderedBody,
  };

  if (!valid) {
    const errorMessage = `Body template did not render to valid JSON: ${bodyError}`;
    await prisma.leadIntegrationLog
      .create({ data: { ...logShared, success: false, errorMessage } })
      .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));
    return { success: false, responseStatus: null, responseBody: null, errorMessage, retryable: false };
  }

  const method = integration.method.toUpperCase();
  const sentBody = method === 'GET' || method === 'HEAD' ? '' : renderedBody;

  // Headers every push carries unless the admin set their own. The idempotency
  // key lets a college discard a repeat delivery of the same lead; the
  // signature lets it prove the request came from this CRM.
  const hasHeader = (name: string) => Object.keys(renderedHeaders).some((k) => k.toLowerCase() === name.toLowerCase());
  if (options.leadId && !hasHeader('Idempotency-Key')) {
    renderedHeaders['Idempotency-Key'] = `${integration.id}-${options.leadId}`;
    logShared.requestHeaders = { ...logHeaders, 'Idempotency-Key': renderedHeaders['Idempotency-Key'] } as Prisma.InputJsonValue;
  }
  if (integration.signingSecret) {
    try {
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = createHmac('sha256', decryptSecret(integration.signingSecret)).update(`${ts}.${sentBody}`).digest('hex');
      renderedHeaders['X-CRM-Timestamp'] = ts;
      renderedHeaders['X-CRM-Signature'] = `sha256=${sig}`;
    } catch (err) {
      const errorMessage = `Failed to sign request: ${err instanceof Error ? err.message : 'Unknown error'}`;
      await prisma.leadIntegrationLog
        .create({ data: { ...logShared, success: false, errorMessage } })
        .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));
      return { success: false, responseStatus: null, responseBody: null, errorMessage, retryable: false };
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), integration.timeoutMs);
  let result: ExecuteResult;
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: renderedHeaders,
      body: sentBody === '' ? undefined : sentBody,
      signal: controller.signal,
      // A redirect would escape the destination check above, so none is followed.
      redirect: 'manual',
    });
    const text = await res.text();
    const truncated =
      text.length > MAX_STORED_RESPONSE_LENGTH ? `${text.slice(0, MAX_STORED_RESPONSE_LENGTH)}…` : text;
    result = {
      success: res.ok,
      responseStatus: res.status,
      responseBody: truncated,
      errorMessage: res.ok ? null : res.status >= 300 && res.status < 400 ? `HTTP ${res.status} — redirects are not followed; use the final URL` : `HTTP ${res.status}`,
      retryable: !res.ok && isRetryableStatus(res.status),
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    result = {
      success: false,
      responseStatus: null,
      responseBody: null,
      errorMessage: isAbort
        ? `Request timed out after ${integration.timeoutMs}ms`
        : err instanceof Error
        ? err.message
        : 'Unknown error',
      retryable: true,
    };
  } finally {
    clearTimeout(timeout);
  }

  await prisma.leadIntegrationLog
    .create({
      data: {
        ...logShared,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        success: result.success,
        errorMessage: result.errorMessage,
      },
    })
    .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));

  // The durable "this lead has been delivered" record — see LeadIntegrationPush.
  if (result.success && !options.isTest && options.leadId) {
    await prisma.leadIntegrationPush
      .upsert({
        where: { integrationId_leadId: { integrationId: integration.id, leadId: options.leadId } },
        create: { integrationId: integration.id, leadId: options.leadId },
        update: { pushedAt: new Date() },
      })
      .catch((pushErr) => console.error('[lead-integration-engine] failed to record push', pushErr));
  }

  return result;
}
