/**
 * Runtime application configuration.
 *
 * In deployed environments the API base URLs are provided by a `/config.json` file
 * written at deploy time by the frontend-hosting CDK stack, so the same Vite build
 * works against any backend without rebuilding. For local development (`npm run dev`)
 * there is no config.json, so values fall back to Vite `import.meta.env` variables.
 *
 * Call `loadRuntimeConfig()` once before rendering; consumers then read the resolved
 * values synchronously via `getConfig()`.
 */

export interface AppConfig {
  transcriptApiBaseUrl: string;
  orchestratorApiBaseUrl: string;
  /** Prototype-only shared API key. Sourced from build-time env, never from config.json. */
  orchestratorApiKey?: string;
}

const stripTrailingSlash = (value: string): string => value.replace(/\/$/, "");

function configFromEnv(): AppConfig {
  return {
    transcriptApiBaseUrl: stripTrailingSlash(import.meta.env.VITE_TRANSCRIPT_API_BASE_URL ?? ""),
    orchestratorApiBaseUrl: stripTrailingSlash(import.meta.env.VITE_ORCHESTRATOR_API_BASE_URL ?? ""),
    orchestratorApiKey: import.meta.env.VITE_ORCHESTRATOR_API_KEY?.trim() || undefined,
  };
}

let resolved: AppConfig | null = null;

/**
 * Fetch `/config.json` and merge it over the build-time env defaults. Never throws:
 * on any failure (e.g. local dev with no config.json) it falls back to env values.
 */
export async function loadRuntimeConfig(): Promise<AppConfig> {
  const envConfig = configFromEnv();
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (response.ok) {
      const data: Partial<Pick<AppConfig, "transcriptApiBaseUrl" | "orchestratorApiBaseUrl">> = await response.json();
      resolved = {
        transcriptApiBaseUrl: stripTrailingSlash(data.transcriptApiBaseUrl || envConfig.transcriptApiBaseUrl),
        orchestratorApiBaseUrl: stripTrailingSlash(data.orchestratorApiBaseUrl || envConfig.orchestratorApiBaseUrl),
        // The API key is intentionally not served from config.json; keep the env value.
        orchestratorApiKey: envConfig.orchestratorApiKey,
      };
      return resolved;
    }
  } catch {
    // No config.json (local dev) or network error — fall back to env below.
  }
  resolved = envConfig;
  return resolved;
}

/** Resolved config. Falls back to env values if `loadRuntimeConfig()` has not completed. */
export function getConfig(): AppConfig {
  return resolved ?? configFromEnv();
}
