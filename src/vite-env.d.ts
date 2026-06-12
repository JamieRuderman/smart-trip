/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SCHEDULE_URL?: string;
  /** Set (to anything non-empty) on native builds once the Live Activity
   *  widget + APNs backend exist, to enable push-backed countdown correction. */
  readonly VITE_LIVE_ACTIVITY_PUSH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
