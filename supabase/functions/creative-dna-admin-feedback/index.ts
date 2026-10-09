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
    if (body.mode === "governance_baseline_upsert") {
      const b=body.baseline||{};
      if(!b.brand_id||!b.branch_slug||!b.case_key||!b.source_brief||!b.approved_output||
        !b.expected_assertions||!Object.keys(b.expected_assertions).length)
        return Response.json({error:"Approved brief, expected assertions and output are required"},{status:422});
      const {data,error}=await adminDb.from("uid_governance_baselines").upsert({
        brand_id:b.brand_id,branch_slug:b.branch_slug,case_key:b.case_key,
        source_brief:b.source_brief,approved_output:b.approved_output,
        expected_assertions:b.expected_assertions,approved_by:user.id,
        approved_at:new Date().toISOString()
      },{onConflict:"brand_id,branch_slug,case_key"}).select().single();
      return error?Response.json({error:error.message},{status:500}):Response.json({baseline:data});
    }
    if (body.mode === "governance_list") {
      const [baselines,evaluations,snapshots]=await Promise.all([
        adminDb.from("uid_governance_baselines").select("*").order("created_at",{ascending:false}).limit(200),
        adminDb.from("uid_governance_evaluations").select("*").order("created_at",{ascending:false}).limit(200),
        adminDb.from("uid_governance_snapshots").select("id,node_id,proposal_id,checkpoint,created_at").order("created_at",{ascending:false}).limit(200)
      ]);
      if(baselines.error||evaluations.error||snapshots.error)return Response.json({error:"Unable to load governance registry"},{status:500});
      return Response.json({baselines:baselines.data,evaluations:evaluations.data,snapshots:snapshots.data});
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
    if (body.mode === "__disabled_legacy_merge") {
      if (!body.proposal_id) return Response.json({ error: "proposal_id required" }, { status: 400 });

      const { data: p, error: pe } = await adminDb
        .from("knowledge_proposals")
        .select("id,status,brand_id,knowledge_node_id,raw_feedback,proposed_content_md,proposed_scope,change_summary,merged_at,context_images")
        .eq("id", body.proposal_id)
        .maybeSingle();

      if (pe) return Response.json({ error: pe.message }, { status: 500 });
      if (!p || p.status !== "accepted" || p.merged_at) {
        return Response.json({ error: "Accepted legacy proposal not found" }, { status: 409 });
      }

      const { data: sourceNode, error: ne } = await adminDb
        .from("knowledge_nodes")
        .select("id,slug,content_md,metadata,brand_id")
        .eq("id", p.knowledge_node_id)
        .single();

      if (ne || !sourceNode) return Response.json({ error: ne?.message || "Knowledge node not found" }, { status: 500 });

      const feedback = String(p.proposed_content_md || p.raw_feedback || "").trim();
      if (!feedback) return Response.json({ error: "Proposal has no mergeable feedback" }, { status: 400 });

      const structuralOnepage =
        sourceNode.slug === "onepage-system" &&
        !/brand[ _-]?style|vibe|mood/i.test(String(p.proposed_scope || ""));

      let targets: any[] = [sourceNode];
      if (structuralOnepage) {
        const { data: nodes, error: te } = await adminDb
          .from("knowledge_nodes")
          .select("id,slug,content_md,metadata,brand_id")
          .eq("slug", "onepage-system")
          .eq("status", "active");
        if (te) return Response.json({ error: te.message }, { status: 500 });
        targets = nodes || [];
      }

      const now = new Date().toISOString();
      const block = "\n\n## ACCEPTED ADMIN FEEDBACK — " + now.slice(0, 10) + "\n" + feedback + "\n";

      for (const node of targets) {
        const current = String(node.content_md || "");
        if (!current.includes(feedback)) {
          const { error: ue } = await adminDb
            .from("knowledge_nodes")
            .update({ content_md: current + block, updated_at: now })
            .eq("id", node.id);
          if (ue) return Response.json({ error: ue.message }, { status: 500 });
        }

        const { error: ee } = await adminDb.from("training_events").insert({
          brand_id: node.brand_id || p.brand_id,
          knowledge_node_id: node.id,
          mode: "train",
          input_text: feedback,
          parsed_payload: {
            proposal_id: p.id,
            proposed_scope: p.proposed_scope,
            cross_brand_sync: structuralOnepage,
            context_images: p.context_images || [],
          },
          status: "accepted",
          actor_user_id: user.id,
          actor_role: "admin",
          source_action: structuralOnepage ? "admin_merge_cross_brand_sync" : "admin_merge",
        });
        if (ee) return Response.json({ error: ee.message }, { status: 500 });
      }

      const { data: merged, error: me } = await adminDb
        .from("knowledge_proposals")
        .update({ status: "merged", merged_at: now, updated_at: now })
        .eq("id", p.id)
        .eq("status", "accepted")
        .select("id,status,merged_at")
        .single();

      if (me) return Response.json({ error: me.message }, { status: 500 });

      return Response.json({
        proposal: merged,
        merged_nodes: targets.length,
        cross_brand_sync: structuralOnepage,
        legacy_merge: true,
      });
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
