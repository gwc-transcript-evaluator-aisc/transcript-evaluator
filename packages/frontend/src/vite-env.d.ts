/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRANSCRIPT_API_BASE_URL?: string;
  readonly VITE_ORCHESTRATOR_API_BASE_URL?: string;
  /** Prototype-only shared API key. It is embedded in browser assets and is not production-safe. */
  readonly VITE_ORCHESTRATOR_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
