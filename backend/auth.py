import hmac
import os
from pathlib import Path
from typing import Optional
from fastapi import Request

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"

def load_dotenv(env_path: Optional[Path] = None) -> None:
    """从 .env 文件加载环境变量（若环境变量未设置则注入，不覆盖已有的环境变量）"""
    target = env_path or ENV_FILE
    if not target.is_file():
        return

    try:
        with open(target, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = val
    except Exception as e:
        import logging
        logging.getLogger("qwen_image_auth").warning(f"读取 .env 文件失败: {e}")

# 模块加载时尝试读取项目根目录下的 .env
load_dotenv()

def get_auth_token() -> str:
    """获取服务端环境变量中配置的访问 Token"""
    return os.environ.get("AUTH_TOKEN", "").strip()

def is_auth_required() -> bool:
    """判断服务端是否启用了 Token 鉴权"""
    return bool(get_auth_token())

def verify_token(provided_token: Optional[str]) -> bool:
    """校验客户端提供的 Token 是否与服务端环境变量一致"""
    expected = get_auth_token()
    if not expected:
        # 服务端未配置 Token，视为未开启鉴权直接放行
        return True
    if not provided_token:
        return False
    return hmac.compare_digest(provided_token.strip(), expected)

def extract_token_from_request(request: Request) -> Optional[str]:
    """从 HTTP 请求中提取 Token，按优先级尝试 Header、Query 参数和 Cookie"""
    # 1. 尝试 Authorization: Bearer <token>
    auth_header = request.headers.get("Authorization") or request.headers.get("authorization")
    if auth_header and auth_header.strip().lower().startswith("bearer "):
        return auth_header.strip()[7:].strip()

    # 2. 尝试 X-Token 头部
    x_token = request.headers.get("X-Token") or request.headers.get("x-token")
    if x_token and x_token.strip():
        return x_token.strip()

    # 3. 尝试 Query 参数 ?token=<token>
    query_token = request.query_params.get("token")
    if query_token and query_token.strip():
        return query_token.strip()

    # 4. 尝试 Cookie auth_token=<token>
    cookie_token = request.cookies.get("auth_token")
    if cookie_token and cookie_token.strip():
        return cookie_token.strip()

    return None

def is_authenticated(request: Request) -> bool:
    """判断当前请求是否通过了身份校验"""
    if not is_auth_required():
        return True
    token = extract_token_from_request(request)
    return verify_token(token)
