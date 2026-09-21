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
        self.current_task: Optional[Dict[str, Any]] = None
        self.history: List[Dict[str, Any]] = []
        self._subscribers: List[asyncio.Queue] = []
        self._load_existing_outputs()

    def _load_existing_outputs(self):
        """扫描 outputs 目录，加载历史生成记录"""
        # 如果根目录下有已生成的示例图片 honoka_transparent.png，也可以拷一份或者链接过来
        initial_file = BASE_DIR / "honoka_transparent.png"
        if initial_file.exists():
            target_demo = OUTPUTS_DIR / "demo_honoka_chibi.png"
            if not target_demo.exists():
                try:
                    import shutil
                    shutil.copyfile(initial_file, target_demo)
                except Exception as e:
                    logger.warning(f"Failed to copy demo image: {e}")

        for p in sorted(OUTPUTS_DIR.glob("*.png"), key=os.path.getmtime, reverse=True):
            if p.is_file():
                self.history.append({
                    "id": p.stem,
                    "filename": p.name,
                    "url": f"/outputs/{p.name}",
                    "prompt": "历史生成图片" if not p.name.startswith("demo") else "1girl, Kousaka Honoka, school uniform, chibi, transparent background, highly detailed",
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(os.path.getmtime(p))),
                    "steps": 28,
                    "width": 1024,
                    "height": 1024,
                })

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
        steps: int,
        width: int,
        height: int,
        seed: Optional[int],
        loop: asyncio.AbstractEventLoop,
    ) -> Dict[str, Any]:
        """在独立工作线程中同步执行生成，并通过 event loop 回调广播进度"""
        start_time = time.time()
        
        # 1. 检查或加载模型
        if self.pipeline is None:
            loop.call_soon_threadsafe(
                self._broadcast,
                "progress",
                {
                    "task_id": task_id,
                    "status": "loading_model",
                    "message": "首次使用：正在加载模型架构与权重（极致层级卸载保护显存）...",
                    "step": 0,
                    "total_steps": steps,
                    "percent": 3,
                    "elapsed": 0,
                }
            )
            self._load_pipeline_sync()

        loop.call_soon_threadsafe(
            self._broadcast,
            "progress",
            {
                "task_id": task_id,
                "status": "encoding_prompt",
                "message": "正在编码提示词与文本特征 (Text Encoder)...",
                "step": 0,
                "total_steps": steps,
                "percent": 8,
                "elapsed": round(time.time() - start_time, 1),
            }
        )

        # 2. 随机种子设置
        generator = None
        if seed is not None and seed >= 0:
            generator = torch.Generator(device="cpu").manual_seed(seed)
        else:
            seed = int(torch.randint(0, 2**32 - 1, (1,)).item())
            generator = torch.Generator(device="cpu").manual_seed(seed)

        # 3. 步进进度回调
        def step_callback(pipe, step_index: int, timestep: Any, callback_kwargs: Dict[str, Any]):
            current_step = step_index + 1
            percent = 10 + int((current_step / steps) * 82)
            elapsed = round(time.time() - start_time, 1)
            eta = round((elapsed / current_step) * (steps - current_step), 1) if current_step > 0 else 0

            status_payload = {
                "task_id": task_id,
                "status": "denoising",
                "message": f"正在去噪采样 (Step {current_step}/{steps})",
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

        logger.info(f"开始生成任务 {task_id}: prompt='{prompt}', steps={steps}, size={width}x{height}, seed={seed}")

        call_kwargs: Dict[str, Any] = {
            "prompt": prompt,
            "num_inference_steps": steps,
            "output_type": "pil",
            "callback_on_step_end": step_callback,
        }

        if width and height:
            call_kwargs["width"] = width
            call_kwargs["height"] = height

        if negative_prompt and negative_prompt.strip():
            call_kwargs["negative_prompt"] = negative_prompt.strip()
            call_kwargs["true_cfg_scale"] = 4.0  # Qwen-Image 开启负向提示词时启用 CFG

        if generator is not None:
            call_kwargs["generator"] = generator

        # 执行去噪采样
        pipeline_output = self.pipeline(**call_kwargs)

        loop.call_soon_threadsafe(
            self._broadcast,
            "progress",
            {
                "task_id": task_id,
                "status": "saving",
                "message": "正在解码保存最终高分辨率图像...",
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
        logger.info(f"生成任务 {task_id} 完成，耗时 {elapsed}s，保存至 {output_filepath}")

        result_data = {
            "id": task_id,
            "filename": filename,
            "url": f"/outputs/{filename}",
            "prompt": prompt,
            "negative_prompt": negative_prompt or "",
            "seed": seed,
            "steps": steps,
            "width": width,
            "height": height,
            "elapsed": elapsed,
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        return result_data

    async def generate_task(
        self,
        prompt: str,
        negative_prompt: Optional[str] = None,
        steps: int = 28,
        width: int = 1024,
        height: int = 1024,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:
        """异步任务分发入口：严格利用 async 互斥锁保障单任务独占"""
        if self._lock.locked():
            raise RuntimeError("当前已有任务正在执行中。由于模型占用极高硬件资源，系统已加锁限制单任务独占。")

        async with self._lock:
            self.is_busy = True
            task_id = str(uuid.uuid4())
            self.current_task = {
                "id": task_id,
                "prompt": prompt,
                "status": "queued",
                "message": "任务已接收，等待调度执行...",
                "step": 0,
                "total_steps": steps,
                "percent": 0,
                "elapsed": 0,
                "eta": 0,
            }
            self._broadcast("start", self.current_task)

            loop = asyncio.get_running_loop()
            try:
                # 放入工作线程池执行阻塞型 PyTorch 推理
                result = await asyncio.to_thread(
                    self._generate_sync,
                    task_id=task_id,
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    steps=steps,
                    width=width,
                    height=height,
                    seed=seed,
                    loop=loop,
                )
                self.history.insert(0, result)
                self._broadcast("complete", result)
                return result
            except Exception as e:
                logger.exception(f"任务 {task_id} 执行出错: {e}")
                err_data = {
                    "task_id": task_id,
                    "status": "error",
                    "message": f"生成失败: {str(e)}",
                }
                self._broadcast("error", err_data)
                raise
            finally:
                self.is_busy = False
                self.current_task = None


# 全局单例
model_manager = ModelManager()
