import { createHash } from 'node:crypto';
import { createWorkspaceVisionTransport, WORKSPACE_VISION_ENDPOINT, type WorkspaceVisionOptions, type WorkspaceVisionRequest } from './uid-workspace-vision.ts';
import { createWorkspaceImageTransport, WORKSPACE_IMAGE_GENERATE_ENDPOINT, WORKSPACE_IMAGE_EDIT_ENDPOINT, type WorkspaceImageOptions, type WorkspaceImageRequest } from './uid-workspace-image.ts';
import { workspaceObjectKey, type WorkspaceObjectIdentity } from './uid-workspace-artifacts.ts';
import type { WorkspaceRuntimeServices } from './uid-workspace-runtime.ts';
import type { WorkspaceStageContext } from './uid-workspace-runner.ts';
import type { WorkspaceResearchOperations, WorkspaceResearchOperationRequest } from './uid-workspace-research.ts';
import { stableJson } from './supabase/functions/_shared/creative-quality.ts';
import { workspaceSourceScope } from './uid-workspace-providers.ts';

/** Exact typed composition; imports do not load keys or issue provider requests.
 * Only the runtime-created providerBudget may reserve modalities: it shares the
 * very same SQL pool, project row and table as the legacy text budget. */
export type WorkspaceProviderRuntimeConfig = {
  vision?: Pick<WorkspaceVisionOptions, 'serverCredential' | 'capability' | 'fetch' | 'objects' | 'limits' | 'now'>;
  image?: Pick<WorkspaceImageOptions, 'serverCredential' | 'capability' | 'fetch' | 'decodeImage' | 'limits' | 'now'>;
};
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function fail(code: string): never { throw new Error(code); }
export function createWorkspaceProviderRuntime(services: WorkspaceRuntimeServices, supplied: WorkspaceProviderRuntimeConfig = {}) {
  const config = { vision: supplied.vision ? { ...supplied.vision, serverCredential: { ...supplied.vision.serverCredential }, capability: structuredClone(supplied.vision.capability) } : undefined,
    image: supplied.image ? { ...supplied.image, serverCredential: { ...supplied.image.serverCredential }, capability: structuredClone(supplied.image.capability) } : undefined };
  if (config.vision && config.image && config.vision.serverCredential.project_id !== config.image.serverCredential.project_id) fail('SHARED_PROVIDER_PROJECT_REQUIRED');
  function child(c: WorkspaceStageContext, operation: string) {
    if (!c.provider_operation || c.provider_operation.operation_id !== operation || !c.bindProviderOperation || c.owner_id !== c.record.owner_id || c.signal.aborted) fail('PROVIDER_CHILD_CONTEXT_REQUIRED');
  }
  async function knownRaster(c: WorkspaceStageContext, object: WorkspaceObjectIdentity) {
    if (object.owner_id !== c.owner_id || object.task_id !== c.record.task.task_id || object.storage_key !== workspaceObjectKey(c.owner_id, c.record.task.task_id, object.sha256)) return false;
    return services.store.read(c.owner_id, state => {
      const record = state.tasks.find(r => r.task.task_id === c.record.task.task_id && r.owner_id === c.owner_id);
      if (!record || record.task.snapshot.snapshot_id !== c.record.task.snapshot.snapshot_id || record.task.state_version !== c.record.task.state_version) return false;
      const exact = (v: { storage_key: string; sha256: string; size_bytes: number; media_type: string }) => v.storage_key === object.storage_key && v.sha256 === object.sha256 && v.size_bytes === object.size_bytes && v.media_type === object.media_type;
      return record.artifacts.some(v => v.verification === 'verified' && exact(v))
        || (record.references ?? []).some(v => !v.removed_at && exact(v))
        || (record.runs ?? []).some(r => r.artifact_intents?.some(v => v.status === 'verified' && v.owner_id === c.owner_id && v.task_id === c.record.task.task_id && exact(v)));
    });
  }
  async function submitVision(c: WorkspaceStageContext, request: WorkspaceVisionRequest) {
    request = { ...structuredClone({ ...request, signal: undefined }), signal: c.signal };
    child(c, request.operation_id); const option = config.vision, budget = services.providerBudget;
    if (!option || !budget) fail('VISION_RUNTIME_NOT_CONFIGURED');
    const authorization = await budget.authorizationFor(option.serverCredential.project_id, c.owner_id, c.record.task.task_id,
      { modality: 'responses_vision', endpoint: WORKSPACE_VISION_ENDPOINT, model: option.capability.model, capability_verification_ref: option.capability.verification_ref });
    if (!authorization) fail('VISION_TASK_AUTHORIZATION_REQUIRED');
    const transport = createWorkspaceVisionTransport({ ...option, authorization, budget,
      authorizeRaster: (_authorization, object) => knownRaster(c, object),
      bindReservation: binding => c.bindProviderOperation!({ provider: 'openai-responses-vision', ...binding }),
      guardDispatch: () => services.operations.guardDispatch(c) });
    return transport.submit({ ...request, signal: c.signal });
  }
  async function submitImage(c: WorkspaceStageContext, request: WorkspaceImageRequest) {
    request = { ...structuredClone({ ...request, signal: undefined }), signal: c.signal };
    child(c, request.operation_id); const option = config.image, budget = services.providerBudget;
    if (!option || !budget) fail('IMAGE_RUNTIME_NOT_CONFIGURED');
    for (const image of request.source_images) if (!await knownRaster(c, { owner_id: c.owner_id, task_id: c.record.task.task_id, storage_key: workspaceObjectKey(c.owner_id, c.record.task.task_id, image.sha256),
      sha256: image.sha256, size_bytes: image.bytes.byteLength, media_type: image.mime_type })) fail('IMAGE_SOURCE_NOT_AUTHORIZED');
    const endpoint = request.operation === 'edit' ? WORKSPACE_IMAGE_EDIT_ENDPOINT : WORKSPACE_IMAGE_GENERATE_ENDPOINT;
    const authorization = await budget.authorizationFor(option.serverCredential.project_id, c.owner_id, c.record.task.task_id,
      { modality: 'images', endpoint, model: option.capability.model, capability_verification_ref: option.capability.verification_ref });
    if (!authorization) fail('IMAGE_TASK_AUTHORIZATION_REQUIRED');
    const transport = createWorkspaceImageTransport({ ...option, authorization, budget,
      bindReservation: binding => c.bindProviderOperation!({ provider: 'openai-images', ...binding }),
      guardDispatch: () => services.operations.guardDispatch(c) });
    return transport.submit({ ...request, signal: c.signal });
  }
  const research: WorkspaceResearchOperations = { async verify(c, receipt, request) {
    if (receipt.operation_id !== request.operation_id || receipt.request_sha256 !== request.request_sha256 || c.owner_id !== c.record.owner_id) return false;
    return services.store.read(c.owner_id, state => {
      const record = state.tasks.find(r => r.owner_id === c.owner_id && r.task.task_id === c.record.task.task_id);
      const child = record?.runs?.flatMap(r => r.child_operations ?? []).find(op => op.operation_id === receipt.provider_operation_id);
      return !!child && child.status === 'completed' && child.intent.role === 'research' && child.intent.key === receipt.operation_id
        && child.intent.input_sha256 === receipt.request_sha256 && child.report?.accounting === 'settled' && child.report.outcome === 'completed'
        && child.report.provider_operation_id === receipt.response_id && child.report.budget_receipt_id === receipt.budget_receipt_id && child.report.output_sha256 === receipt.output_sha256;
    });
  }, async execute(c, request) {
    const raw = structuredClone(request); const vision = raw.images.length > 0;
    const provider = vision ? 'openai-responses-vision' : 'openai-responses', model = vision ? config.vision?.capability.model : 'gpt-6.1-sol';
    if (!model) fail('RESEARCH_VISION_RUNTIME_NOT_CONFIGURED');
    const metadata = { ...raw, images: raw.images.map(({ bytes: _, ...image }) => image) }; delete (metadata as Partial<WorkspaceResearchOperationRequest>).request_sha256;
    if (sha(stableJson(metadata)) !== raw.request_sha256 || stableJson(raw.scope) !== stableJson(workspaceSourceScope(c))) fail('RESEARCH_REQUEST_BINDING_MISMATCH');
    for (const image of raw.images) if (sha(image.bytes) !== image.sha256) fail('RESEARCH_IMAGE_HASH_MISMATCH');
    const childResult = await services.operations.execute(c, { key: raw.operation_id, role: 'research', provider, model, input_sha256: raw.request_sha256 }, async childContext => {
      const input = stableJson({ output_schema: raw.output_schema, untrusted_input: raw.untrusted_input, scope: raw.scope, canonical_packet_sha256: raw.packet_sha256,
        images: raw.images.map(({ bytes: _, ...image }) => image) });
      const common = { operation_id: childContext.provider_operation!.operation_id, instructions: raw.instructions, input,
        reasoning_effort: raw.reasoning_effort, max_output_tokens: raw.max_output_tokens, budget_cap_microusd: raw.budget_cap_microusd, signal: c.signal };
      const result = vision ? await submitVision(childContext, { ...common, images: raw.images.map(image => ({ ref: image.evidence_ref, detail: 'high' as const,
        object: { owner_id: c.owner_id, task_id: c.record.task.task_id, storage_key: workspaceObjectKey(c.owner_id, c.record.task.task_id, image.sha256), sha256: image.sha256, size_bytes: image.bytes.length, media_type: image.media_type } })) })
        : await services.submitText(childContext, { ...common, expect_json_object: true });
      return { value: result, report: { outcome: result.outcome, accounting: result.accounting, request_sha256: result.request_sha256, reservation_id: result.reservation_id,
        budget_receipt_id: result.budget_receipt_id, provider_operation_id: result.response_id, response_model: result.response_model, output_sha256: result.output ? sha(result.output.text) : undefined, evidence_refs: result.budget_receipt_id ? [result.budget_receipt_id] : [] } };
    });
    if (childResult.status !== 'completed') fail(childResult.status === 'unknown' ? 'RESEARCH_ACCOUNTING_RECONCILIATION_REQUIRED' : 'RESEARCH_OPERATION_BLOCKED');
    const result = childResult.value;
    if (!result.output || !result.response_id || !result.budget_receipt_id || result.accounting !== 'settled' || result.reconciliation_required) fail('RESEARCH_PROVIDER_RESULT_UNVERIFIED');
    return { output_json: result.output.text, receipt: { operation_id: raw.operation_id, provider_operation_id: childResult.operation_id, request_sha256: raw.request_sha256,
      response_id: result.response_id, budget_receipt_id: result.budget_receipt_id, accounting: 'settled', output_sha256: sha(result.output.text) } };
  } };
  function readiness() {
    const blockers: Array<{ code: string; message: string }> = [];
    if (!services.providerBudget) blockers.push({ code: 'MULTIMODAL_BUDGET_NOT_CONFIGURED', message: 'Image and vision accounting must share the project budget journal.' });
    else for (const code of services.providerBudget.readiness().blockers) blockers.push({ code, message: 'Current verified multimodal pricing and independent exact-request bounds are required.' });
    for (const type of ['vision', 'image'] as const) {
      const option = config[type], now = option?.now?.() ?? Date.now();
      if (!option || option.capability.verified !== true || typeof option.fetch !== 'function' || option.serverCredential.project_id !== option.capability.project_id
        || typeof option.serverCredential.api_key !== 'string' || !/^[\x21-\x7e]{16,512}$/.test(option.serverCredential.api_key)
        || !Number.isFinite(Date.parse(option.capability.checked_at)) || !Number.isFinite(Date.parse(option.capability.expires_at))
        || Date.parse(option.capability.checked_at) > now || Date.parse(option.capability.expires_at) <= now) blockers.push({ code: type.toUpperCase() + '_CAPABILITY_NOT_CONFIGURED', message: 'A current verified ' + type + ' capability and server transport are required.' });
    }
    return { ready: !blockers.length, blockers };
  }
  return { submitVision, submitImage, research, readiness };
}
