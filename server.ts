import express, { Request, Response } from "express";
import path from "path";
import { attachOnepageUiTemplate, getOnepageUiTemplate, getTemplateFile, ONEPAGE_TEMPLATE_DESC } from "./onepage-ui-template.ts";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";

const DEFAULT_UPSTREAM_URL = "https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-public";

// Upstream datastore URL configured via server-only environment variable.
// Never exposed to client bundles or public API responses.
const UPSTREAM_URL = process.env.CREATIVE_DNA_UPSTREAM_URL || DEFAULT_UPSTREAM_URL;
const FEEDBACK_UPSTREAM_URL = process.env.CREATIVE_DNA_FEEDBACK_UPSTREAM_URL || "https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-feedback-submit";
const COMPILE_ONEPAGE_URL = process.env.CREATIVE_DNA_COMPILE_ONEPAGE_URL || "https://wuonwttmkadwsmefjukv.supabase.co/functions/v1/creative-dna-compile-onepage";

export const CANONICAL_PRODUCTION_ORIGIN = "https://creative-dna-gateway.vercel.app";
export const CANONICAL_PRODUCTION_MCP_URL = `${CANONICAL_PRODUCTION_ORIGIN}/api/mcp`;

export const APP_METADATA = {
  name: "Creative DNA",
  shortDescription: "Live brand creative guidelines and production rules for ecommerce teams.",
  longDescription:
    "Creative DNA connects ChatGPT to a live, structured creative knowledge system for ecommerce brands. It provides canonical brand direction, visual rules, landing-page systems, asset specifications, product imagery rules, UGC direction, and brand-specific production constraints.",
  category: "Productivity",
  secondaryCategories: ["Design", "Marketing", "Ecommerce"],
  coreCapabilities: [
    "Brand DNA retrieval",
    "Landing Page systems",
    "Hero and banner rules",
    "Product imagery rules",
    "UGC creative rules",
    "Onepage production systems",
    "Canonical asset specifications",
  ],
  capabilities: [
    "Brand DNA retrieval",
    "Landing Page systems",
    "Hero and banner rules",
    "Product imagery rules",
    "UGC creative rules",
    "Onepage production systems",
    "Canonical asset specifications",
  ],
  supportedBrands: ["PawfectHouse", "GiftSoul", "SoulPrise"],
  status: "Live",
  mode: "Canonical read-only + pending feedback submission",
  complianceStatement: "Built for ChatGPT using the Apps SDK and Model Context Protocol.",
  sourceOfTruth: "Creative DNA canonical datastore",
  mcpEndpoint: CANONICAL_PRODUCTION_MCP_URL,
  canonicalOrigin: CANONICAL_PRODUCTION_ORIGIN,
};

export const RESOLVE_CREATIVE_DNA_DESC = `Use whenever a user requests or references a Creative DNA brand and branch, for example:
- Creative DNA — Use: PawfectHouse / Onepage
- PawfectHouse LDP Hero
- GiftSoul Shop By Product Image
- SoulPrise Onepage

The returned canonical Creative DNA specification must be treated as source-of-truth instructions for the requested creative task.`;

export const LIST_CREATIVE_DNA_ROUTES_DESC = `Use for discovering available Creative DNA brands and branches, or when the requested branch cannot be resolved confidently.`;

export const COMPILE_ONEPAGE_DESC = `Preferred tool for Creative DNA Onepage execution. Compile a compact task packet before doing collection/PDP research or generating assets. It preserves HARD gates while avoiding repeated full-DNA loading. For collection/search sources, obey the verified product-pool diversity gate and product-to-asset allocation before generation.`;

export const SUBMIT_FEEDBACK_DESC = `MANDATORY for explicit Creative DNA training feedback. BEFORE submission, convert the member's feedback plus all visible conversation/image context into a self-contained training_spec. The stored rule must remain useful after the current chat and image are unavailable. Preserve the member's words in feedback, but put durable learning in training_spec: observed_issue, generalized_rule, expected_behavior, reject_conditions, scope, rule_class, evidence_summary, confidence. ALSO create admin_summary_vi, admin_reason_vi, and admin_change_vi in natural concise Vietnamese for the admin review card. These fields are REQUIRED and review-only context, not canonical database content. The sentence body MUST be Vietnamese; keep only necessary established keywords in English when they are clearer or canonical, such as Banner, Product Details, Good To Know, Asset ID, Before/After, Studio Soft Shadow, WYL, PDP, UGC. Do not output English prose like "No additional evidence summary" or "ADMIN QUICK SCAN Case". admin_summary_vi should let an admin understand the case at a glance; admin_reason_vi should say why this wisdom was extracted; admin_change_vi should state the proposed behavior change plainly. Never write vague evidence such as "this image" or "make it like above"; describe the visible problem and desired behavior concretely. Distinguish STRUCTURAL reusable system rules from BRAND_STYLE rules. For Onepage, structural presentation/format/mechanics feedback should be scoped for shared cross-brand behavior when supported; brand vibe/style stays brand-specific. The image itself is optional evidence: if attachment bytes cannot be passed to the tool, DO NOT block submission and DO NOT ask the member to leave ChatGPT merely to upload it. Instead, encode what was observed from the image in evidence_summary.  When the user says "Creative DNA — Train: Brand / Branch", asks to train Creative DNA, or supplies feedback intended for Creative DNA, call this tool instead of refusing due to read-only canonical access. This creates only a Pending proposal. When the feedback concerns generated images OR the conversation contains any image/file that materially explains why the wisdom was learned, ALWAYS attach that visual context to the proposal. Capture the smallest useful evidence set: the output being critiqued, the approved/reference target when one exists, and any product reference needed to understand fidelity. Use OUTPUT_BEING_REVIEWED for the actual outcome/problem, STYLE_REFERENCE for the desired visual target, PRODUCT_REFERENCE for PDP/design truth, and GENERATION_CONTEXT only for other necessary context. Every attached item MUST have a concise caption that tells an admin what to notice without reopening the chat (for example: "v1 rejected — icon has black specks and orange fringe" or "approved reference — clean peach badge and single brown stroke"). Preserve iteration identity or Asset ID in reference_id/caption when available so the admin can scan v1 -> v2 -> approved. Do not attach unrelated conversation images. Preferred durable flow: upload image bytes first to Creative DNA's /api/feedback/context-assets/upload surface and pass the returned asset_id in context_asset_ids. When direct image bytes are already available inside the tool invocation, context_image_uploads is also supported. Use context_images.image_url only for URLs that are genuinely cross-site accessible. Never use chatgpt.com Library download URLs as image_url. If bytes are unavailable, pass the exact file/library/reference identifier in context_images.reference_id plus a concise caption. References are review evidence only and never become canonical style references automatically.`;

export const PENDING_WRITE_TOOL_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

export const READ_ONLY_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

/**
 * Strict input validation for resolve_creative_dna
 * Enforces non-empty strings with reasonable length limits.
 * Preserves aliases without alteration.
 */
export function validateResolveInput(brand: unknown, branch: unknown): { brand: string; branch: string } {
  if (typeof brand !== "string" || !brand.trim()) {
    throw new Error("Missing or invalid 'brand' parameter. Must be a non-empty string.");
  }
  if (typeof branch !== "string" || !branch.trim()) {
    throw new Error("Missing or invalid 'branch' parameter. Must be a non-empty string.");
  }
  const cleanBrand = brand.trim();
  const cleanBranch = branch.trim();

  if (cleanBrand.length > 100) {
    throw new Error("'brand' parameter exceeds maximum allowed length of 100 characters.");
  }
  if (cleanBranch.length > 150) {
    throw new Error("'branch' parameter exceeds maximum allowed length of 150 characters.");
  }

  return { brand: cleanBrand, branch: cleanBranch };
}

/**
 * Sanitizes errors returned to public consumers.
 * Strips raw internal URLs, tokens, database details, or stack traces.
 */
export function sanitizePublicError(err: unknown, fallback = "Unable to resolve Creative DNA"): string {
  console.error("[GATEWAY SERVER ERROR]", err);
  if (err instanceof Error) {
    if (
      err.message.includes("parameter") ||
      err.message.includes("required") ||
      err.message.includes("exceeds maximum allowed length")
    ) {
      return err.message.replace(/https?:\/\/[^\s]+/gi, "[redacted]");
    }
  }
  return fallback;
}

/**
 * Sanitizes route enumeration data to expose only safe routing metadata:
 * - brand
 * - branch
 * - title
 * Strips internal database IDs, table names, or upstream metadata.
 */
export function sanitizeRoutesData(data: any): any {
  if (!data || !Array.isArray(data.routes)) {
    return { mode: "canonical_read_only_pending_feedback_write", routes: [] };
  }
  return {
    mode: "canonical_read_only_pending_feedback_write",
    routes: data.routes.map((r: any) => ({
      brand: String(r.brand || ""),
      branch: String(r.branch || ""),
      title: String(r.title || ""),
    })),
  };
}

export type FeedbackContextImage = { role:"OUTPUT_BEING_REVIEWED"|"STYLE_REFERENCE"|"PRODUCT_REFERENCE"|"GENERATION_CONTEXT"; image_url?:string; reference_id?:string; caption?:string };
export type FeedbackContextImageUpload = { role:"OUTPUT_BEING_REVIEWED"|"STYLE_REFERENCE"|"PRODUCT_REFERENCE"|"GENERATION_CONTEXT"; data_base64:string; mime_type:"image/png"|"image/jpeg"|"image/webp"|"image/gif"; reference_id?:string; caption?:string };
export type FeedbackContextAsset = { asset_id:string; role:"OUTPUT_BEING_REVIEWED"|"STYLE_REFERENCE"|"PRODUCT_REFERENCE"|"GENERATION_CONTEXT"; caption?:string };
export type TrainingSpec = {
  observed_issue:string;
  generalized_rule:string;
  expected_behavior:string;
  reject_conditions:string[];
  scope:string;
  rule_class:"STRUCTURAL"|"BRAND_STYLE"|"PRODUCT_TRUTH"|"WORKFLOW"|"OTHER";
  evidence_summary:string;
  confidence:"HIGH"|"MEDIUM"|"LOW";
  admin_summary_vi?:string;
  admin_reason_vi?:string;
  admin_change_vi?:string;
};

async function persistFeedbackContextImage(upload:FeedbackContextImageUpload):Promise<FeedbackContextImage> {
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!serviceKey) throw new Error("feedback image storage is not configured");
  const clean=String(upload.data_base64||"").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/,"").replace(/\s+/g,"");
  if(!clean) throw new Error("context image data is required");
  const bytes=Buffer.from(clean,"base64");
  if(!bytes.length || bytes.length>10*1024*1024) throw new Error("context image exceeds maximum allowed size");
  const ext=upload.mime_type==="image/png"?"png":upload.mime_type==="image/webp"?"webp":upload.mime_type==="image/gif"?"gif":"jpg";
  const safeRef=String(upload.reference_id||"context").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,100)||"context";
  const objectPath=`member/${Date.now()}-${safeRef}-${Math.random().toString(36).slice(2,8)}.${ext}`;
  const response=await fetch(`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/feedback-context/${objectPath}`,{method:"POST",headers:{Authorization:`Bearer ${serviceKey}`,apikey:serviceKey,"Content-Type":upload.mime_type,"x-upsert":"false"},body:bytes});
  if(!response.ok) throw new Error("unable to persist context image");
  return {role:upload.role,image_url:`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/public/feedback-context/${objectPath}`,reference_id:upload.reference_id,caption:upload.caption};
}

function contextAssetToImage(asset:FeedbackContextAsset):FeedbackContextImage {
  const assetId=String(asset.asset_id||"").trim();
  if(!/^member\/[a-zA-Z0-9._\/-]+\.(png|jpg|jpeg|webp|gif)$/i.test(assetId) || assetId.includes("..")) throw new Error("invalid context asset id");
  return {role:asset.role,image_url:`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/public/feedback-context/${assetId}`,reference_id:assetId,caption:asset.caption};
}

function validateTrainingSpec(spec?:TrainingSpec):TrainingSpec|undefined {
  if(!spec) return undefined;
  const clean=(v:any,max=4000)=>String(v||"").trim().slice(0,max);
  const observed_issue=clean(spec.observed_issue);
  const generalized_rule=clean(spec.generalized_rule);
  const expected_behavior=clean(spec.expected_behavior);
  const evidence_summary=clean(spec.evidence_summary);
  const admin_summary_vi=clean(spec.admin_summary_vi,700);
  const admin_reason_vi=clean(spec.admin_reason_vi,900);
  const admin_change_vi=clean(spec.admin_change_vi,900);
  if(!observed_issue||!generalized_rule||!expected_behavior||!evidence_summary) throw new Error("training_spec requires observed_issue, generalized_rule, expected_behavior, and evidence_summary");
  if(!admin_summary_vi||!admin_reason_vi||!admin_change_vi) throw new Error("training_spec requires Vietnamese admin_summary_vi, admin_reason_vi, and admin_change_vi");
  const ruleClass=["STRUCTURAL","BRAND_STYLE","PRODUCT_TRUTH","WORKFLOW","OTHER"].includes(spec.rule_class)?spec.rule_class:"OTHER";
  const confidence=["HIGH","MEDIUM","LOW"].includes(spec.confidence)?spec.confidence:"MEDIUM";
  return {observed_issue,generalized_rule,expected_behavior,reject_conditions:(spec.reject_conditions||[]).map(x=>clean(x,800)).filter(Boolean).slice(0,12),scope:clean(spec.scope,500)||"brand_branch",rule_class:ruleClass as TrainingSpec["rule_class"],evidence_summary,confidence:confidence as TrainingSpec["confidence"],admin_summary_vi,admin_reason_vi,admin_change_vi};
}

export async function submitTrainingFeedback(brand:string, branch:string, feedback:string, submitter_name?:string, proposed_scope?:string, context_images?:FeedbackContextImage[], context_image_uploads?:FeedbackContextImageUpload[], context_asset_ids?:FeedbackContextAsset[], training_spec?:TrainingSpec) {
  const validated = validateResolveInput(brand, branch);
  const cleanFeedback = String(feedback || "").trim();
  if (cleanFeedback.length < 3) throw new Error("feedback is required");
  if (cleanFeedback.length > 8000) throw new Error("feedback exceeds maximum allowed length");\n  const cleanSubmitter = String(submitter_name || "").trim();\n  if (!cleanSubmitter || /^(team member|member|unknown|anonymous|n\\/a)$/i.test(cleanSubmitter)) throw new Error("submitter_name must be the exact member account/display name");
  const persistedUploads=context_image_uploads?.length ? await Promise.all(context_image_uploads.slice(0,12).map(persistFeedbackContextImage)) : [];
  const persistedAssets=(context_asset_ids||[]).slice(0,12).map(contextAssetToImage);
  const normalizedImages=[...(context_images||[]),...persistedUploads,...persistedAssets].slice(0,12);
  const normalizedSpec=validateTrainingSpec(training_spec);
  const enrichedFeedback=normalizedSpec ? `${cleanFeedback}\n\n--- AI INTERPRETED TRAINING SPEC ---\nObserved issue: ${normalizedSpec.observed_issue}\nGeneralized rule: ${normalizedSpec.generalized_rule}\nExpected behavior: ${normalizedSpec.expected_behavior}\nReject conditions: ${normalizedSpec.reject_conditions.join(" | ") || "None specified"}\nScope: ${normalizedSpec.scope}\nRule class: ${normalizedSpec.rule_class}\nEvidence summary: ${normalizedSpec.evidence_summary}\nConfidence: ${normalizedSpec.confidence}` : cleanFeedback;
  const feedbackBranch = isPawfectHouseNicheProductCombo(validated.brand, validated.branch) ? "LDP" : validated.branch;
  const routedFeedback = isPawfectHouseNicheProductCombo(validated.brand, validated.branch)
    ? `[Gateway material: Niche Product Combo]\n${enrichedFeedback}`
    : enrichedFeedback;
  const response = await fetch(FEEDBACK_UPSTREAM_URL,{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Creative-DNA-Gateway/1.0"},body:JSON.stringify({brand:validated.brand,branch:feedbackBranch,feedback:routedFeedback,submitter_name:cleanSubmitter,proposed_scope:normalizedSpec?.scope||proposed_scope||"niche-product-combo",context_images:normalizedImages,training_spec:normalizedSpec})});
  return {status:response.status,ok:response.ok,data:await response.json()};
}

export async function compileOnepageJob(brand:string, source_url?:string, source_type?:string, theme?:string) {
 const validated=validateResolveInput(brand,"onepage-system");
 const response=await fetch(COMPILE_ONEPAGE_URL,{method:"POST",headers:{"Content-Type":"application/json","User-Agent":"Creative-DNA-Gateway/1.0"},body:JSON.stringify({brand:validated.brand,source_url,source_type,theme})});
 const data = await response.json();
 return {status:response.status,ok:response.ok,data:response.ok ? attachOnepageUiTemplate(data,validated.brand,"onepage-system") : data};
}

// Core gateway functions
export async function fetchUpstream(payload: { action: "resolve"; brand: string; branch: string } | { action: "routes" }) {
  const response = await fetch(UPSTREAM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Creative-DNA-Gateway/1.0",
    },
    body: JSON.stringify(payload),
  });

  const rawJson = await response.json();
  return {
    status: response.status,
    ok: response.ok,
    data: rawJson,
  };
}

const NICHE_PRODUCT_COMBO_SLUG = "niche-product-combo";
const NICHE_PRODUCT_COMBO_ALIASES = new Set([
  NICHE_PRODUCT_COMBO_SLUG,
  "niche product combo",
  "product combo",
  "niche combo",
]);

function normalizeRouteKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function isPawfectHouseNicheProductCombo(brand: string, branch: string): boolean {
  const brandKey = normalizeRouteKey(brand);
  const rawBranch = branch.trim().toLowerCase();
  const branchKey = normalizeRouteKey(branch);
  return brandKey === "pawfecthouse" && (
    NICHE_PRODUCT_COMBO_ALIASES.has(rawBranch) ||
    NICHE_PRODUCT_COMBO_ALIASES.has(branchKey)
  );
}

const NICHE_PRODUCT_COMBO_OVERLAY = `
## GATEWAY MATERIAL BRANCH — NICHE PRODUCT COMBO

Purpose: create product-first multi-SKU combo imagery organized around a clear shopper niche. This material is distinct from Shop By Product: Shop By Product presents one hero product/product line per image, while Niche Product Combo intentionally combines 2–3 verified products in one coherent tile.

### INPUTS
- Collection / Product Pool: required source of verified products.
- Theme: niche/campaign context.
- Niche list: one or more shopper worlds such as Cozy Reading, Reading & Coffee, Bookish Home, Books & Pets.
- Custom ratio: default 1:1 unless the brief overrides it.
- Quantity: number of standalone combo images.
- Custom Style: optional; "Studio Soft Shadow" is a supported clean product-first direction.

### HARD EXECUTION GATES
1. Verify every selected SKU from the supplied collection/PDP before generation. Preserve product silhouette, material, scale, printed artwork/personalization and physically plausible orientation.
2. Each requested niche must use a meaningfully different product mix when the source assortment allows it. Do not make a multi-niche set feel like the same combo with props swapped.
3. Use 2–3 products per combo by default. Group them tightly enough to read as one composition, but keep every product legible.
4. Vary angle intentionally across products and across the requested image set. Flat accessories need believable support: lay them on a surface or visibly lean them against a real object; never make unsupported objects stand impossibly.
5. Product cluster is the visual focus. Use one simple surface plus a quiet background; props are sparse and only clarify the niche or product use. Reject decorative clutter that competes with the products.
6. Maintain comfortable edge spacing and natural overlap/depth. Avoid rigid grid/lineup staging, floating objects, clipped silhouettes, or products pressed against the frame.
7. Theme should be evident first through the actual chosen products/designs, then through restrained context. Do not compensate for weak product selection with excessive props.
8. Keep the image set coherent in lighting/background language while allowing different compositions and camera angles.
9. For PawfectHouse, inherit canonical product-truth and human-realism rules from the parent LDP/brand DNA. People are optional and should not be added unless they improve the requested story.

### READING / BOOK LOVER REFERENCE
For reading-oriented combo tiles, the accepted balance is a warm, grounded reading context with minimal environmental detail. A single armchair edge, side table, ottoman, book or cup may be enough; avoid shelves/plants/decor stacks that make the product cluster hard to scan. Existing accepted LDP combo wisdom remains applicable.

### OUTPUT EXPECTATION
Return each requested niche as a separate standalone image/concept, with a distinct verified product allocation and intentional angle plan. Do not collapse multiple requested niches into one collage unless explicitly requested.
`;

function applyNicheProductComboOverlay(data: any, requestedBrand: string, requestedBranch: string): any {
  const baseBranch = data?.branch || {};
  return {
    ...data,
    requested: { brand: requestedBrand, branch: requestedBranch },
    resolved: { brand: "pawfecthouse", branch: NICHE_PRODUCT_COMBO_SLUG },
    instruction: "Gateway material route. Use the inherited canonical PawfectHouse LDP + Brand DNA together with the Niche Product Combo overlay below as source-of-truth instructions for this material.",
    branch: {
      ...baseBranch,
      slug: NICHE_PRODUCT_COMBO_SLUG,
      title: "PawfectHouse Niche Product Combo Material Recipe",
      version: `${baseBranch.version || "0.1"}+gateway.1`,
      metadata: {
        ...(baseBranch.metadata || {}),
        gateway_virtual_branch: true,
        parent_branch: "ldp-system",
        material_role: "NICHE_PRODUCT_COMBO",
      },
      node_type: "material",
      content_md: `${baseBranch.content_md || ""}\n\n${NICHE_PRODUCT_COMBO_OVERLAY}`,
      input_schema: {
        collection_or_product_pool: { type: "string", required: true },
        theme: { type: "string", required: false },
        niches: { type: "array", items: { type: "string" }, required: true },
        custom_ratio: { type: "string", default: "1:1" },
        quantity: { type: "number", required: false },
        custom_style: { type: "string", required: false },
      },
    },
  };
}

export async function resolveCreativeDna(brand: string, branch: string) {
  const validated = validateResolveInput(brand, branch);

  if (isPawfectHouseNicheProductCombo(validated.brand, validated.branch)) {
    const parent = await fetchUpstream({
      action: "resolve",
      brand: "PawfectHouse",
      branch: "LDP",
    });
    return {
      ...parent,
      data: parent.ok
        ? applyNicheProductComboOverlay(parent.data, validated.brand, validated.branch)
        : parent.data,
    };
  }

  const result = await fetchUpstream({
    action: "resolve",
    brand: validated.brand,
    branch: validated.branch,
  });
  return { ...result, data: result.ok ? attachOnepageUiTemplate(result.data, validated.brand, validated.branch) : result.data };
}

export async function listCreativeDnaRoutes() {
  const result = await fetchUpstream({
    action: "routes",
  });

  if (!result.ok || !Array.isArray(result.data?.routes)) return result;

  const exists = result.data.routes.some((r: any) =>
    normalizeRouteKey(String(r.brand || "")) === "pawfecthouse" &&
    normalizeRouteKey(String(r.branch || "")) === NICHE_PRODUCT_COMBO_SLUG
  );

  return {
    ...result,
    data: {
      ...result.data,
      routes: exists ? result.data.routes : [
        ...result.data.routes,
        {
          brand: "pawfecthouse",
          branch: NICHE_PRODUCT_COMBO_SLUG,
          title: "PawfectHouse Niche Product Combo Material Recipe",
        },
      ],
    },
  };
}

/**
 * Distributed / Serverless friendly sliding-window rate limiter.
 * - Extracts client IP safely from x-forwarded-for or x-real-ip
 * - Memory-bounded sliding window with automatic garbage collection
 * - Conservative limit (120 req/min per IP) to prevent scraping while accommodating normal ChatGPT bursts
 * - Emits clean 429 response without leaking internal state
 */
interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_ENTRIES = 5000;

const ipRateLimitStore = new Map<string, RateLimitRecord>();

function cleanRateLimitStore() {
  const now = Date.now();
  for (const [ip, record] of ipRateLimitStore.entries()) {
    if (now > record.resetTime) {
      ipRateLimitStore.delete(ip);
    }
  }
}

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetSeconds: number } {
  const now = Date.now();
  if (ipRateLimitStore.size > MAX_ENTRIES) {
    cleanRateLimitStore();
  }

  const record = ipRateLimitStore.get(ip);
  if (!record || now > record.resetTime) {
    const newRecord: RateLimitRecord = {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW_MS,
    };
    ipRateLimitStore.set(ip, newRecord);
    return {
      allowed: true,
      remaining: MAX_REQUESTS_PER_WINDOW - 1,
      resetSeconds: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    };
  }

  record.count += 1;
  const resetSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));

  if (record.count > MAX_REQUESTS_PER_WINDOW) {
    return {
      allowed: false,
      remaining: 0,
      resetSeconds,
    };
  }

  return {
    allowed: true,
    remaining: MAX_REQUESTS_PER_WINDOW - record.count,
    resetSeconds,
  };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  const realIp = req.headers["x-real-ip"];
  if (typeof realIp === "string") {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || "127.0.0.1";
}

// Tool definitions for OpenAPI / ChatGPT Actions / Discovery documentation
export const TOOL_DEFINITIONS = [
  {
    name: "get_onepage_ui_template", title: "Get Onepage UI Template", description: ONEPAGE_TEMPLATE_DESC, annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: { type: "object", properties: { version: { type: "string" }, format: { type: "string", enum: ["manifest", "source"] } } },
  },
  {
    name: "resolve_creative_dna",
    title: "Resolve Creative DNA",
    description: RESOLVE_CREATIVE_DNA_DESC,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {
        brand: {
          type: "string",
          description: "Target brand name (e.g., 'PawfectHouse', 'GiftSoul', 'SoulPrise')",
        },
        branch: {
          type: "string",
          description: "Target branch or module path (e.g., 'Onepage', 'LDP Hero', 'Home Hero', 'Seasonal Banner', 'Shop By Product', 'Shop By Categories', 'UGC')",
        },
      },
      required: ["brand", "branch"],
    },
  },
  {
    name:"compile_onepage_job", title:"Compile Onepage Job", description:COMPILE_ONEPAGE_DESC, annotations:READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema:{type:"object",properties:{brand:{type:"string"},source_url:{type:"string"},source_type:{type:"string",enum:["auto","product","collection"]},theme:{type:"string"}},required:["brand"]},
  },
  {
    name: "submit_training_feedback",
    title: "Submit Training Feedback",
    description: SUBMIT_FEEDBACK_DESC,
    annotations: PENDING_WRITE_TOOL_ANNOTATIONS,
    inputSchema: { type:"object", properties:{ brand:{type:"string"}, branch:{type:"string"}, feedback:{type:"string"}, submitter_name:{type:"string",description:"Required exact member account/display name shown to Admin. Never use generic placeholders such as Team member, Member, Unknown, or Anonymous."}, proposed_scope:{type:"string"}, context_images:{type:"array",maxItems:12,description:"Optional images from the generation/review context. Attach the output being reviewed whenever an accessible image URL or reference is available.",items:{type:"object",properties:{role:{type:"string",enum:["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]},image_url:{type:"string"},reference_id:{type:"string"},caption:{type:"string"}},required:["role"]}}, context_asset_ids:{type:"array",maxItems:12,description:"Creative DNA-owned uploaded context assets. Use asset_id returned by /api/feedback/context-assets/upload.",items:{type:"object",properties:{asset_id:{type:"string"},role:{type:"string",enum:["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]},caption:{type:"string"}},required:["asset_id","role"]}}, training_spec:{type:"object",description:"Self-contained AI interpretation of the member feedback and visible context. Required for durable training value.",properties:{observed_issue:{type:"string"},generalized_rule:{type:"string"},expected_behavior:{type:"string"},reject_conditions:{type:"array",maxItems:12,items:{type:"string"}},scope:{type:"string"},rule_class:{type:"string",enum:["STRUCTURAL","BRAND_STYLE","PRODUCT_TRUTH","WORKFLOW","OTHER"]},evidence_summary:{type:"string"},confidence:{type:"string",enum:["HIGH","MEDIUM","LOW"]},admin_summary_vi:{type:"string",description:"Vietnamese one-glance admin summary. Write naturally in Vietnamese; keep only established product/design/system keywords in English when clearer, e.g. Banner, Product Details, Good To Know, Asset ID, Before/After, Studio Soft Shadow. Do not write the sentence body in English. Review-only, not canonical payload."},admin_reason_vi:{type:"string",description:"Vietnamese explanation of why this wisdom was extracted. Natural Vietnamese first; retain only necessary technical/creative keywords in English. Review-only."},admin_change_vi:{type:"string",description:"Vietnamese plain-language proposed behavior change. Natural Vietnamese first; retain only necessary keywords in English. Review-only."}},required:["observed_issue","generalized_rule","expected_behavior","reject_conditions","scope","rule_class","evidence_summary","confidence","admin_summary_vi","admin_reason_vi","admin_change_vi"]} }, required:["brand","branch","feedback","submitter_name"] },
  },
  {
    name: "list_creative_dna_routes",
    title: "List Creative DNA Routes",
    description: LIST_CREATIVE_DNA_ROUTES_DESC,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

/**
 * Creates and configures a standards-compliant Model Context Protocol server.
 * Canonical Creative DNA resolution remains read-only.
 * Training feedback is the only member write path and creates Pending proposals only.
 * Pending feedback never mutates canonical Creative DNA; admin review/merge remains separate.
 * Single source of truth is the canonical Creative DNA datastore.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "Creative DNA",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: { listChanged: false },
      },
      instructions:
        "Creative DNA connects ChatGPT to a live, structured creative knowledge system for ecommerce brands. Canonical Creative DNA resolution is read-only, while training feedback submission is explicitly writable to the Pending admin-review queue. IMPORTANT: whenever the user explicitly says Creative DNA — Train: Brand / Branch or clearly asks to train/provide Creative DNA feedback, MUST call submit_training_feedback. Do not refuse a Train request because canonical DNA is read-only. submit_training_feedback never changes canonical DNA; it only creates a Pending proposal. For every Train request, MUST create a self-contained training_spec from the member's feedback and all visible context before calling submit_training_feedback. Always include concise Vietnamese admin_summary_vi, admin_reason_vi, and admin_change_vi for the review UI. ALWAYS include submitter_name as the exact member account/display name for the person sending the feedback; never use Team member, Member, Unknown, Anonymous, or another generic placeholder. These three fields are mandatory. Write complete sentences in Vietnamese and preserve only necessary canonical/technical keywords in English. Never put English fallback prose in these fields. Keep generalized_rule/expected_behavior/reject_conditions as the canonical database payload language and do not let the Vietnamese admin overview replace or alter that payload. For image-related feedback, inspect the image in the conversation and describe the concrete visual evidence in training_spec.evidence_summary. ALSO attach the relevant visual context whenever a transferable URL, file/reference id, or Creative-DNA asset id exists. Prefer a compact evidence chain (problem/output -> target/reference -> corrected/approved outcome) with captions and stable Asset IDs when available. The training rule must make sense without access to the image. Image transfer is optional evidence, not a submission dependency: never send the member out of ChatGPT solely to upload an image. When transferable image evidence is already available, prefer Creative DNA-owned context_asset_ids returned by the upload surface. context_image_uploads remains supported when attachment bytes are directly available to the tool. Never submit chatgpt.com Library download links as image_url. If bytes are unavailable, use context_images with the exact file/library reference_id; do not leave image evidence only as prose in feedback. For Onepage execution, prefer compile_onepage_job first; use resolve_creative_dna when full canonical detail is needed. For UI mapping, always download the backend-owned ui_mapping_template HTML/CSS from the returned URLs or get_onepage_ui_template. Never use libfile IDs as download URLs or reconstruct from the live page. Use list_creative_dna_routes to discover routes.",
    }
  );

  server.registerTool("get_onepage_ui_template", {
    title: "Get Onepage UI Template", description: ONEPAGE_TEMPLATE_DESC, annotations: READ_ONLY_TOOL_ANNOTATIONS,
    inputSchema: { version: z.string().trim().max(80).optional(), format: z.enum(["manifest", "source"]).optional() },
  }, async ({ version, format }) => {
    try {
      return { content: [{ type: "text", text: JSON.stringify(getOnepageUiTemplate(version, format), null, 2) }] };
    } catch {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Unknown Onepage UI template version or format" }) }], isError: true };
    }
  });

  // Tool 1: resolve_creative_dna
  server.registerTool(
    "resolve_creative_dna",
    {
      title: "Resolve Creative DNA",
      description: RESOLVE_CREATIVE_DNA_DESC,
      inputSchema: {
        brand: z
          .string()
          .trim()
          .min(1, "Brand name cannot be empty")
          .max(100, "Brand name exceeds maximum allowed length of 100 characters")
          .describe("Target brand name (e.g., 'PawfectHouse', 'GiftSoul', 'SoulPrise')"),
        branch: z
          .string()
          .trim()
          .min(1, "Branch name cannot be empty")
          .max(150, "Branch name exceeds maximum allowed length of 150 characters")
          .describe("Target branch or module path (e.g., 'Onepage', 'LDP Hero', 'Home Hero', 'Seasonal Banner', 'Shop By Product', 'Shop By Categories', 'UGC')"),
      },
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async ({ brand, branch }) => {
      try {
        const upstream = await resolveCreativeDna(brand, branch);
        const text = typeof upstream.data === "string" ? upstream.data : JSON.stringify(upstream.data, null, 2);
        return {
          content: [
            {
              type: "text",
              text,
            },
          ],
          isError: !upstream.ok,
        };
      } catch (err: any) {
        const safeMsg = sanitizePublicError(err, "Error resolving Creative DNA");
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: safeMsg }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Preferred Onepage compiler: compact execution contract, no canonical mutation
  server.registerTool("compile_onepage_job",{
    title:"Compile Onepage Job",description:COMPILE_ONEPAGE_DESC,
    inputSchema:{brand:z.string().trim().min(1).max(100),source_url:z.string().trim().max(2000).optional(),source_type:z.enum(["auto","product","collection"]).optional(),theme:z.string().trim().max(120).optional()},annotations:READ_ONLY_TOOL_ANNOTATIONS
  },async({brand,source_url,source_type,theme})=>{try{const u=await compileOnepageJob(brand,source_url,source_type,theme);return{content:[{type:"text",text:JSON.stringify(u.data,null,2)}],isError:!u.ok}}catch(err:any){return{content:[{type:"text",text:JSON.stringify({error:sanitizePublicError(err,"Unable to compile Onepage job")})}],isError:true}}});

  // Tool 3: submit_training_feedback — pending proposal only; never canonical mutation
  server.registerTool(
    "submit_training_feedback",
    {
      title:"Submit Training Feedback", description:SUBMIT_FEEDBACK_DESC,
      inputSchema:{
        brand:z.string().trim().min(1).max(100), branch:z.string().trim().min(1).max(150),
        feedback:z.string().trim().min(3).max(8000),
        submitter_name:z.string().trim().min(1).max(120),
        proposed_scope:z.string().trim().max(80).optional(),
        context_images:z.array(z.object({
          role:z.enum(["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]),
          image_url:z.string().url().max(4000).optional(),
          reference_id:z.string().max(500).optional(),
          caption:z.string().max(500).optional()
        })).max(12).optional(),
        // Keep MCP tool schema small and text-first. Binary/base64 transport is intentionally
        // excluded from ChatGPT discovery; image observations belong in training_spec.evidence_summary.
        // Creative DNA-owned context assets can still be attached by stable asset id when available.
        context_asset_ids:z.array(z.object({
          asset_id:z.string().min(1).max(500),
          role:z.enum(["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]),
          caption:z.string().max(500).optional()
        })).max(12).optional(),
        training_spec:z.object({
          observed_issue:z.string().min(1).max(4000),
          generalized_rule:z.string().min(1).max(4000),
          expected_behavior:z.string().min(1).max(4000),
          reject_conditions:z.array(z.string().min(1).max(800)).max(12),
          scope:z.string().min(1).max(500),
          rule_class:z.enum(["STRUCTURAL","BRAND_STYLE","PRODUCT_TRUTH","WORKFLOW","OTHER"]),
          evidence_summary:z.string().min(1).max(4000),
          confidence:z.enum(["HIGH","MEDIUM","LOW"]),
          admin_summary_vi:z.string().trim().min(1).max(700).describe("Tóm tắt case bằng tiếng Việt; chỉ giữ keyword chuyên môn cần thiết bằng English."),
          admin_reason_vi:z.string().trim().min(1).max(900).describe("Giải thích bằng tiếng Việt vì sao rút ra wisdom; chỉ giữ keyword chuyên môn cần thiết bằng English."),
          admin_change_vi:z.string().trim().min(1).max(900).describe("Nêu bằng tiếng Việt sau này cần làm khác thế nào; chỉ giữ keyword chuyên môn cần thiết bằng English.")
        }).optional()
      }, annotations:PENDING_WRITE_TOOL_ANNOTATIONS,
    },
    async ({brand,branch,feedback,submitter_name,proposed_scope,context_images,context_asset_ids,training_spec})=>{
      try { const upstream=await submitTrainingFeedback(brand,branch,feedback,submitter_name,proposed_scope,context_images,undefined,context_asset_ids,training_spec); return {content:[{type:"text",text:JSON.stringify(upstream.data,null,2)}],isError:!upstream.ok}; }
      catch(err:any){ return {content:[{type:"text",text:JSON.stringify({error:sanitizePublicError(err,"Unable to submit training feedback")})}],isError:true}; }
    }
  );

  // Tool 2: list_creative_dna_routes
  server.registerTool(
    "list_creative_dna_routes",
    {
      title: "List Creative DNA Routes",
      description: LIST_CREATIVE_DNA_ROUTES_DESC,
      inputSchema: {},
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    async () => {
      try {
        const upstream = await listCreativeDnaRoutes();
        const safeData = sanitizeRoutesData(upstream.data);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(safeData, null, 2),
            },
          ],
          isError: !upstream.ok,
        };
      } catch (err: any) {
        console.error("[MCP LIST ROUTES ERROR]", err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Error listing Creative DNA routes" }),
            },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

/**
 * Builds the Express application with all API endpoints and the standards-compliant MCP server.
 */
export function createApp(): express.Application {
  const app = express();

  // Conservative body limit - MCP tools only send small text parameters
  app.use(express.json({ limit: "14mb" }));

  // Handle payload too large
  app.use((err: any, _req: Request, res: Response, next: any) => {
    if (err && (err.type === "entity.too.large" || err.status === 413)) {
      return res.status(413).json({
        error: "Payload Too Large",
        message: "The request body exceeds the maximum permitted size.",
      });
    }
    next(err);
  });

  // Production security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  // CORS headers - strictly GET, POST, OPTIONS (no DELETE or mutation verbs)
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID"
    );
    res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // Conservative rate limiting on /api/* routes
  app.use("/api", (req: Request, res: Response, next: () => void) => {
    if (req.method === "OPTIONS") {
      return next();
    }

    const ip = getClientIp(req);
    const limit = checkRateLimit(ip);

    res.setHeader("RateLimit-Limit", String(MAX_REQUESTS_PER_WINDOW));
    res.setHeader("RateLimit-Remaining", String(limit.remaining));
    res.setHeader("RateLimit-Reset", String(limit.resetSeconds));

    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.resetSeconds));

      if (req.path === "/mcp" && req.method === "POST") {
        return res.status(429).json({
          jsonrpc: "2.0",
          id: req.body?.id ?? null,
          error: {
            code: -32000,
            message: "Rate limit exceeded. Please retry after a brief pause.",
          },
        });
      }

      return res.status(429).json({
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please retry after a brief pause.",
      });
    }

    next();
  });

  // Versioned backend-owned template: no Library session or datastore query required.
  app.get("/api/onepage-ui-template/:version/:file", (req: Request, res: Response) => {
    const file = getTemplateFile(String(req.params.version), String(req.params.file));
    if (!file) return res.status(404).json({ error: "Unknown Onepage UI template version or file" });
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", `"${file.hash}"`);
    if (req.header("if-none-match") === `"${file.hash}"`) return res.sendStatus(304);
    if (req.params.file === "template.html") {
      res.setHeader("Content-Disposition", 'attachment; filename="template.html"');
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src data:; img-src https: data:; base-uri 'none'; frame-ancestors 'none'");
    }
    return res.type(file.type).send(file.body);
  });
  app.post("/api/tools/get_onepage_ui_template", (req: Request, res: Response) => {
    const input = req.body?.arguments || req.body || {};
    try { return res.json(getOnepageUiTemplate(input.version, input.format)); }
    catch { return res.status(400).json({ error: "Unknown Onepage UI template version or format" }); }
  });
  app.post("/api/tools/compile_onepage_job", async (req: Request, res: Response) => {
    const input = req.body?.arguments || req.body || {};
    try {
      const parsed = z.object({ brand: z.string().trim().min(1).max(100), source_url: z.string().max(2000).optional(), source_type: z.enum(["auto", "product", "collection"]).optional(), theme: z.string().max(120).optional() }).parse(input);
      const result = await compileOnepageJob(parsed.brand, parsed.source_url, parsed.source_type, parsed.theme);
      return res.status(result.status).json(result.data);
    } catch (err: any) { return res.status(err instanceof z.ZodError ? 400 : 502).json({ error: sanitizePublicError(err, "Unable to compile Onepage job") }); }
  });

  // Admin feedback review proxy. The browser supplies the authenticated Supabase JWT;
  // no service-role secret is exposed to the client.
  const adminUpstreamUrl = process.env.CREATIVE_DNA_ADMIN_UPSTREAM_URL;

  app.post("/api/admin/login", async (req: Request, res: Response) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password) return res.status(400).json({ error: "Email and password are required" });
    try {
      const upstream = await fetch("https://wuonwttmkadwsmefjukv.supabase.co/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": "sb_publishable_NRcIK4NuC_MniBDuDhsHHQ_NlwpN0d_",
        },
        body: JSON.stringify({ email, password }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok || !data?.access_token) return res.status(401).json({ error: "Invalid email or password" });
      return res.json({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in || 3600,
        expires_at: data.expires_at || null,
      });
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to sign in") });
    }
  });

  app.post("/api/admin/refresh", async (req: Request, res: Response) => {
    const refreshToken = typeof req.body?.refresh_token === "string" ? req.body.refresh_token.trim() : "";
    if (!refreshToken) return res.status(400).json({ error: "Refresh token is required" });
    try {
      const upstream = await fetch("https://wuonwttmkadwsmefjukv.supabase.co/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": "sb_publishable_NRcIK4NuC_MniBDuDhsHHQ_NlwpN0d_",
        },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok || !data?.access_token) {
        return res.status(401).json({ error: "Admin session expired. Please sign in again." });
      }
      return res.json({
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        expires_in: data.expires_in || 3600,
        expires_at: data.expires_at || null,
      });
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to refresh admin session") });
    }
  });

  app.post("/api/admin/branch-guides/upsert", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin service is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "branch_guide_upsert", ...(req.body || {}) }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to save branch visual guide" });
      return res.json(data);
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to save branch visual guide") });
    }
  });

  app.get("/api/admin/team", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin feedback upstream is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "team_list" }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to load admin team" });
      return res.json({ members: data?.members || [] });
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to load admin team") });
    }
  });

  app.post("/api/admin/team/grant", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin feedback upstream is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const display_name = typeof req.body?.display_name === "string" ? req.body.display_name.trim() : "";
    if (!email) return res.status(400).json({ error: "Email is required" });
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "grant_admin", email, display_name }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to grant admin access" });
      return res.json(data);
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to grant admin access") });
    }
  });

  app.post("/api/admin/feedback/delete-all", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin feedback upstream is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    const status = typeof req.body?.status === "string" ? req.body.status.trim().toLowerCase() : "";
    if (!["pending","accepted","merged","rejected","all"].includes(status)) {
      return res.status(400).json({ error: "Valid status is required" });
    }
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "delete_all", status }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to delete proposals" });
      return res.json(data);
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to delete proposals") });
    }
  });

  app.get("/api/admin/feedback", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin feedback upstream is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "list" }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to load admin feedback" });
      return res.json({ proposals: data?.proposals || [] });
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to load admin feedback") });
    }
  });

  app.post("/api/admin/feedback/:id/merge", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin feedback upstream is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "merge", proposal_id: req.params.id }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to merge feedback" });
      return res.json(data);
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to merge feedback") });
    }
  });

  app.post("/api/admin/feedback/:id/review", async (req: Request, res: Response) => {
    if (!adminUpstreamUrl) return res.status(503).json({ error: "Admin feedback upstream is not configured" });
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) return res.status(401).json({ error: "Admin authentication required" });
    const decision = req.body?.decision;
    if (decision !== "accept" && decision !== "reject") return res.status(400).json({ error: "decision must be accept or reject" });
    try {
      const upstream = await fetch(adminUpstreamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authorization },
        body: JSON.stringify({ mode: "review", proposal_id: req.params.id, decision, review_note: req.body?.review_note || "" }),
      });
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(upstream.status).json({ error: data?.error || "Unable to review feedback" });
      return res.json(data);
    } catch (err:any) {
      return res.status(502).json({ error: sanitizePublicError(err, "Unable to review feedback") });
    }
  });

  // Health / Upstream connectivity check - strictly safe operational info
  app.get("/api/health", async (_req: Request, res: Response) => {
    const startTime = Date.now();
    try {
      const upstream = await listCreativeDnaRoutes();
      const latencyMs = Date.now() - startTime;
      return res.json({
        status: "ok",
        mode: "canonical_read_only_pending_feedback_write",
        upstream: upstream.ok ? "connected" : "degraded",
        latencyMs,
        productionMcpUrl: CANONICAL_PRODUCTION_MCP_URL,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error("[HEALTH CHECK ERROR]", err);
      return res.status(502).json({
        status: "error",
        mode: "canonical_read_only_pending_feedback_write",
        upstream: "unreachable",
        message: "Unable to reach canonical Creative DNA datastore",
        latencyMs: Date.now() - startTime,
        productionMcpUrl: CANONICAL_PRODUCTION_MCP_URL,
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Operation 1: resolve_creative_dna
  app.post("/api/resolve", async (req: Request, res: Response) => {
    try {
      const { brand, branch } = req.body || {};
      const validated = validateResolveInput(brand, branch);

      const upstream = await resolveCreativeDna(validated.brand, validated.branch);
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: typeof upstream.data?.error === "string" ? upstream.data.error.replace(/https?:\/\/[^\s]+/gi, "[redacted]") : "Unable to resolve Creative DNA",
        });
      }
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      const safeMsg = sanitizePublicError(err, "Unable to resolve Creative DNA");
      const isClientError = err?.message && (err.message.includes("parameter") || err.message.includes("required") || err.message.includes("exceeds"));
      return res.status(isClientError ? 400 : 500).json({ error: safeMsg });
    }
  });

  app.get("/api/branch-guides", async (_req: Request, res: Response) => {
    const publicKey = "sb_publishable_NRcIK4NuC_MniBDuDhsHHQ_NlwpN0d_";
    try {
      const upstream = await fetch(
        "https://wuonwttmkadwsmefjukv.supabase.co/rest/v1/branch_visual_guides?select=brand_slug,branch_slug,title_vi,description_vi,usage_badge,ratio_note,output_note,image_url,image_caption,page_url,css_selector,preview_mode,updated_at&order=brand_slug.asc,branch_slug.asc",
        {
          headers: {
            apikey: publicKey,
            Authorization: `Bearer ${publicKey}`,
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
        },
      );
      const data:any = await upstream.json();
      if (!upstream.ok) return res.status(502).json({ error: "Unable to load branch visual guides" });
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return res.json({ guides: Array.isArray(data) ? data : [] });
    } catch (err:any) {
      return res.status(500).json({ error: sanitizePublicError(err, "Unable to load branch visual guides") });
    }
  });

  app.get("/api/branch-preview", async (req: Request, res: Response) => {
    const pageUrl = String(req.query.url || "").trim();
    const selector = String(req.query.selector || "").trim();
    if (!pageUrl || !selector) return res.status(400).send("Missing url or selector");

    let parsed: URL;
    try { parsed = new URL(pageUrl); } catch { return res.status(400).send("Invalid URL"); }
    if (parsed.protocol !== "https:") return res.status(400).send("HTTPS required");

    const host = parsed.hostname.toLowerCase();
    const allowed =
      host === "pawfecthouse.com" || host.endsWith(".pawfecthouse.com") ||
      host === "giftsoul.co" || host.endsWith(".giftsoul.co") ||
      host === "soulprise.co" || host.endsWith(".soulprise.co") ||
      host.endsWith(".myshopify.com");
    if (!allowed) return res.status(400).send("Preview host is not allowed");

    try {
      const upstream = await fetch(pageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 CreativeDNA-Preview/1.0", Accept: "text/html" },
        redirect: "follow",
      });
      if (!upstream.ok) return res.status(502).send("Unable to fetch preview page");
      let html = await upstream.text();

      html = html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "");

      const cssSelector = selector.replace(/<|>|\{/g, "");
      const injected = `<base href="${parsed.origin}/"><style>
        html,body{margin:0!important;padding:0!important;background:#fff!important}
        body *:not(${cssSelector}):not(${cssSelector} *):not(:has(${cssSelector})){display:none!important}
        ${cssSelector}{display:block!important;margin:0!important}
      </style>`;

      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
      else html = `<head>${injected}</head>${html}`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      return res.send(html);
    } catch (err:any) {
      return res.status(500).send(sanitizePublicError(err, "Unable to render live preview"));
    }
  });

  // Operation 2: list_creative_dna_routes
  app.all("/api/routes", async (_req: Request, res: Response) => {
    try {
      const upstream = await listCreativeDnaRoutes();
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: "Unable to list Creative DNA routes",
        });
      }
      return res.status(upstream.status).json(sanitizeRoutesData(upstream.data));
    } catch (err: any) {
      console.error("[ROUTES ERROR]", err);
      return res.status(500).json({ error: "Unable to list Creative DNA routes" });
    }
  });

  // Tool-compatible aliases (for direct ChatGPT Actions / RPC calls)
  app.post("/api/tools/resolve_creative_dna", async (req: Request, res: Response) => {
    try {
      const brand = req.body?.brand || req.body?.arguments?.brand;
      const branch = req.body?.branch || req.body?.arguments?.branch;
      const validated = validateResolveInput(brand, branch);

      const upstream = await resolveCreativeDna(validated.brand, validated.branch);
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: typeof upstream.data?.error === "string" ? upstream.data.error.replace(/https?:\/\/[^\s]+/gi, "[redacted]") : "Unable to resolve Creative DNA",
        });
      }
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      const safeMsg = sanitizePublicError(err, "Unable to resolve Creative DNA");
      const isClientError = err?.message && (err.message.includes("parameter") || err.message.includes("required") || err.message.includes("exceeds"));
      return res.status(isClientError ? 400 : 500).json({ error: safeMsg });
    }
  });

  app.post("/api/feedback/context-assets/upload", async (req: Request, res: Response) => {
    try {
      const body=req.body||{};
      const mimeType=String(body.mime_type||"").toLowerCase();
      if(!["image/png","image/jpeg","image/webp","image/gif"].includes(mimeType)) return res.status(415).json({error:"PNG, JPEG, WebP, or GIF required"});
      const clean=String(body.data_base64||"").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/,"").replace(/\s+/g,"");
      if(!clean) return res.status(400).json({error:"Image data is required"});
      const bytes=Buffer.from(clean,"base64");
      if(!bytes.length) return res.status(400).json({error:"Image data is invalid"});
      if(bytes.length>10*1024*1024) return res.status(413).json({error:"Image exceeds 10 MB"});
      const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
      if(!serviceKey) return res.status(503).json({error:"Storage upload is not configured"});
      const ext=mimeType==="image/png"?"png":mimeType==="image/webp"?"webp":mimeType==="image/gif"?"gif":"jpg";
      const objectPath=`member/${Date.now()}-${Math.random().toString(36).slice(2,10)}.${ext}`;
      const upload=await fetch(`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/feedback-context/${objectPath}`,{method:"POST",headers:{Authorization:`Bearer ${serviceKey}`,apikey:serviceKey,"Content-Type":mimeType,"x-upsert":"false"},body:bytes});
      if(!upload.ok) return res.status(502).json({error:"Unable to persist feedback image"});
      return res.status(201).json({asset_id:objectPath,image_url:`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/public/feedback-context/${objectPath}`});
    } catch(err:any){ return res.status(500).json({error:sanitizePublicError(err,"Unable to upload feedback context asset")}); }
  });

  app.post("/api/feedback/context-image", async (req: Request, res: Response) => {
    if (!FEEDBACK_UPSTREAM_URL) return res.status(503).json({ error:"Feedback service is not configured" });
    try {
      const body = req.body || {};
      const sourceUrl = String(body.source_url || "").trim();
      const referenceId = String(body.reference_id || "").trim();
      if (!sourceUrl || !/^https:\/\/chatgpt\.com\/api\/library\/files\/libfile_[a-zA-Z0-9_-]+\/download(?:\?.*)?$/.test(sourceUrl)) {
        return res.status(400).json({ error:"A valid ChatGPT Library image source_url is required" });
      }
      const upstream = await fetch(sourceUrl, { headers: req.header("authorization") ? { Authorization:req.header("authorization")! } : undefined });
      if (!upstream.ok) return res.status(400).json({ error:"Unable to fetch Library image. Upload requires an accessible source in the current session." });
      const contentType = upstream.headers.get("content-type") || "";
      if (!/^image\/(png|jpeg|webp|gif)/i.test(contentType)) return res.status(415).json({ error:"Source is not a supported image" });
      const bytes = Buffer.from(await upstream.arrayBuffer());
      if (bytes.length > 10*1024*1024) return res.status(413).json({ error:"Image exceeds 10 MB" });
      const ext = contentType.includes("png")?"png":contentType.includes("webp")?"webp":contentType.includes("gif")?"gif":"jpg";
      const safeRef = (referenceId || "context").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,100);
      const objectPath = `member/${Date.now()}-${safeRef}.${ext}`;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!serviceKey) return res.status(503).json({ error:"Storage upload is not configured" });
      const upload = await fetch(`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/feedback-context/${objectPath}`, { method:"POST", headers:{ Authorization:`Bearer ${serviceKey}`, apikey:serviceKey, "Content-Type":contentType, "x-upsert":"false" }, body:bytes });
      if (!upload.ok) return res.status(502).json({ error:"Unable to persist feedback image" });
      return res.json({ image_url:`https://wuonwttmkadwsmefjukv.supabase.co/storage/v1/object/public/feedback-context/${objectPath}`, reference_id:referenceId || null });
    } catch (err:any) { return res.status(500).json({ error:sanitizePublicError(err,"Unable to persist feedback image") }); }
  });

  app.post("/api/tools/submit_training_feedback", async (req: Request, res: Response) => {
    try {
      const body = req.body?.arguments || req.body || {};
      const upstream = await submitTrainingFeedback(body.brand, body.branch, body.feedback, body.submitter_name, body.proposed_scope, body.context_images, body.context_image_uploads, body.context_asset_ids, body.training_spec);
      return res.status(upstream.status).json(upstream.data);
    } catch (err: any) {
      const safeMsg = sanitizePublicError(err, "Unable to submit training feedback");
      return res.status(400).json({ error: safeMsg });
    }
  });

  app.post("/api/tools/list_creative_dna_routes", async (_req: Request, res: Response) => {
    try {
      const upstream = await listCreativeDnaRoutes();
      if (!upstream.ok) {
        return res.status(upstream.status).json({
          error: "Unable to list Creative DNA routes",
        });
      }
      return res.status(upstream.status).json(sanitizeRoutesData(upstream.data));
    } catch (err: any) {
      console.error("[TOOLS LIST ROUTES ERROR]", err);
      return res.status(500).json({ error: "Unable to list Creative DNA routes" });
    }
  });

  // Tool discovery & OpenAPI / schema endpoint
  app.get("/api/tools", (_req: Request, res: Response) => {
    return res.json({
      name: APP_METADATA.name,
      version: "1.0.0",
      description: APP_METADATA.shortDescription,
      canonicalOrigin: CANONICAL_PRODUCTION_ORIGIN,
      mcpEndpoint: CANONICAL_PRODUCTION_MCP_URL,
      tools: TOOL_DEFINITIONS,
    });
  });

  // ChatGPT App / OpenAI Apps SDK discovery endpoint
  app.get(["/api/info", "/api/app"], (_req: Request, res: Response) => {
    return res.json(APP_METADATA);
  });

  // Well-known OpenAI Plugin manifest endpoint
  app.get("/.well-known/ai-plugin.json", (_req: Request, res: Response) => {
    return res.json({
      schema_version: "v1",
      name_for_human: APP_METADATA.name,
      name_for_model: "creative_dna",
      description_for_human: APP_METADATA.shortDescription,
      description_for_model: APP_METADATA.longDescription + " Canonical Creative DNA is read-only, but team members can submit training feedback as Pending admin-review proposals with submit_training_feedback. A pending proposal never changes canonical DNA. Use list_creative_dna_routes to discover routes, resolve_creative_dna for canonical specifications, and submit_training_feedback whenever the user explicitly says Creative DNA — Train: Brand / Branch.",
      auth: {
        type: "none",
      },
      api: {
        type: "openapi",
        url: `${CANONICAL_PRODUCTION_ORIGIN}/api/openapi.json`,
      },
      logo_url: `${CANONICAL_PRODUCTION_ORIGIN}/icon.png`,
      contact_email: "support@creative-dna-gateway.vercel.app",
      legal_info_url: `${CANONICAL_PRODUCTION_ORIGIN}/terms`,
    });
  });

  // OpenAPI 3.1 specification for ChatGPT Actions / Custom GPTs
  app.get("/api/openapi.json", (_req: Request, res: Response) => {
    return res.json({
      openapi: "3.1.0",
      info: {
        title: APP_METADATA.name,
        version: "1.0.0",
        description: APP_METADATA.shortDescription,
      },
      servers: [
        {
          url: CANONICAL_PRODUCTION_ORIGIN,
          description: "Canonical Production Gateway",
        },
      ],
      paths: {
        "/api/tools/get_onepage_ui_template": { post: { operationId: "get_onepage_ui_template", description: ONEPAGE_TEMPLATE_DESC, requestBody: { content: { "application/json": { schema: { type: "object", properties: { version: { type: "string" }, format: { type: "string", enum: ["manifest", "source"] } } } } } }, responses: { "200": { description: "Versioned UI template manifest or inline source" } } } },
        "/api/health": {
          get: {
            operationId: "get_health_status",
            summary: "Check system health and upstream datastore connectivity",
            description: "Returns operational status of the Creative DNA Gateway. Canonical DNA is read-only; pending feedback submission is writable.",
            responses: { "200": { description: "Operational status" } },
          },
        },
        "/api/routes": {
          get: {
            operationId: "list_creative_dna_routes_get",
            summary: "List available Creative DNA brand routes",
            description: LIST_CREATIVE_DNA_ROUTES_DESC,
            responses: { "200": { description: "List of available routes" } },
          },
          post: {
            operationId: "list_creative_dna_routes",
            summary: "List available Creative DNA brand routes",
            description: LIST_CREATIVE_DNA_ROUTES_DESC,
            responses: { "200": { description: "List of available routes" } },
          },
        },
        "/api/tools/submit_training_feedback": {
          post: {
            operationId: "submit_training_feedback",
            summary: "Submit Creative DNA training feedback for admin review",
            description: SUBMIT_FEEDBACK_DESC,
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["brand", "branch", "feedback", "submitter_name"],
                    properties: {
                      brand: { type: "string" },
                      branch: { type: "string" },
                      feedback: { type: "string" },
                      submitter_name: { type: "string", description: "Required exact member account/display name shown in the Admin feedback queue." },
                      proposed_scope: { type: "string" },
                      context_images: { type:"array", maxItems:12, items:{ type:"object", properties:{ role:{type:"string",enum:["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]}, image_url:{type:"string"}, reference_id:{type:"string"}, caption:{type:"string"} }, required:["role"] } },
                      context_image_uploads: { type:"array", maxItems:12, items:{ type:"object", properties:{ role:{type:"string",enum:["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]}, data_base64:{type:"string"}, mime_type:{type:"string",enum:["image/png","image/jpeg","image/webp","image/gif"]}, reference_id:{type:"string"}, caption:{type:"string"} }, required:["role","data_base64","mime_type"] } },
                      context_asset_ids: { type:"array", maxItems:12, items:{ type:"object", properties:{ asset_id:{type:"string"}, role:{type:"string",enum:["OUTPUT_BEING_REVIEWED","STYLE_REFERENCE","PRODUCT_REFERENCE","GENERATION_CONTEXT"]}, caption:{type:"string"} }, required:["asset_id","role"] } },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "Pending feedback proposal accepted for admin review" } },
          },
        },
        "/api/resolve": {
          post: {
            operationId: "resolve_creative_dna",
            summary: "Resolve canonical Creative DNA specification",
            description: RESOLVE_CREATIVE_DNA_DESC,
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["brand", "branch"],
                    properties: {
                      brand: { type: "string", description: "Target brand name (e.g., 'PawfectHouse', 'GiftSoul', 'SoulPrise')" },
                      branch: { type: "string", description: "Target branch or module path (e.g., 'Onepage', 'LDP Hero', 'Home Hero', 'Seasonal Banner', 'Shop By Product', 'Shop By Categories', 'UGC')" },
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "Canonical Creative DNA specification" } },
          },
        },
      },
    });
  });

  // App support, terms, privacy API endpoints (machine readable)
  app.get("/api/privacy", (_req: Request, res: Response) => {
    return res.json({
      title: "Privacy Policy",
      app: APP_METADATA.name,
      updated: "2026-09-18",
      summary: "Creative DNA keeps canonical specifications read-only for member sessions. Team members may submit training feedback into a Pending admin-review queue; pending submissions do not modify canonical DNA. We do not sell user data and do not request or store passwords, financial data, health records, or sensitive personal information.",
      fullUrl: `${CANONICAL_PRODUCTION_ORIGIN}/privacy`,
    });
  });

  app.get("/api/terms", (_req: Request, res: Response) => {
    return res.json({
      title: "Terms of Service",
      app: APP_METADATA.name,
      updated: "2026-09-18",
      summary: "Canonical Creative DNA specifications are read-only for member sessions. Members may submit training feedback to a Pending admin-review queue; pending feedback does not modify canonical DNA. Specifications are provided as-is and users remain responsible for final creative and product decisions.",
      fullUrl: `${CANONICAL_PRODUCTION_ORIGIN}/terms`,
    });
  });

  app.get("/api/support", (_req: Request, res: Response) => {
    return res.json({
      title: "Support & Contact",
      app: APP_METADATA.name,
      purpose: "Technical assistance, brand onboarding, and ChatGPT App integration support.",
      supportedBrands: APP_METADATA.supportedBrands,
      contact: "support@creative-dna-gateway.vercel.app",
      mcpUrl: CANONICAL_PRODUCTION_MCP_URL,
      fullUrl: `${CANONICAL_PRODUCTION_ORIGIN}/support`,
    });
  });

  // MCP v2 HTTP entry: serves modern 2026-07-28 per-request metadata and
  // legacy 2025-era stateless clients from the same endpoint.
  const mcpHandler = createMcpHandler(() => createMcpServer(), { legacy: "stateless" });
  const mcpNodeHandler = toNodeHandler(mcpHandler);

  // IMPORTANT: /api/mcp is protocol-only. Do not return a custom JSON discovery
  // document here: ChatGPT probes the MCP URL with GET/SSE during app creation and must
  // receive the MCP transport response, not application metadata.
  // Express JSON middleware has already consumed POST bodies before this route.
  // Pass req.body explicitly so the MCP Node adapter does not try to re-read an exhausted stream.
  // This is required by @modelcontextprotocol/node when mounted behind express.json().
  app.all("/api/mcp", (req: Request, res: Response) => {
    void mcpNodeHandler(req, res, req.body);
  });

  // Optional human-readable discovery lives on a separate URL so it cannot shadow MCP.
  app.get("/api/mcp-info", (_req: Request, res: Response) => {
    return res.json({
      name: APP_METADATA.name,
      version: "2.0.0",
      canonicalUrl: CANONICAL_PRODUCTION_MCP_URL,
      protocolVersion: "2026-07-28",
      legacyProtocolSupport: "stateless",
      capabilities: { tools: { listChanged: false } },
      tools: TOOL_DEFINITIONS.map(({ name, title, description, annotations }) => ({ name, title, description, annotations })),
    });
  });

  // Explicit 404 handler for unmatched /api/* requests - guarantees API requests never fall through to the SPA index.html
  app.all("/api/*", (_req: Request, res: Response) => {
    return res.status(404).json({
      error: "Not Found",
      message: "The requested API endpoint does not exist on this gateway.",
    });
  });

  return app;
}

export const app = createApp();
export default app;

export function startServer() {
  const PORT = 3000;
  const distPath = path.join(process.cwd(), "dist");

  // Serve static assets from built Vite dist
  app.use(express.static(distPath));
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  return app.listen(PORT, "0.0.0.0", () => {
    console.log(`Creative DNA Gateway server running on http://0.0.0.0:${PORT}`);
    console.log(`Production MCP endpoint configured at: ${CANONICAL_PRODUCTION_MCP_URL}`);
  });
}

/**
 * Determines whether server.ts is executed directly as the main process
 * (e.g. `npm run dev` with tsx or `npm start` with node dist/server.cjs)
 * versus being imported as a module by a serverless function entrypoint (like Vercel `api/index.ts`)
 * or a test runner.
 */
export function isDirectExecution(): boolean {
  // Never start standalone server on Vercel or in serverless environments
  if (process.env.VERCEL || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return false;
  }
  // Never start standalone server in test mode
  if (process.env.NODE_ENV === "test") {
    return false;
  }
  // Check process entry argument to see if this file was invoked directly
  if (typeof process.argv[1] !== "string") {
    return false;
  }
  const entryFile = path.resolve(process.argv[1]);
  const baseName = path.basename(entryFile);
  return baseName === "server.ts" || baseName === "server.cjs" || baseName === "server.js";
}

// Start server if run directly (local dev / container)
if (isDirectExecution()) {
  startServer();
}