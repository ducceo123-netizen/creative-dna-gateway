import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { hash, safeJson, V2Error } from './core.ts';
import type { StoredJob, ArtifactReceipt, OperationKey } from './store.ts';
import { createSnapshot, stageContext, assertCoverage, fullContext, readContextPath, contextStage, contentHash,
  type CanonicalSnapshot, type CoverageReceipt, type Packet } from './rules.ts';
import { preflightAsset } from '../uid-asset-preflight.ts';
import { evaluateOnepageBannerQc } from '../supabase/functions/_shared/onepage-banner-qc.ts';
import { evaluateOnepagePhysicalQc } from '../supabase/functions/_shared/onepage-physical-qc.ts';
import { evaluateOnepageCreativeQc } from '../supabase/functions/_shared/onepage-creative-qc.ts';
import { evaluateOnepageContentPlan } from '../supabase/functions/_shared/onepage-content-plan.ts';
import { validateOnepageUiCopy } from '../supabase/functions/_shared/onepage-ui-content.ts';
import { evaluateOnepageProductTypeScope } from '../supabase/functions/_shared/onepage-product-type-scope.ts';
import { validateCompileInput } from './compiler.ts';
import { renderOnepage, packageOnepage, createPreviewBundle, validateAssetBytes, type DeliveryInput, type RenderedOnepage } from './delivery.ts';

export type MaybePromise<T> = T | Promise<T>;
export interface JobStore {
  findByKey(owner:string,key:string,inputHash?:string):MaybePromise<StoredJob|undefined>;
  create(owner:string,key:string,inputHash:string,initial:Record<string,any>):MaybePromise<StoredJob>;
  read(owner:string,id:string):MaybePromise<StoredJob>;
  update(owner:string,id:string,revision:number,mutation:(job:StoredJob)=>Record<string,any>,operation?:OperationKey):MaybePromise<StoredJob>;
  acquireLease?(owner:string,id:string,holder:string,ttlMs?:number):MaybePromise<{holder:string;fence:number;expires:number}>;
  assertLease?(owner:string,id:string,lease:{holder:string;fence:number}):MaybePromise<void>;
  releaseLease?(owner:string,id:string,lease:{holder:string;fence:number}):MaybePromise<void>;
}
export interface ArtifactStore {
  get(owner:string,jobId:string,sha256:string):MaybePromise<Buffer>;
  put(owner:string,jobId:string,bytes:Buffer,mime:string):MaybePromise<ArtifactReceipt>;
}
export interface CompileInput {brand:string;source_url?:string;source_type?:string;product_line?:string;theme?:string;research?:unknown}
export interface OrchestratorOptions {
  store:JobStore;
  artifacts:ArtifactStore;
  compile:(input:CompileInput)=>Promise<Packet>;
  baselineCommit:string;
  sourceUrl?:string;
  render?:typeof renderOnepage;
  package?:typeof packageOnepage;
}
const text=z.string().trim().min(1).max(4000);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
const timestamp=z.string().datetime();
export const StartSchema=z.object({brand:z.enum(['pawfecthouse','giftsoul','soulprise']),brief:text,sourceUrl:z.string().url().max(2000).optional(),productLine:z.string().trim().min(1).max(160).optional(),sourceType:z.enum(['product','collection','auto']).default('auto'),idempotencyKey:z.string().min(1).max(150),contentReviewRequired:z.boolean().default(false),lockedCopy:z.record(z.string(),z.string().max(4000)).optional(),capabilities:z.object({artifactTransfer:z.boolean(),imageInspection:z.boolean(),videoPlayback:z.boolean().default(false)})});
export const InspectionSchema=z.object({id:text,sourceId:text,itemId:text,artifactHash:sha,method:z.enum(['host_pixels','human_pixels','video_playback']),observations:text,inspectedAt:timestamp,audioCoverage:z.enum(['inspected','verified_no_audio','uninspected']).optional()});
export const ReferenceSchema=z.object({id:text,kind:z.enum(['clipo','human_realism','eo']),status:z.enum(['inspected','unavailable','not_found','not_applicable']),sourceUrl:z.string().url().optional(),artifactHash:sha.optional(),observations:text,permission:text,observedAt:timestamp,required:z.boolean().default(false),brand:z.enum(['pawfecthouse','giftsoul','soulprise']).optional(),role:z.enum(['icon','banner','human_pose','quality_reference']).optional(),originPageUrl:z.string().url().optional()});
export const ProductTypeScopeSchema=z.object({
  report:z.object({brand:z.enum(['pawfecthouse','giftsoul','soulprise']),requested_product_type:z.string().trim().min(1).max(160),scan_complete:z.boolean(),has_more_pages:z.boolean(),products:z.array(z.object({id:text,title:text,product_type:z.string().max(2000),url:z.string().url().max(2000)}).strict()).max(2000)}).strict(),
  pages:z.array(z.object({url:z.string().url().max(2000),nextPageUrl:z.string().url().max(2000).nullable(),productIds:z.array(text).max(250),observedAt:timestamp,observations:text}).strict()).min(1).max(100),
}).strict();
export const ResearchSchema=z.object({research:z.record(z.string(),z.unknown()),inspections:z.array(InspectionSchema).max(500),references:z.array(ReferenceSchema).max(100).default([]),productTypeScope:ProductTypeScopeSchema.optional()});
export const PlanSchema=z.object({mode:z.enum(['gtk','faq']),copy:z.record(z.string(),z.string().max(4000)),allocation:z.record(z.string(),z.object({productId:text,variant:text,artworkEvidenceId:text,containsHumans:z.boolean(),sourceIds:z.array(text).min(1).max(40)}))});
export const QcSchema=z.object({scope:text,inputHashes:z.array(sha).min(1).max(1000),method:z.enum(['host_visual','human_visual']),observations:text,reviewedAt:timestamp,findings:z.array(z.object({criterion:text,outcome:z.enum(['PASS','BLOCKED','NOT_APPLICABLE']),observation:text})).min(1).max(300),canonicalReports:z.object({banner:z.record(z.string(),z.unknown()),physical:z.record(z.string(),z.unknown()),creative:z.array(z.record(z.string(),z.unknown())).min(5).max(10)}).optional()});
export type Inspection=z.infer<typeof InspectionSchema>;
export type Reference=z.infer<typeof ReferenceSchema>;
export type Plan=z.infer<typeof PlanSchema>;
export type Qc=z.infer<typeof QcSchema>&{reviewer:string;attestation:'HOST_OR_HUMAN_REPORTED_NOT_SERVER_VISION';snapshotHash:string};
type Asset={sha256:string;width:number;height:number;format:string;planHash:string;contentRevision:number};
type Approval={kind:'content'|'final'|'package';inputHash:string;reviewer:string;approvedAt:string};
export type OnepageJob=StoredJob&{schemaVersion:'uid-brands-v2.job/1';input:z.infer<typeof StartSchema>;snapshot:CanonicalSnapshot;contentRevision:number;stepIndex:number;completed:string[];state:'READY'|'BLOCKED'|'RETRYABLE'|'CANCELLED'|'COMPLETE';blockers:string[];coverage:Record<string,CoverageReceipt>;research?:Record<string,any>;researchHash?:string;productTypeScope?:z.infer<typeof ProductTypeScopeSchema>;inspections:Inspection[];references:Reference[];plan?:Plan;planHash?:string;assets:Record<string,Asset>;qc:Record<string,Qc>;approvals:Approval[];render?:any;delivery?:any;retryCount:number};
const EXTRAS=['OVERALL_QC','REVIEW','PACKAGE','COMPLETE'];
const equal=(a:unknown,b:unknown)=>hash(a)===hash(b);
const allHashes=(v:string[])=>[...new Set(v)].sort();
const currentStep=(j:OnepageJob)=>[...j.snapshot.packet.execution,...EXTRAS][j.stepIndex]??'COMPLETE';
const requiredSlots=(j:OnepageJob)=>j.snapshot.packet.assets.filter((s:any)=>s.slot!=='ui_mapping_preview'&&(!s.condition||(s.condition==='ONLY_WHEN_GTK_SELECTED'&&j.plan?.mode==='gtk')));
const clearDelivery=(j:OnepageJob)=>{delete j.render;delete j.delivery;delete j.qc.overall;j.approvals=j.approvals.filter(a=>a.kind==='content');};
const rewind=(j:OnepageJob,step:string)=>{const index=j.snapshot.packet.execution.indexOf(step);j.stepIndex=Math.min(j.stepIndex,index<0?0:index);j.completed=j.completed.slice(0,j.stepIndex);j.state='READY';j.blockers=[];};
function notCancelled(j:OnepageJob){if(j.state==='CANCELLED')throw new V2Error('CANCELLED','Cancelled jobs are immutable; start a new idempotent job.',409);}
function assertRevision(j:OnepageJob,revision:number){if(j.storageRevision!==revision)throw new V2Error('STALE_REVISION','Job changed; reload before retrying.',409);notCancelled(j);}
function timestampNotFuture(value:string){if(Date.parse(value)>Date.now()+60_000)throw new V2Error('FUTURE_EVIDENCE','Evidence timestamp cannot be in the future.');}
const normalizedType=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
/** The unchanged evaluator checks the exact Shopify field. Page/source authenticity
 * remains an explicit host/human research-QC responsibility, never a server scan claim.
 */
function namedProductScope(input:z.infer<typeof StartSchema>,research?:Record<string,any>,scope?:z.infer<typeof ProductTypeScopeSchema>){
  if(input.sourceUrl||!input.productLine)return {issues:[] as string[],sourceUrl:input.sourceUrl,sourceType:input.sourceType,evaluation:null};
  if(!scope)return {issues:['EXACT_PRODUCT_TYPE_SCOPE_REPORT_REQUIRED'],sourceUrl:undefined,sourceType:undefined,evaluation:null};
  const evaluation=evaluateOnepageProductTypeScope(scope.report),issues=[...evaluation.issues];
  if(scope.report.brand!==input.brand||normalizedType(scope.report.requested_product_type)!==normalizedType(input.productLine))issues.push('PRODUCT_TYPE_BRIEF_MISMATCH');
  const domain={pawfecthouse:'pawfecthouse.com',giftsoul:'giftsoul.co',soulprise:'soulprise.co'}[input.brand];
  const pageUrl=(page:number)=>`https://${domain}/products.json?limit=250&page=${page}`;
  const ids:string[]=[];
  for(const [index,page] of scope.pages.entries()){
    timestampNotFuture(page.observedAt);
    if(page.url!==pageUrl(index+1)||page.nextPageUrl!==(index===scope.pages.length-1?null:pageUrl(index+2)))issues.push('CATALOG_PAGINATION_CHAIN_REQUIRED');
    if(index===scope.pages.length-1?page.productIds.length!==0:page.productIds.length===0)issues.push('CATALOG_TERMINAL_EMPTY_PAGE_REQUIRED');
    ids.push(...page.productIds);
  }
  if(!equal([...ids].sort(),scope.report.products.map(p=>p.id).sort())||new Set(ids).size!==ids.length)issues.push('CATALOG_PAGE_PRODUCT_COVERAGE_MISMATCH');
  for(const product of scope.report.products)try{validateCompileInput({brand:input.brand,source_url:product.url,source_type:'product'});}catch{issues.push('CATALOG_PRODUCT_OUTSIDE_BRAND_SCOPE');}
  const matched='products' in evaluation?evaluation.products:[],products=research?.scope?.products;
  if(!Array.isArray(products)||!equal(products.map((p:any)=>({id:p.id,url:p.url})).sort((a:any,b:any)=>String(a.id).localeCompare(String(b.id))),matched.map(p=>({id:p.id,url:p.url})).sort((a,b)=>a.id.localeCompare(b.id))))issues.push('RESEARCH_SCOPE_MUST_EQUAL_EXACT_PRODUCT_TYPE_MATCHES');
  const sourceUrl=research?.scope?.source_url,sourceType=research?.scope?.source_type;
  if(input.sourceType!=='auto'&&sourceType!==input.sourceType)issues.push('NAMED_SOURCE_TYPE_MISMATCH');
  try{if(!sourceUrl||!['product','collection'].includes(sourceType))throw Error();validateCompileInput({brand:input.brand,source_url:sourceUrl,source_type:sourceType});if(sourceType==='product'&&(matched.length!==1||matched[0]?.url!==sourceUrl))throw Error();}catch{issues.push('VERIFIED_NAMED_SCOPE_SOURCE_URL_REQUIRED');}
  return {issues:[...new Set(issues)],sourceUrl:issues.length?undefined:sourceUrl as string,sourceType:issues.length?undefined:sourceType as 'product'|'collection',evaluation};
}

/** Backend state and deterministic gates. The host still supplies research, creative work and real visual review. */
export class OnepageOrchestrator {
  constructor(private options:OrchestratorOptions){}
  // Cache only independently verified receipts, never bundles or caller claims.
  // The complete stored snapshot is fingerprinted, so a changed packet, registry,
  // conflict or provenance cannot reuse a receipt merely by retaining snapshot.hash.
  private contextReceipts=new Map<string,CoverageReceipt>();
  private contextKey(j:OnepageJob,stage:string){return `${hash(j.snapshot)}:${stage}:${j.plan?.mode??'none'}`;}
  private rememberContext(key:string,receipt:CoverageReceipt){
    if(!this.contextReceipts.has(key)&&this.contextReceipts.size>=32)this.contextReceipts.delete(this.contextReceipts.keys().next().value!);
    this.contextReceipts.set(key,structuredClone(receipt));
  }
  private contextMetadata(j:OnepageJob){
    const step=currentStep(j),templateMode=j.plan?.mode??null;
    let stage:ReturnType<typeof contextStage>|null=null;
    try{stage=contextStage(step);}catch{/* Unknown future steps remain visible and blocked. */}
    const metadata={stage,snapshotHash:j.snapshot.hash,templateMode,bundleHash:null as string|null,loaded:false};
    const persisted=j.coverage[step];
    if(!stage||!persisted||persisted.snapshotHash!==j.snapshot.hash||persisted.stage!==stage||persisted.templateMode!==templateMode)return metadata;
    try{
      const key=this.contextKey(j,stage);
      let expected=this.contextReceipts.get(key);
      if(!expected){expected=stageContext(j.snapshot,step,{templateMode:j.plan?.mode}).receipt;this.rememberContext(key,expected);}
      if(isDeepStrictEqual(persisted,expected)){metadata.bundleHash=expected.bundleHash;metadata.loaded=true;}
    }catch{/* Invalid snapshots/templates never advertise valid loaded context. */}
    return metadata;
  }
  private async read(owner:string,id:string){return await this.options.store.read(owner,id) as OnepageJob;}
  private async update(owner:string,id:string,revision:number,mutate:(j:OnepageJob)=>void,operation?:OperationKey){
    return await this.options.store.update(owner,id,revision,current=>{const j=current as OnepageJob;notCancelled(j);mutate(j);return j;},operation) as OnepageJob;
  }
  private snapshot(packet:Packet){return createSnapshot(packet,{sourceUrl:this.options.sourceUrl??'https://uid-brands-gateway-preview.onrender.com/api/tools/compile_onepage_job',observedAt:new Date().toISOString(),baselineCommit:this.options.baselineCommit,visibility:'public'});}
  async start(owner:string,input:unknown){
    const parsed=StartSchema.parse(safeJson(input));
    if(!parsed.sourceUrl&&!parsed.productLine)throw new V2Error('SOURCE_OR_PRODUCT_LINE_REQUIRED','Provide an exact product line name or a source URL.');
    const inputHash=hash(parsed),existing=await this.options.store.findByKey(owner,parsed.idempotencyKey,inputHash);
    if(existing)return this.summary(existing as OnepageJob);
    const packet=await this.options.compile({brand:parsed.brand,source_url:parsed.sourceUrl,source_type:parsed.sourceType,product_line:parsed.productLine});
    const snapshot=this.snapshot(packet);
    const j=await this.options.store.create(owner,parsed.idempotencyKey,inputHash,{schemaVersion:'uid-brands-v2.job/1',input:parsed,snapshot,contentRevision:0,stepIndex:0,completed:[],state:'READY',blockers:[],coverage:{},inspections:[],references:[],assets:{},qc:{},approvals:[],retryCount:0}) as OnepageJob;
    return this.summary(j);
  }
  async state(owner:string,id:string){return this.summary(await this.read(owner,id));}
  summary(j:OnepageJob){const named=namedProductScope(j.input,j.research,j.productTypeScope),context=this.contextMetadata(j),action=j.state==='BLOCKED'?j.blockers[0]??'Resolve blocker':`Complete ${currentStep(j)}`;return {jobId:j.jobId,storageRevision:j.storageRevision,contentRevision:j.contentRevision,state:j.state,stage:currentStep(j),context,completedSteps:j.completed,canonicalSteps:j.snapshot.packet.execution,canonicalHash:j.snapshot.hash,canonicalRevision:j.snapshot.packet.resolved,blockers:j.blockers,conflicts:j.snapshot.conflicts,mode:j.plan?.mode??null,productLine:j.input.productLine??null,sourceUrl:named.sourceUrl??null,namedScopeRequired:!j.input.sourceUrl&&!!j.input.productLine,namedScopeIssues:named.issues,planHash:j.planHash??null,expectedSlots:j.plan?requiredSlots(j).map((a:any)=>a.slot):[],assets:Object.fromEntries(Object.entries(j.assets).map(([k,a])=>[k,{sha256:a.sha256,width:a.width,height:a.height,format:a.format}])),render:j.render?{inputHash:j.render.inputHash,desktop:j.render.desktop,mobile:j.render.mobile,htmlArtifact:j.render.htmlArtifact,cssArtifact:j.render.cssArtifact,previewBundle:j.render.previewBundle,visualQcPerformed:false}:null,delivery:j.delivery??null,approvals:j.approvals,evidenceIds:(j.research?.sources??[]).map((r:any)=>r.id),referenceIds:j.references.map(r=>r.id),qcScopes:Object.keys(j.qc),expiresAt:j.expiresAt,nextAction:j.state==='CANCELLED'?'This job is cancelled; start a new job to continue.':j.state==='COMPLETE'?'Delivery is complete; retrieve the validated artifacts.':context.loaded?`${action}. Use the issued stage context; reload it if lost or starting a new session.`:j.state==='BLOCKED'?action:`Load stage context and complete ${currentStep(j)}`,testMode:true,semanticInspection:'HOST_OR_HUMAN_REPORTED_NOT_SERVER_VISION'};}
  async getStageContext(owner:string,id:string){
    const j=await this.read(owner,id);notCancelled(j);
    const step=currentStep(j),bundle=stageContext(j.snapshot,step,{templateMode:j.plan?.mode});
    const candidates=[...j.snapshot.packet.execution,...EXTRAS].filter(candidate=>contextStage(candidate)===bundle.stage);
    const unchanged=candidates.every(candidate=>isDeepStrictEqual(j.coverage[candidate],bundle.receipt));
    const updated=unchanged?j:await this.update(owner,id,j.storageRevision,current=>{for(const candidate of candidates)current.coverage[candidate]=bundle.receipt;});
    this.rememberContext(this.contextKey(j,bundle.stage),bundle.receipt);
    return {...bundle,jobId:id,storageRevision:updated.storageRevision,contentRevision:j.contentRevision,step,artifacts:Object.fromEntries(Object.entries(j.assets).map(([slot,a])=>[slot,a.sha256])),researchHash:j.researchHash??null,jobLookups:['job:plan','job:research','job:inspections','job:references','job:productTypeScope','qc-requirements:research','qc-requirements:content','qc-requirements:asset:<slot>','qc-requirements:overall'],approvalPolicy:{contentReviewRequired:j.input.contentReviewRequired,finalAndPackageApprovalRequired:true}};
  }
  async getFullContext(owner:string,id:string){const j=await this.read(owner,id);return {jobId:id,snapshotHash:j.snapshot.hash,packet:fullContext(j.snapshot)};}
  async getRuleOrEvidence(owner:string,id:string,path:string){const j=await this.read(owner,id);if(path.startsWith('qc-requirements:')){const scope=path.slice('qc-requirements:'.length);return {scope,inputHashes:this.expectedQcHashes(j,scope),criteria:this.qcCriteria(j,scope),canonicalReportsRequired:scope==='overall',contentVersion:String(j.contentRevision),taskId:j.jobId};}if(['job:plan','job:research','job:inspections','job:references','job:productTypeScope'].includes(path)){const field=path.slice(4);return safeJson((j as any)[field]??null);}if(path.startsWith('evidence:')){const source=j.research?.sources?.find((s:any)=>s.id===path.slice(9));if(!source)throw new V2Error('EVIDENCE_NOT_FOUND','Evidence does not exist in this job.',404);return safeJson(source);}return readContextPath(j.snapshot,path);}
  private sourceInspectionBlockers(j:OnepageJob){
    const result:string[]=[...namedProductScope(j.input,j.research,j.productTypeScope).issues];
    for(const source of j.research?.sources??[]){
      if(source.kind!=='target_pdp')continue;
      for(const item of source.pdp_coverage?.gallery?.items??[]){
        if(item.status!=='inspected')continue;
        const receipt=j.inspections.find(r=>r.sourceId===source.id&&r.itemId===item.id);
        if(!receipt)result.push(`PIXEL_RECEIPT_REQUIRED:${source.id}:${item.id}`);
        else if(item.kind==='video'&&(receipt.method!=='video_playback'||!['inspected','verified_no_audio'].includes(receipt.audioCoverage??'')))result.push(`VIDEO_PLAYBACK_AND_AUDIO_REQUIRED:${item.id}`);
      }
      for(const item of source.pdp_coverage?.details?.items??[]){if(item.status==='inspected'&&item.method==='image_view'&&!j.inspections.some(r=>r.sourceId===source.id&&r.itemId===item.id))result.push(`DETAIL_PIXEL_RECEIPT_REQUIRED:${item.id}`);}
    }
    return result;
  }
  async submitResearch(owner:string,id:string,revision:number,input:unknown){
    const j=await this.read(owner,id);assertRevision(j,revision);
    const data=ResearchSchema.parse(safeJson(input));
    if(data.inspections.length&&!j.input.capabilities.artifactTransfer)throw new V2Error('HOST_ARTIFACT_TRANSFER_UNAVAILABLE','Host must transfer real inspected evidence bytes.');
    const seen=new Set<string>();
    for(const r of data.inspections){timestampNotFuture(r.inspectedAt);const key=r.sourceId+':'+r.itemId;if(seen.has(key))throw new V2Error('DUPLICATE_INSPECTION','Each media item needs one unambiguous receipt.');seen.add(key);if(r.method==='video_playback')throw new V2Error('VIDEO_BYTE_VALIDATION_UNAVAILABLE','This runtime cannot validate video artifacts; preserve unsupported playback evidence and block the affected step.');if(!j.input.capabilities.imageInspection)throw new V2Error('HOST_VISION_UNAVAILABLE','Host did not advertise actual image inspection.');const bytes=await this.options.artifacts.get(owner,id,r.artifactHash);if(hash(bytes)!==r.artifactHash||!bytes.length)throw new V2Error('EVIDENCE_BYTES_MISMATCH','Evidence bytes do not match the submitted receipt.');await preflightAsset(bytes,{expected_sha256:r.artifactHash});const source=(data.research.sources as any[])?.find(s=>s.id===r.sourceId);if(!source||![...(source.pdp_coverage?.gallery?.items??[]),...(source.pdp_coverage?.details?.items??[])].some((item:any)=>item.id===r.itemId))throw new V2Error('EVIDENCE_ITEM_MISMATCH','Inspection must identify an exact research media item.');}
    for(const r of data.references){timestampNotFuture(r.observedAt);if(r.status==='inspected'){if(!r.artifactHash||!r.sourceUrl)throw new V2Error('REFERENCE_BYTES_REQUIRED','Inspected visual references require source URL and actual bytes.');const bytes=await this.options.artifacts.get(owner,id,r.artifactHash);if(!bytes.length||hash(bytes)!==r.artifactHash)throw new V2Error('REFERENCE_BYTES_MISMATCH','Reference bytes mismatch.');await preflightAsset(bytes,{expected_sha256:r.artifactHash});if(r.kind==='eo'&&!this.sameBrandEo(j,r))throw new V2Error('EO_REFERENCE_SCOPE','EO visual reference must name this brand and an actual same-brand originating page.');}}
    const named=namedProductScope(j.input,data.research,data.productTypeScope);
    // Preserve incomplete name-resolution evidence without compiling research against an invented URL.
    const packet=named.issues.length?j.snapshot.packet:await this.options.compile({brand:j.input.brand,source_url:named.sourceUrl,source_type:named.sourceType??j.input.sourceType,product_line:j.input.productLine,research:data.research});
    const snapshot=named.issues.length?j.snapshot:this.snapshot(packet);
    const updated=await this.update(owner,id,revision,current=>{current.snapshot=snapshot;current.research=data.research;current.researchHash=hash(data.research);if(data.productTypeScope)current.productTypeScope=data.productTypeScope;else delete current.productTypeScope;current.inspections=data.inspections;current.references=data.references;current.contentRevision++;current.coverage={};current.stepIndex=0;current.completed=[];delete current.plan;delete current.planHash;current.assets={};current.qc={};current.approvals=[];delete current.render;delete current.delivery;current.state='READY';current.blockers=[];});
    return {state:this.summary(updated),validation:{research:packet.research_validation,contentPlan:packet.content_plan_assessment,...(!j.input.sourceUrl&&j.input.productLine?{productTypeScope:{evaluation:named.evaluation,issues:named.issues,sourceVerifiedByServer:false}}:{})},snapshotReplacedAtomically:true};
  }
  private planIssues(j:OnepageJob,plan:Plan){
    if(!j.research)return ['RESEARCH_REQUIRED'];
    const r=structuredClone(j.research);r.analysis??={};r.analysis.content_plan??={};r.analysis.content_plan.ui_copy=plan.copy;
    const assessment=evaluateOnepageContentPlan(r,j.snapshot.packet.research_validation??{status:'AWAITING_RESEARCH',structurally_supported_claim_ids:[]},j.snapshot.packet.creative_quality_contract?.status!=='COMPILED',Number(j.snapshot.packet.acquisition_contract?.min_verified_designs));
    const issues=[...assessment.issues,...namedProductScope(j.input,j.research,j.productTypeScope).issues];
    if(assessment.status!=='READY_FOR_HOST_REVIEW')issues.push(assessment.status);
    if(r.analysis.content_plan.post_story?.mode!==plan.mode)issues.push('PLAN_MODE_DOES_NOT_MATCH_RESEARCH_DECISION');
    issues.push(...validateOnepageUiCopy(plan.copy,plan.mode,r.analysis.content_plan.post_story?.insight_indexes?.length??0));
    if(j.input.lockedCopy&&Object.entries(j.input.lockedCopy).some(([k,v])=>plan.copy[k]!==v))issues.push('USER_LOCKED_COPY_CHANGED');
    const slots=j.snapshot.packet.assets.filter((s:any)=>s.slot!=='ui_mapping_preview'&&(!s.condition||s.condition==='ONLY_WHEN_GTK_SELECTED'&&plan.mode==='gtk')).map((s:any)=>s.slot);
    if(!equal(Object.keys(plan.allocation).sort(),slots.sort()))issues.push('ALLOCATION_SLOTS_MISMATCH');
    for(const [slot,a] of Object.entries(plan.allocation)){
      const product=r.scope?.products?.find((p:any)=>p.id===a.productId);
      if(!product||product.variant!==a.variant)issues.push(`UNVERIFIED_PRODUCT_VARIANT:${slot}`);
      if(!a.sourceIds.every(id=>r.sources?.some((s:any)=>s.id===id&&s.product_ids?.includes(a.productId))))issues.push(`ALLOCATION_SOURCE_MISMATCH:${slot}`);
      if(!j.inspections.some(i=>a.sourceIds.includes(i.sourceId)&&i.itemId===a.artworkEvidenceId))issues.push(`ALLOCATION_ARTWORK_NOT_INSPECTED:${slot}`);
      if(slot.startsWith('detail_')&&a.productId!==r.analysis.content_plan.details?.anchor_product_id)issues.push(`DETAIL_ANCHOR_MISMATCH:${slot}`);
    }
    return [...new Set(issues)];
  }
  async submitPlan(owner:string,id:string,revision:number,input:unknown){
    const j=await this.read(owner,id);assertRevision(j,revision);const plan=PlanSchema.parse(safeJson(input));
    const issues=this.planIssues(j,plan);if(issues.length)throw new V2Error('INVALID_PLAN',issues.join('; '),422);
    const updated=await this.update(owner,id,revision,current=>{current.plan=plan;current.planHash=hash(plan);current.contentRevision++;current.assets={};current.qc=current.qc.research?{research:current.qc.research}:{};current.approvals=[];clearDelivery(current);rewind(current,'VALIDATE_ONEPAGE_CONTENT_PLAN');});return this.summary(updated);
  }
  private assertContext(j:OnepageJob,step:string){const receipt=j.coverage[step];if(!receipt)throw new V2Error('CONTEXT_REQUIRED',`Load the pinned context for ${step}.`,409);try{assertCoverage(j.snapshot,step,receipt,{templateMode:j.plan?.mode});}catch(e){throw new V2Error('CONTEXT_BLOCKED',String((e as Error).message),409);}}
  async submitAsset(owner:string,id:string,revision:number,input:{slot:string;sha256:string}){
    const j=await this.read(owner,id);assertRevision(j,revision);sha.parse(input.sha256);if(!j.plan||!j.planHash)throw new V2Error('PLAN_REQUIRED','Validated content and allocation required.',409);
    if(j.input.contentReviewRequired&&!j.approvals.some(a=>a.kind==='content'&&a.inputHash===j.planHash))throw new V2Error('CONTENT_REVIEW_REQUIRED','User requested content approval first.',409);
    this.assertContext(j,'GENERATE_SLOT_BY_SLOT');
    const unresolved=[...this.sourceInspectionBlockers(j),...this.requiredReferenceBlockers(j,input.slot)];if(unresolved.length)throw new V2Error('SOURCE_PIXELS_REQUIRED',unresolved.join('; '),409);
    if(!j.completed.includes('ALLOCATE_PRODUCTS_VARIANTS_CAST_TO_ASSETS'))throw new V2Error('ALLOCATION_NOT_ADVANCED','Finish canonical allocation prerequisites before asset submission.',409);
    const spec=requiredSlots(j).find((s:any)=>s.slot===input.slot);if(!spec)throw new V2Error('UNEXPECTED_SLOT','Asset is not in selected canonical manifest.');
    const bytes=await this.options.artifacts.get(owner,id,input.sha256);const receipt=await validateAssetBytes(bytes,spec,input.sha256);
    const updated=await this.update(owner,id,revision,current=>{current.assets[input.slot]={sha256:input.sha256,width:receipt.width,height:receipt.height,format:receipt.format,planHash:current.planHash!,contentRevision:current.contentRevision};delete current.qc['asset:'+input.slot];clearDelivery(current);rewind(current,'GENERATE_SLOT_BY_SLOT');});return this.summary(updated);
  }

  private sameBrandEo(j:OnepageJob,r:Reference){
    const domains:Record<string,string>={pawfecthouse:'pawfecthouse.com',giftsoul:'giftsoul.co',soulprise:'soulprise.co'};
    try{const u=new URL(r.originPageUrl??r.sourceUrl??'');return r.brand===j.input.brand&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname===domains[j.input.brand]||u.hostname==='www.'+domains[j.input.brand]);}catch{return false;}
  }
  private requiredReferenceBlockers(j:OnepageJob,slot?:string){
    const contract=j.snapshot.packet.creative_quality_contract??{},required=new Set<string>();
    for(const ref of contract.references??[])if(ref.usage==='required_evidence'&&(!slot||!ref.required_for?.length||ref.required_for.includes(slot)))required.add(ref.id);
    for(const rule of contract.rules??[])for(const id of rule.required_reference_ids??[])required.add(id);
    return [...required].filter(id=>!j.references.some(r=>r.id===id&&r.status==='inspected'&&r.artifactHash)).map(id=>'CANONICAL_REQUIRED_REFERENCE_UNINSPECTED:'+id);
  }
  private canonicalQcIssues(j:OnepageJob,reports:z.infer<typeof QcSchema>['canonicalReports']){
    if(!reports)return ['EXACT_BANNER_PHYSICAL_CREATIVE_REPORTS_REQUIRED'];
    const issues:string[]=[],version=String(j.contentRevision);
    const reportsAll=[reports.banner,reports.physical,...reports.creative] as Record<string,any>[];
    if(reportsAll.some(r=>r.task_id!==j.jobId||r.content_version!==version))issues.push('CANONICAL_REPORT_TASK_OR_VERSION_MISMATCH');
    const banner=evaluateOnepageBannerQc(reports.banner),physical=evaluateOnepagePhysicalQc(reports.physical);
    if(banner.status!=='REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA')issues.push('BANNER_REPORT_BLOCKED');
    if(physical.status!=='REPORTED_CLEAR_REQUIRES_INDEPENDENT_VISUAL_QA')issues.push('PHYSICAL_REPORT_BLOCKED');
    const banners=(reports.banner as any).inspections??[];
    for(const viewport of ['desktop','mobile']){const inspection=banners.find((r:any)=>r.viewport===viewport),slot='banner_'+viewport;if(!inspection||inspection.asset_id!==slot||inspection.sha256!=='sha256:'+j.assets[slot]?.sha256||inspection.approved_title!==j.research?.analysis?.content_plan?.banner?.[viewport+'_title'])issues.push('BANNER_REPORT_ASSET_OR_TITLE_MISMATCH:'+slot);}
    const physicalRows=(reports.physical as any).inspections??[];
    for(const slot of requiredSlots(j).filter((s:any)=>!s.slot.startsWith('occasion_icon'))){const row=physicalRows.find((r:any)=>r.asset_id===slot.slot),allocation=j.plan?.allocation[slot.slot],product=j.research?.scope?.products?.find((p:any)=>p.id===allocation?.productId);if(!row||row.product_id!==allocation?.productId||row.source_pdp_url!==product?.url)issues.push('PHYSICAL_REPORT_SOURCE_MISMATCH:'+slot.slot);}
    const scopes=['design_diversity','eo_icons','post_story_choice','shot_diversity','content_visual_match'];
    if(new Set(reports.creative.map((r:any)=>r.scope)).size!==reports.creative.length)issues.push('DUPLICATE_CREATIVE_REPORT_SCOPE');
    for(const scope of scopes){const report=reports.creative.find((r:any)=>r.scope===scope) as any;if(!report){issues.push('CREATIVE_REPORT_REQUIRED:'+scope);continue;}const result=evaluateOnepageCreativeQc(report);if(result.status!=='REPORTED_CLEAR_REQUIRES_HOST_VISUAL_QA')issues.push('CREATIVE_REPORT_BLOCKED:'+scope);}
    const photos=requiredSlots(j).filter((s:any)=>!s.slot.startsWith('occasion_icon')).map((s:any)=>s.slot);
    const exactSlots=(rows:any[],expected:string[])=>Array.isArray(rows)&&equal(rows.map(r=>r.slot).sort(),[...expected].sort());
    const evidenceUrls=new Set<string>((j.research?.sources??[]).map((s:any)=>s.url));
    const productIds=(j.research?.scope?.products??[]).map((p:any)=>p.id).sort();
    for(const report of reports.creative as Record<string,any>[]){
      if(report.scope==='eo_icons'&&!exactSlots(report.icons,requiredSlots(j).filter((s:any)=>s.slot.startsWith('occasion_icon')).map((s:any)=>s.slot)))issues.push('COMPLETE_ICON_REPORT_REQUIRED');
      if(report.scope==='design_diversity'){
        if(!exactSlots(report.placements,photos))issues.push('COMPLETE_DESIGN_MAP_REQUIRED');
        if(!report.catalog_scan||!equal([...(report.catalog_scan.inspected_product_ids??[])].sort(),productIds)||!equal([...(report.catalog_scan.discovered_product_ids??[])].sort(),productIds))issues.push('CATALOG_SCAN_MUST_MATCH_VERIFIED_RESEARCH');
      }
      if(report.scope==='shot_diversity'&&!exactSlots(report.shots,photos.filter((slot:string)=>/^(?:wyl_|detail_|occasion_)/.test(slot))))issues.push('COMPLETE_SHOT_REPORT_REQUIRED');
      if(report.scope==='content_visual_match'){
        if(!exactSlots(report.visual_proofs,photos))issues.push('COMPLETE_CONTENT_PROOF_MAP_REQUIRED');
        for(const proof of report.visual_proofs??[]){
          const allocation=j.plan?.allocation[proof.slot],sources=(j.research?.sources??[]).filter((src:any)=>allocation?.sourceIds.includes(src.id));
          const indexBySlot:Record<string,number[]>={wyl_01:[1],wyl_02:[2],wyl_03:[3],detail_main:[4,5,6],detail_01:[4],detail_02:[5],detail_03:[6],gtk_01:[11],gtk_02:[12],gtk_03:[13]};
          const copyValues=(indexBySlot[proof.slot]??[]).flatMap(n=>[j.plan?.copy['title_'+String(n).padStart(2,'0')],j.plan?.copy['description_'+String(n).padStart(2,'0')]]);
          // The Occasion photo pair is text-free; bind to its explicit allocation, never icon copy or invented headings.
          if(['occasion_01','occasion_02'].includes(proof.slot))copyValues.push('allocation:'+proof.slot);
          if(proof.slot.startsWith('banner_'))copyValues.push(j.research?.analysis?.content_plan?.banner?.[proof.slot==='banner_desktop'?'desktop_title':'mobile_title']);
          if(!allocation||!sources.some((src:any)=>src.url===proof.proof_source_url)||!copyValues.includes(proof.content_key))issues.push('CONTENT_PROOF_PLAN_LINK_REQUIRED:'+proof.slot);
        }
      }
      if(report.scope==='post_story_choice'){
        if(report.post_story?.selected!==(j.plan?.mode==='gtk'?'good_to_know':'faqs'))issues.push('POST_STORY_REPORT_MODE_MISMATCH');
        const urls=[...(report.post_story?.pdp_evidence_urls??[]),...(report.post_story?.buyer_questions??[]).map((r:any)=>r.evidence_url),...(report.post_story?.gtk_insights??[]).map((r:any)=>r.evidence_url)];
        if(urls.some(url=>!evidenceUrls.has(url)))issues.push('POST_STORY_REPORT_SOURCE_MISMATCH');
      }

      for(const row of [...(report.placements??[]),...(report.shots??[])]){const a=j.plan?.allocation[row.slot];if(!a||row.product_id!==a.productId||(row.design_id!==undefined&&row.design_id!==a.artworkEvidenceId))issues.push('CREATIVE_ALLOCATION_MISMATCH:'+row.slot);}
      for(const row of report.inventory??[]){if(!j.research?.scope?.products?.some((p:any)=>p.id===row.product_id&&p.url===row.pdp_url)||!j.inspections.some(i=>i.itemId===row.design_id))issues.push('CREATIVE_INVENTORY_UNVERIFIED');}
      for(const row of report.icons??[]){if(row.asset_id!==row.slot||!j.assets[row.slot]||!j.references.some(r=>r.kind==='eo'&&r.role==='icon'&&r.status==='inspected'&&r.sourceUrl===row.reference_url&&this.sameBrandEo(j,r)))issues.push('ICON_REPORT_REFERENCE_MISMATCH:'+row.slot);}
    }
    return [...new Set(issues)];
  }
  private expectedQcHashes(j:OnepageJob,scope:string):string[]{
    if(scope==='research')return allHashes([j.researchHash!,...j.inspections.map(r=>r.artifactHash),...(!j.input.sourceUrl&&j.productTypeScope?[hash(j.productTypeScope)]:[])].filter(Boolean));
    if(scope==='content')return allHashes([j.planHash!,j.researchHash!].filter(Boolean));
    if(scope==='overall')return j.render?allHashes([j.planHash!,j.render.desktop.sha256,j.render.mobile.sha256,...Object.values(j.assets).map(a=>a.sha256),...j.inspections.map(i=>i.artifactHash),...j.references.filter(r=>r.status==='inspected'&&r.artifactHash).map(r=>r.artifactHash!)]):[];
    if(scope.startsWith('asset:')){const slot=scope.slice(6),a=j.assets[slot];return a?allHashes([a.sha256,j.planHash!,...j.inspections.filter(i=>j.plan?.allocation[slot]?.sourceIds.includes(i.sourceId)).map(i=>i.artifactHash)]):[];}
    return [];
  }
  private qcCriteria(j:OnepageJob,scope:string){
    if(scope==='research')return ['source_authenticity','semantic_truth','media_coverage','variant_artwork_mapping',...(!j.input.sourceUrl&&j.input.productLine?['exact_shopify_product_type','catalog_pagination_completeness']:[])];
    if(scope==='content')return ['content_to_visual_proof','semantic_deduplication','gtk_faq_evidence','locked_copy'];
    if(scope==='overall')return Object.keys(j.snapshot.packet.hard_gates);
    if(scope.startsWith('asset:'))return ['product_physical_truth','content_to_visual_proof','exact_dimensions','standalone_assets',...(scope.includes('banner_')?['responsive_banner_pair']:[])];
    return [];
  }
  async submitQc(owner:string,id:string,revision:number,input:unknown,actor=owner){
    const j=await this.read(owner,id);assertRevision(j,revision);const receipt=QcSchema.parse(safeJson(input));timestampNotFuture(receipt.reviewedAt);
    if(receipt.method==='host_visual'&&!j.input.capabilities.imageInspection)throw new V2Error('HOST_VISION_UNAVAILABLE','Host lacks image-inspection capability.');
    const expected=this.expectedQcHashes(j,receipt.scope),criteria=this.qcCriteria(j,receipt.scope);
    if(!expected.length||!equal(allHashes(receipt.inputHashes),expected))throw new V2Error('QC_INPUT_MISMATCH','QC must bind the exact current evidence/plan/asset/render hashes.',409);
    if(!criteria.length||new Set(receipt.findings.map(f=>f.criterion)).size!==receipt.findings.length||criteria.some(c=>!receipt.findings.some(f=>f.criterion===c)))throw new V2Error('QC_COVERAGE_INCOMPLETE',`Required criteria: ${criteria.join(', ')}.`,422);
    if(receipt.findings.some(f=>f.outcome==='NOT_APPLICABLE'&&['product_physical_truth','content_to_visual_proof','exact_dimensions','standalone_assets','ui_mapping_preview','source_authenticity','semantic_truth','media_coverage','variant_artwork_mapping','locked_copy','semantic_deduplication','gtk_faq_evidence'].includes(f.criterion)))throw new V2Error('QC_REQUIRED_CRITERION','Required criteria cannot be waived with NOT_APPLICABLE.',422);
    if(receipt.scope==='overall'){const issues=this.canonicalQcIssues(j,receipt.canonicalReports);if(issues.length)throw new V2Error('CANONICAL_QC_INCOMPLETE',issues.join('; '),422);}
    const qc:Qc={...receipt,reviewer:actor,attestation:'HOST_OR_HUMAN_REPORTED_NOT_SERVER_VISION',snapshotHash:j.snapshot.hash};
    return this.summary(await this.update(owner,id,revision,current=>{current.qc[receipt.scope]=qc;current.state='READY';current.blockers=[];}));
  }
  private qcPass(j:OnepageJob,scope:string){const q=j.qc[scope];return !!q&&q.snapshotHash===j.snapshot.hash&&equal(allHashes(q.inputHashes),this.expectedQcHashes(j,scope))&&this.qcCriteria(j,scope).every(c=>q.findings.some(f=>f.criterion===c&&f.outcome!=='BLOCKED'))&&!q.findings.some(f=>f.outcome==='BLOCKED');}
  private stepBlockers(j:OnepageJob,step:string){
    const blockers:string[]=[];try{this.assertContext(j,step);}catch(e){blockers.push((e as Error).message);}
    const p=j.snapshot.packet,researchReady=['READY','READY_WITH_LIMITATIONS'].includes(p.research_validation?.status),researchQc=this.qcPass(j,'research');
    const researchSteps=['ACQUIRE_SOURCE','BUILD_VERIFIED_PRODUCT_POOL','CHECK_DIVERSITY_GATE','INSPECT_DESCRIPTIONS_AND_REVIEW_COVERAGE','RESEARCH_MARKETPLACE_COMPETITOR_SUPPLIER','RESEARCH_PINTEREST_PRODUCT_THEME_MARKET_REFERENCES','RESEARCH_REDDIT_CUSTOMER_CONTEXT_AND_COUNTEREVIDENCE','ANALYZE_BUYER_CONCERNS_AND_SCOPED_CLAIMS','VALIDATE_RESEARCH_BEFORE_CONTENT'];
    if(step==='VALIDATE_QUALITY_CONTRACT'&&(p.creative_quality_contract?.status!=='COMPILED'||p.quality_execution_guard?.status==='BLOCKED'))blockers.push('CANONICAL_QUALITY_CONTRACT_BLOCKED');
    if(researchSteps.includes(step)){if(!j.research||!researchReady)blockers.push('VALID_RESEARCH_REQUIRED');if(!researchQc)blockers.push('RESEARCH_SEMANTIC_REVIEW_REQUIRED');blockers.push(...this.sourceInspectionBlockers(j));}
    if(step==='RESEARCH_PINTEREST_PRODUCT_THEME_MARKET_REFERENCES'&&!['STRUCTURALLY_COMPLETE','PARTIAL'].includes(p.pinterest_validation?.status))blockers.push('PINTEREST_RESEARCH_ATTEMPT_REQUIRED');
    if(step==='RESEARCH_REDDIT_CUSTOMER_CONTEXT_AND_COUNTEREVIDENCE'&&!['STRUCTURALLY_COMPLETE','PARTIAL'].includes(p.reddit_validation?.status))blockers.push('REDDIT_RESEARCH_ATTEMPT_REQUIRED');
    if(step==='SELECT_INCREMENTAL_CUSTOMER_VALUE'&&!['READY_FOR_HOST_REVIEW','NO_INCREMENTAL_VALUE'].includes(p.insight_value_assessment?.status))blockers.push('INCREMENTAL_VALUE_ASSESSMENT_REQUIRED');
    if(step==='CLIPO_REFERENCE_DISCOVERY'&&!j.references.some(r=>r.kind==='clipo'))blockers.push('CLIPO_DISCOVERY_ATTEMPT_REQUIRED');
    if(step==='HUMAN_REALISM_REFERENCE_DISCOVERY'&&!j.references.some(r=>r.kind==='human_realism'))blockers.push('HUMAN_REALISM_DISCOVERY_OR_JUSTIFIED_NA_REQUIRED');
    if(['CLIPO_REFERENCE_DISCOVERY','HUMAN_REALISM_REFERENCE_DISCOVERY'].includes(step)&&j.references.some(r=>r.required&&r.status!=='inspected'))blockers.push('EXPLICITLY_REQUIRED_REFERENCE_UNAVAILABLE');
    if(['SELECT_INCREMENTAL_CUSTOMER_VALUE','VALIDATE_ONEPAGE_CONTENT_PLAN','BUILD_CONTENT_MAP','BUILD_ASSET_MANIFEST','ALLOCATE_PRODUCTS_VARIANTS_CAST_TO_ASSETS','GENERATE_SLOT_BY_SLOT'].includes(step)){
      if(!j.plan)blockers.push('VALIDATED_CONTENT_PLAN_REQUIRED');else blockers.push(...this.planIssues(j,j.plan));
      if(!this.qcPass(j,'content'))blockers.push('CONTENT_SEMANTIC_REVIEW_REQUIRED');
      if(j.input.contentReviewRequired&&!j.approvals.some(a=>a.kind==='content'&&a.inputHash===j.planHash))blockers.push('EXPLICIT_CONTENT_APPROVAL_REQUIRED');
    }
    if(step==='GENERATE_SLOT_BY_SLOT'){
      for(const s of requiredSlots(j))if(!j.assets[s.slot]||j.assets[s.slot].planHash!==j.planHash)blockers.push('MISSING_CURRENT_ASSET:'+s.slot);
      if(Object.values(j.plan?.allocation??{}).some(a=>a.containsHumans)&&!j.references.some(r=>r.kind==='human_realism'&&r.status==='inspected')){const fallback=JSON.stringify(p.human_realism_execution_contract?.fallback??'');const attempted=j.references.some(r=>r.kind==='human_realism'&&['unavailable','not_found'].includes(r.status));if(!attempted||!/(?:continue|fallback)/i.test(fallback))blockers.push('HUMAN_REALISM_INSPECTION_OR_CANONICAL_FALLBACK_REQUIRED');}
      blockers.push(...this.requiredReferenceBlockers(j));
      if(requiredSlots(j).some((s:any)=>s.slot.startsWith('occasion_icon'))&&new Set(j.references.filter(r=>r.kind==='eo'&&r.role==='icon'&&r.status==='inspected'&&this.sameBrandEo(j,r)).map(r=>r.artifactHash)).size<2)blockers.push('TWO_INSPECTED_SAME_BRAND_EO_ICONS_REQUIRED');
    }
    if(step==='INSPECT_PRODUCT_AND_EXPLICITLY_REQUIRED_EVIDENCE_PIXELS')blockers.push(...this.sourceInspectionBlockers(j));
    if(step==='QA_EACH_SLOT')for(const slot of requiredSlots(j))if(!this.qcPass(j,'asset:'+slot.slot))blockers.push('ASSET_VISUAL_QC_REQUIRED:'+slot.slot);
    if(step==='BUILD_UI_MAPPING_PREVIEW'&&!j.render)blockers.push('DETERMINISTIC_DESKTOP_MOBILE_RENDER_REQUIRED');
    if(step==='OVERALL_QC'&&!this.qcPass(j,'overall'))blockers.push('ACTUAL_DESKTOP_MOBILE_VISUAL_REVIEW_REQUIRED');
    if(step==='REVIEW'&&!j.approvals.some(a=>a.kind==='final'&&a.inputHash===j.render?.inputHash))blockers.push('FINAL_OUTCOME_APPROVAL_REQUIRED');
    if(step==='PACKAGE'&&!j.delivery)blockers.push('PACKAGE_APPROVAL_AND_VALIDATED_ARCHIVE_REQUIRED');
    if(step==='COMPLETE'&&!j.delivery)blockers.push('VALIDATED_DELIVERY_REQUIRED');
    return [...new Set(blockers)];
  }
  async advance(owner:string,id:string,revision:number){
    const j=await this.read(owner,id);assertRevision(j,revision);if(j.state==='COMPLETE')return this.summary(j);
    return this.summary(await this.update(owner,id,revision,current=>{
      // Execute the original ordered dependency chain, coalescing deterministic transitions.
      // A different context group, missing evidence or an approval remains a real boundary.
      for(let count=0;count<current.snapshot.packet.execution.length+EXTRAS.length;count++){
        const step=currentStep(current),blockers=this.stepBlockers(current,step);current.blockers=blockers;
        if(blockers.length){current.state='BLOCKED';return;}
        if(step==='COMPLETE'){current.state='COMPLETE';return;}
        current.completed.push(step);current.stepIndex++;current.state='READY';
      }
    }));
  }
  async revise(owner:string,id:string,revision:number,input:{scope:'asset'|'content'|'research'|'cancel'|'retry';slots?:string[];reason:string;unlockApprovedCopy?:boolean}){
    text.parse(input.reason);if(input.unlockApprovedCopy&&input.scope!=='content')throw new V2Error('INVALID_UNLOCK_SCOPE','Approved copy can be unlocked only by an explicitly authorized content revision.');const j=await this.read(owner,id);assertRevision(j,revision);
    return this.summary(await this.update(owner,id,revision,current=>{
      if(input.scope==='cancel'){current.state='CANCELLED';current.blockers=[input.reason];return;}
      if(input.scope==='retry'){if(current.state!=='RETRYABLE')throw new V2Error('NOT_RETRYABLE','Only a recorded transient failure can be retried.',409);if(current.retryCount>=3)throw new V2Error('RETRY_LIMIT','Three retry attempts exhausted; inspect the failure before a new revision.',409);current.retryCount++;current.state='READY';current.blockers=[];return;}
      if(input.scope==='asset'){
        if(!input.slots?.length||input.slots.some(s=>!requiredSlots(current).some((spec:any)=>spec.slot===s)))throw new V2Error('INVALID_REVISION_SCOPE','Name current canonical asset slots.');
        for(const slot of input.slots){delete current.assets[slot];delete current.qc['asset:'+slot];}
        clearDelivery(current);rewind(current,'GENERATE_SLOT_BY_SLOT');return;
      }
      if(input.scope==='content'){if(input.unlockApprovedCopy)delete current.input.lockedCopy;delete current.plan;delete current.planHash;current.assets={};current.qc=current.qc.research?{research:current.qc.research}:{};current.approvals=[];current.contentRevision++;clearDelivery(current);rewind(current,'VALIDATE_ONEPAGE_CONTENT_PLAN');return;}
      if(input.scope==='research'){delete current.productTypeScope;delete current.research;delete current.researchHash;delete current.plan;delete current.planHash;current.inspections=[];current.references=[];current.assets={};current.qc={};current.approvals=[];current.contentRevision++;current.coverage={};clearDelivery(current);rewind(current,'ACQUIRE_SOURCE');return;}
      throw new V2Error('INVALID_REVISION_SCOPE','Unknown revision scope.');
    }));
  }
  private async deliveryInput(j:OnepageJob):Promise<DeliveryInput>{
    if(!j.plan)throw new V2Error('PLAN_REQUIRED','Validated plan is missing.',409);
    const assets:DeliveryInput['assets']={};for(const slot of requiredSlots(j)){const a=j.assets[slot.slot];if(!a)throw new V2Error('MISSING_ASSET',slot.slot,409);assets[slot.slot]={bytes:await this.options.artifacts.get(j.owner,j.jobId,a.sha256),sha256:a.sha256,revision:a.contentRevision};}
    return {packet:j.snapshot.packet,mode:j.plan.mode,text:j.plan.copy,assets,contentRevision:j.contentRevision,...(j.plan.mode==='faq'?{faqCount:j.research?.analysis?.content_plan?.post_story?.insight_indexes?.length}:{})};
  }
  async render(owner:string,id:string,revision:number){
    const j=await this.read(owner,id);assertRevision(j,revision);if(j.state==='RETRYABLE')throw new V2Error('EXPLICIT_RETRY_REQUIRED','Resume the recorded retry before rendering again.',409);this.assertContext(j,'BUILD_UI_MAPPING_PREVIEW');
    if(!j.completed.includes('QA_EACH_SLOT')||requiredSlots(j).some((s:any)=>!this.qcPass(j,'asset:'+s.slot)))throw new V2Error('ASSET_QC_REQUIRED','Every current asset requires actual visual QC before overall rendering.',409);
    const lease=await this.options.store.acquireLease?.(owner,id,'render-'+randomUUID(),120_000);
    try{
      const deliveryInput=await this.deliveryInput(j);
      const rendered=await (this.options.render??renderOnepage)(deliveryInput);
      const preview=await createPreviewBundle(deliveryInput,rendered,{jobId:id,contentRevision:j.contentRevision});
      await this.options.artifacts.put(owner,id,rendered.desktop.bytes,'image/png');await this.options.artifacts.put(owner,id,rendered.mobile.bytes,'image/png');
      if(lease)await this.options.store.assertLease?.(owner,id,lease);
      const htmlArtifact={...await this.options.artifacts.put(owner,id,Buffer.from(rendered.html),'text/html'),filename:'index.html'};
      const cssArtifact={...await this.options.artifacts.put(owner,id,Buffer.from(rendered.css),'text/css'),filename:'styles.css'};
      const previewBundle={...await this.options.artifacts.put(owner,id,preview.zip,'application/zip'),filename:'onepage-review-preview.zip',inputHash:rendered.inputHash,boundHtmlHash:rendered.boundHtmlHash,contentRevision:j.contentRevision};
      const stored={...rendered,htmlArtifact,cssArtifact,previewBundle,desktop:{...rendered.desktop,bytes:undefined},mobile:{...rendered.mobile,bytes:undefined}};
      return this.summary(await this.update(owner,id,revision,current=>{clearDelivery(current);current.render=safeJson(stored);current.state='READY';current.blockers=[];}));
    }catch(e){if(e instanceof V2Error)throw e;const updated=await this.update(owner,id,revision,current=>{current.state='RETRYABLE';current.blockers=['RENDER_FAILED:'+String((e as Error).message).slice(0,180)];});return this.summary(updated);}
    finally{if(lease)await this.options.store.releaseLease?.(owner,id,lease);}
  }
  async approve(owner:string,id:string,revision:number,input:{kind:'content'|'final'|'package';expectedHash:string},actor=owner){
    const j=await this.read(owner,id);assertRevision(j,revision);if(!['content','final','package'].includes(input.kind))throw new V2Error('INVALID_APPROVAL','Unknown approval kind.');
    const expected=input.kind==='content'?j.planHash:j.render?.inputHash;if(!expected||input.expectedHash!==expected)throw new V2Error('STALE_APPROVAL','Approval must bind the exact current content or rendered result.',409);
    if(input.kind==='content'&&!this.qcPass(j,'content'))throw new V2Error('CONTENT_QC_REQUIRED','Content review is incomplete.',409);
    if(input.kind!=='content'&&!this.qcPass(j,'overall'))throw new V2Error('OVERALL_QC_REQUIRED','Actual desktop/mobile visual review is incomplete.',409);
    if(input.kind==='package'&&!j.approvals.some(a=>a.kind==='final'&&a.inputHash===expected))throw new V2Error('FINAL_APPROVAL_REQUIRED','Approve the final outcome before authorizing its package.',409);
    return this.summary(await this.update(owner,id,revision,current=>{current.approvals=current.approvals.filter(a=>a.kind!==input.kind);current.approvals.push({kind:input.kind,inputHash:expected,reviewer:actor,approvedAt:new Date().toISOString()});if(input.kind==='content'||input.kind==='final')current.input.lockedCopy=structuredClone(current.plan!.copy);}));
  }
  async package(owner:string,id:string,revision:number,input:{productLineName:string;productSlug:string}){
    const j=await this.read(owner,id);assertRevision(j,revision);this.assertContext(j,'PACKAGE');
    const approved=j.approvals.find(a=>a.kind==='package'&&a.inputHash===j.render?.inputHash);if(!approved||!j.render||!this.qcPass(j,'overall')||!j.completed.includes('REVIEW'))throw new V2Error('PACKAGE_AUTHORIZATION_REQUIRED','Current overall review and explicit packaging authorization required.',409);
    // Canonical packaging requires a fresh read. Do not repin an already reviewed outcome.
    const named=namedProductScope(j.input,j.research,j.productTypeScope);if(named.issues.length)throw new V2Error('PRODUCT_TYPE_SCOPE_REQUIRED',named.issues.join('; '),409);
    const fresh=this.snapshot(await this.options.compile({brand:j.input.brand,source_url:named.sourceUrl,source_type:named.sourceType??j.input.sourceType,product_line:j.input.productLine,research:j.research}));
    const releasePolicy=(snapshot:CanonicalSnapshot)=>({rules:snapshot.registry.map(r=>({id:r.id,hash:r.hash,authority:r.authority,provenance:r.provenance,requires:r.requires,supersedes:r.supersedes})),quality:{status:snapshot.packet.creative_quality_contract?.status,revision:snapshot.packet.creative_quality_contract?.revision??null,hash:snapshot.packet.creative_quality_contract?.contract_hash??null},packaging:snapshot.packet.packaging_contract,template:snapshot.packet.ui_mapping_templates?.[j.plan!.mode],hardGates:snapshot.packet.hard_gates,execution:snapshot.packet.execution});
    if(fresh.packet.creative_quality_contract?.status!=='COMPILED'||fresh.packet.packaging_contract?.status!=='READY_AFTER_QA_AND_FINAL_OUTCOME_REVIEW'||fresh.conflicts.length||contentHash(releasePolicy(fresh))!==contentHash(releasePolicy(j.snapshot)))return this.summary(await this.update(owner,id,revision,current=>{current.state='BLOCKED';current.blockers=['PACKAGE_CANONICAL_DRIFT: refresh or resolve policy before a separately reviewed revision.'];}));
    assertRevision(await this.read(owner,id),revision);
    const lease=await this.options.store.acquireLease?.(owner,id,'package-'+randomUUID(),120_000);
    try{
    const rendered:RenderedOnepage={...j.render,desktop:{...j.render.desktop,bytes:await this.options.artifacts.get(owner,id,j.render.desktop.sha256)},mobile:{...j.render.mobile,bytes:await this.options.artifacts.get(owner,id,j.render.mobile.sha256)}};
    const q=j.qc.overall;
    const result=await (this.options.package??packageOnepage)({input:await this.deliveryInput(j),render:rendered,...input,approval:{inputHash:approved.inputHash,contentRevision:j.contentRevision,reviewer:approved.reviewer,approvedAt:approved.approvedAt},visualReview:{inputHash:j.render.inputHash,desktopHash:j.render.desktop.sha256,mobileHash:j.render.mobile.sha256,reviewer:q.reviewer,method:q.method,observations:q.observations,reviewedAt:q.reviewedAt}});
    if(lease)await this.options.store.assertLease?.(owner,id,lease);
    const artifact=await this.options.artifacts.put(owner,id,result.zip,'application/zip');
    return this.summary(await this.update(owner,id,revision,current=>{current.delivery={...artifact,manifest:result.manifest,inputHash:current.render.inputHash,contentRevision:current.contentRevision};}));
    }finally{if(lease)await this.options.store.releaseLease?.(owner,id,lease);}
  }
}
