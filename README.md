# Qwen-Image 2.1 Web Studio

基于 **Material Design 3 (MD3)** 设计风格的 Qwen-Image 2.1 简易图像生成 Web 应用。

---

## 🌟 核心特性

- **Material Design 3 现代界面**：遵循 MD3 官方规范（Tonal Palette、动态 Surface 层级、圆角卡片、药丸按钮、线性进度条与深浅色模式切换）。
- **硬件独占互斥锁（单任务保护）**：Qwen-Image 2.1 模型极度消耗硬件资源。后端采用双重互斥锁（`asyncio.Lock` 与状态守卫），**严格限制同一时刻仅允许一个生成任务执行**。并发请求将受到友好拦截并提示排队状态，防止显存与内存溢出崩溃。
- **极致显存保护（Sequential CPU Offload）**：针对硬件瓶颈开启 Diffusers 逐层卸载机制，空闲时绝大部分模型权重常驻系统内存，GPU 闲置显存占用维持在极低水位（~1.7GB），按需分层调度推理。
- **实时步进流式反馈（SSE）**：基于 Server-Sent Events 实现毫秒级进度同步，页面实时显示当前推理阶段、去噪采样步数（Step X/Y）、进度百分比、已耗时与预估剩余时间（ETA）。
- **动静合一单端口部署**：React + Vite 前端构建出的生产静态资源直接由 FastAPI 后端统一托管，开箱即用，无需配置复杂的 Nginx 反向代理。
- **文生图与图生图全支持（Qwen3-VL 多模态引导）**：
  - **参考图上传**：支持文件选择、拖拽及剪贴板粘贴（Ctrl+V），自动识别并激活图生图模式。
  - **图生图灵感变换预设**：转Q版手办、转赛博朋克、转新海诚唯美风、高清细节增强。
  - **自适应画幅**：上传参考图后自动自适应原始比例输出，并支持对比查看原图与生成图。
- **便捷工作流与历史记录**：
  - 内置快捷灵感预设 Chip（Q版手办、赛博朋克、新海诚唯美、电影写实、水彩国风等）。
  - 高级推理参数可折叠调节（步数 Slider、画幅比例/分辨率、随机种子控制、负向提示词）。
  - 生成结果支持原图与生成图双视对比、全屏放大预览、一键下载图片、一键复制提示词以及下方历史记录画廊。

---

## 🚀 快速启动指南

### 1. 启动服务

项目虚拟环境与模型已就绪，直接运行启动脚本即可：

```bash
# 方式一：使用当前项目的虚拟环境启动
.venv/bin/python server.py

# 方式二：使用 uv 启动
uv run python server.py
```

终端将显示启动信息：
```text
==================================================
🚀 Qwen-Image 2.1 Web Studio 正在启动...
📡 服务地址: http://localhost:8000
🔒 硬件互斥锁: 已激活 (单任务独占)
⚡ 显存保护: Sequential CPU Offload 已就绪
==================================================
```

### 2. 访问应用

打开浏览器访问：
👉 **[http://localhost:8000](http://localhost:8000)**

*(如需自定义端口或监听地址，可通过环境变量设置：`PORT=8080 HOST=0.0.0.0 python server.py`)*

---

## 🛠️ 前端二次开发与构建

如需对前端界面（[`frontend/src`](frontend/src)）进行修改或定制：

```bash
# 进入前端目录
cd frontend

# 安装依赖
npm install

# 本地热重载开发调试（API 代理到 8000）
npm run dev

# 构建生产静态资源（输出至 frontend/dist，后端将自动挂载）
npm run build
```

---

## 📁 目录结构

```text
├── backend/
│   ├── app.py              # FastAPI 应用、路由定义、SSE 事件流与静态文件托管
│   └── model_service.py    # 模型单例生命周期、硬件独占互斥锁与去噪步进回调
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # MD3 风格主界面（输入、实时进度、预览与历史相册）
│   │   ├── App.css         # MD3 组件样式与响应式布局
│   │   └── index.css       # MD3 调色板设计 Token (Light / Dark)
│   ├── dist/               # Vite 构建出的生产静态文件
│   └── package.json        # 前端依赖配置
├── outputs/                # 生成的图片输出与持久化目录
├── server.py               # 生产服务启动入口
├── generate_chibi.py       # 原始测试脚本
├── pyproject.toml          # Python 依赖配置文件
└── README.md
```
