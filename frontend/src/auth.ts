const TOKEN_KEY = 'qwen_studio_auth_token'

export function getAuthToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || ''
  } catch {
    return ''
  }
}

export function setAuthToken(token: string): void {
  try {
    if (token && token.trim()) {
      localStorage.setItem(TOKEN_KEY, token.trim())
    } else {
      localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    // 忽略 localStorage 不可用情况
  }
}

export function clearAuthToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

export async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAuthToken()
  const headers = new Headers(init?.headers || {})

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  })

  // 当收到 401 状态码时，向全局发送鉴权失效事件
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:unauthorized'))
  }

  return response
}

export function getStreamUrl(): string {
  const token = getAuthToken()
  if (token) {
    return `/api/stream?token=${encodeURIComponent(token)}`
  }
  return '/api/stream'
}

export function getAuthorizedUrl(url: string): string {
  if (!url) return url
  const token = getAuthToken()
  if (!token || !url.startsWith('/outputs/')) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(token)}`
}
