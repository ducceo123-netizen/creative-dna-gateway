/**
 * OAuth resource protection for the isolated UID Brands member MCP endpoint.
 * The authorization server is Supabase Auth; UID never issues OAuth tokens.
 * Reuse Clipo's member MCP admission check, which validates auth.getUser()
 * and an active creative_dna_team_members row on every request.
 */
export const UID_MEMBER_MCP_RESOURCE="https://uid-brands-gateway-preview.onrender.com/api/mcp-member";
export const UID_MEMBER_OAUTH_ISSUER="https://wuonwttmkadwsmefjukv.supabase.co/auth/v1";
export const UID_MEMBER_OAUTH_METADATA="https://uid-brands-gateway-preview.onrender.com/.well-known/oauth-protected-resource/api/mcp-member";
const CLIPO_MEMBER_MCP="https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/clipo-research-refs/member/mcp";
export function memberResourceMetadata(){
 return {resource:UID_MEMBER_MCP_RESOURCE,authorization_servers:[UID_MEMBER_OAUTH_ISSUER],
   bearer_methods_supported:["header"],resource_documentation:"https://uid-brands-gateway-preview.onrender.com/api/mcp-info"};
}
export function memberAuthChallenge(){
 return `Bearer resource_metadata="${UID_MEMBER_OAUTH_METADATA}"`;
}
export type MemberCheck={status:"authorized"|"missing_bearer"|"invalid_or_inactive"|"provider_unavailable",code:200|401|403|503};
export async function verifyMemberBearer(authorization:string|undefined,
 fetcher:typeof fetch=fetch):Promise<MemberCheck>{
 if(!authorization||!/^Bearer [^\s]{1,8192}$/i.test(authorization))
   return {status:"missing_bearer",code:401};
 try{
   const res=await fetcher(CLIPO_MEMBER_MCP,{method:"POST",redirect:"error",
     headers:{"Authorization":authorization,"Content-Type":"application/json",
       "Accept":"application/json, text/event-stream","MCP-Protocol-Version":"2025-06-18"},
     body:JSON.stringify({jsonrpc:"2.0",id:1,method:"ping"}),signal:AbortSignal.timeout(6000)});
   if(res.status===401||res.status===403)return {status:"invalid_or_inactive",code:res.status};
   if(res.status!==200)return {status:"provider_unavailable",code:503};
   const payload=await res.json();
   if(payload?.jsonrpc!=="2.0"||payload?.id!==1||!payload.result||payload.error)
     return {status:"provider_unavailable",code:503};
   return {status:"authorized",code:200};
 }catch{return {status:"provider_unavailable",code:503};}
}

/** Detect whether the external OAuth 2.1 issuer is configured, without secrets. */
export async function oauthIssuerReadiness(fetcher:typeof fetch=fetch):Promise<{status:"ready"|"not_configured"|"unavailable";reason:string}>{
 const endpoint="https://wuonwttmkadwsmefjukv.supabase.co/.well-known/oauth-authorization-server/auth/v1";
 try{
  const res=await fetcher(endpoint,{method:"GET",redirect:"error",
    headers:{Accept:"application/json"},signal:AbortSignal.timeout(6500)});
  if(res.status===404||res.status===501)return {status:"not_configured",reason:"issuer_discovery_not_enabled"};
  if(!res.ok)return {status:"unavailable",reason:"issuer_http_"+res.status};
  const meta=await res.json();
  const valid=meta?.issuer===UID_MEMBER_OAUTH_ISSUER &&
    typeof meta?.authorization_endpoint==="string"&&
    typeof meta?.token_endpoint==="string"&&
    (Array.isArray(meta?.code_challenge_methods_supported)?meta.code_challenge_methods_supported.includes("S256"):false);
  return valid?{status:"ready",reason:"issuer_discovery_valid"}:
    {status:"not_configured",reason:"issuer_metadata_incomplete"};
 }catch{return {status:"unavailable",reason:"issuer_check_unavailable"};}
}
