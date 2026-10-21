/** Explicit retirement prevents the generic SPA fallback from pretending old demos still exist. */
export const RETIRED_LDP_DEMO_PATHS=new Set(['/ldp-feedback-demo.html','/previews/sport-lovers-v9','/previews/sport-lovers-v9/','/previews/sport-lovers-v9/index.html','/previews/cooking-bbq-v1','/previews/cooking-bbq-v1/','/previews/cooking-bbq-v1/index.html','/previews/cooking-bbq-v1/page.html']);
export const isRetiredLdpDemo=(path:string)=>RETIRED_LDP_DEMO_PATHS.has(path);
