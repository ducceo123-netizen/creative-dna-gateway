#!/usr/bin/env python3
"""Offline evidence audit. No providers, ZIP extraction, or artistic scores."""
import argparse, hashlib, io, json, re, stat, sys, warnings, zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from PIL import Image

SHA = re.compile(r"^[a-f0-9]{64}$")
HUMAN_GATES = ("product_truth", "claim_support", "canonical_compliance", "typography", "campaign_continuity", "composition", "anatomy_handling", "scene_variety", "revision_preservation", "desktop_mobile_layout")
MAX_ZIP = 100 * 1024 * 1024
MAX_MEMBER = 32 * 1024 * 1024
MAX_TOTAL = 200 * 1024 * 1024

def sha(data):
    return hashlib.sha256(data).hexdigest()

def local_file(root, name):
    path = (root / name).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("path escapes evidence root")
    return path

def archive_inventory(data):
    if len(data) > MAX_ZIP:
        raise ValueError("archive exceeds audit byte cap")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if not 1 <= len(members) <= 100:
            raise ValueError("invalid member count")
        if len({m.filename for m in members}) != len(members):
            raise ValueError("duplicate archive path")
        if sum(m.file_size for m in members) > MAX_TOTAL:
            raise ValueError("archive expands beyond audit cap")
        inventory = []
        for member in members:
            path = PurePosixPath(member.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in member.filename or "\x00" in member.filename or member.is_dir() or stat.S_ISLNK(member.external_attr >> 16)):
                raise ValueError("unsafe or non-file archive entry")
            if member.flag_bits & 1 or member.file_size > MAX_MEMBER:
                raise ValueError("encrypted or oversized archive member")
            if member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise ValueError("unsupported ZIP compression")
            payload = archive.read(member)
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(payload)) as image:
                    image.load()
                    if image.format not in ("PNG", "WEBP") or getattr(image, "n_frames", 1) != 1:
                        raise ValueError("unsupported image format or animated member")
                    inventory.append({"path": member.filename, "sha256": sha(payload), "bytes": len(payload), "format": image.format, "width": image.width, "height": image.height})
        return inventory

def audit(case, root):
    failures, unverified = [], []
    checked = {}
    artifacts = case.get("artifacts", {})
    for key, artifact in artifacts.items():
        try:
            data = local_file(root, artifact["path"]).read_bytes()
            digest = sha(data)
            if not isinstance(artifact.get("sha256"), str) or not SHA.fullmatch(artifact["sha256"]) or digest != artifact["sha256"]:
                failures.append("artifact_hash:" + key)
            checked[key] = digest
        except (OSError, ValueError, KeyError) as error:
            failures.append("artifact_read:" + key + ":" + str(error))
    for key in ("reference_package", "candidate_package"):
        record = artifacts.get(key)
        if not record:
            unverified.append("missing:" + key)
            continue
        try:
            actual = archive_inventory(local_file(root, record["path"]).read_bytes())
            checked[key + "_inventory"] = actual
            expected = record.get("inventory")
            if not expected:
                unverified.append("missing_inventory:" + key)
            elif actual != expected:
                failures.append("inventory_mismatch:" + key)
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, RuntimeError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            failures.append("archive:" + key + ":" + str(error))
    approval = case.get("reference_approval", {})
    for field in ("message_url", "message_id", "exact_user_quote", "approved_revision", "approved_at", "checked_through"):
        if not approval.get(field):
            unverified.append("reference_approval:" + field)
    if checked.get("reference_package") != approval.get("package_sha256"):
        unverified.append("approval_not_bound_to_reference_bytes")
    try:
        parse = lambda s: datetime.fromisoformat(s.replace("Z", "+00:00"))
        if parse(approval["approved_at"]) < parse(approval.get("last_correction_at", approval["approved_at"])):
            failures.append("approval_precedes_correction")
        if parse(approval["checked_through"]) < parse(approval["approved_at"]):
            failures.append("history_check_predates_approval")
    except (KeyError, ValueError, TypeError):
        unverified.append("approval_time_provenance")
    if approval.get("later_corrections") != "none_found_in_checked_scope":
        unverified.append("later_corrections")
    for run in ("reference", "candidate"):
        pins = case.get(run + "_pins", {})
        for field in ("canonical_sha256", "template_sha256", "source_manifest_sha256", "model_id", "model_version", "provider"):
            value = pins.get(field)
            if not value or (field.endswith("_sha256") and not SHA.fullmatch(value)):
                unverified.append(run + "_pin:" + field)
        for field in ("canonical", "template", "source_manifest"):
            artifact_key = run + "_" + field
            if checked.get(artifact_key) != pins.get(field + "_sha256") or artifact_key not in checked:
                unverified.append(run + "_pin_bytes:" + field)
    sources = case.get("sources", [])
    if not sources:
        unverified.append("source_captures")
    for source in sources:
        if (not source.get("url") or not source.get("captured_at") or not source.get("scope") or checked.get(source.get("artifact_id")) != source.get("sha256") or source.get("artifact_id") not in checked):
            unverified.append("unbound_source_capture")
        if source.get("kind") == "product_image" and source.get("pixel_review") != "observed":
            unverified.append("unviewed_product_pixels")
    review = case.get("visual_review", {})
    if not review.get("reviewer") or not review.get("producer") or review.get("reviewer") == review.get("producer"):
        unverified.append("independent_visual_reviewer")
    if not checked.get("candidate_package") or review.get("candidate_sha256") != checked.get("candidate_package"):
        unverified.append("visual_review_not_bound_to_candidate")
    screenshots = review.get("screenshots", {})
    for viewport in ("desktop", "mobile", "798", "799"):
        if screenshots.get(viewport) not in checked:
            unverified.append("screenshot:" + viewport)
    for gate in HUMAN_GATES:
        entry = review.get("gates", {}).get(gate, {})
        if entry.get("result") == "FAIL":
            failures.append("human_gate:" + gate)
        elif entry.get("result") != "PASS" or not entry.get("notes") or entry.get("evidence_artifact") not in checked:
            unverified.append("human_gate:" + gate)
    for unchanged in case.get("unchanged_assets", []):
        if checked.get(unchanged.get("before")) != checked.get(unchanged.get("after")) or unchanged.get("before") not in checked or unchanged.get("after") not in checked:
            failures.append("revision_changed_unselected_asset")
    if case.get("case_kind") == "revision_only" and not case.get("unchanged_assets"):
        unverified.append("revision_preservation_bytes")
    acceptance = case.get("candidate_acceptance", {})
    if not acceptance.get("exact_user_quote") or not acceptance.get("message_url") or not checked.get("candidate_package") or acceptance.get("package_sha256") != checked.get("candidate_package"):
        unverified.append("candidate_user_acceptance")
    status = "FAIL" if failures else "INCOMPLETE" if unverified else "EVIDENCE_COMPLETE_REQUIRES_REVIEW"
    return {"schema_version": 1, "case_id": case.get("case_id"), "status": status, "failures": sorted(set(failures)), "unverified": sorted(set(unverified)), "verified_byte_records": checked, "eo_parity_certified": False, "note": "Byte checks are computed. Reviewer statements and approval provenance must be independently verified; no automatic EO score."}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("case", type=Path)
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    result = audit(json.loads(args.case.read_text()), args.root)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if result["status"] == "FAIL" else 2 if result["status"] == "INCOMPLETE" else 0

if __name__ == "__main__":
    sys.exit(main())
