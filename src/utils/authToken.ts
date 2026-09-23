// 前端 token 过期预判：只读 payload 里的 exp，不校验 HMAC 签名（签名只在服务端校验）
export function isTokenLive(token: string): boolean {
  try {
    const payload = token.split('.')[0]
    if (!payload) return false
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof data.exp === 'number' && data.exp > Date.now()
  } catch {
    // 解析失败（如旧的 open-access 占位 token）：交给服务端判定，不在前端拦截
    return true
  }
}
