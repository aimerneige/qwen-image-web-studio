import { useState, useEffect, useRef } from 'react'
import {
  Layers,
  UploadCloud,
  Play,
  Pause,
  Square,
  RefreshCw,
  Trash2,
  Download,
  Eye,
  Check,
  X,
  AlertCircle,
  Archive,
  ArrowRight,
  Sparkles,
  Sliders,
  Copy,
  Clock,
  Cpu
} from 'lucide-react'
import type { TaskProgress, ImageResult, Resolution, BatchItem } from './types'

export interface BatchCallbacks {
  onProgress?: (progress: TaskProgress) => void
  onComplete?: (result: ImageResult) => void
  onError?: (msg: string) => void
  onCancelled?: () => void
}

interface BatchProcessingProps {
  isBusy: boolean
  isCancelling: boolean
  currentProgress: TaskProgress | null
  registerBatchCallbacks: (callbacks: BatchCallbacks) => void
  onTaskComplete: (result: ImageResult) => void
  onRemixToStudio: (prompt: string, negativePrompt?: string, refUrl?: string) => void
  setErrorMessage: (msg: string | null) => void
  onQueueStatsChange: (total: number, completed: number, isRunning: boolean) => void
}

const BATCH_PRESETS = [
  {
    name: '🧸 批量转Q版手办风',
    prompt: 'transform this character into a cute 3D chibi figure toy, glossy plastic clay texture, smooth lighting, white background, highly detailed',
  },
  {
    name: '🌌 批量转赛博朋克风',
    prompt: 'reimagine this scene with futuristic cyberpunk aesthetic, neon cyan and magenta illumination, wet pavement reflections, 8k',
  },
  {
    name: '🌸 批量转新海诚二次元',
    prompt: 're-render this scene in Makoto Shinkai anime movie style, gorgeous sunset gradient sky, vibrant anime colors, hand-drawn detailing',
  },
  {
    name: '✨ 批量高清质感重绘',
    prompt: 'enhance the resolution and fine details of this image, crisp texture, masterpiece quality, 8k photographic rendering',
  },
  {
    name: '🎨 批量转水彩国风意境',
    prompt: 'transform into Chinese traditional watercolor and ink wash painting style, elegant brush strokes, misty serene atmosphere, artistic masterpiece',
  },
  {
    name: '📸 批量转电影写实肖像',
    prompt: 'cinematic lighting, realistic photographic portrait, natural skin texture, 85mm lens f/1.4 bokeh, 8k highly detailed',
  },
  {
    name: '✏️ 批量二次元素描线稿',
    prompt: 'clean manga anime line art sketch, sharp fine outlines, monochrome ink shading, highly expressive',
  },
  {
    name: '🌇 批量暮光落日氛围',
    prompt: 'bathed in warm golden hour sunset glow, dramatic twilight rim lighting, cinematic aesthetic, atmospheric haze',
  },
]

const BATCH_RESOLUTIONS: Resolution[] = [
  { label: '🖼️ 保持原图自适应 (Auto - 推荐)', width: 0, height: 0 },
  { label: '1:1 方形 (1024×1024)', width: 1024, height: 1024 },
  { label: '16:9 横屏 (1280×720)', width: 1280, height: 720 },
  { label: '9:16 竖屏 (720×1280)', width: 720, height: 1280 },
  { label: '4:3 经典 (1024×768)', width: 1024, height: 768 },
  { label: '3:4 人像 (768×1024)', width: 768, height: 1024 },
]

export default function BatchProcessing({
  isBusy,
  isCancelling,
  currentProgress,
  registerBatchCallbacks,
  onTaskComplete,
  onRemixToStudio,
  setErrorMessage,
  onQueueStatsChange,
}: BatchProcessingProps) {
  // Batch Prompt & Inference Parameters
  const [prompt, setPrompt] = useState(BATCH_PRESETS[0].prompt)
  const [negativePrompt, setNegativePrompt] = useState('')
  const [resolution, setResolution] = useState<Resolution>(BATCH_RESOLUTIONS[0])
  const [steps, setSteps] = useState(28)
  const [seedMode, setSeedMode] = useState<'random' | 'increment' | 'fixed'>('random')
  const [baseSeed, setBaseSeed] = useState<number | ''>('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Queue & State
  const [queue, setQueue] = useState<BatchItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [isBatchPaused, setIsBatchPaused] = useState(false)
  const [filter, setFilter] = useState<'all' | 'completed' | 'pending' | 'failed'>('all')
  const [isDragging, setIsDragging] = useState(false)
  const [isExportingZip, setIsExportingZip] = useState(false)

  // Modals & Inspection
  const [activeModalItem, setActiveModalItem] = useState<BatchItem | null>(null)
  const [modalCopied, setModalCopied] = useState(false)

  // Time Tracking
  const [batchStartTime, setBatchStartTime] = useState<number | null>(null)
  const [batchElapsedTime, setBatchElapsedTime] = useState(0)

  // Refs for async loop consistency
  const queueRef = useRef<BatchItem[]>(queue)
  const isBatchRunningRef = useRef(isBatchRunning)
  const isBatchPausedRef = useRef(isBatchPaused)
  const currentProcessingIdRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    queueRef.current = queue
  }, [queue])

  useEffect(() => {
    isBatchRunningRef.current = isBatchRunning
  }, [isBatchRunning])

  useEffect(() => {
    isBatchPausedRef.current = isBatchPaused
  }, [isBatchPaused])

  // Update parent stats badge
  useEffect(() => {
    const completed = queue.filter((i) => i.status === 'completed').length
    onQueueStatsChange(queue.length, completed, isBatchRunning)
  }, [queue, isBatchRunning, onQueueStatsChange])

  // Timer for overall batch elapsed time
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    if (isBatchRunning && !isBatchPaused && batchStartTime) {
      interval = setInterval(() => {
        setBatchElapsedTime(Math.floor((Date.now() - batchStartTime) / 1000))
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isBatchRunning, isBatchPaused, batchStartTime])

  // Read file as Base64 Data URL
  const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Update specific item in queue
  const updateItem = (id: string, patch: Partial<BatchItem>) => {
    setQueue((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
      queueRef.current = next
      return next
    })
  }

  // Execution Step: Process next pending item
  const processNextItem = async () => {
    if (!isBatchRunningRef.current || isBatchPausedRef.current) return

    const currentList = queueRef.current
    const nextItem = currentList.find((i) => i.status === 'pending')

    if (!nextItem) {
      // All items in queue have been processed!
      setIsBatchRunning(false)
      isBatchRunningRef.current = false
      currentProcessingIdRef.current = null
      return
    }

    currentProcessingIdRef.current = nextItem.id
    updateItem(nextItem.id, {
      status: 'processing',
      progress: 0,
      step: 0,
      totalSteps: steps,
      error: undefined,
    })

    // 1. Convert image to Base64
    let base64Data: string
    try {
      base64Data = await readFileAsDataURL(nextItem.file)
    } catch (err: any) {
      updateItem(nextItem.id, {
        status: 'failed',
        error: `读取图片文件失败: ${err.message}`,
      })
      currentProcessingIdRef.current = null
      // Continue to next pending item
      setTimeout(processNextItem, 200)
      return
    }

    // 2. Compute seed
    let seedParam: number = -1
    if (seedMode === 'fixed') {
      seedParam = baseSeed === '' ? 42 : Number(baseSeed)
    } else if (seedMode === 'increment') {
      const base = baseSeed === '' ? 1000 : Number(baseSeed)
      const itemIdx = currentList.findIndex((i) => i.id === nextItem.id)
      seedParam = base + itemIdx
    }

    // 3. Post to API
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          negative_prompt: negativePrompt.trim(),
          image: base64Data,
          steps,
          width: resolution.width,
          height: resolution.height,
          seed: seedParam,
          count: 1,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '启动生成任务失败')
      }
    } catch (err: any) {
      updateItem(nextItem.id, {
        status: 'failed',
        error: err.message || '网络连接失败',
      })
      currentProcessingIdRef.current = null
      if (isBatchRunningRef.current && !isBatchPausedRef.current) {
        setTimeout(() => processNextItemRef.current(), 500)
      }
    }
  }

  const processNextItemRef = useRef(processNextItem)
  useEffect(() => {
    processNextItemRef.current = processNextItem
  }, [processNextItem])

  // Register SSE event listeners
  useEffect(() => {
    registerBatchCallbacks({
      onProgress: (prog) => {
        if (currentProcessingIdRef.current) {
          updateItem(currentProcessingIdRef.current, {
            progress: prog.percent,
            step: prog.step,
            totalSteps: prog.total_steps || steps,
            elapsed: prog.elapsed,
          })
        }
      },
      onComplete: (result) => {
        const activeId = currentProcessingIdRef.current
        if (activeId) {
          updateItem(activeId, {
            status: 'completed',
            progress: 100,
            step: steps,
            result,
            elapsed: result.elapsed,
          })
          onTaskComplete(result)
          currentProcessingIdRef.current = null

          // Advance to next item if still running and not paused
          if (isBatchRunningRef.current && !isBatchPausedRef.current) {
            setTimeout(() => processNextItemRef.current(), 400)
          }
        }
      },
      onError: (msg) => {
        const activeId = currentProcessingIdRef.current
        if (activeId) {
          updateItem(activeId, {
            status: 'failed',
            error: msg || '生成异常中断',
          })
          currentProcessingIdRef.current = null
          if (isBatchRunningRef.current && !isBatchPausedRef.current) {
            setTimeout(() => processNextItemRef.current(), 500)
          }
        }
      },
      onCancelled: () => {
        const activeId = currentProcessingIdRef.current
        if (activeId) {
          updateItem(activeId, {
            status: 'pending',
            progress: 0,
          })
          currentProcessingIdRef.current = null
        }
        setIsBatchRunning(false)
        isBatchRunningRef.current = false
      },
    })
  }, [registerBatchCallbacks, steps, onTaskComplete])

  // Handle file uploads (multiple files)
  const addFilesToQueue = (files: FileList | File[]) => {
    const validFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (validFiles.length === 0) {
      setErrorMessage('请选择有效的图片文件 (PNG, JPG, WEBP, JPEG 等)')
      return
    }

    const newItems: BatchItem[] = validFiles.map((file) => ({
      id: `batch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      name: file.name,
      size: file.size,
      status: 'pending',
      progress: 0,
      step: 0,
      totalSteps: steps,
    }))

    setQueue((prev) => {
      const updated = [...prev, ...newItems]
      queueRef.current = updated
      return updated
    })
  }

  // Batch control actions
  const handleStartBatch = () => {
    if (!prompt.trim()) {
      setErrorMessage('请输入批量处理提示词')
      return
    }
    const hasPending = queue.some((i) => i.status === 'pending')
    if (!hasPending) {
      setErrorMessage('队列中没有待处理的图片，请先添加图片')
      return
    }
    if (isBusy && !currentProcessingIdRef.current) {
      setErrorMessage('当前后台已有任务在运行中，请等待其完成')
      return
    }

    setErrorMessage(null)
    setIsBatchRunning(true)
    isBatchRunningRef.current = true
    setIsBatchPaused(false)
    isBatchPausedRef.current = false

    if (!batchStartTime) {
      setBatchStartTime(Date.now())
    }

    setTimeout(processNextItem, 100)
  }

  const handlePauseBatch = () => {
    setIsBatchPaused(true)
    isBatchPausedRef.current = true
  }

  const handleResumeBatch = () => {
    setIsBatchPaused(false)
    isBatchPausedRef.current = false
    setTimeout(processNextItem, 100)
  }

  const handleStopBatch = async () => {
    setIsBatchRunning(false)
    isBatchRunningRef.current = false
    setIsBatchPaused(false)
    isBatchPausedRef.current = false

    if (isBusy) {
      try {
        await fetch('/api/cancel', { method: 'POST' })
      } catch {}
    }

    if (currentProcessingIdRef.current) {
      updateItem(currentProcessingIdRef.current, {
        status: 'pending',
        progress: 0,
      })
      currentProcessingIdRef.current = null
    }
  }

  // Clear queue
  const handleClearQueue = () => {
    if (isBatchRunning) {
      if (!window.confirm('当前正在执行批量处理，确定要终止并清空队列吗？')) {
        return
      }
      handleStopBatch()
    }
    // Revoke memory
    queue.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    setQueue([])
    queueRef.current = []
    setBatchStartTime(null)
    setBatchElapsedTime(0)
  }

  // Remove single item from queue
  const handleRemoveItem = (id: string) => {
    if (currentProcessingIdRef.current === id) {
      setErrorMessage('无法删除当前正在处理的图片')
      return
    }
    const target = queue.find((i) => i.id === id)
    if (target) {
      URL.revokeObjectURL(target.previewUrl)
    }
    setQueue((prev) => {
      const next = prev.filter((i) => i.id !== id)
      queueRef.current = next
      return next
    })
  }

  // Retry single failed item
  const handleRetryItem = (id: string) => {
    updateItem(id, {
      status: 'pending',
      error: undefined,
      progress: 0,
    })
    if (!isBatchRunningRef.current) {
      setIsBatchRunning(true)
      isBatchRunningRef.current = true
      setIsBatchPaused(false)
      isBatchPausedRef.current = false
      setTimeout(processNextItem, 100)
    }
  }

  // Retry all failed items
  const handleRetryAllFailed = () => {
    setQueue((prev) => {
      const next = prev.map((item) =>
        item.status === 'failed' ? { ...item, status: 'pending' as const, error: undefined, progress: 0 } : item
      )
      queueRef.current = next
      return next
    })

    if (!isBatchRunningRef.current) {
      setIsBatchRunning(true)
      isBatchRunningRef.current = true
      setIsBatchPaused(false)
      isBatchPausedRef.current = false
      setTimeout(processNextItem, 100)
    }
  }

  // Export all completed images as ZIP
  const handleExportZip = async () => {
    const completedItems = queue.filter((item) => item.status === 'completed' && item.result)
    if (completedItems.length === 0) return

    setIsExportingZip(true)
    try {
      const payload = {
        items: completedItems.map((item, idx) => {
          const cleanBase = item.name.replace(/\.[^/.]+$/, '')
          const numPrefix = String(idx + 1).padStart(3, '0')
          return {
            filename: item.result!.filename,
            download_name: `${numPrefix}_${cleanBase}_qwen.png`,
          }
        }),
      }

      const res = await fetch('/api/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '打包导出失败')
      }

      const blob = await res.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `qwen_batch_${completedItems.length}_images_${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(downloadUrl)
    } catch (err: any) {
      setErrorMessage(err.message || '导出 ZIP 失败')
    } finally {
      setIsExportingZip(false)
    }
  }

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // Format duration
  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    if (m === 0) return `${s}s`
    return `${m}m ${s}s`
  }

  // Statistics
  const totalCount = queue.length
  const completedCount = queue.filter((i) => i.status === 'completed').length
  const failedCount = queue.filter((i) => i.status === 'failed').length
  const pendingCount = queue.filter((i) => i.status === 'pending').length
  const processingCount = queue.filter((i) => i.status === 'processing').length

  const batchPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  // Estimated batch remaining time
  const avgTimePerImage = completedCount > 0 && batchElapsedTime > 0 ? batchElapsedTime / completedCount : 0
  const estimatedBatchRemaining = Math.round(avgTimePerImage * (pendingCount + processingCount))

  // Filtered queue items
  const filteredQueue = queue.filter((item) => {
    if (filter === 'completed') return item.status === 'completed'
    if (filter === 'pending') return item.status === 'pending'
    if (filter === 'failed') return item.status === 'failed'
    return true
  })

  // Current processing item info
  const currentItem = queue.find((i) => i.status === 'processing')

  return (
    <div className="batch-page-container">
      <div className="batch-workspace-grid">
        {/* Left Column: Unified Configuration & Batch Controls */}
        <div className="md3-card batch-config-card">
          <div className="card-header">
            <h2 className="card-title">
              <Sliders size={20} color="var(--md-sys-color-primary)" />
              批量处理统一配置
            </h2>
            <span style={{ fontSize: '12px', color: 'var(--md-sys-color-primary)', fontWeight: 500 }}>
              {totalCount > 0 ? `队列共 ${totalCount} 张图片` : '统一参数应用于全部图片'}
            </span>
          </div>

          {/* Quick Presets */}
          <div className="field-group">
            <label className="field-label">
              <span>💡 批量变换快捷灵感预设</span>
            </label>
            <div className="chips-scroll">
              {BATCH_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`md3-chip ${prompt === p.prompt ? 'active' : ''}`}
                  onClick={() => setPrompt(p.prompt)}
                  disabled={isBatchRunning}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          {/* Positive Prompt */}
          <div className="field-group">
            <label className="field-label">
              <span>统一正向提示词 (Prompt)</span>
              <span style={{ fontSize: '11px', color: 'var(--md-sys-color-outline)' }}>
                适用于所有输入图片
              </span>
            </label>
            <div className="field-container">
              <textarea
                className="md3-textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="请输入想要统一应用于批量图片的变换指令（例如：将其转换为二次元唯美插画风格，细腻的线条与明丽的光影...）"
                rows={4}
                disabled={isBatchRunning}
              />
              <div className="field-footer">
                <span>每张图片将作为独立的图像参考输入</span>
                <span>{prompt.length} 字</span>
              </div>
            </div>
          </div>

          {/* Resolution Mode */}
          <div className="field-group">
            <label className="field-label">
              <span>输出比例与画幅 (Aspect Ratio)</span>
            </label>
            <div className="chips-scroll">
              {BATCH_RESOLUTIONS.map((res, i) => (
                <button
                  key={i}
                  type="button"
                  className={`md3-chip ${resolution.width === res.width && resolution.height === res.height ? 'active' : ''}`}
                  onClick={() => setResolution(res)}
                  disabled={isBatchRunning}
                >
                  {res.label}
                </button>
              ))}
            </div>
            {resolution.width === 0 && (
              <span style={{ fontSize: '11px', color: 'var(--md-sys-color-outline)', marginTop: '2px' }}>
                🌟 推荐模式：模型将自动测量并匹配每张原图的原始宽高比，无需手动裁剪缩放。
              </span>
            )}
          </div>

          {/* Inference Steps Slider */}
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
              disabled={isBatchRunning}
            />
          </div>

          {/* Advanced Accordion (Negative Prompt & Seed Strategy) */}
          <div className="field-group">
            <button
              type="button"
              className="accordion-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <Sliders size={16} />
              <span>高级设置 (负向提示词 / 随机种子策略)</span>
            </button>

            {showAdvanced && (
              <div className="accordion-body">
                {/* Negative Prompt */}
                <div className="field-group">
                  <label className="field-label">负向提示词 (Negative Prompt)</label>
                  <textarea
                    className="md3-textarea"
                    style={{ minHeight: '56px' }}
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="不希望在画面中出现的元素（如：blurry, low quality, distorted, watermark）..."
                    rows={2}
                    disabled={isBatchRunning}
                  />
                </div>

                {/* Seed Strategy */}
                <div className="field-group">
                  <label className="field-label">随机种子生成策略 (Seed Strategy)</label>
                  <div className="chips-scroll">
                    <button
                      type="button"
                      className={`md3-chip ${seedMode === 'random' ? 'active' : ''}`}
                      onClick={() => setSeedMode('random')}
                      disabled={isBatchRunning}
                    >
                      🎲 每张随机 (独立生成)
                    </button>
                    <button
                      type="button"
                      className={`md3-chip ${seedMode === 'increment' ? 'active' : ''}`}
                      onClick={() => setSeedMode('increment')}
                      disabled={isBatchRunning}
                    >
                      ➕ 步进递增 (种子 + 序号)
                    </button>
                    <button
                      type="button"
                      className={`md3-chip ${seedMode === 'fixed' ? 'active' : ''}`}
                      onClick={() => setSeedMode('fixed')}
                      disabled={isBatchRunning}
                    >
                      🔒 全部固定种子
                    </button>
                  </div>

                  {seedMode !== 'random' && (
                    <div className="seed-input-row" style={{ marginTop: '8px' }}>
                      <input
                        type="number"
                        className="md3-input"
                        placeholder={seedMode === 'increment' ? '起始种子数值 (默认 1000)' : '固定种子数值 (默认 42)'}
                        value={baseSeed}
                        onChange={(e) => setBaseSeed(e.target.value === '' ? '' : Number(e.target.value))}
                        disabled={isBatchRunning}
                      />
                      <button
                        type="button"
                        className="md3-chip"
                        onClick={() => setBaseSeed(Math.floor(Math.random() * 2147483647))}
                        disabled={isBatchRunning}
                      >
                        <RefreshCw size={13} /> 随机设定
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Batch Progress Dashboard (Active or Paused) */}
          {(isBatchRunning || isBatchPaused || completedCount > 0) && (
            <div className="batch-dashboard-card">
              <div className="batch-dashboard-header">
                <span className="batch-dashboard-title">
                  <Cpu size={16} />
                  {isBatchRunning
                    ? isBatchPaused
                      ? '批量任务已暂停'
                      : `正在处理第 ${completedCount + 1} / ${totalCount} 张图片`
                    : `批量任务已结束 (共完成 ${completedCount} 张)`}
                </span>
                <span className="batch-dashboard-percent">{batchPercent}%</span>
              </div>

              {/* Dual Progress Bars */}
              <div className="batch-progress-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--md-sys-color-on-surface-variant)' }}>
                  <span>总队列完成进度 ({completedCount}/{totalCount})</span>
                  <span>{batchPercent}%</span>
                </div>
                <div className="progress-track" style={{ height: '8px' }}>
                  <div
                    className="progress-bar"
                    style={{
                      width: `${Math.max(2, batchPercent)}%`,
                      backgroundColor: 'var(--md-sys-color-primary)',
                    }}
                  />
                </div>
              </div>

              {currentItem && (
                <div className="batch-progress-section" style={{ marginTop: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--md-sys-color-primary)' }}>
                    <span style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      当前: {currentItem.name} (Step {currentItem.step || currentProgress?.step || 0}/{steps})
                    </span>
                    <span>{currentItem.progress || currentProgress?.percent || 0}%</span>
                  </div>
                  <div className="progress-track" style={{ height: '6px' }}>
                    <div
                      className="progress-bar"
                      style={{
                        width: `${Math.max(5, currentItem.progress || currentProgress?.percent || 0)}%`,
                        backgroundColor: 'var(--md-sys-color-tertiary, #7d5260)',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Time Metrics */}
              <div className="batch-time-row">
                <span><Clock size={12} /> 任务总耗时: {formatDuration(batchElapsedTime)}</span>
                {isBatchRunning && !isBatchPaused && estimatedBatchRemaining > 0 && (
                  <span>预估剩余: ~{formatDuration(estimatedBatchRemaining)}</span>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons Row */}
          <div className="batch-action-controls">
            {!isBatchRunning ? (
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartBatch}
                disabled={totalCount === 0 || !prompt.trim() || isBusy}
                style={{ width: '100%' }}
              >
                <Play size={18} fill="currentColor" />
                <span>
                  {totalCount === 0
                    ? '请先添加待处理图片'
                    : pendingCount === 0 && completedCount > 0
                    ? '全部已完成 (可清空或添加更多)'
                    : `开始批量处理 (${pendingCount} 张待处理)`}
                </span>
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '10px', width: '100%' }}>
                {isBatchPaused ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleResumeBatch}
                    style={{ flex: 1 }}
                  >
                    <Play size={18} fill="currentColor" />
                    <span>继续处理</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handlePauseBatch}
                    style={{ flex: 1 }}
                    title="在当前图片生成完毕后暂停"
                  >
                    <Pause size={18} />
                    <span>暂停</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn-danger"
                  onClick={handleStopBatch}
                  disabled={isCancelling}
                  style={{ flex: 1 }}
                  title="中断当前生成并停止批量队列"
                >
                  <Square size={16} fill="currentColor" />
                  <span>{isCancelling ? '正在中断...' : '终止任务'}</span>
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--md-sys-color-outline)' }}>
            <Layers size={14} />
            <span>自动逐张顺序处理，严格互斥锁独占，内存与显存双重保护</span>
          </div>
        </div>

        {/* Right Column: Queue Management & Live Results Grid */}
        <div className="batch-queue-container">
          {/* Header Toolbar */}
          <div className="batch-queue-toolbar">
            <div className="batch-toolbar-left">
              <span className="batch-queue-title">
                <Layers size={18} color="var(--md-sys-color-primary)" />
                图片处理队列与结果看板
              </span>
              <div className="batch-stats-group">
                <span className="batch-stat-badge">总数: {totalCount}</span>
                {completedCount > 0 && (
                  <span className="batch-stat-badge success">已完成: {completedCount}</span>
                )}
                {pendingCount > 0 && (
                  <span className="batch-stat-badge warning">待处理: {pendingCount}</span>
                )}
                {failedCount > 0 && (
                  <span className="batch-stat-badge error">失败: {failedCount}</span>
                )}
              </div>
            </div>

            <div className="batch-toolbar-right">
              {failedCount > 0 && !isBatchRunning && (
                <button
                  type="button"
                  className="batch-tool-btn"
                  onClick={handleRetryAllFailed}
                  title="重新排队所有失败图片"
                >
                  <RefreshCw size={14} /> 重试失败项
                </button>
              )}

              {completedCount > 0 && (
                <button
                  type="button"
                  className="batch-tool-btn primary"
                  onClick={handleExportZip}
                  disabled={isExportingZip}
                  title="将所有已完成的生成图片打包为 ZIP 压缩包下载"
                >
                  <Archive size={14} />
                  <span>{isExportingZip ? '正在打包...' : `打包下载完成图 (${completedCount})`}</span>
                </button>
              )}

              <button
                type="button"
                className="batch-tool-btn"
                onClick={() => fileInputRef.current?.click()}
                title="选择更多图片加入队列"
              >
                <UploadCloud size={14} /> 添加图片
              </button>

              {totalCount > 0 && (
                <button
                  type="button"
                  className="batch-tool-btn danger"
                  onClick={handleClearQueue}
                  title="清空整个队列"
                >
                  <Trash2 size={14} /> 清空
                </button>
              )}
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                addFilesToQueue(e.target.files)
              }
              e.target.value = ''
            }}
          />

          {/* Filters Row */}
          {totalCount > 0 && (
            <div className="batch-filter-bar">
              <button
                type="button"
                className={`batch-filter-chip ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                全部 ({totalCount})
              </button>
              <button
                type="button"
                className={`batch-filter-chip ${filter === 'completed' ? 'active' : ''}`}
                onClick={() => setFilter('completed')}
              >
                已完成 ({completedCount})
              </button>
              <button
                type="button"
                className={`batch-filter-chip ${filter === 'pending' ? 'active' : ''}`}
                onClick={() => setFilter('pending')}
              >
                等待中 ({pendingCount})
              </button>
              {failedCount > 0 && (
                <button
                  type="button"
                  className={`batch-filter-chip error ${filter === 'failed' ? 'active' : ''}`}
                  onClick={() => setFilter('failed')}
                >
                  失败 ({failedCount})
                </button>
              )}
            </div>
          )}

          {/* Empty Dropzone State */}
          {totalCount === 0 ? (
            <div
              className={`batch-empty-dropzone ${isDragging ? 'dragging' : ''}`}
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
                  addFilesToQueue(e.dataTransfer.files)
                }
              }}
            >
              <div className="batch-dropzone-circle">
                <UploadCloud size={36} />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '8px 0 4px' }}>
                一次性选择或拖入大量图片
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--md-sys-color-outline)', maxWidth: 460, margin: 0 }}>
                支持多选文件、批量拖入或从剪贴板粘贴。系统将使用左侧设定的相同提示词与配置，全自动依次完成生成处理。
              </p>
              <button type="button" className="btn-primary" style={{ marginTop: '16px' }}>
                <UploadCloud size={16} /> 批量选择图片文件
              </button>
            </div>
          ) : (
            /* Queue Items Grid */
            <div
              className="batch-items-grid"
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  addFilesToQueue(e.dataTransfer.files)
                }
              }}
            >
              {filteredQueue.map((item, idx) => (
                <div
                  key={item.id}
                  className={`batch-card ${item.status}`}
                  onClick={() => {
                    if (item.status === 'completed') {
                      setActiveModalItem(item)
                    }
                  }}
                >
                  {/* Card Header */}
                  <div className="batch-card-header">
                    <span className="batch-card-index">#{idx + 1}</span>
                    <span className="batch-card-name" title={item.name}>
                      {item.name}
                    </span>
                    <span className="batch-card-size">{formatFileSize(item.size)}</span>
                    {item.status !== 'processing' && (
                      <button
                        type="button"
                        className="batch-card-remove-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveItem(item.id)
                        }}
                        title="从队列中移除"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  {/* Card Visual Body: Before -> After */}
                  <div className="batch-card-body">
                    {/* Left: Input Image */}
                    <div className="batch-img-thumb-wrapper">
                      <img src={item.previewUrl} alt={item.name} className="batch-img-thumb" />
                      <span className="batch-thumb-label">原图</span>
                    </div>

                    {/* Middle: Transform Indicator */}
                    <div className="batch-transform-arrow">
                      {item.status === 'processing' ? (
                        <div className="spinner" style={{ width: 18, height: 18 }} />
                      ) : item.status === 'completed' ? (
                        <Check size={18} color="var(--md-sys-color-success)" />
                      ) : item.status === 'failed' ? (
                        <AlertCircle size={18} color="var(--md-sys-color-error)" />
                      ) : (
                        <ArrowRight size={16} color="var(--md-sys-color-outline)" />
                      )}
                    </div>

                    {/* Right: Output Image / Status Placeholder */}
                    <div className="batch-img-thumb-wrapper">
                      {item.status === 'completed' && item.result ? (
                        <>
                          <img
                            src={item.result.url}
                            alt={`生成结果: ${item.name}`}
                            className="batch-img-thumb result"
                          />
                          <span className="batch-thumb-label success">已完成</span>
                        </>
                      ) : item.status === 'processing' ? (
                        <div className="batch-thumb-placeholder processing">
                          <div className="spinner" style={{ width: 22, height: 22 }} />
                          <span style={{ fontSize: '11px', marginTop: '4px', fontWeight: 500 }}>
                            {item.progress || currentProgress?.percent || 0}%
                          </span>
                        </div>
                      ) : item.status === 'failed' ? (
                        <div className="batch-thumb-placeholder failed">
                          <AlertCircle size={20} color="var(--md-sys-color-error)" />
                          <span style={{ fontSize: '10px', color: 'var(--md-sys-color-error)', marginTop: '2px' }}>
                            失败
                          </span>
                        </div>
                      ) : (
                        <div className="batch-thumb-placeholder pending">
                          <Clock size={18} color="var(--md-sys-color-outline)" />
                          <span style={{ fontSize: '10px', color: 'var(--md-sys-color-outline)', marginTop: '2px' }}>
                            排队中
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Card Status & Actions Bar */}
                  <div className="batch-card-footer">
                    <div className="batch-card-status-text">
                      {item.status === 'completed' ? (
                        <span style={{ color: 'var(--md-sys-color-success)', fontSize: '11px', fontWeight: 500 }}>
                          耗时: {item.elapsed || item.result?.elapsed || 0}s
                        </span>
                      ) : item.status === 'processing' ? (
                        <span style={{ color: 'var(--md-sys-color-primary)', fontSize: '11px', fontWeight: 500 }}>
                          采样中 (Step {item.step || currentProgress?.step || 0}/{steps})
                        </span>
                      ) : item.status === 'failed' ? (
                        <span style={{ color: 'var(--md-sys-color-error)', fontSize: '11px' }} title={item.error}>
                          {item.error ? (item.error.length > 18 ? item.error.slice(0, 18) + '...' : item.error) : '失败'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--md-sys-color-outline)', fontSize: '11px' }}>
                          等待处理
                        </span>
                      )}
                    </div>

                    <div className="batch-card-actions">
                      {item.status === 'completed' && item.result && (
                        <>
                          <button
                            type="button"
                            className="batch-mini-action-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              setActiveModalItem(item)
                            }}
                            title="查看原图与生成图大图对比"
                          >
                            <Eye size={13} />
                          </button>
                          <a
                            href={item.result.url}
                            download={`${item.name.replace(/\.[^/.]+$/, "")}_qwen.png`}
                            className="batch-mini-action-btn"
                            onClick={(e) => e.stopPropagation()}
                            title="下载生成图片"
                          >
                            <Download size={13} />
                          </a>
                        </>
                      )}

                      {item.status === 'failed' && (
                        <button
                          type="button"
                          className="batch-mini-action-btn retry"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRetryItem(item.id)
                          }}
                          title="重新加入队列重试"
                        >
                          <RefreshCw size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comparison & Details Dialog for Batch Items */}
      {activeModalItem && activeModalItem.result && (
        <div className="modal-overlay" onClick={() => setActiveModalItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <h3 className="modal-title">批量图片处理对比详情</h3>
                <span style={{ fontSize: '12px', color: 'var(--md-sys-color-outline)' }}>
                  原文件: {activeModalItem.name}
                </span>
                <span className="reference-badge" style={{ fontSize: '11px' }}>
                  耗时: {activeModalItem.result.elapsed}s
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setActiveModalItem(null)}
                title="关闭"
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {/* Image Comparison Pane */}
              <div className="batch-modal-compare-pane">
                <div className="batch-compare-card">
                  <div className="batch-compare-label">原图 (Original)</div>
                  <img
                    src={activeModalItem.previewUrl}
                    alt={activeModalItem.name}
                    className="batch-compare-img"
                  />
                </div>
                <div className="batch-compare-card">
                  <div className="batch-compare-label success">生成结果 (Qwen-Image)</div>
                  <img
                    src={activeModalItem.result.url}
                    alt={activeModalItem.result.prompt}
                    className="batch-compare-img"
                  />
                </div>
              </div>

              {/* Details Pane */}
              <div className="modal-details-pane">
                <div>
                  <div className="modal-section-title">
                    <span>应用的提示词 (Prompt)</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(activeModalItem.result!.prompt)
                        setModalCopied(true)
                        setTimeout(() => setModalCopied(false), 2000)
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        background: 'none',
                        border: 'none',
                        color: 'var(--md-sys-color-primary)',
                      }}
                    >
                      {modalCopied ? <Check size={12} /> : <Copy size={12} />}
                      <span>{modalCopied ? '已复制' : '复制'}</span>
                    </button>
                  </div>
                  <div className="modal-text-box">
                    {activeModalItem.result.prompt}
                  </div>
                </div>

                {activeModalItem.result.negative_prompt && (
                  <div>
                    <div className="modal-section-title">
                      <span>负向提示词 (Negative Prompt)</span>
                    </div>
                    <div className="modal-text-box" style={{ fontSize: '12px', color: 'var(--md-sys-color-on-surface-variant)' }}>
                      {activeModalItem.result.negative_prompt}
                    </div>
                  </div>
                )}

                <div>
                  <div className="modal-section-title">
                    <span>生成参数</span>
                  </div>
                  <div className="modal-param-grid">
                    <div className="modal-param-card">
                      <span className="modal-param-label">输出尺寸</span>
                      <span className="modal-param-value">
                        {activeModalItem.result.width} × {activeModalItem.result.height}
                      </span>
                    </div>
                    <div className="modal-param-card">
                      <span className="modal-param-label">推理步数</span>
                      <span className="modal-param-value">{activeModalItem.result.steps} 步</span>
                    </div>
                    <div className="modal-param-card">
                      <span className="modal-param-label">随机种子</span>
                      <span className="modal-param-value">{activeModalItem.result.seed ?? '随机'}</span>
                    </div>
                    <div className="modal-param-card">
                      <span className="modal-param-label">生成耗时</span>
                      <span className="modal-param-value">{activeModalItem.result.elapsed}s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="modal-footer-actions-left">
                <a
                  href={activeModalItem.result.url}
                  download={`${activeModalItem.name.replace(/\.[^/.]+$/, "")}_qwen.png`}
                  className="md3-chip"
                  style={{ textDecoration: 'none' }}
                  title="下载单张生成图片"
                >
                  <Download size={14} /> 下载结果图片
                </a>
              </div>
              <div className="modal-footer-actions-right">
                <button
                  type="button"
                  className="btn-remix"
                  onClick={() => {
                    onRemixToStudio(
                      activeModalItem.result!.prompt,
                      activeModalItem.result!.negative_prompt,
                      activeModalItem.result!.input_image_url
                    )
                    setActiveModalItem(null)
                  }}
                  title="将此提示词与参考图载入单图创作室"
                >
                  <Sparkles size={16} />
                  <span>载入创作室 (Remix)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
