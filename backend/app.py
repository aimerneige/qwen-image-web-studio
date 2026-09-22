import asyncio
import json
import logging
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.model_service import model_manager, OUTPUTS_DIR, BASE_DIR

logger = logging.getLogger("qwen_image_api")

app = FastAPI(
    title="Qwen-Image 2.1 Studio",
    description="Material Design 3 Web UI for Qwen-Image 2.1 with Hardware Lock and Sequential Offload",
    version="1.0.0",
)

# CORS 支持前端开发调试
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class GenerateRequest(BaseModel):
    prompt: str = Field(..., description="正向提示词", min_length=1)
    negative_prompt: Optional[str] = Field(default="", description="负向提示词")
    image: Optional[str] = Field(default=None, description="Base64 编码的输入图像（支持图生图/参考图引导，兼容单图）")
    images: Optional[List[str]] = Field(default=None, description="Base64 编码的多张输入参考图像列表")
    steps: int = Field(default=28, ge=1, le=100, description="推理步数")
    width: Optional[int] = Field(default=1024, ge=0, le=2048, description="图像宽度（0表示根据参考图自适应）")
    height: Optional[int] = Field(default=1024, ge=0, le=2048, description="图像高度（0表示根据参考图自适应）")
    seed: Optional[int] = Field(default=None, description="随机种子，留空或负数表示随机")
    count: int = Field(default=1, ge=1, le=20, description="生成图像数量（顺序生成，支持提前终止）")

@app.get("/api/status")
async def get_status():
    """获取当前状态、当前任务与历史记录"""
    return model_manager.get_status()

@app.post("/api/generate")
async def trigger_generate(req: GenerateRequest):
    """提交生成任务。加锁保护，同一时间仅允许一个任务执行"""
    if model_manager.is_busy:
        raise HTTPException(
            status_code=409,
            detail="当前已有图像生成任务在运行中。由于模型极高硬件负载，系统锁定单任务独占，请稍候再试。",
        )

    # 启动后台异步任务
    asyncio.create_task(
        model_manager.generate_task(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            images_data=req.images,
            image_data=req.image,
            steps=req.steps,
            width=req.width,
            height=req.height,
            seed=req.seed,
            count=req.count,
        )
    )

    return {
        "success": True,
        "message": "生成任务已启动",
    }

@app.post("/api/cancel")
async def cancel_task():
    """取消当前正在运行的图像生成任务并释放 GPU 硬件锁"""
    success, message = model_manager.cancel_task()
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {
        "success": True,
        "message": message,
    }

@app.get("/api/stream")
async def event_stream(request: Request):
    """Server-Sent Events (SSE) 实时推送生成进度与状态"""
    queue = model_manager.subscribe()

    async def event_generator():
        try:
            # 初始推送一次当前状态
            initial_status = model_manager.get_status()
            yield f"event: status\ndata: {json.dumps(initial_status, ensure_ascii=False)}\n\n"

            while True:
                # 检查客户端是否断开
                if await request.is_disconnected():
                    break

                try:
                    # 等待新消息，设置超时保活心跳 (Keep-Alive)
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    event_type = msg.get("event", "message")
                    event_data = json.dumps(msg.get("data", {}), ensure_ascii=False)
                    yield f"event: {event_type}\ndata: {event_data}\n\n"
                except asyncio.TimeoutError:
                    # 心跳包
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            model_manager.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@app.get("/api/history")
async def get_history():
    return {"history": model_manager.history}

@app.delete("/api/history/{item_id}")
async def delete_history_item(item_id: str):
    """从数据库中删除指定历史生成记录"""
    from backend.database import delete_generation
    success = delete_generation(item_id)
    if not success:
        raise HTTPException(status_code=404, detail="未找到该历史记录")
    return {"success": True, "message": "历史记录已删除"}

class BatchExportItem(BaseModel):
    filename: str
    download_name: Optional[str] = None

class BatchExportRequest(BaseModel):
    items: List[BatchExportItem]

@app.post("/api/batch-export")
async def batch_export_zip(req: BatchExportRequest):
    """打包下载批量生成的图片为 ZIP 压缩包"""
    import io
    import time
    import zipfile

    if not req.items:
        raise HTTPException(status_code=400, detail="导出列表不能为空")

    buf = io.BytesIO()
    valid_count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for item in req.items:
            # 严格提取纯文件名，防止目录遍历注入
            clean_name = Path(item.filename).name
            file_path = OUTPUTS_DIR / clean_name
            if file_path.exists() and file_path.is_file():
                arc_name = Path(item.download_name).name if item.download_name else clean_name
                zip_file.write(file_path, arcname=arc_name)
                valid_count += 1

    if valid_count == 0:
        raise HTTPException(status_code=404, detail="未找到任何可导出的图片文件")

    buf.seek(0)
    zip_filename = f"qwen_batch_{int(time.time())}.zip"
    return StreamingResponse(
        io.BytesIO(buf.getvalue()),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_filename}"',
            "Cache-Control": "no-cache",
        },
    )

# 挂载输出图像目录
app.mount("/outputs", StaticFiles(directory=str(OUTPUTS_DIR)), name="outputs")

# 挂载前端构建产物
DIST_DIR = BASE_DIR / "frontend" / "dist"
if DIST_DIR.exists() and (DIST_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(DIST_DIR), html=True), name="frontend")
else:
    @app.get("/")
    async def index_fallback():
        return Response(
            content="""
            <html>
                <head><title>Qwen-Image Studio</title></head>
                <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                    <h2>Qwen-Image Studio 后端服务已启动</h2>
                    <p>前端静态文件尚未构建，请进入 <code>frontend</code> 目录执行 <code>npm run build</code> 构建 dist 产物。</p>
                </body>
            </html>
            """,
            media_type="text/html",
        )
