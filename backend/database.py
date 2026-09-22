import sqlite3
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger("qwen_image_db")

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "history.db"

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """初始化 SQLite 数据库表结构"""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS generations (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                url TEXT NOT NULL,
                prompt TEXT NOT NULL,
                negative_prompt TEXT DEFAULT '',
                has_input_image INTEGER DEFAULT 0,
                input_image_url TEXT DEFAULT '',
                seed INTEGER DEFAULT -1,
                steps INTEGER DEFAULT 28,
                width INTEGER DEFAULT 1024,
                height INTEGER DEFAULT 1024,
                elapsed REAL DEFAULT 0.0,
                created_at TEXT NOT NULL
            );
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_generations_created ON generations (created_at DESC);
        """)
        conn.commit()

        # 检查初始 demo 示例图
        cursor.execute("SELECT COUNT(*) FROM generations")
        count = cursor.fetchone()[0]
        if count == 0:
            demo_img = BASE_DIR / "outputs" / "demo_honoka_chibi.png"
            if not demo_img.exists():
                raw_demo = BASE_DIR / "honoka_transparent.png"
                if raw_demo.exists():
                    try:
                        import shutil
                        demo_img.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copyfile(raw_demo, demo_img)
                    except Exception as e:
                        logger.warning(f"复制 demo 图片失败: {e}")
            
            if demo_img.exists():
                cursor.execute("""
                    INSERT OR IGNORE INTO generations (
                        id, filename, url, prompt, negative_prompt,
                        has_input_image, input_image_url, seed, steps,
                        width, height, elapsed, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    "demo_honoka_chibi",
                    "demo_honoka_chibi.png",
                    "/outputs/demo_honoka_chibi.png",
                    "1girl, Kousaka Honoka, school uniform, chibi, transparent background, highly detailed",
                    "",
                    0,
                    "",
                    42,
                    28,
                    1024,
                    1024,
                    12.5,
                    "2026-09-21 16:53:50"
                ))
                conn.commit()
                logger.info("已初始化并植入包含有效提示词的示例生成记录")

def insert_generation(data: Dict[str, Any]):
    """将一条完整的图像生成记录存入 SQLite（支持单图或多图参考）"""
    import json
    input_img_urls = data.get("input_image_urls")
    if input_img_urls and isinstance(input_img_urls, list):
        stored_img_url = json.dumps(input_img_urls)
    else:
        stored_img_url = data.get("input_image_url", "") or ""

    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO generations (
                id, filename, url, prompt, negative_prompt,
                has_input_image, input_image_url, seed, steps,
                width, height, elapsed, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("id"),
            data.get("filename"),
            data.get("url"),
            data.get("prompt"),
            data.get("negative_prompt", ""),
            1 if data.get("has_input_image") else 0,
            stored_img_url,
            data.get("seed", -1),
            data.get("steps", 28),
            data.get("width", 1024),
            data.get("height", 1024),
            data.get("elapsed", 0.0),
            data.get("created_at"),
        ))
        conn.commit()
        logger.info(f"已将生成记录持久化至 SQLite: id={data.get('id')}, prompt='{data.get('prompt')[:30]}...'")

def get_history(limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """从数据库中按生成时间倒序获取历史记录（纯净数据，只返回包含有效 prompt 的记录）"""
    import json
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                id, filename, url, prompt, negative_prompt,
                has_input_image, input_image_url, seed, steps,
                width, height, elapsed, created_at
            FROM generations
            WHERE prompt IS NOT NULL AND TRIM(prompt) != ''
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = cursor.fetchall()
        result = []
        for r in rows:
            raw_input_url = r["input_image_url"] or ""
            parsed_urls = []
            if raw_input_url.startswith("["):
                try:
                    parsed_urls = json.loads(raw_input_url)
                except Exception:
                    parsed_urls = [raw_input_url] if raw_input_url else []
            elif raw_input_url:
                parsed_urls = [raw_input_url]

            result.append({
                "id": r["id"],
                "filename": r["filename"],
                "url": r["url"],
                "prompt": r["prompt"],
                "negative_prompt": r["negative_prompt"],
                "has_input_image": bool(r["has_input_image"]),
                "input_image_url": parsed_urls[0] if parsed_urls else "",
                "input_image_urls": parsed_urls,
                "seed": r["seed"],
                "steps": r["steps"],
                "width": r["width"],
                "height": r["height"],
                "elapsed": r["elapsed"],
                "created_at": r["created_at"],
            })
        return result

def delete_generation(gen_id: str) -> bool:
    """根据 ID 删除一条历史记录，并安全清理关联的输出图片与临时参考图"""
    import json
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename, input_image_url FROM generations WHERE id = ?", (gen_id,))
        row = cursor.fetchone()
        if not row:
            return False

        filename = row["filename"]
        raw_input_url = row["input_image_url"] or ""

        cursor.execute("DELETE FROM generations WHERE id = ?", (gen_id,))
        conn.commit()

        # 清理输出文件（保护 demo 示例图不被误删）
        if filename and filename != "demo_honoka_chibi.png":
            out_file = BASE_DIR / "outputs" / filename
            try:
                if out_file.exists():
                    out_file.unlink()
            except Exception as e:
                logger.warning(f"删除输出图片 {filename} 失败: {e}")

        # 清理关联的任务参考图
        ref_urls = []
        if raw_input_url.startswith("["):
            try:
                ref_urls = json.loads(raw_input_url)
            except Exception:
                ref_urls = [raw_input_url]
        elif raw_input_url:
            ref_urls = [raw_input_url]

        for ref_url in ref_urls:
            if ref_url.startswith("/outputs/ref_"):
                ref_filename = ref_url.replace("/outputs/", "")
                ref_file = BASE_DIR / "outputs" / ref_filename
                try:
                    if ref_file.exists():
                        ref_file.unlink()
                except Exception as e:
                    logger.warning(f"删除参考图 {ref_filename} 失败: {e}")

        return True

def clear_all_generations() -> int:
    """清空所有历史生成记录并清理 outputs 目录中除 demo 外的生成图片"""
    import json
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT filename, input_image_url FROM generations")
        rows = cursor.fetchall()
        count = len(rows)

        cursor.execute("DELETE FROM generations")
        conn.commit()

        for r in rows:
            filename = r["filename"]
            raw_input_url = r["input_image_url"] or ""

            if filename and filename != "demo_honoka_chibi.png":
                out_file = BASE_DIR / "outputs" / filename
                try:
                    if out_file.exists():
                        out_file.unlink()
                except Exception:
                    pass

            ref_urls = []
            if raw_input_url.startswith("["):
                try:
                    ref_urls = json.loads(raw_input_url)
                except Exception:
                    ref_urls = [raw_input_url]
            elif raw_input_url:
                ref_urls = [raw_input_url]

            for ref_url in ref_urls:
                if ref_url.startswith("/outputs/ref_"):
                    ref_filename = ref_url.replace("/outputs/", "")
                    ref_file = BASE_DIR / "outputs" / ref_filename
                    try:
                        if ref_file.exists():
                            ref_file.unlink()
                    except Exception:
                        pass

        return count
