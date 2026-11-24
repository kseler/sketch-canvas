// y-websocket's server helper has no type declarations, so declare the part we use.
declare module 'y-websocket/bin/utils' {
  import type { IncomingMessage } from 'node:http';
  import type { WebSocket } from 'ws';
  import type * as Y from 'yjs';
  export function setupWSConnection(conn: WebSocket, req: IncomingMessage, opts?: { docName?: string; gc?: boolean }): void;
  // The server's copy of a room's document (created if new). The room name is the WebSocket path.
  export function getYDoc(docName: string, gc?: boolean): Y.Doc;
  // Every room document the server holds, by room name, with its open connections.
  export const docs: Map<string, Y.Doc & { conns: Map<unknown, unknown> }>;
}
