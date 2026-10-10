export interface SyncServer {
  server: import('node:http').Server;
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createSyncServer(options?: {
  root?: string;
  publicOrigin?: string;
  discoverLan?: boolean;
  logger?: { log(...args: unknown[]): void };
}): SyncServer;
