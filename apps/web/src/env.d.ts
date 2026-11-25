// The VITE_* variables this app reads. Vite copies each one into the public bundle, so none of them
// may hold a secret (eslint.config.js refuses key-like names here; CLAUDE.md rule 1).
interface ImportMetaEnv {
  // Where the sync server is, e.g. wss://sketch.example.com. Defaults to ws://localhost:1234.
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
