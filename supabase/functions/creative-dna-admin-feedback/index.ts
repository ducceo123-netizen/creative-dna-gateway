import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

export default {
  fetch: async (req: Request) => {
    if (req.method !== "POST") return Response.json({ error: "POST required" }, { status: 405 });

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData } = await authClient.auth.getUser();
    const user = authData?.user;
    if (!user) return Response.json({ error: "Authenticated user required" }, { status: 401 });

    const adminDb = createClient(supabaseUrl, serviceKey);
    const { data: member } = await adminDb
      .from("creative_dna_team_members")
      .select("role,is_active")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!member?.is_active || member.role !== "admin") {
      return Response.json({ error: "Admin required" }, { status: 403 });
    }

    const body = await req.json();

    // UID Brands governance: admin-only, fail-closed operations.
    if (body.mode === "governance_evaluate") {
      const proposalId=String(body.proposal_id||"").trim();
      const runs=Array.isArray(body.candidate_runs)?body.candidate_runs:[];
      const review=body.review||{};
      if(!proposalId)return Response.json({error:"proposal_id required"},{status:400});
      const {data:p,error:pe}=await adminDb.from("knowledge_proposals")
        .select("id,knowledge_node_id,brand_id,proposed_scope,status,proposed_content_md,raw_feedback")
        .eq("id",proposalId).single();
      if(pe||!p||p.status!=="pending")return Response.json({error:"Pending proposal required"},{status:409});
      const {data:node}=await adminDb.from("knowledge_nodes")
        .select("id,slug").eq("id",p.knowledge_node_id).single();
      if(!node)return Response.json({error:"Source node unavailable"},{status:404});
      const structural=node.slug==="onepage-system"&&!/brand[ _-]?style|vibe|mood/i.test(String(p.proposed_scope||""));
      const q=adminDb.from("uid_governance_baselines").select("*").eq("branch_slug",node.slug).not("approved_at","is",null);
      const {data:baselines,error:be}=await (structural?q:q.eq("brand_id",p.brand_id));
      if(be)return Response.json({error:be.message},{status:500});
      const cases=baselines||[];
      const allIssues:string[]=[];
      if(!cases.length)allIssues.push("No approved regression baseline cases");
      if(structural){
        const {data:nodes}=await adminDb.from("knowledge_nodes").select("brand_id").eq("slug","onepage-system").eq("status","active");
        for(const target of nodes||[])
          if(!cases.some((c:any)=>c.brand_id===target.brand_id))
            allIssues.push("Missing approved baseline for an affected Onepage brand");
      }
      const results=cases.map((c:any)=>{
        const issues:string[]=[];
        const run=runs.find((r:any)=>String(r.baseline_id)===c.id);
        if(!run||!run.output||typeof run.output!=="object"||!run.source_run_id||!/^https:\/\//.test(String(run.artifact_url||""))){
          issues.push("Missing actual candidate run output, run ID, or artifact reference");
        } else {
          const content=JSON.stringify(run.output).toLowerCase();
          const assertions=c.expected_assertions||{};
          for(const required of assertions.required_text||[])
            if(!content.includes(String(required).toLowerCase()))issues.push("Required statement missing");
          for(const forbidden of assertions.forbidden_text||[])
            if(content.includes(String(forbidden).toLowerCase()))issues.push("Forbidden statement found");
          for(const key of assertions.required_keys||[])
            if(!(key in run.output))issues.push("Required output field missing");
          for(const key of assertions.immutable_fields||[])
            if(JSON.stringify(run.output[key])!==JSON.stringify(c.approved_output?.[key]))
              issues.push("Approved immutable field changed: "+key);
          if(!["required_text","forbidden_text","required_keys","immutable_fields"].some(k=>Array.isArray(assertions[k])&&assertions[k].length))
            issues.push("No enforceable assertions");
        }
        return {baseline_id:c.id,case_key:c.case_key,status:issues.length?"failed":"passed",
          issues,source_run_id:run?.source_run_id||null,artifact_url:run?.artifact_url||null};
      });
      // Lexical similarity is only a conflict-review candidate, not a semantic contradiction verdict.
      const {data:currentNodes}=await adminDb.from("knowledge_nodes")
        .select("id,content_md,slug").eq("status","active").limit(200);
      const proposalText=String(p.proposed_content_md||p.raw_feedback||"").toLowerCase();
      const words=(v:string)=>new Set(v.match(/[a-z0-9À-ỹ]+/gu)||[]);
      const referenceWords=words(proposalText);
      const conflicts=(currentNodes||[]).map((n:any)=>{
        const source=words(String(n.content_md||"").toLowerCase());
        const overlap=[...referenceWords].filter(w=>source.has(w)).length;
        return {node_id:n.id,lexical_overlap:referenceWords.size?overlap/referenceWords.size:0,
          interpretation:"requires_human_review"};
      }).filter((x:any)=>x.lexical_overlap>=0.6).slice(0,10);
      const declaredReview=review.product_truth_verified===true&&review.visual_reviewed===true
        &&review.conflicts_reviewed===true&&review.critical_regressions===0
        &&String(review.review_note||"").trim().length>=20;
      if(!declaredReview)allIssues.push("Required Admin visual, product-truth and conflict attestations missing");
      const failures=results.filter((x:any)=>x.status==="failed").length;
      const status=allIssues.length?"blocked":failures?"failed":"passed";
      const {data:hash,error:he}=await adminDb.rpc("uid_governance_candidate_hash",{p_proposal_id:proposalId});
      if(he||!hash)return Response.json({error:"Unable to resolve candidate identity"},{status:500});
      const {data:stored,error:se}=await adminDb.from("uid_governance_evaluations").insert({
        proposal_id:proposalId,candidate_hash:hash,baseline_ids:cases.map((c:any)=>c.id),
        test_results:results,conflict_results:[...conflicts,{note:String(review.review_note||"").slice(0,4000),
          manually_reviewed:review.conflicts_reviewed===true}],
        evaluation_status:status,critical_failures:failures+Math.max(0,Number(review.critical_regressions||0)),
        evaluator_version:"mechanical-v1-plus-human-review",completed_at:new Date().toISOString()
      }).select("id,evaluation_status,critical_failures,baseline_ids").single();
      if(se)return Response.json({error:se.message},{status:500});
      return Response.json({evaluation:stored,issues:allIssues,results,
        limitation:"Tests verify supplied run artifacts and assertions; creative visual quality is admin-attested, not model-verified."});
    }
    if (body.mode === "governance_rollback_preview") {
      const {data:snapshot,error:se}=await adminDb.from("uid_governance_snapshots")
        .select("id,node_id,proposal_id,checkpoint,created_at").eq("id",body.snapshot_id).single();
      if(se||!snapshot)return Response.json({error:"Snapshot not found"},{status:404});
      const {data:hash,error:he}=await adminDb.rpc("uid_governance_node_hash",{p_node_id:snapshot.node_id});
      if(he||!hash)return Response.json({error:"Cannot resolve current node hash"},{status:500});
      return Response.json({snapshot,current_md5:hash,
        note:"Use current_md5 for concurrency guarded rollback after administrator review."});
    }
    if (body.mode === "governance_baseline_upsert") {
      const b=body.baseline||{};
      if(!b.brand_id||!b.branch_slug||!b.case_key||!b.source_brief||!b.approved_output||
        !b.expected_assertions||!["required_text","forbidden_text","required_keys","immutable_fields"].some(k=>Array.isArray(b.expected_assertions?.[k])&&b.expected_assertions[k].length))
        return Response.json({error:"Approved brief, expected assertions and output are required"},{status:422});
      const {data,error}=await adminDb.from("uid_governance_baselines").insert({
        brand_id:b.brand_id,branch_slug:b.branch_slug,case_key:b.case_key,
        source_brief:b.source_brief,approved_output:b.approved_output,
        expected_assertions:b.expected_assertions,approved_by:user.id,
        approved_at:new Date().toISOString()
      }).select().single();
      return error?Response.json({error:error.message},{status:500}):Response.json({baseline:data});
    }
    if (body.mode === "governance_list") {
      const [baselines,evaluations,snapshots,brands]=await Promise.all([
        adminDb.from("uid_governance_baselines").select("*").order("created_at",{ascending:false}).limit(200),
        adminDb.from("uid_governance_evaluations").select("*").order("created_at",{ascending:false}).limit(200),
        adminDb.from("uid_governance_snapshots").select("id,node_id,proposal_id,checkpoint,created_at").order("created_at",{ascending:false}).limit(200),
        adminDb.from("brands").select("id,slug,name").order("name")
      ]);
      if(baselines.error||evaluations.error||snapshots.error||brands.error)return Response.json({error:"Unable to load governance registry"},{status:500});
      return Response.json({baselines:baselines.data,evaluations:evaluations.data,snapshots:snapshots.data,brands:brands.data});
    }
    if (body.mode === "governance_rollback_proposal_preview") {
      const proposalId=String(body.proposal_id||"");
      const {data:snaps,error:se}=await adminDb.from("uid_governance_snapshots")
        .select("id,node_id,checkpoint,content_md,metadata,node_version,created_at")
        .eq("proposal_id",proposalId).in("checkpoint",["before","after"]).order("created_at",{ascending:false});
      if(se||!snaps?.length)return Response.json({error:"Snapshots not available"},{status:404});
      const latest=new Map<string,{before:any;after:any}>();
      for(const snap of snaps){
        const group=latest.get(snap.node_id)||{before:null,after:null};
        const checkpoint=snap.checkpoint as "before"|"after";
        if(!group[checkpoint])group[checkpoint]=snap;
        latest.set(snap.node_id,group);
      }
      const summary=[];
      for(const [nodeId,states] of latest){
        const {data:node}=await adminDb.from("knowledge_nodes")
          .select("id,slug,content_md,metadata,version").eq("id",nodeId).single();
        const {data:currentHash}=await adminDb.rpc("uid_governance_node_hash",{p_node_id:nodeId});
        summary.push({node_id:nodeId,slug:node?.slug,ready:Boolean(states.before&&states.after),
          current_md5:currentHash,after_checkpoint_id:states.after?.id||null});
      }
      return Response.json({proposal_id:proposalId,affected_nodes:summary,
        note:"Rollback is atomic; RPC will reject all nodes if any node has changed since this merge."});
    }
    if (body.mode === "governance_rollback_proposal") {
      const {data,error}=await adminDb.rpc("uid_governance_rollback_proposal",{
        p_proposal_id:body.proposal_id,p_actor_user_id:user.id
      });
      return error?Response.json({error:error.message},{status:409}):Response.json({result:data});
    }
    if (body.mode === "governance_rollback") {
      const {data,error}=await adminDb.rpc("uid_governance_rollback_snapshot",{
        p_snapshot_id:body.snapshot_id,p_actor_user_id:user.id,
        p_expected_current_md5:body.expected_current_md5
      });
      return error?Response.json({error:error.message},{status:409}):Response.json({result:data});
    }
    if (body.mode === "branch_guide_upsert") {
      const brandSlug = String(body.brand_slug || "").trim().toLowerCase();
      const branchSlug = String(body.branch_slug || "").trim().toLowerCase();
      if (!brandSlug || !branchSlug) {
        return Response.json({ error: "brand_slug and branch_slug are required" }, { status: 400 });
      }

      let imageUrl = String(body.image_url || "").trim();
      const dataUrl = String(body.image_data_base64 || "").trim();
      const mimeType = String(body.mime_type || "").trim().toLowerCase();

      if (dataUrl) {
        if (!["image/png","image/jpeg","image/webp"].includes(mimeType)) {
          return Response.json({ error: "PNG, JPEG, or WebP required" }, { status: 415 });
        }
        const clean = dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "").replace(/\s+/g, "");
        if (!clean) return Response.json({ error: "Image data is required" }, { status: 400 });

        const binary = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
        if (!binary.length) return Response.json({ error: "Image data is invalid" }, { status: 400 });
        if (binary.length > 8 * 1024 * 1024) return Response.json({ error: "Image exceeds 8 MB" }, { status: 413 });

        const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
        const safeBrand = brandSlug.replace(/[^a-z0-9-]/g, "");
        const safeBranch = branchSlug.replace(/[^a-z0-9-]/g, "");
        const objectPath = `branch-guides/${safeBrand}/${safeBranch}-${Date.now()}.${ext}`;

        const { error: uploadError } = await adminDb.storage
          .from("feedback-context")
          .upload(objectPath, binary, { contentType: mimeType, upsert: false });

        if (uploadError) return Response.json({ error: uploadError.message }, { status: 500 });

        const { data: publicUrlData } = adminDb.storage.from("feedback-context").getPublicUrl(objectPath);
        imageUrl = publicUrlData.publicUrl;
      }

      const pageUrl = String(body.page_url || "").trim();
      const cssSelector = String(body.css_selector || "").trim();

      if (pageUrl) {
        let parsed: URL;
        try { parsed = new URL(pageUrl); } catch {
          return Response.json({ error: "Valid page_url required" }, { status: 400 });
        }
        if (parsed.protocol !== "https:") {
          return Response.json({ error: "Only HTTPS page URLs are allowed" }, { status: 400 });
        }
      }

      const payload = {
        brand_slug: brandSlug,
        branch_slug: branchSlug,
        title_vi: body.title_vi ? String(body.title_vi).trim() : null,
        description_vi: body.description_vi ? String(body.description_vi).trim() : null,
        usage_badge: body.usage_badge ? String(body.usage_badge).trim() : null,
        ratio_note: body.ratio_note ? String(body.ratio_note).trim() : null,
        output_note: body.output_note ? String(body.output_note).trim() : null,
        page_url: pageUrl || null,
        css_selector: cssSelector || null,
        preview_mode: pageUrl && cssSelector ? "selector" : "selector",
        image_url: pageUrl && cssSelector ? null : (imageUrl || null),
        image_caption: pageUrl && cssSelector ? null : (body.image_caption ? String(body.image_caption).trim() : null),
        updated_at: new Date().toISOString(),
      };

      const { data: guide, error } = await adminDb
        .from("branch_visual_guides")
        .upsert(payload, { onConflict: "brand_slug,branch_slug" })
        .select("*")
        .single();

      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({ guide });
    }

    if (body.mode === "team_list") {
      const { data: rows, error } = await adminDb
        .from("creative_dna_team_members")
        .select("user_id,display_name,role,is_active,created_at,updated_at")
        .order("created_at", { ascending: true });

      if (error) return Response.json({ error: error.message }, { status: 500 });

      const members = await Promise.all(
        (rows || []).map(async (row: any) => {
          const { data: userData } = await adminDb.auth.admin.getUserById(row.user_id);
          return {
            ...row,
            email: userData?.user?.email || null,
          };
        }),
      );

      return Response.json({ members });
    }

    if (body.mode === "grant_admin") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: "Valid email required" }, { status: 400 });
      }

      let targetUser: any = null;
      let invited = false;

      for (let page = 1; page <= 10 && !targetUser; page++) {
        const { data: usersData, error: usersError } = await adminDb.auth.admin.listUsers({ page, perPage: 100 });
        if (usersError) return Response.json({ error: usersError.message }, { status: 500 });
        targetUser = (usersData?.users || []).find((u: any) => String(u.email || "").toLowerCase() === email) || null;
        if ((usersData?.users || []).length < 100) break;
      }

      if (!targetUser) {
        const { data: inviteData, error: inviteError } = await adminDb.auth.admin.inviteUserByEmail(email);
        if (inviteError) return Response.json({ error: inviteError.message }, { status: 500 });
        targetUser = inviteData?.user;
        invited = true;
      }

      if (!targetUser?.id) {
        return Response.json({ error: "Unable to resolve or invite user" }, { status: 500 });
      }

      const displayName = String(body.display_name || email.split("@")[0]).trim().slice(0, 120) || email;

      const { data: memberRow, error: memberError } = await adminDb
        .from("creative_dna_team_members")
        .upsert(
          {
            user_id: targetUser.id,
            display_name: displayName,
            role: "admin",
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        )
        .select("user_id,display_name,role,is_active,created_at,updated_at")
        .single();

      if (memberError) return Response.json({ error: memberError.message }, { status: 500 });

      return Response.json({
        member: { ...memberRow, email },
        invited,
        instruction: invited
          ? "Admin access granted and an invitation email was requested."
          : "Admin access granted to the existing user.",
      });
    }

    if (body.mode === "delete_all") {
      const status = String(body.status || "").trim().toLowerCase();
      const allowed = new Set(["pending","accepted","merged","rejected","all"]);
      if (!allowed.has(status)) {
        return Response.json({ error: "Valid status required" }, { status: 400 });
      }

      let query = adminDb
        .from("knowledge_proposals")
        .delete()
        .select("id,status");

      if (status !== "all") query = query.eq("status", status);

      const { data: deleted, error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({
        deleted_count: (deleted || []).length,
        status,
        instruction: "Selected proposal records were permanently deleted from the admin review queue.",
      });
    }

    if (body.mode === "list") {
      const { data, error } = await adminDb
        .from("knowledge_proposals")
        .select("id,status,raw_feedback,proposed_content_md,proposed_scope,change_summary,evidence_summary,submitted_by_name,created_at,reviewed_at,review_note,merged_at,context_images,brands(name),knowledge_nodes(title,slug)")
        .order("created_at", { ascending: false })
        .limit(300);

      if (error) return Response.json({ error: error.message }, { status: 500 });

      return Response.json({
        proposals: (data || []).map((p: any) => ({
          id: p.id,
          status: p.status,
          raw_feedback: p.raw_feedback,
          proposed_content_md: p.proposed_content_md,
          proposed_scope: p.proposed_scope,
          change_summary: p.change_summary,
          evidence_summary: p.evidence_summary || {},
          submitted_by_name: p.submitted_by_name,
          created_at: p.created_at,
          reviewed_at: p.reviewed_at,
          review_note: p.review_note,
          merged_at: p.merged_at,
          context_images: p.context_images || [],
          brand_name: p.brands?.name,
          branch_title: p.knowledge_nodes?.title,
          branch_slug: p.knowledge_nodes?.slug,
        })),
      });
    }

    // Legacy manual merge remains supported only for proposals accepted before auto-merge was enabled.
    if (body.mode === "merge") {
      return Response.json({error:"Legacy merge is disabled pending governed migration; use verified evaluation flow."},{status:409});
    }
    if (body.mode === "review") {
      if (!body.proposal_id || !["accept", "reject"].includes(body.decision)) {
        return Response.json({ error: "proposal_id and valid decision required" }, { status: 400 });
      }

      if (body.decision === "accept") {
        if(!body.evaluation_id)
          return Response.json({error:"Passed regression evaluation ID required before Accept"},{status:422});
        const { data, error } = await adminDb.rpc("uid_governance_accept_merge", {
          p_proposal_id: body.proposal_id,
          p_actor_user_id: user.id,
          p_review_note: body.review_note || null,
          p_evaluation_id: body.evaluation_id,
        });

        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({
          proposal: {
            id: data.proposal_id,
            status: data.status,
            merged_at: data.merged_at,
          },
          merged_nodes: data.merged_nodes,
          cross_brand_sync: data.cross_brand_sync,
          instruction: "Accepted and merged into canonical Creative DNA in one action.",
        });
      }

      const now = new Date().toISOString();
      const { data, error } = await adminDb
        .from("knowledge_proposals")
        .update({
          status: "rejected",
          reviewed_at: now,
          reviewed_by: user.id,
          review_note: body.review_note || null,
          updated_at: now,
        })
        .eq("id", body.proposal_id)
        .eq("status", "pending")
        .select("id,status,knowledge_node_id,brand_id,raw_feedback,proposed_scope,reviewed_at,context_images")
        .maybeSingle();

      if (error) return Response.json({ error: error.message }, { status: 500 });
      if (!data) return Response.json({ error: "Pending proposal not found" }, { status: 404 });

      return Response.json({
        proposal: data,
        instruction: "Rejected; canonical DNA unchanged.",
      });
    }

    return Response.json({ error: "mode must be list, review, merge, team_list, grant_admin, delete_all, or branch_guide_upsert" }, { status: 400 });
  },
};
