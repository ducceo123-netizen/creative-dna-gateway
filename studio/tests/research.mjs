import assert from 'node:assert/strict';
import {sourceFor,scanPublicSource} from '../research.mjs';
assert.deepEqual(
 {type:sourceFor('PawfectHouse','https://pawfecthouse.com/collections/christmas-bone-stockings').type,
 slug:sourceFor('PawfectHouse','https://pawfecthouse.com/collections/christmas-bone-stockings').slug},
 {type:'collection',slug:'christmas-bone-stockings'});
for(const url of ['http://pawfecthouse.com/products/thing','https://localhost/private','https://pawfecthouse.com.evil.com/products/a','https://pawfecthouse.com/products/a?x=1','https://pawfecthouse.com/products/a/../b','https://pawfecthouse.com/products/a/extra']){
 assert.throws(()=>sourceFor('PawfectHouse',url));
}
const oldFetch=globalThis.fetch;
const accessed=[];
globalThis.fetch=async(url)=>{
 accessed.push(String(url));
 const data=String(url).endsWith('/products.json?limit=24')?
 {products:[{handle:'custom-stockings',title:'Christmas Bone Stockings',body_html:'<p>Personalized holiday stocking</p>',images:['https://cdn.shopify.com/x.jpg'],variants:[{title:'Default',available:true,option1:'Red'}]}]}:
 {collection:{title:'Christmas Bone Stockings'}};
 return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(data)};
};
try{
 const result=await scanPublicSource('PawfectHouse','https://pawfecthouse.com/collections/christmas-bone-stockings');
 assert.equal(result.type,'collection');
 assert.equal(result.product_count,1);
 assert.equal(result.products[0].title,'Christmas Bone Stockings');
 assert.equal(result.status,'partial');
 assert.equal(result.products[0].images.length,1);
 assert.ok(result.warnings.some(x=>x.includes('NOT scanned')));
 assert.equal(accessed.length,2);
 assert.ok(accessed.every(x=>x.startsWith('https://pawfecthouse.com/')));
}finally{globalThis.fetch=oldFetch;}
console.log('Research collector origin, capture, evidence and limits passed');
