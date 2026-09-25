import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.model_service import model_manager, OUTPUTS_DIR, BASE_DIR
from backend.auth import (
    is_auth_required,
    is_authenticated,
    verify_token,
    extract_token_from_request,
    get_auth_token,
)

logger = logging.getLogger("qwen_image_api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # 优雅关闭：通知所有挂起的 SSE 长连接立即断开
    model_manager.broadcast_shutdown()

app = FastAPI(
    title="Qwen-Image 2.1 Studio",
    description="Material Design 3 Web UI for Qwen-Image 2.1 with Hardware Lock and Sequential Offload",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS 支持前端开发调试
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class AuthMiddleware:
    """纯 ASGI 鉴权中间件：避免 BaseHTTPMiddleware 与流式响应在关闭时产生 CancelledError 异常"""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        # 1. 服务端未配置 AUTH_TOKEN 时完全开放
        if not is_auth_required():
            return await self.app(scope, receive, send)

        # 2. 放行 CORS OPTIONS 预检请求
        if scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)

        path = scope.get("path", "")

        # 3. 放行公开鉴权路由
        if path in ("/api/auth/config", "/api/auth/verify", "/api/auth/logout"):
            return await self.app(scope, receive, send)

        # 4. 拦截受保护资源：所有 /api/* 以及 /outputs/*
        if path == "/api" or path.startswith("/api/") or path == "/outputs" or path.startswith("/outputs/"):
            request = Request(scope)
            if not is_authenticated(request):
                if path == "/api" or path.startswith("/api/"):
                    response = JSONResponse(
                        status_code=401,
                        content={"detail": "未授权：请提供有效的访问 Token"},
                    )
                else:
                    response = Response(
                        status_code=401,
                        content="Unauthorized: Valid token required",
                        media_type="text/plain",
                    )
                return await response(scope, receive, send)

        # 5. 前端静态文件及根路径放行，以便用户加载 UI 输入 Token
        return await self.app(scope, receive, send)

app.add_middleware(AuthMiddleware)

class VerifyTokenRequest(BaseModel):
    token: Optional[str] = Field(default=None, description="访问鉴权 Token")

@app.get("/api/auth/config")
async def get_auth_config(request: Request):
    """获取鉴权配置及当前请求的有效鉴权状态"""
    return {
        "auth_required": is_auth_required(),
        "authenticated": is_authenticated(request),
    }

@app.post("/api/auth/verify")
async def verify_auth_token(response: Response, request: Request, req: Optional[VerifyTokenRequest] = None):
    """验证用户填写的 Token，并在鉴权成功后写入安全 Session Cookie"""
    provided_token = None
    if req and req.token:
        provided_token = req.token
    elif request:
        provided_token = extract_token_from_request(request)

    if not verify_token(provided_token):
        raise HTTPException(status_code=401, detail="Token 错误或无效，请重新输入")

    if response:
        response.set_cookie(
            key="auth_token",
            value=provided_token or get_auth_token(),
            httponly=True,
            samesite="lax",
            path="/",
            max_age=30 * 24 * 3600,
        )
    return {
        "success": True,
        "message": "Token 验证成功",
    }

@app.post("/api/auth/logout")
async def auth_logout(response: Response):
    """清除鉴权 Cookie 并退出登录"""
    response.delete_cookie(key="auth_token", path="/")
    return {
        "success": True,
        "message": "已清除访问凭证",
    }

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
        last_ping = time.time()
        try:
            # 初始推送一次当前状态
            initial_status = model_manager.get_status()
            yield f"event: status\ndata: {json.dumps(initial_status, ensure_ascii=False)}\n\n"

            while not model_manager.is_shutting_down:
                # 检查客户端是否断开
                if await request.is_disconnected():
                    break

                try:
                    # 等待新消息，设置 1.0 秒超时以感知服务端关闭信号
                    msg = await asyncio.wait_for(queue.get(), timeout=1.0)
                    if msg.get("event") == "close" or model_manager.is_shutting_down:
                        break
                    event_type = msg.get("event", "message")
                    event_data = json.dumps(msg.get("data", {}), ensure_ascii=False)
                    yield f"event: {event_type}\ndata: {event_data}\n\n"
                except asyncio.TimeoutError:
                    if model_manager.is_shutting_down:
                        break
                    now = time.time()
                    if now - last_ping >= 15.0:
                        yield ": ping\n\n"
                        last_ping = now
        except (asyncio.CancelledError, GeneratorExit):
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
async def get_history_api(
    page: int = Query(default=1, ge=1, description="当前页码"),
    page_size: int = Query(default=24, ge=1, le=100, description="每页记录数"),
):
    """分页获取历史生成记录"""
    from backend.database import get_history, get_history_count
    total = get_history_count()
    offset = (page - 1) * page_size
    items = get_history(limit=page_size, offset=offset)
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    return {
        "history": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }

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
