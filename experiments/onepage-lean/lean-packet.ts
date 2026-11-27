// Experimental only. No network, DB, or production integration.
import { isDeepStrictEqual } from "node:util";
type Packet = Record<string, any>;
const pairs = [
 ["ui_mapping_template","ui_mapping_templates.gtk"],
 ["owner_supplemental_contract.rules","creative_quality_contract.owner_supplemental_rules"],
 ["agent_rule_reviewed_supplemental_contract.rules","creative_quality_contract.agent_rule_reviewed_supplemental_rules"],
 ["ui_mapping_templates.faq.production_qc_contract","ui_mapping_templates.gtk.production_qc_contract"],
 ["ui_mapping_templates.faq.portable_quality_playbook","ui_mapping_templates.gtk.portable_quality_playbook"],
 ["ui_mapping_templates.faq.live_html_feedback","ui_mapping_templates.gtk.live_html_feedback"],
] as const;
function parent(o: Packet, path: string) {
 const keys=path.split("."); const key=keys.pop()!;
 for(const k of keys){ if(!o || typeof o!=="object" || !Object.hasOwn(o,k)) return undefined; o=o[k]; }
 return o && typeof o==="object" ? {o,key}:undefined;
}
function get(o: Packet,path:string){const p=parent(o,path);return p&&Object.hasOwn(p.o,p.key)?p.o[p.key]:undefined;}
export function compactOnepage(packet:Packet){
 const data=structuredClone(packet);
 const aliases: Record<string,string>={};
 for(const [dest,source] of pairs){
  const a=get(data,dest), b=get(data,source);
  if(a!==undefined && b!==undefined && isDeepStrictEqual(a,b)){
   const p=parent(data,dest)!; delete p.o[p.key]; aliases[dest]=source;
  }
 }
 return {schema:"onepage-lean-experiment/v1" as const,data,aliases};
}
export function restoreOnepage(compact:ReturnType<typeof compactOnepage>){
 const data=structuredClone(compact.data);
 for(const [dest,source] of Object.entries(compact.aliases).reverse()){
  if(!pairs.some(([a,b])=>a===dest&&b===source)) throw new Error("Unknown alias");
  const p=parent(data,dest), value=get(data,source);
  if(!p || Object.hasOwn(p.o,p.key) || value===undefined) throw new Error("Invalid alias");
  p.o[p.key]=structuredClone(value);
 }
 return data;
}
export function benchmarkOnepage(packet:Packet){
 const compact=compactOnepage(packet);
 const roundtrip=isDeepStrictEqual(packet,restoreOnepage(compact));
 if(!roundtrip) throw new Error("Lossless invariant failed");
 const before=Buffer.byteLength(JSON.stringify(packet));
 const after=Buffer.byteLength(JSON.stringify(compact));
 return {before,after,saved:before-after,percent:before?100*(before-after)/before:0,roundtrip,aliases:compact.aliases};
}
