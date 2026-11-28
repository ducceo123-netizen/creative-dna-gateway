import assert from 'node:assert/strict';

/** Inject into an evaluated Edge handler, never global fetch. Synthetic reference
 * discovery only: these policy tests must not contact the production Clipo API. */
export function publicClipoNoMatch() {
  const requests: Array<{url:string;body:any}> = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const body=JSON.parse(String(init?.body));requests.push({url:String(url),body});
    return Response.json({jsonrpc:'2.0',id:body.id,result:{structuredContent:{status:'no_match',matches:[]}}});
  };
  const verify=() => {
    for(const request of requests){
      assert.equal(request.url,'https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/clipo-research-refs/mcp');
      assert.equal(request.body.method,'tools/call');
      assert.equal(request.body.params.name,'search_reference_packs');
    }
  };
  return {fetch,verify};
}
