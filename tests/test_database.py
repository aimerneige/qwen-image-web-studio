import unittest
from backend.database import init_db, insert_generation, get_history, delete_generation, get_history_count

class TestDatabase(unittest.TestCase):
    def setUp(self):
        init_db()

    def test_insert_and_get_history(self):
        test_item = {
            "id": "test_gen_001",
            "filename": "test_output.png",
            "url": "/outputs/test_output.png",
            "prompt": "a test cute cat in a teacup",
            "negative_prompt": "blurry",
            "has_input_image": True,
            "input_image_url": "/outputs/ref_test.png",
            "seed": 12345,
            "steps": 20,
            "width": 1024,
            "height": 1024,
            "elapsed": 8.5,
            "created_at": "2099-09-22 13:00:00",
        }
        insert_generation(test_item)
        history = get_history(limit=100)
        found = next((item for item in history if item["id"] == "test_gen_001"), None)
        self.assertIsNotNone(found)
        self.assertEqual(found["prompt"], "a test cute cat in a teacup")
        self.assertEqual(found["elapsed"], 8.5)
        self.assertTrue(found["has_input_image"])
        self.assertEqual(found["input_image_url"], "/outputs/ref_test.png")

        # Cleanup test item
        deleted = delete_generation("test_gen_001")
        self.assertTrue(deleted)

    def test_insert_and_get_multi_images(self):
        test_item = {
            "id": "test_gen_multi_001",
            "filename": "test_multi_output.png",
            "url": "/outputs/test_multi_output.png",
            "prompt": "combine image 1 character with image 2 background",
            "negative_prompt": "ugly",
            "has_input_image": True,
            "input_image_url": "/outputs/ref_test_1.png",
            "input_image_urls": ["/outputs/ref_test_1.png", "/outputs/ref_test_2.png"],
            "seed": 99999,
            "steps": 28,
            "width": 1024,
            "height": 1024,
            "elapsed": 12.3,
            "created_at": "2099-09-22 13:05:00",
        }
        insert_generation(test_item)
        history = get_history(limit=100)
        found = next((item for item in history if item["id"] == "test_gen_multi_001"), None)
        self.assertIsNotNone(found)
        self.assertEqual(found["input_image_urls"], ["/outputs/ref_test_1.png", "/outputs/ref_test_2.png"])
        self.assertEqual(found["input_image_url"], "/outputs/ref_test_1.png")

        # Cleanup
        deleted = delete_generation("test_gen_multi_001")
        self.assertTrue(deleted)

    def test_load_image_item_and_ref_protection(self):
        import base64
        import io
        from PIL import Image
        from backend.model_service import load_image_item, OUTPUTS_DIR

        # 1. 构造一个微型 Base64 PNG 图片
        img = Image.new("RGB", (32, 32), color=(255, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")

        # 2. 测试通过 Base64 加载并保存
        pil_img, ref_url = load_image_item(f"data:image/png;base64,{b64_str}", "test_loader", 1)
        self.assertIsNotNone(pil_img)
        self.assertIsNotNone(ref_url)
        self.assertTrue(ref_url.startswith("/outputs/ref_"))

        # 3. 测试通过已有 /outputs/ 路径直接加载
        reloaded_img, reloaded_url = load_image_item(ref_url, "test_loader_reuse", 1)
        self.assertIsNotNone(reloaded_img)
        self.assertEqual(reloaded_url, ref_url)

        # 4. 测试两条记录共享同一参考图时，删除一条不会破坏另一条的参考图物理文件
        gen1 = {
            "id": "test_share_001",
            "filename": "test_share_001.png",
            "url": "/outputs/test_share_001.png",
            "prompt": "shared ref 1",
            "has_input_image": True,
            "input_image_urls": [ref_url],
            "created_at": "2099-09-22 14:00:00",
        }
        gen2 = {
            "id": "test_share_002",
            "filename": "test_share_002.png",
            "url": "/outputs/test_share_002.png",
            "prompt": "shared ref 2",
            "has_input_image": True,
            "input_image_urls": [ref_url],
            "created_at": "2099-09-22 14:01:00",
        }
        insert_generation(gen1)
        insert_generation(gen2)

        ref_file = OUTPUTS_DIR / ref_url.replace("/outputs/", "")
        self.assertTrue(ref_file.exists())

        # 删除 gen1，由于 gen2 依然引用该参考图，文件应保留
        delete_generation("test_share_001")
        self.assertTrue(ref_file.exists())

        # 删除 gen2，不再有任何记录引用该参考图，文件应被安全清理
        delete_generation("test_share_002")
        self.assertFalse(ref_file.exists())

    def test_get_history_count_and_pagination(self):
        initial_count = get_history_count()
        self.assertGreaterEqual(initial_count, 0)

        # 插入两条测试数据
        item1 = {
            "id": "test_page_001",
            "filename": "test_page_001.png",
            "url": "/outputs/test_page_001.png",
            "prompt": "page test prompt 1",
            "created_at": "2099-09-22 15:00:00",
        }
        item2 = {
            "id": "test_page_002",
            "filename": "test_page_002.png",
            "url": "/outputs/test_page_002.png",
            "prompt": "page test prompt 2",
            "created_at": "2099-09-22 15:01:00",
        }
        insert_generation(item1)
        insert_generation(item2)

        new_count = get_history_count()
        self.assertEqual(new_count, initial_count + 2)

        # 测试分页获取
        page1 = get_history(limit=1, offset=0)
        self.assertEqual(len(page1), 1)
        self.assertEqual(page1[0]["id"], "test_page_002")

        page2 = get_history(limit=1, offset=1)
        self.assertEqual(len(page2), 1)
        self.assertEqual(page2[0]["id"], "test_page_001")

        # 清理
        delete_generation("test_page_001")
        delete_generation("test_page_002")
        self.assertEqual(get_history_count(), initial_count)

if __name__ == "__main__":
    unittest.main()
