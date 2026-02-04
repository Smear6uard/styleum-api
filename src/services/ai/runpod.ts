import * as Sentry from "@sentry/node";

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;

if (!RUNPOD_API_KEY) {
  console.warn("RUNPOD_API_KEY not set - AI features will be disabled");
}

interface RunPodResponse {
  id: string;
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | "CANCELLED";
  output?: unknown;
  error?: string;
}

interface CallRunPodOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<CallRunPodOptions> = {
  maxRetries: 30,
  initialDelayMs: 1000,
  maxDelayMs: 5000,
  timeoutMs: 240000,
};

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Network errors that should trigger retry
const RETRYABLE_ERRORS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'Connection reset',
  'socket hang up',
  'network error',
  'abort',
];

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return RETRYABLE_ERRORS.some(e => message.includes(e.toLowerCase()));
  }
  return false;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  context: string
): Promise<Response> {
  const maxRetries = 3;
  const baseDelay = 1000;
  const fetchTimeout = 90000; // 90 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Don't retry on 4xx client errors
      if (response.status >= 400 && response.status < 500) {
        return response;
      }

      // Retry on 5xx server errors
      if (response.status >= 500 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`[RunPod] ${context}: Server error ${response.status}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        Sentry.addBreadcrumb({
          category: 'runpod',
          message: `Retry attempt ${attempt} for ${context}: Server error ${response.status}`,
          level: 'warning',
        });
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (attempt < maxRetries && isRetryableError(error)) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        const errorMsg = error instanceof Error ? error.message : 'Network error';
        console.log(`[RunPod] ${context}: ${errorMsg}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        Sentry.addBreadcrumb({
          category: 'runpod',
          message: `Retry attempt ${attempt} for ${context}: ${errorMsg}`,
          level: 'warning',
        });
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`${context}: Max retries exceeded`);
}

export async function callRunPod<T = unknown>(
  endpointId: string,
  input: Record<string, unknown>,
  options: CallRunPodOptions = {}
): Promise<T> {
  const maxJobRetries = 1; // Retry once on timeout

  for (let jobAttempt = 0; jobAttempt <= maxJobRetries; jobAttempt++) {
    try {
      return await executeRunPodJob<T>(endpointId, input, options);
    } catch (error) {
      const isTimeout = error instanceof Error && error.message.includes('timed out');
      const canRetry = jobAttempt < maxJobRetries && isTimeout;

      if (canRetry) {
        console.log(`[RunPod] Job timed out for ${endpointId}, retrying in 2s (attempt ${jobAttempt + 2}/${maxJobRetries + 1})`);
        await sleep(2000);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unreachable');
}

async function executeRunPodJob<T = unknown>(
  endpointId: string,
  input: Record<string, unknown>,
  options: CallRunPodOptions = {}
): Promise<T> {
  if (!RUNPOD_API_KEY) {
    throw new Error("RUNPOD_API_KEY not configured");
  }

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  // Initial request using runsync
  const response = await fetchWithRetry(
    `https://api.runpod.ai/v2/${endpointId}/runsync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    },
    `runsync ${endpointId}`
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RunPod request failed: ${response.status} - ${errorText}`);
  }

  let result: RunPodResponse = await response.json();

  // If completed immediately, return
  if (result.status === "COMPLETED") {
    return result.output as T;
  }

  if (result.status === "FAILED") {
    throw new Error(`RunPod job failed: ${result.error ?? "Unknown error"}`);
  }

  // Poll for completion
  let delay = opts.initialDelayMs;
  let attempts = 0;

  while (
    result.status === "IN_QUEUE" ||
    result.status === "IN_PROGRESS"
  ) {
    // Check timeout
    if (Date.now() - startTime > opts.timeoutMs) {
      Sentry.captureMessage(`RunPod timeout: ${endpointId}`, {
        level: "error",
        extra: { jobId: result.id, timeoutMs: opts.timeoutMs },
      });
      throw new Error(`RunPod job timed out after ${opts.timeoutMs}ms`);
    }

    // Check max retries
    if (attempts >= opts.maxRetries) {
      throw new Error(`RunPod job exceeded max retries (${opts.maxRetries})`);
    }

    await sleep(delay);

    // Poll status
    const statusResponse = await fetchWithRetry(
      `https://api.runpod.ai/v2/${endpointId}/status/${result.id}`,
      {
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
      },
      `status ${endpointId}/${result.id}`
    );

    if (!statusResponse.ok) {
      const errorText = await statusResponse.text();
      throw new Error(
        `RunPod status check failed: ${statusResponse.status} - ${errorText}`
      );
    }

    result = await statusResponse.json();
    attempts++;

    // Exponential backoff with cap
    delay = Math.min(delay * 1.5, opts.maxDelayMs);
  }

  if (result.status === "COMPLETED") {
    return result.output as T;
  }

  if (result.status === "FAILED") {
    Sentry.captureMessage(`RunPod job failed: ${endpointId}`, {
      level: "error",
      extra: { jobId: result.id, error: result.error },
    });
    throw new Error(`RunPod job failed: ${result.error ?? "Unknown error"}`);
  }

  if (result.status === "CANCELLED") {
    throw new Error("RunPod job was cancelled");
  }

  throw new Error(`Unexpected RunPod status: ${result.status}`);
}
