/** Owner-only v4 adapter. Pinned v2/v3 compiler sources remain unchanged.
 * A stripped projection is used only to reuse the legacy structural checks;
 * every v4 record is validated before it, restored verbatim, and compiled after it.
 */
import { buildOwnerRulePlan, type OwnerRulePlanResult } from './owner-rule-plan.ts';
import { compileCompatibleQuality, RULE_QUALITY_SCHEMA, stripRuleCatalog } from './agent-rule-quality.ts';
import { QUALITY_CATALOG_SCHEMA, MAX_OWNER_SUPPLEMENTS, sha256, stableJson } from './creative-quality.ts';
import { RULE_COMPILER } from './agent-rule-policy.ts';
const object = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
const clone = (v: any) => JSON.parse(stableJson(v));
const bundles = (n: any): any[] => {
  const c = n?.metadata?.creative_quality_contract;
  return c?.schema_version === QUALITY_CATALOG_SCHEMA && object(c.contracts) ? Object.values(c.contracts) : [c];
};
const hasV4 = (n: any) => bundles(n).some(b => b?.schema_version === RULE_QUALITY_SCHEMA || (object(b) && Object.hasOwn(b, 'agent_rule_reviewed_supplemental_rules')));
const blocked = (code: string, message: string): OwnerRulePlanResult => ({ eligible:false, blockers:[{code,message,next_action:'Resolve the exact canonical catalog or source snapshot before owner acceptance; do not remove existing provenance.'}],plan_kind:null,plan:null,plan_hash:null,additions:[],compiled:[],compiler_version:RULE_COMPILER,visual_qc_performed:false,semantic_consistency:'NOT_PROVEN_BY_DETERMINISTIC_CHECKS' });

/** Only the owner-direct Edge endpoint uses this adapter; it grants no write capability. */
export async function buildCompatibleOwnerRulePlan(snapshot: unknown): Promise<OwnerRulePlanResult> {
  const s = snapshot as any;
  if (!Array.isArray(s?.targets) || !s.targets.some(hasV4)) return buildOwnerRulePlan(snapshot);
  try {
    // Exact structural and mirror validation still occurs in the pinned planner.
    if (!s.compiler_context || !Array.isArray(s.compiler_context.brands) || !Array.isArray(s.compiler_context.brand_dna_nodes)
      || !Array.isArray(s.compiler_context.projected_targets)) return blocked('compiler_snapshot_invalid','The exact owner source and target projections are required.');
    // Projection adapters must never erase a mismatch before structural validation.
    // Compare original full catalogs (including every brand's v4 history) first.
    const master=s.targets.find((n:any)=>n.id===s.compiler_context.master_node_id);
    for(const n of s.targets) {
      const after=s.compiler_context.projected_targets.filter((p:any)=>p.id===n.id);
      if(after.length!==1 || stableJson(after[0].metadata)!==stableJson(n.metadata))
        return blocked('merge_projection_mismatch','Full original metadata and provenance must remain identical in the server content projection.');
      if(s.scope?.branch_slug==='onepage-system') {
        if(!master) return blocked('onepage_master_invalid','The exact shared Onepage master is required.');
        const expected=n.id===master.id?master.metadata:{...clone(master.metadata),active_brand:n.brand_name,onepage_master_brand:'PawfectHouse',onepage_sync_mode:'PAWFECTHOUSE_MASTER_100_PERCENT',cross_brand_onepage_structure:'IDENTICAL_HARD',brand_difference_scope:'BRAND_DNA_EXPRESSION_ONLY'};
        if(stableJson(n.metadata)!==stableJson(expected))
          return blocked('mirror_preservation_blocked','Full Onepage master and mirror catalogs must agree before any compatibility projection.');
      }
    }
    for (const n of s.targets) {
      if(bundles(n).some(b=>stableJson(b).length>100000)) return blocked('quality_bundle_capacity_exceeded','The full original quality bundle exceeds the bounded compiler capacity.');
      const brands=s.compiler_context.brands.filter((b:any)=>b.id===n.brand_id);
      const dnas=s.compiler_context.brand_dna_nodes.filter((d:any)=>d.brand_id===n.brand_id);
      if(brands.length!==1||dnas.length!==1) return blocked('brand_source_missing','Every owner target requires one exact brand and brand DNA source.');
      const before=await compileCompatibleQuality({brand:brands[0],branch:n,brand_dna:dnas[0],visual_references:[]});
      if(before.status!=='COMPILED') return blocked('preexisting_quality_blocked',`${brands[0].slug}: existing v4 contract does not compile (${before.errors.join(', ')}).`);
      const c=n.metadata.creative_quality_contract;
      const b=c?.schema_version===QUALITY_CATALOG_SCHEMA?c.contracts?.[brands[0].slug]:c;
      const all=[...(b.owner_supplemental_rules||[]),...(b.agent_reviewed_supplemental_rules||[]),...(b.agent_rule_reviewed_supplemental_rules||[])];
      if(all.length>=MAX_OWNER_SUPPLEMENTS) return blocked('supplement_capacity_exceeded','The additive owner change exceeds the shared limit of 16 supplements.');
      if(all.some((r:any)=>r.id===`owner:${s.proposal?.id}`||r.proposal_id===s.proposal?.id||r.canonical_text===s.proposal?.proposed_content_md?.trim()))
        return blocked('owner_rule_id_collision','This proposal or verbatim rule already has a compiled supplement.');
    }
    const projected=clone(s);
    for(const n of [...projected.targets,...projected.compiler_context.projected_targets]) n.metadata=stripRuleCatalog(n.metadata);
    const result=await buildOwnerRulePlan(projected);
    if(!result.eligible||!result.plan) return result;
    for(const target of result.plan.targets) {
      const original=s.targets.find((n:any)=>n.id===target.node_id);
      const originalCatalog=original?.metadata?.creative_quality_contract;
      const catalog=target.metadata.creative_quality_contract;
      if(originalCatalog?.schema_version!==QUALITY_CATALOG_SCHEMA||catalog?.schema_version!==QUALITY_CATALOG_SCHEMA)
        return blocked('catalog_required','Owner supplementation requires an existing exact brand-keyed catalog.');
      for(const [brand, prior] of Object.entries(originalCatalog.contracts) as [string,any][]) {
        if(prior.schema_version===RULE_QUALITY_SCHEMA) {
          if(!object(catalog.contracts?.[brand])) return blocked('quality_bundle_missing','An existing v4 brand bundle is missing from the projection.');
          catalog.contracts[brand].schema_version=RULE_QUALITY_SCHEMA;
          catalog.contracts[brand].agent_rule_reviewed_supplemental_rules=clone(prior.agent_rule_reviewed_supplemental_rules);
        }
      }
    }
    for(const target of result.plan.targets) if(bundles(target).some(b=>stableJson(b).length>100000))
      return blocked('quality_bundle_capacity_exceeded','The full proposed quality bundle exceeds the bounded compiler capacity.');
    result.compiled=[];
    for(const target of result.plan.targets) {
      const original=s.targets.find((n:any)=>n.id===target.node_id);
      const brand=s.compiler_context.brands.find((b:any)=>b.id===original.brand_id);
      const dna=s.compiler_context.brand_dna_nodes.find((d:any)=>d.brand_id===original.brand_id);
      const final=await compileCompatibleQuality({brand,branch:{...original,...target},brand_dna:dna,visual_references:[]});
      if(final.status!=='COMPILED'||!final.owner_supplemental_rules.some(r=>r.id===`owner:${s.proposal.id}`&&r.canonical_text===s.proposal.proposed_content_md.trim()))
        return blocked('proposed_quality_blocked',`${brand.slug}: full v4 owner projection does not compile (${final.errors.join(', ')}).`);
      result.compiled.push({node_id:target.node_id,brand_slug:brand.slug,source_hashes:final.source_hashes,contract_hash:final.contract_hash,added_supplement_ids:[`owner:${s.proposal.id}`]});
    }
    result.plan_hash=await sha256(stableJson(result.plan));
    result.compiler_version=RULE_COMPILER;
    return result;
  } catch { return blocked('compiler_error','The owner v4 adapter could not safely validate and preserve the complete original contract.'); }
}
