import { createWorkspaceOnepageAdapters, type WorkspaceOnepageOptions } from './uid-workspace-onepage.ts';
import { WorkspacePublicSourceProvider, type WorkspacePublicSourceConfig } from './uid-workspace-providers.ts';
import { createWorkspaceResearchAdapter, type WorkspaceResearchConfig } from './uid-workspace-research.ts';
import { createWorkspaceProviderRuntime, type WorkspaceProviderRuntimeConfig } from './uid-workspace-provider-runtime.ts';
import { createWorkspaceQualityRegistry } from './uid-workspace-quality-registry.ts';
import { createWorkspaceOnepageQualityProvider, createWorkspaceQualityRenderResolver, type WorkspaceQualityOptions } from './uid-workspace-quality.ts';
import { createWorkspaceOnepageImageAssets, type WorkspaceImageAssetsOptions } from './uid-workspace-image-assets.ts';
import { createWorkspaceBrowserRenderer, type WorkspaceRendererOptions } from './uid-workspace-renderer.ts';
import type { WorkspacePrivateObjectStore } from './uid-workspace-artifacts.ts';
import type { WorkspaceRuntimePipeline, WorkspaceRuntimeServices } from './uid-workspace-runtime.ts';
import { createWorkspaceInventoryAdapter, type WorkspaceInventoryOptions } from './uid-workspace-inventory.ts';

/** Production composition, NEVER an activation script. Every optional external
 * capability remains explicit; no credentials, grant provisioning, installed
 * browser, source identity, cost ceiling or quality result is inferred. */
export type WorkspaceOnepageProductionOptions = {
  objects: WorkspacePrivateObjectStore;
  providers: WorkspaceProviderRuntimeConfig;
  sources: Omit<WorkspacePublicSourceConfig, 'objects' | 'writeRunArtifact'>;
  research: Pick<WorkspaceResearchConfig, 'budgets' | 'discover' | 'inspectInventory' | 'timeoutMs' | 'reopenTimeoutMs'>;
  inventory?: Omit<WorkspaceInventoryOptions, 'objects' | 'writeRunArtifact' | 'sources' | 'authorize'>;
  resolveCanonical: NonNullable<WorkspaceOnepageOptions['resolveCanonical']>;
  renderer: WorkspaceRendererOptions;
  review: Pick<WorkspaceQualityOptions, 'authorizeReviewer' | 'reopenInventoryEvidence' | 'budgetCapMicrousd' | 'maxOutputTokens' | 'now'> & { reviewer_id: string; model: string };
  images: Pick<WorkspaceImageAssetsOptions, 'budgetCapMicrousd' | 'quality' | 'sizingStrategies' | 'maxSourceBytes'>;
  content: { budgetCapMicrousd: number; maxOutputTokens?: number };
};
export function createWorkspaceOnepageProductionPipeline(services: WorkspaceRuntimeServices, options: WorkspaceOnepageProductionOptions): WorkspaceRuntimePipeline {
  const providers = createWorkspaceProviderRuntime(services, options.providers);
  const sources = new WorkspacePublicSourceProvider({ ...options.sources, objects: options.objects, writeRunArtifact: services.writeRunArtifact });
  if (options.inventory && (options.research.inspectInventory || options.review.reopenInventoryEvidence)) throw new Error('AMBIGUOUS_INVENTORY_CONFIGURATION');
  const inventory = options.inventory ? createWorkspaceInventoryAdapter({ ...options.inventory, objects: options.objects, sources, writeRunArtifact: services.writeRunArtifact, authorize: options.sources.authorize }) : undefined;
  const research = createWorkspaceResearchAdapter({ ...options.research, inspectInventory: inventory?.inspectInventory ?? options.research.inspectInventory,
    timeoutMs: options.research.timeoutMs ?? 15 * 60_000, objects: options.objects, sources, writeRunArtifact: services.writeRunArtifact, operations: providers.research });
  const registry = createWorkspaceQualityRegistry(services.store, { now: options.review.now });
  const quality = createWorkspaceOnepageQualityProvider({ ...options.review, ...registry, objects: options.objects, operations: services.operations, writeRunArtifact: services.writeRunArtifact,
    reopenInventoryEvidence: inventory?.reopenInventoryEvidence ?? options.review.reopenInventoryEvidence,
    reopenResearchEvidence: research.reopenResearchEvidence,
    resolveRenderEvidence: createWorkspaceQualityRenderResolver(services, options.renderer),
    reviewer: { reviewer_id: options.review.reviewer_id, model: options.review.model, submit: providers.submitVision } });
  const images = createWorkspaceOnepageImageAssets({ ...options.images, objects: options.objects, operations: services.operations, writeRunArtifact: services.writeRunArtifact,
    reopenResearchEvidence: research.reopenResearchEvidence, submit: providers.submitImage });
  const renderer = createWorkspaceBrowserRenderer(services, options.renderer);
  const onepage = createWorkspaceOnepageAdapters(services, { resolveCanonical: options.resolveCanonical, acquireResearch: research.acquireResearch, quality,
    generateAssets: images.generateAssets, renderMapping: renderer.renderMapping, contentBudgetCapMicrousd: options.content.budgetCapMicrousd, contentMaxOutputTokens: options.content.maxOutputTokens });
  function readiness() {
    const blockers = [...onepage.readiness().blockers, ...research.readiness().blockers, ...providers.readiness().blockers, ...renderer.readiness().blockers, ...(inventory?.readiness().blockers ?? [])];
    if (!options.objects.productionReady || options.objects.loopbackOnly || !sources.productionReady) blockers.push({ code: 'PRODUCTION_PRIVATE_SOURCE_CUSTODY_REQUIRED', message: 'Reviewed production private object custody and public source acquisition are required.' });
    if (!inventory && typeof options.review.reopenInventoryEvidence !== 'function') blockers.push({ code: 'INVENTORY_EVIDENCE_REOPENER_REQUIRED', message: 'Source gallery and variant enumeration must be backed by reopenable browser/platform evidence.' });
    if (!options.providers.vision?.capability.structured_outputs) blockers.push({ code: 'REVIEW_STRUCTURED_OUTPUT_CAPABILITY_REQUIRED', message: 'The independent reviewer requires verified strict structured output support.' });
    if (options.providers.vision?.capability.model !== options.review.model) blockers.push({ code: 'REVIEW_MODEL_BINDING_REQUIRED', message: 'The reviewer identity must use the exact verified vision model.' });
    if (!options.images.sizingStrategies.length) blockers.push({ code: 'CANONICAL_IMAGE_FITTING_REVIEW_REQUIRED', message: 'Pinned canonical slot and icon sizing must have reviewed, uncropped provider fitting strategies.' });
    const unique = [...new Map(blockers.map(blocker => [blocker.code, blocker])).values()];
    return { ready: unique.length === 0, blockers: unique };
  }
  // Named sequential operations can legitimately outlive the generic one-minute
  // stage default. These are bounded failure deadlines, not latency promises or
  // permission to spend. Every provider still has a shorter request timeout/cap.
  const timing = (timeoutMs: number) => ({ timeoutMs, leaseMs: timeoutMs + 30_000 });
  return { adapters: onepage.adapters, renderPreview: onepage.renderPreview, readiness, stageTiming: {
    research: timing((options.research.timeoutMs ?? 15 * 60_000) + 3 * 60_000), content_authoring: timing(3 * 60_000), content_feedback: timing(3 * 60_000),
    assets: timing(45 * 60_000), asset_feedback: timing(45 * 60_000), assets_reuse: timing(3 * 60_000), review: timing(3 * 60_000), packaging: timing(3 * 60_000),
  } };
}
