import os
import sys
import uvicorn

def main():
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"==================================================")
    print(f"🚀 Qwen-Image 2.1 Web Studio 正在启动...")
    print(f"📡 服务地址: http://localhost:{port}")
    print(f"🔒 硬件互斥锁: 已激活 (单任务独占)")
    print(f"⚡ 显存保护: Sequential CPU Offload 已就绪")
    print(f"==================================================")
    uvicorn.run("backend.app:app", host=host, port=port, reload=False, log_level="info")

if __name__ == "__main__":
    main()
