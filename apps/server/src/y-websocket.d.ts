// y-websocket's server helper has no type declarations, so declare the part we use.
declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http';
  import type { WebSocket } from 'ws';
  export function setupWSConnection(conn: WebSocket, req: IncomingMessage, opts?: { docName?: string; gc?: boolean }): void;
}
