// Offline experimental runner; never calls production, modifies data, or deploys.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { compactOnepage,restoreOnepage,benchmarkOnepage } from "./lean-packet.ts";
const files=process.argv.slice(2);
if(!files.length) throw new Error("Usage: node --import tsx experiments/onepage-lean/benchmark.ts <compiler-response.json> [...]");
for(const file of files){
 const raw=readFileSync(file,"utf8");
 const parsed=JSON.parse(raw);
 const p=typeof parsed.text==="string"?JSON.parse(parsed.text.split("\n")[0]):parsed;
 if(!p.resolved || !p.hard_gates || !Array.isArray(p.execution) || !Array.isArray(p.assets)) throw new Error("Not a complete compiler packet: "+file);
 const restored=restoreOnepage(compactOnepage(p));
 for(const key of ["hard_gates","execution","assets","resolved","creative_quality_contract","research_contract","ui_mapping_templates"]){
  if(!isDeepStrictEqual(p[key],restored[key])) throw new Error("Coverage mismatch: "+key);
 }
 console.log(JSON.stringify({file,brand:p.resolved.brand,...benchmarkOnepage(p),steps:p.execution.length,slots:p.assets.length,gates:Object.keys(p.hard_gates).length},null,2));
}
