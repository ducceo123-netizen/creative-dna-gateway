import express from 'express';
import { createApp as createLegacyGateway } from './server.ts';
import { registerWorkspaceRoutes, type WorkspaceApiOptions } from './uid-workspace-api.ts';

/** Additive gateway composition. The existing server source and default startup
 * remain byte-identical to main. Private routes terminate before the legacy JSON
 * parser/public CORS middleware; unmatched requests use the unchanged gateway.
 * No key, credential discovery, listener, worker or activation is added here. */
export function createWorkspaceGateway(options: { workspace?: WorkspaceApiOptions } = {}) {
  const app = express();
  registerWorkspaceRoutes(app, options.workspace);
  app.use(createLegacyGateway());
  return app;
}
