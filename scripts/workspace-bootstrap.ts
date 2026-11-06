import express from 'express';
import path from 'node:path';
import { createWorkspaceRuntime, runWorkspaceWorker, type WorkspaceRuntimeConfig } from '../uid-workspace-runtime.ts';
import { createWorkspaceGateway } from '../uid-workspace-gateway.ts';

/** Production composition entry for an already-reviewed dependency module.
 * No dynamic credential loader, config module discovery, migrations or auto-worker.
 * This factory mounts the real existing gateway + workspace, preserving MCP. */
export async function createWorkspaceWebApplication(config: WorkspaceRuntimeConfig = {}, options: { staticDirectory?: string } = {}) {
  const runtime = createWorkspaceRuntime(config);
  const app = createWorkspaceGateway({ workspace: runtime.apiOptions });
  if (options.staticDirectory) {
    if (!path.isAbsolute(options.staticDirectory)) throw new Error('STATIC_DIRECTORY_MUST_BE_ABSOLUTE');
    const directory = path.resolve(options.staticDirectory);
    app.use(express.static(directory));
    app.get('/workspace*', (_request, response) => response.sendFile(path.join(directory, 'index.html')));
  }
  // The caller owns listen(), TLS/proxy deployment and graceful pool shutdown.
  return { app, runtime };
}

/** Independently supervised worker. It starts only with complete readiness;
 * missing stage/quality adapters are an exact startup blocker, not fake results. */
export async function startWorkspaceWorker(config: WorkspaceRuntimeConfig, signal: AbortSignal, options: { pollMs?: number; onError?: (code: string) => void } = {}) {
  const runtime = createWorkspaceRuntime(config);
  if (!runtime.readiness().ready) throw new Error('WORKSPACE_RUNTIME_NOT_READY');
  await runWorkspaceWorker(runtime, { signal, ...options });
}

// Safe offline inspection only. There is deliberately no CLI option that imports
// arbitrary JS, reads a provider key or enables execution from environment flags.
if (process.argv[1] && ['workspace-bootstrap.ts', 'workspace-bootstrap.cjs'].includes(path.basename(process.argv[1]))) {
  if (process.argv.slice(2).some(value => value !== '--check')) {
    process.stderr.write('Only --check is supported. Use the typed factory with reviewed dependencies.\n'); process.exitCode = 2;
  } else process.stdout.write(JSON.stringify(createWorkspaceRuntime().readiness(), null, 2) + '\n');
}
