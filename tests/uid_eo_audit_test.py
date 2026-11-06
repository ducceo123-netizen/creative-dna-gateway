import io, unittest, warnings, zipfile
from pathlib import Path
from PIL import Image
from uid_eo_audit import archive_inventory, audit, sha

def raster(fmt="WEBP", size=(16, 12)):
    buffer = io.BytesIO()
    Image.new("RGB", size, "#147abc").save(buffer, fmt)
    return buffer.getvalue()

def zip_bytes(entries):
    buffer = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(buffer, "w") as archive:
            for name, data in entries:
                archive.writestr(name, data)
    return buffer.getvalue()

class AuditTests(unittest.TestCase):
    def test_real_hash_and_decode(self):
        data = raster()
        result = archive_inventory(zip_bytes([("Onepage - Test/banner.webp", data)]))
        self.assertEqual(result[0]["sha256"], sha(data))
        self.assertEqual((result[0]["width"], result[0]["height"], result[0]["format"]), (16, 12, "WEBP"))
    def test_duplicate_path(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            archive_inventory(zip_bytes([("banner.webp", raster())] * 2))
    def test_traversal_and_absolute(self):
        for name in ("../banner.webp", "/banner.webp", "a/../../banner.webp", "a\\banner.webp"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                archive_inventory(zip_bytes([(name, raster())]))
    def test_non_image(self):
        with self.assertRaises(OSError):
            archive_inventory(zip_bytes([("banner.webp", b"not an image")]))
    def test_false_extension_records_actual_format(self):
        result = archive_inventory(zip_bytes([("banner.webp", raster("PNG"))]))
        self.assertEqual(result[0]["format"], "PNG")
    def test_empty_zip(self):
        with self.assertRaises(ValueError):
            archive_inventory(zip_bytes([]))
    def test_crc_tamper(self):
        data = bytearray(zip_bytes([("banner.webp", raster())]))
        data[30 + len("banner.webp") + 12] ^= 1
        with self.assertRaises(zipfile.BadZipFile):
            archive_inventory(bytes(data))
    def test_directories_disallowed(self):
        with self.assertRaises(ValueError):
            archive_inventory(zip_bytes([("folder/", b"")]))
    def test_no_evidence_never_passes(self):
        result = audit({"case_id": "empty"}, Path("/unused"))
        self.assertEqual(result["status"], "INCOMPLETE")
        self.assertFalse(result["eo_parity_certified"])
    def test_correction_after_approval_fails(self):
        result = audit({"reference_approval":{"approved_at":"2026-10-15T00:00:00Z", "last_correction_at":"2026-10-16T00:00:00Z", "checked_through":"2026-11-06T00:00:00Z"}}, Path("/unused"))
        self.assertIn("approval_precedes_correction", result["failures"])
    def test_stale_history_fails(self):
        result = audit({"reference_approval":{"approved_at":"2026-10-15T00:00:00Z", "checked_through":"2026-10-14T00:00:00Z"}}, Path("/unused"))
        self.assertIn("history_check_predates_approval", result["failures"])
    def test_failed_visual_gate_cannot_average_away(self):
        result = audit({"visual_review":{"gates":{"product_truth":{"result":"FAIL"}}}}, Path("/unused"))
        self.assertEqual(result["status"], "FAIL")
        self.assertIn("human_gate:product_truth", result["failures"])
    def test_review_without_bytes_is_incomplete(self):
        result = audit({"visual_review":{"reviewer":"reviewer","producer":"producer", "candidate_sha256":"a"*64,"gates":{}}}, Path("/unused"))
        self.assertIn("visual_review_not_bound_to_candidate", result["unverified"])
    def test_path_escape_fails(self):
        result = audit({"artifacts":{"private":{"path":"../../etc/passwd","sha256":"a"*64}}}, Path("/unused"))
        self.assertTrue(any(item.startswith("artifact_read:private") for item in result["failures"]))
    def test_revision_requires_actual_preserved_bytes(self):
        result = audit({"case_kind":"revision_only"}, Path("/unused"))
        self.assertIn("revision_preservation_bytes", result["unverified"])

if __name__ == "__main__":
    unittest.main()
