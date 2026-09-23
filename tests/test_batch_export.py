import os
import unittest
import io
import zipfile
from fastapi.testclient import TestClient
from backend.app import app
from backend.model_service import OUTPUTS_DIR

class TestBatchExport(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        token = os.environ.get("AUTH_TOKEN")
        if token:
            self.client.headers["Authorization"] = f"Bearer {token}"
        # Create a temporary dummy file in OUTPUTS_DIR for export testing
        self.test_filename = "test_export_dummy.png"
        self.test_filepath = OUTPUTS_DIR / self.test_filename
        self.test_filepath.write_bytes(b"PNG_FAKE_DATA_FOR_TESTING")

    def tearDown(self):
        if self.test_filepath.exists():
            self.test_filepath.unlink()

    def test_batch_export_success(self):
        response = self.client.post(
            "/api/batch-export",
            json={
                "items": [
                    {
                        "filename": self.test_filename,
                        "download_name": "renamed_output_01.png"
                    }
                ]
            }
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/zip")

        # Verify zip contents
        zip_buf = io.BytesIO(response.content)
        with zipfile.ZipFile(zip_buf, "r") as zf:
            namelist = zf.namelist()
            self.assertIn("renamed_output_01.png", namelist)
            data = zf.read("renamed_output_01.png")
            self.assertEqual(data, b"PNG_FAKE_DATA_FOR_TESTING")

    def test_batch_export_empty_list(self):
        response = self.client.post(
            "/api/batch-export",
            json={"items": []}
        )
        self.assertEqual(response.status_code, 400)

    def test_batch_export_file_not_found(self):
        response = self.client.post(
            "/api/batch-export",
            json={"items": [{"filename": "non_existent_file_12345.png"}]}
        )
        self.assertEqual(response.status_code, 404)

if __name__ == "__main__":
    unittest.main()
