import {readFileSync,statSync,openSync,writeFileSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
export const ALLOWED_ORIGIN='https://uid-brands-architecture-v2-test.onrender.com';
export const BASELINE_COMMIT='87bf39d1f38eb1d0baee159b921efbd7e3aaf923';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function argumentsFor(names){
 const values={};const args=process.argv.slice(2);
 if(args.length===1&&['--help','-h'].includes(args[0])){const mode=names.includes('before')?'resume':'smoke';console.log(`Node.js 24.14+, no npm dependencies.\nUsage: node ${mode}.mjs --origin ${ALLOWED_ORIGIN} --token-file /private/token.txt --output /new/report.json${mode==='resume'?' --before /prior/smoke.json --deployment dep-ID':''} [--source-commit COMMIT_SHA]\nThe token file must be private (chmod 600); output must not already exist.\n${mode==='smoke'?'Creates/resumes one isolated test job and uploads a labelled synthetic PNG.':'Reads an existing job and bytes; does not restart, deploy or upload.'}\nNo production endpoint is contacted.`);process.exit(0);}
 for(let i=0;i<args.length;i+=2){const flag=args[i];if(!flag?.startsWith('--')||!names.includes(flag.slice(2))||!args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(values,flag.slice(2)))throw Error('INVALID_ARGUMENTS');values[flag.slice(2)]=args[i+1];}
 for(const key of ['origin','token-file','output'])if(!values[key])throw Error('REQUIRED_ARGUMENT_MISSING');
 if(values.origin!==ALLOWED_ORIGIN)throw Error('ISOLATED_ORIGIN_REQUIRED');
 if(values['source-commit']&&!/^[a-f0-9]{7,40}$/.test(values['source-commit']))throw Error('INVALID_SOURCE_COMMIT_LABEL');
 return values;
}
export function privateToken(filename){
 const info=statSync(filename);if(!info.isFile()||info.size>8192||(info.mode&0o077)!==0)throw Error('PRIVATE_TOKEN_FILE_REQUIRED');
 const token=readFileSync(filename,'utf8').trim();if(!/^uidv2_[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('PRIVATE_CREDENTIAL_FORMAT_INVALID');return token;
}
export function reportWriter(filename,protectedFiles=[]){
 if(protectedFiles.some(path=>resolve(path)===resolve(filename)))throw Error('OUTPUT_MUST_BE_A_NEW_FILE');
 // Exclusive creation refuses existing files and symlinks, including credential
 // aliases. Reports are private by default even though secret values are absent.
 const fd=openSync(filename,'wx',0o600);let closed=false;
 return report=>{try{writeFileSync(fd,JSON.stringify(report,null,2)+'\n');}finally{if(!closed){closeSync(fd);closed=true;}}};
}
export function parsePacket(raw){const json=raw.startsWith('{')?raw:raw.split(/\r?\n/).filter(line=>line.startsWith('data:')).at(-1)?.slice(5);if(!json)throw Error('MCP_RESPONSE_INVALID');return JSON.parse(json);}
export function createClient(origin,token,operations=[]){
 let sequence=0;
 const request=(path,options={})=>fetch(origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(110000)});
 const rpc=async(method,params={},options={})=>{
  const version=options.version||'2025-06-18',started=performance.now();
  const response=await request('/api/mcp',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':version,...(version==='2026-07-28'?{'Mcp-Method':method,...(params.name?{'Mcp-Name':params.name}:{})}:{})},body:JSON.stringify({jsonrpc:'2.0',...(options.notification?{}:{id:++sequence}),method,params})});
  const raw=await response.text(),packet=raw?parsePacket(raw):null;operations.push({method,...(params.name?{name:params.name}:{}),protocol:version,status:response.status,responseBytes:Buffer.byteLength(raw),durationMs:Math.round(performance.now()-started)});
  if(options.allowError)return {response,packet};
  if(!response.ok||packet?.error||packet?.result?.isError){let code='REQUEST_REJECTED';try{const candidate=JSON.parse(packet.result.content[0].text).error.code;if(/^[A-Z_]{1,80}$/.test(candidate))code=candidate;}catch{}operations.at(-1).errorCode=code;throw Error('MCP_OPERATION_FAILED_'+code);}
  return packet?.result;
 };
 return {request,rpc,tool:async(name,input)=>JSON.parse((await rpc('tools/call',{name,arguments:input})).content[0].text)};
}
export function safeFailure(error){return {code:typeof error.code==='string'&&/^[A-Z_0-9]+$/.test(error.code)?error.code:error.name||'CHECK_FAILED',message:/^(?:MCP_|ISOLATED_|PRIVATE_|INVALID_|REQUIRED_|OUTPUT_)/.test(error.message)?error.message:'A request or assertion failed. Review the last recorded operation; no credentials are included.'};}
export function setupFailure(error){console.error(JSON.stringify({status:'SETUP_FAILED',error:safeFailure(error),credentialsPrinted:false}));process.exitCode=1;}
