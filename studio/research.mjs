// UID Brands Studio: public Shopify research collection, without AI or privileged storefront access.
// Never follow redirects, fetch arbitrary hosts, or claim inaccessible data was reviewed.
const STORES=Object.freeze({PawfectHouse:'https://pawfecthouse.com',GiftSoul:'https://giftsoul.co',SoulPrise:'https://soulprise.co'});
function sourceFor(brand,raw){
 const host=STORES[brand];
 if(!host)throw Error('Unsupported brand');
 const input=String(raw||'').trim();
 let url;
 if(/^https:\/\//i.test(input)){if(/(?:\/|%2f)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|%2f)/i.test(input))throw Error('Path traversal is not permitted');url=new URL(input);}
 else if(input.includes('://'))throw Error('HTTPS source required');
 else if(input.length>=2&&input.length<150&&/^[\p{L}\p{N}\s-]+$/u.test(input)){
  const slug=input.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  url=new URL('/collections/'+slug,host);
 }else throw Error('Use a collection/product URL or a short name');
 if(url.origin!==host||url.username||url.password||url.search||url.hash)throw Error('Source must be a clean URL on the selected brand storefront');
 const parts=url.pathname.split('/').filter(Boolean);
 if(parts.length!==2||!['collections','products'].includes(parts[0])||!/^[a-z0-9][a-z0-9-]{0,130}$/.test(parts[1]))throw Error('Only direct Shopify product and collection URLs are supported');
 return {brand,type:parts[0]==='collections'?'collection':'product',slug:parts[1],url:host+'/'+parts.join('/')};
}
async function fetchJSON(url,max=350000){
 const r=await fetch(url,{headers:{Accept:'application/json','User-Agent':'UIDBrandsStudio/1.0'},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('Storefront response '+r.status);
 if(Number(r.headers.get('content-length')||0)>max)throw Error('Store response too large');
 const txt=await r.text();
 if(txt.length>max)throw Error('Store response exceeds safe limit');
 return JSON.parse(txt);
}
function cleanHtml(s){return String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim().slice(0,1800);}
function normalizeProduct(p,base){
 const handle=String(p?.handle||'');
 if(!/^[a-z0-9][a-z0-9-]{0,130}$/.test(handle))return null;
 const imageCandidates=Array.isArray(p.images)?p.images:[];
 const images=imageCandidates.slice(0,8).map(x=>typeof x==='string'?x:x?.src).filter(x=>typeof x==='string'&&/^https:\/\//i.test(x)).slice(0,8);
 const variants=(Array.isArray(p.variants)?p.variants:[]).slice(0,12).map(x=>({
   title:String(x?.title||'').slice(0,100),available:typeof x?.available==='boolean'?x.available:null,
   options:[x?.option1,x?.option2,x?.option3].filter(Boolean).map(z=>String(z).slice(0,80))
 }));
 return {title:String(p.title||'').slice(0,180),handle,url:base+'/products/'+handle,
   description:cleanHtml(p.body_html||p.description||''),images,variants,variantCount:Array.isArray(p.variants)?p.variants.length:0};
}
async function scanPublicSource(brand,raw){
 const source=sourceFor(brand,raw);
 const startedAt=new Date().toISOString();
 const failures=[];
 const products=[];
 let collectionTitle=null;
 if(source.type==='product'){
  const j=await fetchJSON(source.url+'.js');
  const p=normalizeProduct(j,STORES[brand]);
  if(!p)throw Error('Store did not return valid product data');
  products.push(p);
 }else{
  // Public Shopify JSON is paginated and sometimes restricted. Never claim full coverage.
  const seen=new Set();
  for(let page=1;page<=3;page++){
   try{
    const endpoint=source.url+'/products.json?limit=24'+(page===1?'':'&page='+page);
    const j=await fetchJSON(endpoint,500000);
    const batch=(Array.isArray(j?.products)?j.products:[]).slice(0,24);
    for(const p of batch){
     const clean=normalizeProduct(p,STORES[brand]);
     if(clean&&!seen.has(clean.handle)){products.push(clean);seen.add(clean.handle);}
    }
    if(batch.length<24)break;
    if(page===3)failures.push('Public scan capped at 72 products; collection may contain more');
   }catch(e){
    failures.push('Collection page '+page+' unavailable: '+String(e.message).slice(0,120));
    break;
   }
  }
  if(!products.length)failures.push('Collection products endpoint returned no usable products');
  try{
   const j=await fetchJSON(source.url+'.json',350000);
   collectionTitle=String(j?.collection?.title||'').slice(0,180)||null;
  }catch(e){failures.push('Collection metadata unavailable: '+String(e.message).slice(0,120));}
 }
 const status=products.length?'partial':'blocked';
 return {schema_version:'studio-research-v1',task_source:source.url,brand,type:source.type,
  source_title:collectionTitle||products[0]?.title||null,scanned_at:startedAt,status,
  products,product_count:products.length,maximum_products:source.type==='collection'?72:1,
  warnings:[...failures,'Collection scan captures at most 72 products; compare with live collection for coverage.','External customer reviews and competitor sources are NOT scanned by this collector.','Images and variants are storefront metadata only; physical construction and fidelity require manual/AI verification.'],
  evidence:[{url:source.url,source:'brand storefront',access:'public',captured_at:startedAt}],
  required_ai_gates:['Verify PDP/gallery/materials and product construction','Research verified external buyer feedback','Select Good To Know or FAQs based on evidence','Creative DNA content and visual QA']};
}
export {sourceFor,scanPublicSource};
