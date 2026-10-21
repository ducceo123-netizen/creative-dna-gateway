import {z} from 'zod';
import {fingerprint, LDP_JOB_SCHEMA, ldpContentVersion} from './uid-ldp-contract.ts';
import {buildLdpHtmlPreview, LDP_PREVIEW_LAYOUT_SCHEMA, LDP_ASSET_OUTPUT_SCHEMA} from './uid-ldp-html-preview.ts';
import type {ResearchContext} from './supabase/functions/_shared/product-research.ts';
const hash=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const image=z.object({viewport:z.enum(['desktop','mobile']),file_reference:z.string().trim().min(1).max(4000),mime_type:z.enum(['image/png','image/webp','image/jpeg']),checksum:hash,width:z.number().int().positive(),height:z.number().int().positive(),section_ids:z.array(z.string()).min(1),inspected_at:z.string().datetime({offset:true}),inspection_note:z.string().trim().min(40).max(4000),full_page:z.literal(true),copy_legible:z.literal(true),assets_visible:z.literal(true),no_placeholders:z.literal(true)}).strict();
export const LDP_DESIGN_DRAFT_SCHEMA=z.object({schema_version:z.literal('uid-ldp-design-draft/1'),task_id:z.string().min(1),content_version:hash,mapping_hash:hash,images:z.array(image).length(2)}).strict();
export const LDP_DESIGN_DRAFT_CONTRACT={schema_version:'uid-ldp-design-draft/1',delivery_mode:'complete_design_draft',delivery_requirement:'COMPLETE_DESKTOP_MOBILE_DRAFT_AND_MAPPING',hosted_url_required:false,selection:'CHAT_FEEDBACK_WITH_EXACT_SECTION_ELEMENT_IDS',auto_send:false,input_shape:z.toJSONSchema(LDP_DESIGN_DRAFT_SCHEMA),instruction:'Deliver complete, genuinely rendered desktop and mobile full-page design images as attachments plus the exact copy/section/card/destination/asset mapping, layout hierarchy and brand token sources. The user rebuilds the design in Figma; no hosted web demo, deployment, interactive feedback UI or Figma creation is required. Images must contain every section in order, readable final copy and actual mapped assets, not wireframes/placeholders. Inspect both actual image files before supplying truthful revision-bound receipts. Keep research, product truth, dimensions and scoped feedback/version checks. Local HTML may be used as an optional rendering aid only. Missing source, asset, image or inspection is a concrete blocker, never a reason to invent QC.'};
export function prepareLdpDesignDraft(raw:unknown,context:ResearchContext,snapshot:string,outputs:unknown,layout:unknown){
 // Reuse existing strict plan, authority, source, asset and layout validation; no publication or QC occurs.
 const preview=buildLdpHtmlPreview(raw,context,snapshot,outputs,layout),job=LDP_JOB_SCHEMA.parse(raw);
 if(job.page_manifest.scope!=='complete_ldp')throw new Error('COMPLETE_LDP_REQUIRED_FOR_FINAL_DRAFT');
 const mapping={schema_version:'uid-ldp-design-mapping/1',task_id:job.task_id,content_version:ldpContentVersion(job),canonical_snapshot:snapshot,scope:job.page_manifest.scope,sections:job.sections,asset_specs:job.assets,evidence:job.evidence,assets:outputs,baseline_source:{url:job.baseline.url,observed_at:job.baseline.observed_at},layout:LDP_PREVIEW_LAYOUT_SCHEMA.parse(layout),brand_tokens:job.baseline.tokens,token_evidence:job.baseline.token_evidence,design_strategy:job.design_strategy,elements:preview.manifest.elements};
 return {mapping,mapping_hash:fingerprint(mapping)};
}
export function validateLdpDesignDraft(raw:unknown,context:ResearchContext,snapshot:string,outputs:unknown,layout:unknown,receipt:unknown){
 const prepared=prepareLdpDesignDraft(raw,context,snapshot,outputs,layout),job=LDP_JOB_SCHEMA.parse(raw),r=LDP_DESIGN_DRAFT_SCHEMA.parse(receipt);
 if(r.task_id!==job.task_id||r.content_version!==prepared.mapping.content_version||r.mapping_hash!==prepared.mapping_hash)throw new Error('STALE_OR_WRONG_DRAFT_IDENTITY');
 if(new Set(r.images.map(i=>i.viewport)).size!==2)throw new Error('DESKTOP_AND_MOBILE_DRAFT_REQUIRED');
 const expected=job.sections.map(s=>s.id);
 for(const i of r.images){if(JSON.stringify(i.section_ids)!==JSON.stringify(expected))throw new Error('EXACT_ORDERED_FULL_PAGE_SECTIONS_REQUIRED');if(i.width!==job.baseline[i.viewport].width)throw new Error('DRAFT_VIEWPORT_WIDTH_MISMATCH');if(Date.parse(i.inspected_at)>Date.now())throw new Error('FUTURE_INSPECTION_RECEIPT');}
 if(r.images[0].file_reference===r.images[1].file_reference||r.images[0].checksum===r.images[1].checksum)throw new Error('DISTINCT_DESKTOP_MOBILE_RENDERS_REQUIRED');
 return {...prepared,status:'HOST_REPORTED_DRAFT_READY_FOR_HANDOFF',receipt:r,visual_qc_performed:false,source_attestation:'HOST_REPORTED_NOT_INDEPENDENTLY_VERIFIED',limitations:['Gateway validates structure and revision bindings only; it does not download or inspect image pixels.','The executing host must inspect real bytes, verify hashes and attach the exact files. Receipt claims do not certify output quality.']};
}
export function attachLdpDesignDraft<T extends Record<string,any>>(data:T,context:ResearchContext={}):T & Record<string,any>{
 if(!data.ldp_workflow_contract)return data;
 const r=context.research as any,result={...data,ldp_preview_contract:{...LDP_DESIGN_DRAFT_CONTRACT,layout_input_shape:z.toJSONSchema(LDP_PREVIEW_LAYOUT_SCHEMA),asset_outputs_input_shape:z.toJSONSchema(z.array(LDP_ASSET_OUTPUT_SCHEMA).max(100))}};
 if(!r?.ldp_asset_outputs)return result;
 if(data.readiness?.ldp_plan==='BLOCKED')return {...result,ldp_design_draft:{status:'BLOCKED',issues:['CANONICAL_POLICY_BLOCKED']}};
 try {const args=[r.ldp_job,context,data.ldp_workflow_contract.canonical_snapshot,r.ldp_asset_outputs,r.ldp_preview_layout] as const;return {...result,ldp_design_draft:r.ldp_design_draft===undefined?{...prepareLdpDesignDraft(...args),status:'REQUIRES_ACTUAL_DESKTOP_MOBILE_IMAGES_AND_INSPECTION',visual_qc_performed:false}:validateLdpDesignDraft(...args,r.ldp_design_draft)};}catch(e){return {...result,ldp_design_draft:{status:'NEEDS_INPUT',issues:[e instanceof z.ZodError?'INVALID_DESIGN_DRAFT_PACKET':e instanceof Error?e.message:'INVALID_DESIGN_DRAFT_INPUT']}};}
}
