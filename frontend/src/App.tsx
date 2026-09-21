import { useState, useEffect } from 'react'
import {
  Sparkles,
  Lock,
  Unlock,
  Sun,
  Moon,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Sliders,
  Maximize2,
  Clock,
  Cpu,
  Layers,
  RefreshCw,
  X
} from 'lucide-react'
import './App.css'

interface TaskProgress {
  task_id?: string
  status: string
  message: string
  step: number
  total_steps: number
  percent: number
  elapsed?: number
  eta?: number
}

interface ImageResult {
  id: string
  filename: string
  url: string
  prompt: string
  negative_prompt?: string
  seed?: number
  steps?: number
  width?: number
  height?: number
  elapsed?: number
  created_at?: string
}

const PRESETS = [
  {
    name: '🧸 Q版手办 (Chibi)',
    prompt: '1girl, Kousaka Honoka, school uniform, chibi, transparent background, highly detailed',
  },
  {
    name: '🌌 赛博朋克都市',
    prompt: 'futuristic cyberpunk city at night, neon lights reflecting on wet street, glowing skyscrapers, cinematic atmosphere, 8k',
  },
  {
    name: '🌸 新海诚唯美风',
    prompt: 'Makoto Shinkai style, breathtaking sky with giant fluffy clouds, twilight glow, train tracks, cherry blossoms, vibrant colors',
  },
  {
    name: '📸 电影写实肖像',
    prompt: 'cinematic medium shot portrait of a girl in winter coat, snowing street in Kyoto, golden hour bokeh, 85mm lens, master piece',
  },
  {
    name: '🎨 水彩东方意境',
    prompt: 'Chinese watercolor and ink wash painting, misty mountains, solitary pine tree, serene lake, minimalist, traditional aesthetics',
  },
]

const RESOLUTIONS = [
  { label: '1:1 方形 (1024×1024)', width: 1024, height: 1024 },
  { label: '16:9 横屏 (1280×720)', width: 1280, height: 720 },
  { label: '9:16 竖屏 (720×1280)', width: 720, height: 1280 },
  { label: '4:3 经典 (1024×768)', width: 1024, height: 768 },
  { label: '3:4 人像 (768×1024)', width: 768, height: 1024 },
]

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [prompt, setPrompt] = useState('1girl, Kousaka Honoka, school uniform, chibi, transparent background, highly detailed')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [steps, setSteps] = useState(28)
  const [resolution, setResolution] = useState(RESOLUTIONS[0])
  const [seed, setSeed] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [isBusy, setIsBusy] = useState(false)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const [currentResult, setCurrentResult] = useState<ImageResult | null>(null)
  const [history, setHistory] = useState<ImageResult[]>([])
  const [activeModalImage, setActiveModalImage] = useState<ImageResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // 主题切换
  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light'
    setTheme(nextTheme)
    document.documentElement.setAttribute('data-theme', nextTheme)
  }

  // 复制提示词
  const copyPrompt = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // 获取初始状态
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status')
      if (res.ok) {
        const data = await res.json()
        setIsBusy(data.is_busy)
        if (data.current_task) {
          setProgress(data.current_task)
        }
        if (data.history && data.history.length > 0) {
          setHistory(data.history)
          if (!currentResult) {
            setCurrentResult(data.history[0])
          }
        }
      }
    } catch (e) {
      console.warn('获取状态异常:', e)
    }
  }

  // SSE 实时推送与长连接
  useEffect(() => {
    fetchStatus()

    let eventSource: EventSource | null = null

    const connectSSE = () => {
      eventSource = new EventSource('/api/stream')

      eventSource.addEventListener('status', (e) => {
        try {
          const data = JSON.parse(e.data)
          setIsBusy(data.is_busy)
          if (data.current_task) {
            setProgress(data.current_task)
          } else {
            setIsBusy(false)
          }
          if (data.history && data.history.length > 0) {
            setHistory(data.history)
            setCurrentResult((prev) => prev || data.history[0])
          }
        } catch (err) {
          console.error('解析 status 事件失败', err)
        }
      })

      eventSource.addEventListener('start', (e) => {
        try {
          const data = JSON.parse(e.data)
          setIsBusy(true)
          setProgress(data)
          setErrorMessage(null)
        } catch (err) {
          console.error(err)
        }
      })

      eventSource.addEventListener('progress', (e) => {
        try {
          const data = JSON.parse(e.data)
          setIsBusy(true)
          setProgress(data)
        } catch (err) {
          console.error(err)
        }
      })

      eventSource.addEventListener('complete', (e) => {
        try {
          const data: ImageResult = JSON.parse(e.data)
          setIsBusy(false)
          setProgress(null)
          setCurrentResult(data)
          setHistory((prev) => [data, ...prev.filter((item) => item.id !== data.id)])
        } catch (err) {
          console.error(err)
        }
      })

      eventSource.addEventListener('error', (e: any) => {
        if (e.data) {
          try {
            const data = JSON.parse(e.data)
            setErrorMessage(data.message || '生成失败')
          } catch {}
        }
        setIsBusy(false)
      })

      eventSource.onerror = () => {
        eventSource?.close()
        // 3秒后尝试重连
        setTimeout(connectSSE, 3000)
      }
    }

    connectSSE()

    return () => {
      eventSource?.close()
    }
  }, [])

  // 提交生成
  const handleGenerate = async () => {
    if (!prompt.trim() || isBusy) return

    setErrorMessage(null)
    setIsBusy(true)
    setProgress({
      status: 'starting',
      message: '正在提交任务并请求硬件互斥锁...',
      step: 0,
      total_steps: steps,
      percent: 0,
    })

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          negative_prompt: negativePrompt.trim(),
          steps,
          width: resolution.width,
          height: resolution.height,
          seed: seed === '' ? -1 : Number(seed),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setErrorMessage(err.detail || err.message || '任务启动失败')
        setIsBusy(false)
        setProgress(null)
      }
    } catch (e: any) {
      setErrorMessage(e.message || '网络连接错误')
      setIsBusy(false)
      setProgress(null)
    }
  }

  return (
    <div className="app-container">
      {/* Top App Bar */}
      <header className="top-app-bar">
        <div className="top-bar-brand">
          <div className="brand-icon-wrapper">
            <Sparkles size={22} />
          </div>
          <span className="brand-title">Qwen-Image 2.1 Studio</span>
        </div>

        <div className="top-bar-actions">
          {/* 硬件互斥锁状态胶囊 */}
          <div className={`lock-badge ${isBusy ? 'busy' : 'idle'}`}>
            {isBusy ? (
              <>
                <Lock size={15} />
                <span>硬件独占锁：已锁定 (单任务运行中)</span>
              </>
            ) : (
              <>
                <Unlock size={15} />
                <span>硬件独占锁：空闲 (就绪)</span>
              </>
            )}
          </div>

          <button
            className="icon-button"
            onClick={toggleTheme}
            title={theme === 'light' ? '切换深色模式' : '切换浅色模式'}
          >
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        <div className="workspace-grid">
          {/* Left Panel: Prompt & Controls */}
          <div className="md3-card">
            <div className="card-header">
              <h2 className="card-title">
                <Sliders size={20} color="var(--md-sys-color-primary)" />
                图像生成配置
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--md-sys-color-outline)' }}>
                Diffusion Pipeline
              </span>
            </div>

            {/* Prompt Input */}
            <div className="field-group">
              <label className="field-label">正向提示词 (Prompt)</label>
              <div className="field-container">
                <textarea
                  className="md3-textarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="请输入用于引导图像生成的英文或中文提示词..."
                  rows={4}
                  disabled={isBusy}
                />
                <div className="field-footer">
                  <span>支持细致角色、场景、画风与材质描述</span>
                  <span>{prompt.length} 字</span>
                </div>
              </div>
            </div>

            {/* Suggestion Chips */}
            <div className="field-group">
              <label className="field-label">快捷灵感预设</label>
              <div className="chips-scroll">
                {PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="md3-chip"
                    onClick={() => setPrompt(p.prompt)}
                    disabled={isBusy}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Advanced Settings Accordion */}
            <div className="field-group">
              <button
                type="button"
                className="accordion-toggle"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                <span>高级推理参数 (采样步数 / 画幅 / 种子 / 负向提示)</span>
              </button>

              {showAdvanced && (
                <div className="accordion-body">
                  {/* Negative Prompt */}
                  <div className="field-group">
                    <label className="field-label">负向提示词 (Negative Prompt)</label>
                    <textarea
                      className="md3-textarea"
                      style={{ minHeight: '64px' }}
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      placeholder="不希望在画面中出现的元素（如：blurry, low quality, distorted）..."
                      rows={2}
                      disabled={isBusy}
                    />
                  </div>

                  {/* Steps */}
                  <div className="field-group">
                    <div className="slider-header">
                      <span>推理步数 (Inference Steps)</span>
                      <span><b>{steps}</b> 步</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={50}
                      step={1}
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value))}
                      className="md3-slider"
                      disabled={isBusy}
                    />
                  </div>

                  {/* Resolution */}
                  <div className="field-group">
                    <label className="field-label">分辨率比例 (Aspect Ratio)</label>
                    <div className="chips-scroll">
                      {RESOLUTIONS.map((res, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`md3-chip ${resolution.width === res.width && resolution.height === res.height ? 'active' : ''}`}
                          onClick={() => setResolution(res)}
                          disabled={isBusy}
                        >
                          {res.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Seed */}
                  <div className="field-group">
                    <label className="field-label">随机种子 (Seed)</label>
                    <div className="seed-input-row">
                      <input
                        type="number"
                        className="md3-input"
                        placeholder="留空为随机种子"
                        value={seed}
                        onChange={(e) => setSeed(e.target.value === '' ? '' : Number(e.target.value))}
                        disabled={isBusy}
                      />
                      <button
                        type="button"
                        className="md3-chip"
                        onClick={() => setSeed(Math.floor(Math.random() * 2147483647))}
                        disabled={isBusy}
                      >
                        <RefreshCw size={14} /> 随机
                      </button>
                      {seed !== '' && (
                        <button
                          type="button"
                          className="md3-chip"
                          onClick={() => setSeed('')}
                          disabled={isBusy}
                        >
                          清除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: 'var(--md-sys-shape-m)',
                  backgroundColor: 'var(--md-sys-color-error-container)',
                  color: 'var(--md-sys-color-on-error-container)',
                  fontSize: '13px',
                }}
              >
                ⚠️ {errorMessage}
              </div>
            )}

            {/* Progress Display */}
            {isBusy && progress && (
              <div className="progress-card">
                <div className="progress-header">
                  <span className="progress-status-text">
                    <Cpu size={16} />
                    {progress.message || '生成计算中...'}
                  </span>
                  <span>{progress.percent}%</span>
                </div>
                <div className="progress-track">
                  <div
                    className="progress-bar"
                    style={{ width: `${Math.max(5, progress.percent)}%` }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                  <span>步数: {progress.step} / {progress.total_steps || steps}</span>
                  {progress.elapsed !== undefined && <span>已耗时: {progress.elapsed}s</span>}
                  {progress.eta !== undefined && progress.eta > 0 && <span>预估剩余: {progress.eta}s</span>}
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={isBusy || !prompt.trim()}
            >
              {isBusy ? (
                <>
                  <div className="spinner" />
                  <span>任务执行中 (硬件独占保护)</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} />
                  <span>开始生成图像</span>
                </>
              )}
            </button>

            {/* Safety Tip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--md-sys-color-outline)' }}>
              <Layers size={14} />
              <span>已启用 Sequential CPU Offload 与硬件锁，防止并发爆显存</span>
            </div>
          </div>

          {/* Right Panel: Output & Preview */}
          <div className="preview-container">
            <div className="preview-header">
              <span style={{ fontWeight: 500, fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ImageIcon size={18} color="var(--md-sys-color-primary)" />
                生成结果预览
              </span>
              {currentResult && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="icon-button"
                    onClick={() => copyPrompt(currentResult.prompt)}
                    title="复制提示词"
                  >
                    {copied ? <Check size={18} color="var(--md-sys-color-success)" /> : <Copy size={18} />}
                  </button>
                  <a
                    href={currentResult.url}
                    download={currentResult.filename}
                    className="icon-button"
                    title="下载原始图片"
                  >
                    <Download size={18} />
                  </a>
                  <button
                    className="icon-button"
                    onClick={() => setActiveModalImage(currentResult)}
                    title="全屏查看"
                  >
                    <Maximize2 size={18} />
                  </button>
                </div>
              )}
            </div>

            <div className="preview-body">
              {isBusy ? (
                <div className="empty-placeholder">
                  <div className="spinner" style={{ width: 44, height: 44, color: 'var(--md-sys-color-primary)' }} />
                  <div style={{ fontWeight: 500, fontSize: '16px', color: 'var(--md-sys-color-on-surface)' }}>
                    {progress?.message || 'Qwen-Image 正在绘制中...'}
                  </div>
                  <div style={{ fontSize: '13px', maxWidth: 360 }}>
                    模型正在进行层级显存交换与去噪采样计算，请稍候...
                  </div>
                </div>
              ) : currentResult ? (
                <div className="image-wrapper">
                  <img
                    src={currentResult.url}
                    alt={currentResult.prompt}
                    className="display-image"
                    onClick={() => setActiveModalImage(currentResult)}
                  />
                  <div className="image-meta-bar">
                    <span className="meta-chip">
                      尺寸: {currentResult.width || 1024} × {currentResult.height || 1024}
                    </span>
                    <span className="meta-chip">步数: {currentResult.steps || 28} 步</span>
                    {currentResult.seed !== undefined && (
                      <span className="meta-chip">种子: {currentResult.seed}</span>
                    )}
                    {currentResult.elapsed !== undefined && (
                      <span className="meta-chip">耗时: {currentResult.elapsed}s</span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="empty-placeholder">
                  <ImageIcon size={64} strokeWidth={1.2} />
                  <p>输入提示词并点击“开始生成图像”，结果将在此处呈现</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* History Gallery */}
        {history.length > 0 && (
          <section className="history-section">
            <h3 style={{ fontSize: '18px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} color="var(--md-sys-color-primary)" />
              历史生成记录 ({history.length})
            </h3>
            <div className="history-grid">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="history-card"
                  onClick={() => {
                    setCurrentResult(item)
                    setPrompt(item.prompt)
                  }}
                >
                  <img src={item.url} alt={item.prompt} className="history-thumb" loading="lazy" />
                  <div className="history-info">
                    <span className="history-prompt" title={item.prompt}>
                      {item.prompt}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="history-time">{item.created_at || '刚刚'}</span>
                      <span style={{ fontSize: '11px', color: 'var(--md-sys-color-primary)' }}>
                        载入配置 ↵
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Fullscreen Modal Dialog */}
      {activeModalImage && (
        <div className="modal-overlay" onClick={() => setActiveModalImage(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <img
              src={activeModalImage.url}
              alt={activeModalImage.prompt}
              className="modal-image"
            />
            <div className="modal-footer">
              <div style={{ maxWidth: '70%', fontSize: '13px', color: 'var(--md-sys-color-on-surface)' }}>
                <p style={{ fontWeight: 500 }}>{activeModalImage.prompt}</p>
                <p style={{ fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                  {activeModalImage.created_at} | 步数: {activeModalImage.steps || 28} | 种子: {activeModalImage.seed}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <a
                  href={activeModalImage.url}
                  download={activeModalImage.filename}
                  className="md3-chip"
                  style={{ textDecoration: 'none' }}
                >
                  <Download size={14} /> 下载图片
                </a>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setActiveModalImage(null)}
                >
                  <X size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
