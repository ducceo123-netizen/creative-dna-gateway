/** Lossless pinned canonical packets. No network, credentials, or canonical writes. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Packet = Record<string, any>;
export type ContextStage = 'init' | 'research' | 'references' | 'content' | 'allocation' | 'materials' | 'qc' | 'mapping' | 'review' | 'packaging';
export type TemplateMode = 'gtk' | 'faq';
export interface SnapshotProvenance {
  sourceUrl: string;
  observedAt: string;
  baselineCommit: string;
  sourceRevision?: string;
  visibility: 'public' | 'private' | 'synthetic';
  [key: string]: unknown;
}
export interface RuleRecord {
  id: string;
  paths: string[];
  hash: string;
  text: string;
  raw: Json;
  authority: string;
  provenance: Json;
  appliesTo: Json;
  supersedes: string[];
  requires: string[];
  /** Conservative initial classification: every canonical rule is visible in every bundle. */
  stages: ['*'];
}
export interface RuleConflict { code: string; paths: string[]; ruleIds: string[]; detail: string; stages: ContextStage[] }
export interface CanonicalSnapshot {
  schemaVersion: 'uid-brands-v2.snapshot/1';
  hash: string;
  packet: Packet;
  provenance: SnapshotProvenance;
  registry: RuleRecord[];
  conflicts: RuleConflict[];
}
export interface CoverageReceipt {
  snapshotHash: string;
  stage: ContextStage;
  templateMode: TemplateMode | null;
  requiredRuleIds: string[];
  ruleHashes: Record<string, string>;
  bundleHash: string;
}

export const OBSERVED_EXECUTION = [
  'VALIDATE_QUALITY_CONTRACT', 'READ_OWNER_SUPPLEMENTS_WITH_CANONICAL_PRECEDENCE',
  'READ_AGENT_REVIEWED_SUPPLEMENTS_WITH_PINNED_EVIDENCE_SCOPE', 'ACQUIRE_SOURCE',
  'BUILD_VERIFIED_PRODUCT_POOL', 'CHECK_DIVERSITY_GATE', 'INSPECT_DESCRIPTIONS_AND_REVIEW_COVERAGE',
  'RESEARCH_MARKETPLACE_COMPETITOR_SUPPLIER', 'RESEARCH_PINTEREST_PRODUCT_THEME_MARKET_REFERENCES',
  'RESEARCH_REDDIT_CUSTOMER_CONTEXT_AND_COUNTEREVIDENCE', 'ANALYZE_BUYER_CONCERNS_AND_SCOPED_CLAIMS',
  'VALIDATE_RESEARCH_BEFORE_CONTENT', 'CLIPO_REFERENCE_DISCOVERY', 'HUMAN_REALISM_REFERENCE_DISCOVERY',
  'SELECT_INCREMENTAL_CUSTOMER_VALUE', 'VALIDATE_ONEPAGE_CONTENT_PLAN', 'BUILD_CONTENT_MAP',
  'BUILD_ASSET_MANIFEST', 'ALLOCATE_PRODUCTS_VARIANTS_CAST_TO_ASSETS', 'GENERATE_SLOT_BY_SLOT',
  'INSPECT_PRODUCT_AND_EXPLICITLY_REQUIRED_EVIDENCE_PIXELS', 'QA_EACH_SLOT', 'BUILD_UI_MAPPING_PREVIEW',
] as const;

const stepStages: Record<string, ContextStage> = {
  ...Object.fromEntries(OBSERVED_EXECUTION.slice(0, 3).map(step => [step, 'init'])),
  ...Object.fromEntries(OBSERVED_EXECUTION.slice(3, 12).map(step => [step, 'research'])),
  CLIPO_REFERENCE_DISCOVERY: 'references', HUMAN_REALISM_REFERENCE_DISCOVERY: 'references',
  SELECT_INCREMENTAL_CUSTOMER_VALUE: 'content', VALIDATE_ONEPAGE_CONTENT_PLAN: 'content', BUILD_CONTENT_MAP: 'content',
  BUILD_ASSET_MANIFEST: 'allocation', ALLOCATE_PRODUCTS_VARIANTS_CAST_TO_ASSETS: 'allocation',
  GENERATE_SLOT_BY_SLOT: 'materials', INSPECT_PRODUCT_AND_EXPLICITLY_REQUIRED_EVIDENCE_PIXELS: 'qc',
  QA_EACH_SLOT: 'qc', BUILD_UI_MAPPING_PREVIEW: 'mapping',
};
const groupAliases: Record<string, ContextStage> = {
  INIT: 'init', SOURCE_RESEARCH: 'research', RESEARCH_VALIDATED: 'research', REFERENCE_DISCOVERY: 'references',
  CONTENT_PLAN: 'content', CONTENT_VALIDATED: 'content', ALLOCATION: 'allocation', MATERIALS: 'materials',
  SLOT_QC: 'qc', OVERALL_RENDER: 'mapping', OVERALL_QC: 'qc', REVIEW: 'review', PACKAGE: 'packaging', COMPLETE: 'packaging',
};
const stages: ContextStage[] = ['init', 'research', 'references', 'content', 'allocation', 'materials', 'qc', 'mapping', 'review', 'packaging'];
export function contextStage(stage: string): ContextStage {
  const result = stepStages[stage] || groupAliases[stage] || (stages.includes(stage as ContextStage) ? stage as ContextStage : undefined);
  if (!result) throw new Error('UNKNOWN_CONTEXT_STAGE');
  return result;
}

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > 64) throw new Error('JSON_DEPTH_LIMIT');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) assertSafeJson(item, depth + 1); return; }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error('UNSAFE_JSON_KEY');
      assertSafeJson(item, depth + 1);
    }
    return;
  }
  throw new Error('NON_JSON_VALUE');
}
export function canonicalJson(value: unknown): string {
  assertSafeJson(value);
  const write = (v: Json): string => Array.isArray(v) ? '[' + v.map(write).join(',') + ']'
    : v !== null && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + write(v[k])).join(',') + '}'
      : JSON.stringify(v);
  return write(value as Json);
}
export const contentHash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const pointerPart = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
function parts(pointer: string): string[] {
  if (typeof pointer !== 'string' || pointer.length > 2048 || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) throw new Error('INVALID_CONTEXT_PATH');
  const keys = pointer.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (keys.some(k => !k || forbiddenKeys.has(k))) throw new Error('UNSAFE_CONTEXT_PATH');
  return keys;
}
function at(root: any, pointer: string): any {
  let current = root;
  for (const key of parts(pointer)) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key)) throw new Error('CONTEXT_PATH_NOT_FOUND');
    current = current[key];
  }
  return current;
}
function has(root: any, pointer: string) { try { at(root, pointer); return true; } catch { return false; } }
function remove(root: any, pointer: string) {
  const keys = parts(pointer), leaf = keys.pop()!;
  let parent = root;
  for (const key of keys) parent = parent[key];
  delete parent[leaf];
}
function set(root: any, pointer: string, value: any) {
  const keys = parts(pointer), leaf = keys.pop()!;
  let parent = root;
  for (const key of keys) {
    if (!Object.hasOwn(parent, key) || !parent[key] || typeof parent[key] !== 'object') throw new Error('INVALID_ALIAS_PARENT');
    parent = parent[key];
  }
  if (Object.hasOwn(parent, leaf)) throw new Error('ALIAS_ALREADY_PRESENT');
  parent[leaf] = structuredClone(value);
}

/** Reviewed from Lean 8367c7c; equality, never similar naming, permits deduplication. */
export const ALIAS_PAIRS = [
  ['/ui_mapping_template', '/ui_mapping_templates/gtk'],
  ['/owner_supplemental_contract/rules', '/creative_quality_contract/owner_supplemental_rules'],
  ['/agent_rule_reviewed_supplemental_contract/rules', '/creative_quality_contract/agent_rule_reviewed_supplemental_rules'],
  ['/agent_reviewed_supplemental_contract/rules', '/creative_quality_contract/agent_reviewed_supplemental_rules'],
  ['/ui_mapping_templates/faq/production_qc_contract', '/ui_mapping_templates/gtk/production_qc_contract'],
  ['/ui_mapping_templates/faq/portable_quality_playbook', '/ui_mapping_templates/gtk/portable_quality_playbook'],
  ['/ui_mapping_templates/faq/live_html_feedback', '/ui_mapping_templates/gtk/live_html_feedback'],
] as const;
export function compactPacket(packet: Packet) {
  assertSafeJson(packet);
  const data = structuredClone(packet), aliases: Record<string, string> = {};
  for (const [destination, source] of ALIAS_PAIRS) {
    if (has(data, destination) && has(data, source) && isDeepStrictEqual(at(data, destination), at(data, source))) {
      remove(data, destination); aliases[destination] = source;
    }
  }
  return { data, aliases };
}
export function restorePacket(compact: ReturnType<typeof compactPacket>): Packet {
  assertSafeJson(compact);
  const data = structuredClone(compact.data);
  for (const [destination, source] of Object.entries(compact.aliases).reverse()) {
    if (!ALIAS_PAIRS.some(([a, b]) => a === destination && b === source)) throw new Error('UNKNOWN_ALIAS');
    set(data, destination, at(data, source));
  }
  return data;
}

const ruleArrays = [
  ['rules', 'ACTIVE_CANONICAL_CATALOG'], ['owner_supplemental_rules', 'OWNER_APPROVED_VERBATIM_SUPPLEMENT'],
  ['agent_reviewed_supplemental_rules', 'OWNER_APPROVED_AGENT_REVIEWED_VERBATIM_SUPPLEMENT'],
  ['agent_rule_reviewed_supplemental_rules', 'DELEGATED_RULE_REVIEW_VERBATIM_SUPPLEMENT'],
] as const;
function buildRegistry(packet: Packet): { registry: RuleRecord[]; conflicts: RuleConflict[] } {
  const registry: RuleRecord[] = [], conflicts: RuleConflict[] = [];
  const quality = packet.creative_quality_contract || {};
  const containers:Array<{rules:any;path:string;authority:string}> = ruleArrays.map(([key,authority])=>({rules:quality[key],path:'/creative_quality_contract/'+key,authority}));
  for(const [top,authority] of [
    ['owner_supplemental_contract','OWNER_APPROVED_VERBATIM_SUPPLEMENT'],
    ['agent_reviewed_supplemental_contract','OWNER_APPROVED_AGENT_REVIEWED_VERBATIM_SUPPLEMENT'],
    ['agent_rule_reviewed_supplemental_contract','DELEGATED_RULE_REVIEW_VERBATIM_SUPPLEMENT'],
  ])if(packet[top]?.rules!==undefined)containers.push({rules:packet[top].rules,path:'/'+top+'/rules',authority});
  for (const {rules,path:arrayPath,authority} of containers) {
    if (rules === undefined) continue;
    if (!Array.isArray(rules)) { conflicts.push({code:'RULE_ARRAY_INVALID',paths:[arrayPath],ruleIds:[],detail:'Canonical rule array has an unsupported shape.',stages}); continue; }
    rules.forEach((raw: any, index: number) => {
      const path = arrayPath + '/' + index;
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id || raw.id.length>200 || !(typeof raw.instruction === 'string' || typeof raw.canonical_text === 'string')) {
        conflicts.push({code:'RULE_SHAPE_UNCLASSIFIED',paths:[path],ruleIds:[],detail:'Unknown rule shape retained; explicit classification required.',stages}); return;
      }
      for(const key of ['requires','supersedes'])if(raw[key]!==undefined&&(!Array.isArray(raw[key])||!raw[key].every((v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=200)))
        conflicts.push({code:'RULE_DEPENDENCY_SHAPE_INVALID',paths:[path+'/'+key],ruleIds:[raw.id],detail:'Rule relationship is not a list of stable rule IDs.',stages});
      const existing = registry.find(r => r.id === raw.id);
      if (existing) {
        if (isDeepStrictEqual(existing.raw, raw)) existing.paths.push(path);
        else conflicts.push({code:'CONFLICTING_RULE_ID',paths:[...existing.paths,path],ruleIds:[raw.id],detail:'Same ID has unequal canonical content or provenance.',stages});
        return;
      }
      registry.push({id:raw.id,paths:[path],hash:contentHash(raw),text:raw.canonical_text ?? raw.instruction,raw:structuredClone(raw),
        authority:raw.precedence || authority,provenance:structuredClone(raw.sources ?? raw.source ?? null),
        appliesTo:structuredClone(raw.scope ?? null),supersedes:Array.isArray(raw.supersedes)?raw.supersedes:[],
        requires:Array.isArray(raw.requires)?raw.requires:[],stages:['*']});
    });
  }
  for (const r of registry) for (const dependency of r.requires) if (!registry.some(p => p.id === dependency))
    conflicts.push({code:'RULE_DEPENDENCY_MISSING',paths:r.paths,ruleIds:[r.id,dependency],detail:'Explicit required rule is absent.',stages});
  const visiting = new Set<string>(), visited = new Set<string>();
  const cycle = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (registry.find(r => r.id === id)?.requires.some(cycle)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (registry.some(r => cycle(r.id))) conflicts.push({code:'RULE_DEPENDENCY_CYCLE',paths:[],ruleIds:[...visiting],detail:'Rule dependency closure is cyclic.',stages});
  if (quality.status !== 'COMPILED') conflicts.push({code:'CANONICAL_POLICY_BLOCKED',paths:['/creative_quality_contract'],ruleIds:[],detail:'Canonical compiler did not report COMPILED.',stages});
  for (const error of Array.isArray(quality.errors) ? quality.errors : []) conflicts.push({code:String(error),paths:['/creative_quality_contract/errors'],ruleIds:[],detail:'Pinned upstream compiler error.',stages});
  if (packet.template_policy_compatibility?.status?.startsWith('BLOCKED')) conflicts.push({code:'TEMPLATE_POLICY_CONFLICT',paths:['/template_policy_compatibility'],ruleIds:[],detail:'Pinned template policy is incompatible.',stages:['mapping','review','packaging']});
  const modes: Array<{path:string;mode:string}> = [];
  const walk = (value:any,path:string) => {
    if (!value || typeof value !== 'object') return;
    for (const [key,v] of Object.entries(value)) {
      const next=path+'/'+pointerPart(key);
      if (key==='generation_mode' && typeof v==='string' && /banner/i.test(path)) modes.push({path:next,mode:v});
      walk(v,next);
    }
  };
  walk(packet,'');
  if (modes.some(v=>v.mode==='single_pass_integrated_final_banner') && modes.some(v=>/scene.first|typography.second|two.step|separate/i.test(v.mode)))
    conflicts.push({code:'BANNER_WORKFLOW_CONFLICT',paths:modes.map(v=>v.path),ruleIds:[],detail:'Pinned banner workflow modes disagree; preserve text and obtain owner resolution.',stages:['materials','qc','mapping','review','packaging']});
  return {registry,conflicts};
}
export function createSnapshot(packet: Packet, provenance: SnapshotProvenance): CanonicalSnapshot {
  assertSafeJson(packet); assertSafeJson(provenance);
  if (Buffer.byteLength(JSON.stringify(packet)) > 4_000_000) throw new Error('CANONICAL_PACKET_TOO_LARGE');
  if (!Array.isArray(packet.execution) || !packet.execution.length || packet.execution.some((s: unknown)=>typeof s!=='string')
      || new Set(packet.execution).size!==packet.execution.length || !Array.isArray(packet.assets) || !packet.hard_gates || !packet.resolved)
    throw new Error('CANONICAL_PACKET_SHAPE_INVALID');
  if (!Number.isFinite(Date.parse(provenance.observedAt)) || !/^[a-f0-9]{40}$/.test(provenance.baselineCommit)) throw new Error('SNAPSHOT_PROVENANCE_INVALID');
  const cloned = structuredClone(packet);
  const {registry,conflicts}=buildRegistry(cloned);
  const unknownSteps=packet.execution.filter((s:string)=>!Object.hasOwn(stepStages,s));
  if(unknownSteps.length)conflicts.push({code:'UNCLASSIFIED_EXECUTION_STEPS',paths:['/execution'],ruleIds:[],detail:unknownSteps.join(', '),stages});
  const snapshot:CanonicalSnapshot={schemaVersion:'uid-brands-v2.snapshot/1',hash:contentHash(cloned),packet:cloned,provenance:structuredClone(provenance),registry,conflicts};
  return snapshot;
}
export function verifySnapshot(snapshot: CanonicalSnapshot) {
  if(snapshot.schemaVersion!=='uid-brands-v2.snapshot/1'||contentHash(snapshot.packet)!==snapshot.hash)throw new Error('SNAPSHOT_HASH_MISMATCH');
  const rebuilt=createSnapshot(snapshot.packet,snapshot.provenance);
  if(!isDeepStrictEqual(rebuilt.registry,snapshot.registry))throw new Error('SNAPSHOT_REGISTRY_MISMATCH');
  if(!isDeepStrictEqual(rebuilt.conflicts,snapshot.conflicts))throw new Error('SNAPSHOT_CONFLICT_MISMATCH');
}
export function fullContext(snapshot: CanonicalSnapshot): Packet { verifySnapshot(snapshot); return structuredClone(snapshot.packet); }
export function readContextPath(snapshot: CanonicalSnapshot, pointer: string): Json {
  verifySnapshot(snapshot);
  if (pointer.startsWith('rule:')) {
    const record=snapshot.registry.find(r=>r.id===pointer.slice(5));
    if(!record)throw new Error('RULE_NOT_FOUND');
    return structuredClone(record.raw);
  }
  return structuredClone(at(snapshot.packet,pointer));
}

const globalFields = [
  'api_version','mode','compiler_version','resolved','dynamic_job','hard_gates','execution','instruction',
  'creative_quality_contract','owner_supplemental_contract','agent_rule_reviewed_supplemental_contract',
  'agent_reviewed_supplemental_contract','portable_quality_playbook','quality_execution_guard','readiness',
  'brand_expression','context_policy','rule_index_note','named_product_scope','template_policy_compatibility',
  'content_to_materials_contract','post_story_section',
];
const stageFields: Record<ContextStage,string[]> = {
  init:['acquisition_contract'],
  research:['acquisition_contract','research_contract','research_validation','pinterest_contract','pinterest_validation','reddit_contract','reddit_validation','insight_value_contract','insight_value_assessment','single_pdp_contract'],
  references:['clipo_reference_discovery','clipo_reference_contract','human_realism_reference_discovery','human_realism_qc','human_realism_execution_contract','eo_reference_intelligence'],
  content:['content_contract','content_plan_contract','content_plan_assessment','product_line_title_contract','insight_value_contract','insight_value_assessment','research_validation','pinterest_validation','reddit_validation'],
  allocation:['assets','acquisition_contract','content_plan_contract','content_plan_assessment','single_pdp_contract','template_asset_bindings','template_binding_note','visual_proof_contract'],
  materials:['assets','main_banner_contract','casting_contract','desktop_support_typography_contract','typography_contract','visual_proof_contract','angle_policy','single_pdp_contract','human_realism_reference_discovery','human_realism_qc','human_realism_execution_contract','clipo_reference_discovery','clipo_reference_contract','eo_reference_intelligence'],
  qc:['assets','main_banner_contract','casting_contract','visual_proof_contract','human_realism_qc','human_realism_execution_contract','eo_reference_intelligence','onepage_preview_contract'],
  mapping:['ui_mapping_templates','template_asset_bindings','template_binding_note','onepage_preview_contract','assets'],
  review:['ui_mapping_templates','onepage_preview_contract','assets','packaging_contract','delivery_contract'],
  packaging:['ui_mapping_templates','packaging_contract','delivery_contract','assets','template_asset_bindings','onepage_preview_contract'],
};
const knownFields = new Set([...globalFields,...Object.values(stageFields).flat(),'ui_mapping_template']);
export function stageContext(snapshot: CanonicalSnapshot, requestedStage: string, options: {templateMode?:TemplateMode} = {}) {
  verifySnapshot(snapshot);
  const stage=contextStage(requestedStage),packet=snapshot.packet;
  const templateNeeded=['mapping','review','packaging'].includes(stage);
  if(templateNeeded&&!options.templateMode)throw new Error('TEMPLATE_DECISION_REQUIRED');
  if(options.templateMode&&!['gtk','faq'].includes(options.templateMode))throw new Error('INVALID_TEMPLATE_MODE');
  const selected=new Set([...globalFields,...stageFields[stage],...Object.keys(packet).filter(k=>!knownFields.has(k))]);
  // The legacy alias may only be deferred when it really is the same GTK template.
  // A changed/unknown legacy payload remains visible until its scope is reviewed.
  if(packet.ui_mapping_template!==undefined&&!isDeepStrictEqual(packet.ui_mapping_template,packet.ui_mapping_templates?.gtk))selected.add('ui_mapping_template');
  // Do not summarize unknown fields. All canonical rules remain verbatim and visible in every stage initially.
  const data:Packet=Object.fromEntries(Object.entries(packet).filter(([k])=>selected.has(k)).map(([k,v])=>[k,structuredClone(v)]));
  if(templateNeeded) {
    const template=packet.ui_mapping_templates?.[options.templateMode!];
    if(!template)throw new Error('SELECTED_TEMPLATE_UNAVAILABLE');
    data.ui_mapping_templates = {[options.templateMode!]:structuredClone(template)};
    // Any future template variants/fields remain visible instead of being silently classified away.
    for(const [key,value] of Object.entries(packet.ui_mapping_templates))if(!['gtk','faq'].includes(key))data.ui_mapping_templates[key]=structuredClone(value);
  }
  // Creative/workflow instructions embedded in template metadata must be visible before content or imagery.
  // Only reviewed layout/transport fields are deferred; unknown template metadata stays universal.
  const templateContextRecords:Array<{paths:string[];value:unknown}>=[];
  if(!templateNeeded) {
    const technicalFields=new Set(['id','version','scope','post_story_section','variants','reference_url','captured_at','urls','sha256','asset_slots','text_slots','canvas_gutter','layout_lock','loading','binding','qa','verification','deterministic_binding','technical_quality_gate']);
    for(const [mode,template] of Object.entries(packet.ui_mapping_templates || {}) as Array<[string,any]>) {
      if(!template)continue;
      if(!['gtk','faq'].includes(mode)) {templateContextRecords.push({paths:['/ui_mapping_templates/'+pointerPart(mode)],value:structuredClone(template)});continue;}
      for(const key of Object.keys(template).filter(k=>!technicalFields.has(k))) {
        const path='/ui_mapping_templates/'+mode+'/'+key;
        const same=templateContextRecords.find(v=>isDeepStrictEqual(v.value,template[key]));
        if(same)same.paths.push(path);else templateContextRecords.push({paths:[path],value:structuredClone(template[key])});
      }
    }
  }
  const compact=compactPacket(data);
  // Every alias source is in this response. No prompt-only unresolved alias is allowed.
  for(const source of Object.values(compact.aliases))if(!has(compact.data,source))throw new Error('BUNDLE_ALIAS_UNRESOLVED');
  const requiredRuleIds=snapshot.registry.map(r=>r.id).sort();
  const ruleHashes=Object.fromEntries(snapshot.registry.map(r=>[r.id,r.hash]));
  const base={schemaVersion:'uid-brands-v2.stage-context/1',snapshotHash:snapshot.hash,canonicalRevision:packet.creative_quality_contract?.revision ?? null,
    stage,templateMode:options.templateMode??null,...compact,templateContextRecords,
    deferredPaths:Object.keys(packet).filter(k=>!selected.has(k)).map(k=>'/'+pointerPart(k)),
    coverage:{requiredRuleIds,ruleHashes,unknownFieldsIncluded:Object.keys(packet).filter(k=>!knownFields.has(k)),ruleCoverage:1},
    conflicts:snapshot.conflicts.filter(c=>c.stages.includes(stage)),
    inspection:'CANONICAL_RULE_COVERAGE_ONLY_NOT_PRODUCT_OR_PIXEL_INSPECTION',
    fallback:'onepage_get_full_context returns this exact pinned compiler packet; no canonical rule or step is waived.'};
  const receipt:CoverageReceipt={snapshotHash:snapshot.hash,stage,templateMode:options.templateMode??null,requiredRuleIds,ruleHashes,bundleHash:contentHash(base)};
  return {...base,receipt};
}
/** Caller must supply a receipt previously persisted by the server for this principal/job. */
export function assertCoverage(snapshot: CanonicalSnapshot, stage: string, issuedReceipt: CoverageReceipt, options: {templateMode?:TemplateMode} = {}) {
  const expected=stageContext(snapshot,stage,options);
  if(!isDeepStrictEqual(expected.receipt,issuedReceipt))throw new Error('STALE_OR_INCOMPLETE_CONTEXT_COVERAGE');
  if(expected.conflicts.length)throw new Error('CANONICAL_CONTEXT_CONFLICT:'+expected.conflicts.map(c=>c.code).join(','));
  return {status:'COVERED' as const,ruleCount:expected.receipt.requiredRuleIds.length,snapshotHash:snapshot.hash};
}
