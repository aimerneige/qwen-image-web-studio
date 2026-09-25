import os
import sys
import uvicorn
from backend.model_service import model_manager

class StudioServer(uvicorn.Server):
    """自定义 Uvicorn 服务端：在收到退出信号时主动通知活跃的 SSE 连接关闭，避免等待连接挂起"""
    def handle_exit(self, sig: int, frame) -> None:
        model_manager.broadcast_shutdown()
        super().handle_exit(sig, frame)

def main():
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"==================================================")
    print(f"🚀 Qwen-Image 2.1 Web Studio 正在启动...")
    print(f"📡 服务地址: http://localhost:{port}")
    print(f"🔒 硬件互斥锁: 已激活 (单任务独占)")
    print(f"⚡ 显存保护: Sequential CPU Offload 已就绪")
    print(f"==================================================")
    config = uvicorn.Config(
        "backend.app:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
        timeout_graceful_shutdown=2,
    )
    server = StudioServer(config=config)
    server.run()

if __name__ == "__main__":
    main()
