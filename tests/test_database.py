import unittest
from backend.database import init_db, insert_generation, get_history, delete_generation

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

if __name__ == "__main__":
    unittest.main()
