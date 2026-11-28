/** Transport projections only. Persisted jobs, canonical bundles and gate inputs
 * keep their original schemas. Full state/context remain explicitly available. */
import { compactState } from './wire-state.ts';
import { compactStageContext } from './wire-context.ts';

const stateTools=new Set(['onepage_start','onepage_get_state','onepage_submit_research','onepage_submit_plan','onepage_submit_asset','onepage_submit_qc','onepage_advance','onepage_revision','onepage_render','onepage_approve','onepage_package']);
export function projectToolResult(name:string,result:any,detail?:'full'|'compact') {
  if(detail==='full')return result;
  if(name==='onepage_get_stage_context')return compactStageContext(result);
  if(!stateTools.has(name))return result;
  // Research validation and render/package metadata are independent of state.
  // Never strip fields from validators or novel wrapper shapes.
  if(result&&typeof result==='object'&&result.state&&typeof result.state==='object')return {...result,state:compactState(result.state)};
  return compactState(result);
}
