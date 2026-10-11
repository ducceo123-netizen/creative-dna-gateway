import { createReferenceLibraryHandler } from '../_shared/reference-library.ts';
import { referenceLibraryRuntime } from '../_shared/reference-library-runtime.ts';

function envKey(name: string) {
  try { return JSON.parse(Deno.env.get(name) || '{}').default || ''; } catch { return ''; }
}
const config = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') || '',
  publishableKey: envKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY') || '',
  serviceKey: envKey('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
};
let handler: ((request: Request) => Promise<Response>) | undefined;
try { handler = createReferenceLibraryHandler(referenceLibraryRuntime(config), true); } catch { /* Fail closed. */ }
export default {
  fetch: (request: Request) => handler ? handler(request) : Response.json({ error: 'PRIVATE_REFERENCE_SERVICE_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }),
};
