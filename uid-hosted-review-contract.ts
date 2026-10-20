/** Shared delivery requirements: generating HTML is not delivering a working browser link. */
export const HOSTED_REVIEW_ORIGIN='https://uid-brands-gateway-preview.onrender.com';
export function hostedReviewDeliveryContract(kind:'ldp'|'onepage',identity?:{type:'task'|'outcome';id:string},contentVersion?:string,renderHash?:string){return {
 schema_version:'uid-hosted-review-delivery/1',status:'REQUIRES_HOSTED_PUBLICATION',delivery_requirement:'REQUIRED_HOSTED_VERIFIED_URL',kind,identity:identity||null,content_version:contentVersion||null,render_hash:renderHash||null,
 publishing_method:'AUTHORIZED_REPOSITORY_RENDER_DEPLOY',publication_cli:'node --import tsx scripts/publish-hosted-review.ts delivery-input.json actual-output-directory',
 required_inputs:['Actual bound HTML from this outcome revision, not a demonstration.','Exact task identity, or explicit outcome identity when no registered task exists.','Canonical template CSS and exact raster asset bytes, with canonical Asset IDs, source URLs and SHA-256 checksums.','User authorization to publish the actual outcome and assets.'],
 completion_gate:['Deploy the immutable repository bundle to Render.','Verify index.html, delivery.json, every CSS/image HTTP response and file digest against the bundle receipt.','Check expected identity, content_version and render_hash against the actual requested revision.','Browser-check desktop/mobile, element feedback, real images and copy. Return the verified direct HTML URL.'],
 missing_source_rule:'If real bound HTML, actual image bytes, copy or exact revision identity is missing, report the exact missing source. Do not substitute demo assets, a different task, a generic tool page or a download link.',
 missing_hosting_rule:'If publication or HTTP/browser verification is blocked, report the exact hosting/verification blocker. A local HTML file or staged URL is not a completed preview delivery.',
 safety:'Never publish signed/private source URLs, credentials or unapproved personal/private material. No arbitrary HTML upload API. Publishing is a reviewed repository change; feedback never auto-submits.'
};}
