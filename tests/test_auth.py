import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import app
from backend.auth import (
    load_dotenv,
    get_auth_token,
    is_auth_required,
    verify_token,
)
from backend.model_service import OUTPUTS_DIR

class TestAuth(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.test_token = "test-secret-token-12345"

    def test_verify_token_logic(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": "secret-key-abc"}):
            self.assertTrue(is_auth_required())
            self.assertTrue(verify_token("secret-key-abc"))
            self.assertFalse(verify_token("wrong-key"))
            self.assertFalse(verify_token(None))
            self.assertFalse(verify_token(""))

        with patch.dict(os.environ, {"AUTH_TOKEN": ""}):
            self.assertFalse(is_auth_required())
            self.assertTrue(verify_token("any-token"))
            self.assertTrue(verify_token(None))

    def test_auth_config_endpoint(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": self.test_token}):
            # 未提供 token
            res = self.client.get("/api/auth/config")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertTrue(data["auth_required"])
            self.assertFalse(data["authenticated"])

            # 提供有效 token
            res_auth = self.client.get(
                "/api/auth/config",
                headers={"Authorization": f"Bearer {self.test_token}"},
            )
            self.assertEqual(res_auth.status_code, 200)
            data_auth = res_auth.json()
            self.assertTrue(data_auth["auth_required"])
            self.assertTrue(data_auth["authenticated"])

    def test_auth_verify_and_logout_endpoints(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": self.test_token}):
            # 1. 错误 token -> 401
            res_fail = self.client.post("/api/auth/verify", json={"token": "wrong-token"})
            self.assertEqual(res_fail.status_code, 401)

            # 2. 正确 token -> 200 并设置 Cookie
            res_ok = self.client.post("/api/auth/verify", json={"token": self.test_token})
            self.assertEqual(res_ok.status_code, 200)
            self.assertIn("auth_token", res_ok.cookies)
            self.assertEqual(res_ok.cookies["auth_token"], self.test_token)

            # 3. 退出登录 -> 清除 Cookie
            res_logout = self.client.post("/api/auth/logout")
            self.assertEqual(res_logout.status_code, 200)

    def test_protected_endpoints_rejection_without_token(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": self.test_token}):
            # API 接口拦截
            res = self.client.get("/api/status")
            self.assertEqual(res.status_code, 401)
            self.assertIn("未授权", res.json()["detail"])

            # 静态输出资源拦截
            res_img = self.client.get("/outputs/some_non_existent.png")
            self.assertEqual(res_img.status_code, 401)

    def test_protected_endpoints_access_methods(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": self.test_token}):
            # 1. Authorization: Bearer <token>
            res_bearer = self.client.get(
                "/api/status",
                headers={"Authorization": f"Bearer {self.test_token}"},
            )
            self.assertEqual(res_bearer.status_code, 200)

            # 2. X-Token header
            res_xtoken = self.client.get(
                "/api/status",
                headers={"X-Token": self.test_token},
            )
            self.assertEqual(res_xtoken.status_code, 200)

            # 3. Query param ?token=...
            res_query = self.client.get(f"/api/status?token={self.test_token}")
            self.assertEqual(res_query.status_code, 200)

            # 4. Cookie auth_token=...
            res_cookie = self.client.get("/api/status", cookies={"auth_token": self.test_token})
            self.assertEqual(res_cookie.status_code, 200)

    def test_outputs_file_access_with_token(self):
        test_file = OUTPUTS_DIR / "auth_test_image.png"
        test_file.write_bytes(b"IMAGE_CONTENT")
        try:
            with patch.dict(os.environ, {"AUTH_TOKEN": self.test_token}):
                # 无 token -> 401
                res_unauth = self.client.get(f"/outputs/{test_file.name}")
                self.assertEqual(res_unauth.status_code, 401)

                # 有 Query param token -> 200
                res_auth_query = self.client.get(f"/outputs/{test_file.name}?token={self.test_token}")
                self.assertEqual(res_auth_query.status_code, 200)
                self.assertEqual(res_auth_query.content, b"IMAGE_CONTENT")

                # 有 Cookie token -> 200
                res_auth_cookie = self.client.get(
                    f"/outputs/{test_file.name}",
                    cookies={"auth_token": self.test_token},
                )
                self.assertEqual(res_auth_cookie.status_code, 200)
                self.assertEqual(res_auth_cookie.content, b"IMAGE_CONTENT")
        finally:
            if test_file.exists():
                test_file.unlink()

    def test_open_mode_when_auth_token_empty(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": ""}):
            # 未开启鉴权时直接放行
            res = self.client.get("/api/status")
            self.assertEqual(res.status_code, 200)

    def test_history_pagination_api(self):
        with patch.dict(os.environ, {"AUTH_TOKEN": ""}):
            res = self.client.get("/api/history?page=1&page_size=10")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertIn("history", data)
            self.assertIn("total", data)
            self.assertIn("page", data)
            self.assertIn("page_size", data)
            self.assertIn("total_pages", data)
            self.assertEqual(data["page"], 1)
            self.assertEqual(data["page_size"], 10)

if __name__ == "__main__":
    unittest.main()
