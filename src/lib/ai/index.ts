import "server-only";

import { getConfig } from "@/server/runtime/config";
import { createStubProvider } from "@/server/agents/stub-transport";
import { createGeminiProvider } from "./gemini";
import type { Provider } from "./types";

/**
 * Where the model provider is chosen.
 *
 * The agent loop asks for a provider and never names one, so swapping the
 * backend again means adding a file here rather than editing the loop. The
 * instance is cached because a provider holds nothing per-request.
 */

let cached: Provider | null = null;
let cachedKey = "";

export function getProvider(): Provider {
  const cfg = getConfig();
  const key = cfg.testTransport ? "stub" : `gemini:${cfg.apiKey.slice(-8)}`;

  if (!cached || cachedKey !== key) {
    cached = cfg.testTransport
      ? createStubProvider()
      : createGeminiProvider({ apiKey: cfg.apiKey });
    cachedKey = key;
  }
  return cached;
}

/** Drops the cached provider so a changed key takes effect. */
export function resetProvider(): void {
  cached = null;
  cachedKey = "";
}

export * from "./types";
