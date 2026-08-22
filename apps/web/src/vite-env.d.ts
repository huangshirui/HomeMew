/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LIFESPACE_IDENTITY_URL?: string;
  readonly VITE_LIFESPACE_CORE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
