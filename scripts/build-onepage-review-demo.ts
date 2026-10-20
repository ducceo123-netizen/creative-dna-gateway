/** Clearly labeled demonstration using exact canonical layout, not a real task output. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {getOnepageUiTemplate} from '../onepage-ui-template.ts';
import {packageOnepageReview} from '../public/onepage-review-pack.mjs';
const template:any=getOnepageUiTemplate(undefined,'source');
const assetPath='onepage-feedback-demo-asset.svg';
const checksum='sha256:'+createHash('sha256').update(readFileSync(new URL('../public/'+assetPath,import.meta.url))).digest('hex');
let html=template.html.replace('href="styles.css"',`href="/api/onepage-ui-template/${template.version}/styles.css"`);
for(const slot of template.asset_slots)html=html.replaceAll('{{'+slot+'}}',assetPath);
for(const slot of template.text_slots)html=html.replaceAll('{{'+slot+'}}',slot.startsWith('title')?'Demo '+slot:'Demonstration copy only. Click this text to select it and add feedback.');
html=html.replace('<body>','<body><p role="note" style="padding:12px;background:#fff5cd;color:#222;font:14px system-ui">DEMO · Onepage element feedback · This is not a customer task or generated product. Layout uses the canonical Onepage template; images and copy are deliberately demo-only. Resize the browser to review mobile.</p>');
const manifest={schema_version:'uid-onepage-preview/1',task_id:'DEMO-ONEPAGE-NOT-A-REAL-TASK',content_version:'demo-v1',brand:'pawfecthouse',template_version:template.version,asset_manifest:template.asset_slots.map((slot:string)=>({slot,asset_id:'DEMO-SHARED-PLACEHOLDER',file_url:assetPath,checksum}))};
const result=packageOnepageReview(html,manifest,readFileSync(new URL('../public/onepage-review.js',import.meta.url),'utf8'),readFileSync(new URL('../public/onepage-review.css',import.meta.url),'utf8'));
writeFileSync(new URL('../public/onepage-feedback-demo.html',import.meta.url),result.html);
