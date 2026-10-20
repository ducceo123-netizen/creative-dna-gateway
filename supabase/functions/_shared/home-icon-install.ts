import { HOME_ICON_CONTENT, HOME_ICON_GUIDE, HOME_ICON_INPUT, HOME_ICON_METADATA, HOME_ICON_REVISION } from './home-icon.ts';
const canonical = (value:any):string => JSON.stringify(value, (_key, val) => val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a],[b])=>a.localeCompare(b))) : val);
const fixed = { node_type:'material',slug:'home-icon',title:'PawfectHouse Home Icon Material Recipe',version:'1.0',confidence:'contextual',content_md:HOME_ICON_CONTENT,metadata:HOME_ICON_METADATA,input_schema:HOME_ICON_INPUT };
const matches = (node:any) => node && ['draft','active'].includes(node.status) && Object.entries(fixed).every(([key,value])=>canonical(node[key])===canonical(value));
/** Called ONLY after the existing verified active-admin check. No arbitrary node payload accepted. */
export async function installHomeIcon(db:any, body:any) {
  if (body?.confirm_revision !== HOME_ICON_REVISION) return {status:422,body:{error:'Review and confirm the exact Home Icon revision first.',revision:HOME_ICON_REVISION}};
  const {data:brand,error:brandError}=await db.from('brands').select('id').eq('slug','pawfecthouse').single();
  if(brandError||!brand) return {status:409,body:{error:'PawfectHouse brand unavailable; nothing changed.'}};
  const read=()=>db.from('knowledge_nodes').select('id,status,node_type,slug,title,version,confidence,content_md,metadata,input_schema').eq('brand_id',brand.id).eq('slug','home-icon');
  let {data:nodes,error}=await read();
  if(error) return {status:503,body:{error:'Cannot verify existing Home Icon. No write attempted.'}};
  if(nodes?.length>1 || nodes?.some((n:any)=>!matches(n)))
    return {status:409,body:{error:'Home Icon already exists with different content/status. Use governed review; not overwritten.'}};
  let node=nodes?.[0];
  if(!node){
    const inserted=await db.from('knowledge_nodes').insert({brand_id:brand.id,...fixed,status:'draft'}).select('id,status,node_type,slug,title,version,confidence,content_md,metadata,input_schema').single();
    if(inserted.error){
      // Resolve unique-key races by a read, never a blind repeated write.
      const current=await read();
      if(current.error||current.data?.length!==1||!matches(current.data[0]))
        return {status:409,body:{error:'Creation outcome not confirmed. Read current route before retrying.'}};
      node=current.data[0];
    } else node=inserted.data;
  }
  const {data:guide,error:guideReadError}=await db.from('branch_visual_guides').select('*').eq('brand_slug','pawfecthouse').eq('branch_slug','home-icon').maybeSingle();
  if(guideReadError) return {status:503,body:{error:'Guide read failed. Draft remains inactive; check state before retry.'}};
  if(guide&&Object.entries(HOME_ICON_GUIDE).some(([key,value])=>guide[key]!==value)) return {status:409,body:{error:'An existing Home Icon guide differs. Draft remains inactive; no overwrite.'}};
  if(node.status==='active') return guide ? {status:200,body:{installed:true,already_active:true,brand:'pawfecthouse',branch:'home-icon',revision:HOME_ICON_REVISION,output_owner_approved:false}} : {status:409,body:{error:'Active Home Icon is missing its guide. Inspect current state; no silent repair.'}};
  if(!guide){
    const created=await db.from('branch_visual_guides').insert(HOME_ICON_GUIDE);
    if(created.error) return {status:409,body:{error:'Guide creation not confirmed. Draft remains inactive; inspect before retry.'}};
  }
  const active=await db.from('knowledge_nodes').update({status:'active',updated_at:new Date().toISOString()}).eq('id',node.id).eq('status','draft').eq('content_md',HOME_ICON_CONTENT).eq('metadata',JSON.stringify(HOME_ICON_METADATA)).eq('input_schema',JSON.stringify(HOME_ICON_INPUT)).eq('node_type',fixed.node_type).eq('title',fixed.title).eq('version',fixed.version).eq('confidence',fixed.confidence).eq('slug',fixed.slug).select('id,status').maybeSingle();
  if(active.error||active.data?.status!=='active') return {status:409,body:{error:'Activation not confirmed. Check live route; do not repeat blindly.'}};
  return {status:200,body:{installed:true,brand:'pawfecthouse',branch:'home-icon',revision:HOME_ICON_REVISION,output_owner_approved:false}};
}
