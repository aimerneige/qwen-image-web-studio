export interface TaskProgress {
  task_id?: string
  status: string
  message: string
  step: number
  total_steps: number
  percent: number
  elapsed?: number
  eta?: number
  batch_index?: number
  batch_total?: number
}

export interface UploadedImage {
  id: string
  url: string
  name: string
}

export interface ImageResult {
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
  batch_index?: number
  batch_total?: number
  is_batch_end?: boolean
}

export interface Resolution {
  label: string
  width: number
  height: number
}

export interface BatchItem {
  id: string
  file: File
  previewUrl: string
  name: string
  size: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  step: number
  totalSteps: number
  elapsed?: number
  error?: string
  result?: ImageResult
}
