import { useState, useEffect, useRef } from 'react'
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
  UploadCloud,
  Trash2,
  Eye,
  Square,
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

interface UploadedImage {
  id: string
  url: string
  name: string
}

interface ImageResult {
  id: string
  filename: string
  url: string
  prompt: string
  negative_prompt?: string
  has_input_image?: boolean
  input_image_url?: string
  input_image_urls?: string[]
  seed?: number
  steps?: number
  width?: number
  height?: number
  elapsed?: number
  created_at?: string
}

const TEXT_PRESETS = [
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

const IMAGE_PRESETS = [
  {
    name: '🧸 转Q版手办风',
    prompt: 'transform this character into a cute 3D chibi figure toy, glossy plastic clay texture, smooth lighting, white background, highly detailed',
  },
  {
    name: '🌌 转赛博朋克风',
    prompt: 'reimagine this scene with futuristic cyberpunk aesthetic, neon cyan and magenta illumination, wet pavement reflections, 8k',
  },
  {
    name: '🌸 转新海诚二次元',
    prompt: 're-render this scene in Makoto Shinkai anime movie style, gorgeous sunset gradient sky, vibrant anime colors, hand-drawn detailing',
  },
  {
    name: '✨ 高清细节增强',
    prompt: 'enhance the resolution and fine details of this image, crisp texture, masterpiece quality, 8k photographic rendering',
  },
]

const MULTI_IMAGE_PRESETS = [
  {
    name: '🎭 角色融入场景 (图1+图2)',
    prompt: '让图1中的角色置身于图2的场景环境中，自然融合图2的光照与阴影，保持角色的特征与服饰细节，8k cinematic lighting',
  },
  {
    name: '👗 服装迁移 (图1穿图2服装)',
    prompt: '让图1中的人物换上图2中的服装与造型风格，保持图1人物的容貌五官与身材比例，极其细致的服饰材质质感',
  },
  {
    name: '🎨 画风迁移 (图1内容改为图2画风)',
    prompt: '将图1的主体角色与场景构图，转换为图2的艺术风格与色彩调色，保留构图结构，高品质渲染',
  },
  {
    name: '✨ 多主体协同组合',
    prompt: '将图1与图2中的主体角色置于同一画面中，两者自然互动交流，景深虚化，高分辨率真实感',
  },
]

const STANDARD_RESOLUTIONS = [
  { label: '1:1 方形 (1024×1024)', width: 1024, height: 1024 },
  { label: '16:9 横屏 (1280×720)', width: 1280, height: 720 },
  { label: '9:16 竖屏 (720×1280)', width: 720, height: 1280 },
  { label: '4:3 经典 (1024×768)', width: 1024, height: 768 },
  { label: '3:4 人像 (768×1024)', width: 768, height: 1024 },
]

const AUTO_RESOLUTION = { label: '🖼️ 自适应参考图比例 (Auto)', width: 0, height: 0 }

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [prompt, setPrompt] = useState('1girl, Kousaka Honoka, school uniform, chibi, transparent background, highly detailed')
  const [negativePrompt, setNegativePrompt] = useState('')
  const [inputImages, setInputImages] = useState<UploadedImage[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [steps, setSteps] = useState(28)
  const [resolution, setResolution] = useState(STANDARD_RESOLUTIONS[0])
  const [seed, setSeed] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showRefCompare, setShowRefCompare] = useState(false)

  const [isBusy, setIsBusy] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const [currentResult, setCurrentResult] = useState<ImageResult | null>(null)
  const [history, setHistory] = useState<ImageResult[]>([])
  const [activeModalImage, setActiveModalImage] = useState<ImageResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 取消正在运行的任务
  const handleCancel = async () => {
    if (!isBusy || isCancelling) return
    setIsCancelling(true)
    try {
      const res = await fetch('/api/cancel', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json()
        setErrorMessage(err.detail || '取消失败')
      }
    } catch (e: any) {
      setErrorMessage(e.message || '网络连接错误')
    } finally {
      setIsCancelling(false)
    }
  }

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

  // 处理多张图片文件加载
  const processImageFiles = (files: FileList | File[]) => {
    const fileArray = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (fileArray.length === 0) {
      setErrorMessage('请上传标准的图片文件 (PNG, JPG, WEBP 等)')
      return
    }

    const readers = fileArray.map((file) => {
      return new Promise<UploadedImage>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = (e) => {
          resolve({
            id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            url: e.target?.result as string,
            name: file.name,
          })
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    })

    Promise.all(readers)
      .then((newImages) => {
        setInputImages((prev) => {
          const updated = [...prev, ...newImages]
          return updated
        })
        setResolution(AUTO_RESOLUTION)
        if (prompt.includes('Kousaka Honoka')) {
          if (newImages.length > 1 || inputImages.length > 0) {
            setPrompt(MULTI_IMAGE_PRESETS[0].prompt)
          } else {
            setPrompt(IMAGE_PRESETS[0].prompt)
          }
        }
      })
      .catch((err) => {
        setErrorMessage('读取图片失败: ' + err.message)
      })
  }

  // 移除单张参考图
  const removeInputImage = (id: string) => {
    setInputImages((prev) => {
      const next = prev.filter((img) => img.id !== id)
      if (next.length === 0 && resolution.width === 0 && resolution.height === 0) {
        setResolution(STANDARD_RESOLUTIONS[0])
      }
      return next
    })
  }

  // 清空所有参考图
  const clearAllInputImages = () => {
    setInputImages([])
    if (resolution.width === 0 && resolution.height === 0) {
      setResolution(STANDARD_RESOLUTIONS[0])
    }
  }

  // 删除单条生成历史记录
  const handleDeleteHistory = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!window.confirm('确定要删除该条生成历史记录吗？对应图片文件也将被清理。')) {
      return
    }

    try {
      const res = await fetch(`/api/history/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setHistory((prev) => {
          const updated = prev.filter((item) => item.id !== id)
          if (currentResult?.id === id) {
            setCurrentResult(updated.length > 0 ? updated[0] : null)
          }
          return updated
        })
        if (activeModalImage?.id === id) {
          setActiveModalImage(null)
        }
      } else {
        const err = await res.json()
        setErrorMessage(err.detail || '删除记录失败')
      }
    } catch (err: any) {
      setErrorMessage(err.message || '网络连接错误')
    }
  }

  // 剪贴板全局粘贴图片监听 (Ctrl + V)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          imageFiles.push(file)
        }
      }
    }
    if (imageFiles.length > 0) {
      processImageFiles(imageFiles)
    }
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
          setIsCancelling(false)
          setProgress(null)
          setCurrentResult(data)
          setHistory((prev) => [data, ...prev.filter((item) => item.id !== data.id)])
        } catch (err) {
          console.error(err)
        }
      })

      eventSource.addEventListener('cancelled', () => {
        setIsBusy(false)
        setIsCancelling(false)
        setProgress(null)
        setErrorMessage('任务已成功取消并释放 GPU 硬件锁')
        setTimeout(() => setErrorMessage(null), 4000)
      })

      eventSource.addEventListener('error', (e: any) => {
        if (e.data) {
          try {
            const data = JSON.parse(e.data)
            setErrorMessage(data.message || '生成失败')
          } catch {}
        }
        setIsBusy(false)
        setIsCancelling(false)
      })

      eventSource.onerror = () => {
        eventSource?.close()
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
          image: inputImages.length > 0 ? inputImages[0].url : null,
          images: inputImages.map((img) => img.url),
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

  const availableResolutions = inputImages.length > 0
    ? [AUTO_RESOLUTION, ...STANDARD_RESOLUTIONS]
    : STANDARD_RESOLUTIONS

  return (
    <div className="app-container" onPaste={handlePaste}>
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
                图像生成与引导配置
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--md-sys-color-outline)' }}>
                {inputImages.length > 1
                  ? `多图多模态参考 (${inputImages.length}张)`
                  : inputImages.length === 1
                  ? '图生图引导 (1张)'
                  : '文生图 (Text-to-Image)'}
              </span>
            </div>

            {/* Input Image Upload Area (多图参考 / 图像引导) */}
            <div className="field-group">
              <div className="field-label">
                <span>参考图片输入 (支持单图或多图引导)</span>
                <span style={{ fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                  支持多选、拖入或 Ctrl+V 粘贴
                </span>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    processImageFiles(e.target.files)
                  }
                  e.target.value = ''
                }}
              />

              {inputImages.length === 0 ? (
                <div
                  className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      processImageFiles(e.dataTransfer.files)
                    }
                  }}
                >
                  <div className="upload-dropzone-icon">
                    <UploadCloud size={22} />
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 500 }}>
                    点击选择图片（支持多选），或将图片拖拽至此处
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--md-sys-color-outline)' }}>
                    单图支持图生图/重绘；多图支持多角色、场景组合与风格融合
                  </div>
                </div>
              ) : (
                <div
                  className="upload-multi-container"
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDragging(true)
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      processImageFiles(e.dataTransfer.files)
                    }
                  }}
                >
                  <div className="upload-multi-header">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Layers size={13} color="var(--md-sys-color-primary)" />
                      已载入 {inputImages.length} 张参考图
                      <span style={{ fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                        (提示词中可用“图1”、“图2”指代)
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={clearAllInputImages}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--md-sys-color-error)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      <Trash2 size={12} /> 清空全部
                    </button>
                  </div>

                  <div className="upload-preview-grid">
                    {inputImages.map((img, idx) => (
                      <div key={img.id} className="upload-image-card">
                        <img src={img.url} alt={img.name} className="upload-image-card-thumb" />
                        <span className="upload-card-badge">图 {idx + 1}</span>
                        <button
                          type="button"
                          className="upload-card-delete"
                          onClick={() => removeInputImage(img.id)}
                          title={`移除图 ${idx + 1}`}
                        >
                          <X size={12} />
                        </button>
                        <span className="upload-card-name" title={img.name}>
                          {img.name}
                        </span>
                      </div>
                    ))}
                    <div
                      className="upload-card-add"
                      onClick={() => fileInputRef.current?.click()}
                      title="添加更多参考图片"
                    >
                      <UploadCloud size={20} />
                      <span>添加图片</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Prompt Input */}
            <div className="field-group">
              <label className="field-label">
                <span>正向提示词 (Prompt)</span>
                {inputImages.length > 0 && (
                  <span className="reference-badge">
                    {inputImages.length > 1 ? `多图协同引导 (${inputImages.length}张)` : '配合参考图引导'}
                  </span>
                )}
              </label>
              <div className="field-container">
                <textarea
                  className="md3-textarea"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    inputImages.length > 1
                      ? '描述如何组合或转换各张参考图（提示：可用“图1”、“图2”指代，例如：让图1中的角色穿上图2的服装置身于...）'
                      : inputImages.length === 1
                      ? '描述想要在参考图基础上进行的变换（如：改为二次元水彩风、添加墨镜与赛博朋克服饰...）'
                      : '请输入引导图像生成的正向提示词...'
                  }
                  rows={4}
                  disabled={isBusy}
                />
                <div className="field-footer">
                  <span>支持中英文细致角色、场景、画风与材质描述</span>
                  <span>{prompt.length} 字</span>
                </div>
              </div>
            </div>

            {/* Suggestion Chips */}
            <div className="field-group">
              <label className="field-label">
                <span>
                  {inputImages.length > 1
                    ? '💡 多图协同灵感'
                    : inputImages.length === 1
                    ? '💡 图生图变换灵感'
                    : '💡 文生图快捷灵感'}
                </span>
              </label>
              <div className="chips-scroll">
                {(inputImages.length > 1
                  ? MULTI_IMAGE_PRESETS
                  : inputImages.length === 1
                  ? IMAGE_PRESETS
                  : TEXT_PRESETS
                ).map((p, idx) => (
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
                      {availableResolutions.map((res, i) => (
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{progress.percent}%</span>
                    <button
                      type="button"
                      className="btn-cancel-chip"
                      onClick={handleCancel}
                      disabled={isCancelling}
                      title="取消当前生成任务"
                    >
                      <Square size={11} fill="currentColor" />
                      <span>{isCancelling ? '取消中...' : '取消'}</span>
                    </button>
                  </div>
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

            {/* Submit & Cancel Buttons */}
            {isBusy ? (
              <div className="button-action-row">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={true}
                  style={{ flex: 1 }}
                >
                  <div className="spinner" />
                  <span>任务执行中 (硬件独占保护)</span>
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  title="中断当前推理并释放 GPU 硬件锁"
                >
                  <Square size={16} fill="currentColor" />
                  <span>{isCancelling ? '正在中断...' : '取消任务'}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
              >
                <Sparkles size={18} />
                <span>
                  {inputImages.length > 1
                    ? `基于 ${inputImages.length} 张参考图融合生成`
                    : inputImages.length === 1
                    ? '基于参考图开始生成'
                    : '开始文生图'}
                </span>
              </button>
            )}

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
                  {((currentResult.input_image_urls && currentResult.input_image_urls.length > 0) || currentResult.input_image_url) && (
                    <button
                      className="icon-button"
                      onClick={() => setShowRefCompare(!showRefCompare)}
                      title={showRefCompare ? '隐藏参考图对比' : '查看原参考图对比'}
                    >
                      <Eye size={18} />
                    </button>
                  )}
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
                    onClick={() => handleDeleteHistory(currentResult.id)}
                    title="删除此条生成记录"
                  >
                    <Trash2 size={18} color="var(--md-sys-color-error)" />
                  </button>
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
                  {showRefCompare && ((currentResult.input_image_urls && currentResult.input_image_urls.length > 0) || currentResult.input_image_url) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {((currentResult.input_image_urls && currentResult.input_image_urls.length > 0)
                          ? currentResult.input_image_urls
                          : [currentResult.input_image_url!]
                        ).map((refUrl, idx) => (
                          <div key={idx} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '12px', marginBottom: '6px', color: 'var(--md-sys-color-outline)' }}>
                              参考图 {idx + 1}
                            </div>
                            <img
                              src={refUrl}
                              alt={`参考图 ${idx + 1}`}
                              style={{ maxHeight: 240, maxWidth: 220, borderRadius: 12, objectFit: 'contain' }}
                            />
                          </div>
                        ))}
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '12px', marginBottom: '6px', color: 'var(--md-sys-color-primary)', fontWeight: 600 }}>
                          最终生成结果
                        </div>
                        <img
                          src={currentResult.url}
                          alt={currentResult.prompt}
                          className="display-image"
                          style={{ maxHeight: 380 }}
                          onClick={() => setActiveModalImage(currentResult)}
                        />
                      </div>
                    </div>
                  ) : (
                    <img
                      src={currentResult.url}
                      alt={currentResult.prompt}
                      className="display-image"
                      onClick={() => setActiveModalImage(currentResult)}
                    />
                  )}
                  <div className="image-meta-bar">
                    {currentResult.has_input_image && (
                      <span className="reference-badge">
                        {currentResult.input_image_urls && currentResult.input_image_urls.length > 1
                          ? `🖼️ 多图参考 (${currentResult.input_image_urls.length}张)`
                          : '🖼️ 图生图引导'}
                      </span>
                    )}
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
                  <p>输入提示词（或上传参考图）并点击“开始生成”，结果将在此处呈现</p>
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
                  <button
                    type="button"
                    className="history-card-delete"
                    onClick={(e) => handleDeleteHistory(item.id, e)}
                    title="删除该记录"
                  >
                    <Trash2 size={13} />
                  </button>
                  <div style={{ position: 'relative' }}>
                    <img src={item.url} alt={item.prompt} className="history-thumb" loading="lazy" />
                    {item.has_input_image && (
                      <span
                        className="reference-badge"
                        style={{ position: 'absolute', top: 8, right: 8, boxShadow: 'var(--md-sys-elevation-1)' }}
                      >
                        {item.input_image_urls && item.input_image_urls.length > 1
                          ? `多图 (${item.input_image_urls.length})`
                          : '图生图'}
                      </span>
                    )}
                  </div>
                  <div className="history-info">
                    <span className="history-prompt" title={item.prompt}>
                      {item.prompt}
                    </span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                      <span>{item.created_at || '刚刚'}</span>
                      {item.elapsed !== undefined && <span>{item.elapsed}s</span>}
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
              <div style={{ maxWidth: '65%', fontSize: '13px', color: 'var(--md-sys-color-on-surface)' }}>
                <p style={{ fontWeight: 500 }}>{activeModalImage.prompt}</p>
                <p style={{ fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                  时间: {activeModalImage.created_at} | 耗时: {activeModalImage.elapsed}s | 步数: {activeModalImage.steps || 28} | 尺寸: {activeModalImage.width || 1024}×{activeModalImage.height || 1024} | 种子: {activeModalImage.seed}
                  {activeModalImage.has_input_image && (
                    activeModalImage.input_image_urls && activeModalImage.input_image_urls.length > 1
                      ? ` | 🖼️ 多图参考 (${activeModalImage.input_image_urls.length}张)`
                      : ' | 🖼️ 图生图'
                  )}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="md3-chip"
                  style={{ color: 'var(--md-sys-color-error)', borderColor: 'var(--md-sys-color-error)' }}
                  onClick={() => handleDeleteHistory(activeModalImage.id)}
                  title="删除该条历史记录"
                >
                  <Trash2 size={14} /> 删除记录
                </button>
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
