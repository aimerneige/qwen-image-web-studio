import asyncio
import os
import time
import uuid
import logging
from typing import Optional, Dict, Any, List, Callable
from pathlib import Path
import torch
from diffusers import DiffusionPipeline
from PIL import Image
from backend.database import init_db, insert_generation, get_history, delete_generation

logger = logging.getLogger("qwen_image_service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BASE_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

class ModelManager:
    def __init__(self):
        self.pipeline: Optional[DiffusionPipeline] = None
        self._lock = asyncio.Lock()  # 严格硬件互斥锁，确保单任务运行
        self._thread_lock = asyncio.Lock()
        self.is_busy: bool = False
        self._cancel_requested: bool = False
        self.current_task: Optional[Dict[str, Any]] = None
        self._subscribers: List[asyncio.Queue] = []
        init_db()  # 初始化 SQLite 表结构（若初次运行且有示例图，植入真实提示词 demo）

    @property
    def history(self) -> List[Dict[str, Any]]:
        """从 SQLite 数据库实时查询历史记录（无 prompt 的旧扫描图片直接跳过）"""
        return get_history(limit=50)

    def subscribe(self) -> asyncio.Queue:
        queue = asyncio.Queue()
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue):
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def _broadcast(self, event_type: str, data: Dict[str, Any]):
        message = {"event": event_type, "data": data}
        for q in list(self._subscribers):
            try:
                q.put_nowait(message)
            except Exception:
                pass

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_busy": self.is_busy,
            "is_model_loaded": self.pipeline is not None,
            "current_task": self.current_task,
            "history": self.history[:50],
        }

    def cancel_task(self) -> tuple[bool, str]:
        """请求取消当前正在执行的任务并释放资源"""
        if not self.is_busy:
            return False, "当前无正在运行的生成任务"

        self._cancel_requested = True
        if self.pipeline is not None:
            self.pipeline._interrupt = True

        logger.info("已发起任务取消请求，正在中断去噪流程...")
        self._broadcast("progress", {
            "task_id": self.current_task.get("id") if self.current_task else "",
            "status": "cancelling",
            "message": "正在中断去噪并清理显存资源...",
            "step": self.current_task.get("step", 0) if self.current_task else 0,
            "total_steps": self.current_task.get("total_steps", 28) if self.current_task else 28,
            "percent": self.current_task.get("percent", 0) if self.current_task else 0,
        })
        return True, "已发送任务取消信号"

    def _load_pipeline_sync(self):
        """同步加载模型管线并配置极致层级卸载"""
        if self.pipeline is not None:
            return self.pipeline

        logger.info("正在安全加载管线元数据...")
        self._broadcast("progress", {
            "status": "loading_model",
            "message": "正在加载 Qwen-Image-2.1 模型与层级卸载配置...",
            "step": 0,
            "total_steps": 100,
            "percent": 5,
        })

        pipe = DiffusionPipeline.from_pretrained(
            "Qwen/Qwen-Image-2.1",
            torch_dtype=torch.bfloat16,
        )
        # 关键优化：启用层级卸载，彻底保护内存与显存
        pipe.enable_sequential_cpu_offload()
        self.pipeline = pipe
        logger.info("模型管线加载完成！")
        return self.pipeline

    def _generate_sync(
        self,
        task_id: str,
        prompt: str,
        negative_prompt: Optional[str],
        images_data: Optional[List[str]],
        steps: int,
        width: Optional[int],
        height: Optional[int],
        seed: Optional[int],
        loop: asyncio.AbstractEventLoop,
        batch_index: int = 1,
        batch_total: int = 1,
        preloaded_images: Optional[List[Image.Image]] = None,
        preloaded_urls: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """在独立工作线程中同步执行单张生成，并通过 event loop 回调广播进度"""
        start_time = time.time()
        msg_prefix = f"[{batch_index}/{batch_total}] " if batch_total > 1 else ""

        # 1. 检查或加载模型
        if self.pipeline is None:
            loop.call_soon_threadsafe(
                self._broadcast,
                "progress",
                {
                    "task_id": task_id,
                    "batch_index": batch_index,
                    "batch_total": batch_total,
                    "status": "loading_model",
                    "message": "首次使用：正在加载模型架构与权重（极致层级卸载保护显存）...",
                    "step": 0,
                    "total_steps": steps,
                    "percent": 3,
                    "elapsed": 0,
                }
            )
            self._load_pipeline_sync()

        # 2. 处理参考图片（图生图 / 多图引导）
        if preloaded_images is not None:
            input_pils = list(preloaded_images)
            input_image_urls = list(preloaded_urls or [])
        else:
            input_pils: List[Image.Image] = []
            input_image_urls: List[str] = []
            if images_data:
                import io
                import base64
                for idx, raw_item in enumerate(images_data):
                    if not raw_item or not raw_item.strip():
                        continue
                    try:
                        raw_b64 = raw_item.strip()
                        if "," in raw_b64:
                            raw_b64 = raw_b64.split(",", 1)[1]
                        image_bytes = base64.b64decode(raw_b64)
                        pil_img = Image.open(io.BytesIO(image_bytes))
                        if hasattr(pil_img, "mode") and pil_img.mode not in ("RGB", "RGBA"):
                            pil_img = pil_img.convert("RGB")

                        ref_filename = f"ref_{int(time.time())}_{task_id[:8]}_{idx + 1}.png"
                        ref_filepath = OUTPUTS_DIR / ref_filename
                        pil_img.save(ref_filepath)
                        input_pils.append(pil_img)
                        input_image_urls.append(f"/outputs/{ref_filename}")
                        logger.info(f"已载入参考图[{idx + 1}]: {ref_filename}, 尺寸={pil_img.size}")
                    except Exception as e:
                        logger.warning(f"解析第 {idx + 1} 张参考图片失败: {e}")

        num_imgs = len(input_pils)
        loop.call_soon_threadsafe(
            self._broadcast,
            "progress",
            {
                "task_id": task_id,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "status": "encoding_prompt",
                "message": f"{msg_prefix}" + (
                    f"正在编码提示词与多图特征 ({num_imgs}张参考图)..." if num_imgs > 1 else (
                        "正在编码提示词与参考图多模态特征..." if num_imgs == 1 else "正在编码文本提示词特征..."
                    )
                ),
                "step": 0,
                "total_steps": steps,
                "percent": 8,
                "elapsed": round(time.time() - start_time, 1),
            }
        )

        # 3. 随机种子设置
        generator = None
        if seed is not None and seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(seed)
        else:
            seed = int(torch.randint(0, 2**32 - 1, (1,)).item())
            generator = torch.Generator(device="cpu").manual_seed(seed)

        # 4. 步进进度回调
        def step_callback(pipe, step_index: int, timestep: Any, callback_kwargs: Dict[str, Any]):
            if self._cancel_requested:
                if self.pipeline is not None:
                    self.pipeline._interrupt = True
                raise RuntimeError("TaskCancelled: 任务已由用户手动取消")

            current_step = step_index + 1
            percent = 10 + int((current_step / steps) * 82)
            elapsed = round(time.time() - start_time, 1)
            eta = round((elapsed / current_step) * (steps - current_step), 1) if current_step > 0 else 0

            status_payload = {
                "task_id": task_id,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "status": "denoising",
                "message": f"{msg_prefix}正在去噪采样 (Step {current_step}/{steps})",
                "step": current_step,
                "total_steps": steps,
                "percent": percent,
                "elapsed": elapsed,
                "eta": eta,
            }
            if self.current_task and self.current_task.get("id") == task_id:
                self.current_task.update(status_payload)

            loop.call_soon_threadsafe(self._broadcast, "progress", status_payload)
            return callback_kwargs

        logger.info(f"开始生成任务 {task_id} ({batch_index}/{batch_total}): prompt='{prompt}', images_count={num_imgs}, steps={steps}, size={width}x{height}, seed={seed}")

        if self._cancel_requested:
            raise RuntimeError("TaskCancelled: 任务已由用户手动取消")

        call_kwargs: Dict[str, Any] = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "output_type": "pil",
            "callback_on_step_end": step_callback,
        }

        if input_pils:
            call_kwargs["image"] = input_pils

        if width and height and width > 0 and height > 0:
            call_kwargs["width"] = width
            call_kwargs["height"] = height

        if negative_prompt and negative_prompt.strip():
            call_kwargs["negative_prompt"] = negative_prompt.strip()
            call_kwargs["true_cfg_scale"] = 4.0  # Qwen-Image 开启负向提示词时启用 CFG

        if generator is not None:
            call_kwargs["generator"] = generator

        # 执行去噪采样
        pipeline_output = self.pipeline(**call_kwargs)

        if self._cancel_requested:
            raise RuntimeError("TaskCancelled: 任务已由用户手动取消")

        loop.call_soon_threadsafe(
            self._broadcast,
            "progress",
            {
                "task_id": task_id,
                "batch_index": batch_index,
                "batch_total": batch_total,
                "status": "saving",
                "message": f"{msg_prefix}正在解码保存最终图像...",
                "step": steps,
                "total_steps": steps,
                "percent": 96,
                "elapsed": round(time.time() - start_time, 1),
            }
        )

        image: Image.Image = pipeline_output.images[0]
        filename = f"qwen_{int(time.time())}_{task_id[:8]}.png"
        output_filepath = OUTPUTS_DIR / filename
        image.save(output_filepath)

        elapsed = round(time.time() - start_time, 1)
        logger.info(f"生成任务 {task_id} ({batch_index}/{batch_total}) 完成，耗时 {elapsed}s，保存至 {output_filepath}")

        result_data = {
            "id": task_id,
            "filename": filename,
            "url": f"/outputs/{filename}",
            "prompt": prompt,
            "negative_prompt": negative_prompt or "",
            "has_input_image": num_imgs > 0,
            "input_image_url": input_image_urls[0] if input_image_urls else "",
            "input_image_urls": input_image_urls,
            "seed": seed,
            "steps": steps,
            "width": image.width,
            "height": image.height,
            "elapsed": elapsed,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "batch_index": batch_index,
            "batch_total": batch_total,
        }
        return result_data

    async def generate_task(
        self,
        prompt: str,
        negative_prompt: Optional[str] = None,
        images_data: Optional[List[str]] = None,
        image_data: Optional[str] = None,
        steps: int = 28,
        width: Optional[int] = 1024,
        height: Optional[int] = 1024,
        seed: Optional[int] = None,
        count: int = 1,
    ) -> List[Dict[str, Any]]:
        """异步任务分发入口：严格利用 async 互斥锁保障单任务独占，按指定数量顺序执行生成"""
        if self._lock.locked():
            raise RuntimeError("当前已有任务正在执行中。由于模型占用极高硬件资源，系统已加锁限制单任务独占。")

        # 整合多图与单图参数
        all_images = list(images_data) if images_data else []
        if image_data and image_data not in all_images:
            all_images.insert(0, image_data)

        total_count = max(1, count)

        async with self._lock:
            self.is_busy = True
            self._cancel_requested = False
            batch_id = str(uuid.uuid4())
            self.current_task = {
                "id": batch_id,
                "prompt": prompt,
                "has_image": len(all_images) > 0,
                "images_count": len(all_images),
                "batch_index": 1,
                "batch_total": total_count,
                "status": "queued",
                "message": f"任务已接收，准备顺序生成 {total_count} 张图片..." if total_count > 1 else "任务已接收，等待调度执行...",
                "step": 0,
                "total_steps": steps,
                "percent": 0,
                "elapsed": 0,
                "eta": 0,
            }
            self._broadcast("start", self.current_task)

            # 预处理并复用参考图，避免批次重复写入磁盘
            preloaded_pils = []
            preloaded_urls = []
            if all_images:
                import io
                import base64
                for idx, raw_item in enumerate(all_images):
                    if not raw_item or not raw_item.strip():
                        continue
                    try:
                        raw_b64 = raw_item.strip()
                        if "," in raw_b64:
                            raw_b64 = raw_b64.split(",", 1)[1]
                        image_bytes = base64.b64decode(raw_b64)
                        pil_img = Image.open(io.BytesIO(image_bytes))
                        if hasattr(pil_img, "mode") and pil_img.mode not in ("RGB", "RGBA"):
                            pil_img = pil_img.convert("RGB")

                        ref_filename = f"ref_{int(time.time())}_{batch_id[:8]}_{idx + 1}.png"
                        ref_filepath = OUTPUTS_DIR / ref_filename
                        pil_img.save(ref_filepath)
                        preloaded_pils.append(pil_img)
                        preloaded_urls.append(f"/outputs/{ref_filename}")
                        logger.info(f"批次预加载参考图[{idx + 1}]: {ref_filename}")
                    except Exception as e:
                        logger.warning(f"预解析第 {idx + 1} 张参考图片失败: {e}")

            loop = asyncio.get_running_loop()
            completed_results = []
            base_seed = seed if (seed is not None and seed >= 0) else None

            try:
                for idx in range(total_count):
                    if self._cancel_requested:
                        logger.info(f"批次生成在第 {idx + 1}/{total_count} 张前已被用户提前终止")
                        break

                    task_id = str(uuid.uuid4())
                    current_seed = (base_seed + idx) if base_seed is not None else None

                    self.current_task["id"] = task_id
                    self.current_task["batch_index"] = idx + 1
                    self.current_task["batch_total"] = total_count

                    # 放入工作线程池顺序执行 PyTorch 推理
                    result = await asyncio.to_thread(
                        self._generate_sync,
                        task_id=task_id,
                        prompt=prompt,
                        negative_prompt=negative_prompt,
                        images_data=None,
                        steps=steps,
                        width=width,
                        height=height,
                        seed=current_seed,
                        loop=loop,
                        batch_index=idx + 1,
                        batch_total=total_count,
                        preloaded_images=preloaded_pils,
                        preloaded_urls=preloaded_urls,
                    )

                    insert_generation(result)
                    completed_results.append(result)

                    is_batch_end = (idx + 1 == total_count) or self._cancel_requested
                    result_payload = dict(result)
                    result_payload["is_batch_end"] = is_batch_end
                    self._broadcast("complete", result_payload)

                    if self._cancel_requested:
                        logger.info(f"批次生成在第 {idx + 1}/{total_count} 张完成时收到提前终止信号")
                        break

                if self._cancel_requested:
                    self._broadcast("cancelled", {
                        "task_id": batch_id,
                        "status": "cancelled",
                        "message": f"任务已由用户提前终止 (已生成 {len(completed_results)}/{total_count} 张图片)",
                    })
                return completed_results
            except Exception as e:
                if "TaskCancelled" in str(e):
                    logger.info(f"批次任务被用户手动取消 (已完成 {len(completed_results)}/{total_count} 张)")
                    self._broadcast("cancelled", {
                        "task_id": batch_id,
                        "status": "cancelled",
                        "message": f"任务已由用户提前终止 (已生成 {len(completed_results)}/{total_count} 张图片)",
                    })
                    return completed_results
                logger.exception(f"任务执行出错: {e}")
                err_data = {
                    "task_id": batch_id,
                    "status": "error",
                    "message": f"生成失败: {str(e)}",
                }
                self._broadcast("error", err_data)
                raise
            finally:
                self._cancel_requested = False
                self.is_busy = False
                self.current_task = None
                if self.pipeline is not None:
                    self.pipeline._interrupt = False
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()


# 全局单例
model_manager = ModelManager()
