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
  const response = await fetch(
    `https://api.runpod.ai/v2/${endpointId}/runsync`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    }
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
    const statusResponse = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/status/${result.id}`,
      {
        headers: {
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
      }
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
