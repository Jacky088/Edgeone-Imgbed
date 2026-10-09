import type { NextFunction, Request, Response } from 'express'
import { getStore, type Store, type StoreOptions } from '@edgeone/pages-blob'
import { verifyAuthToken } from './_utils'
import { reply } from './_reply'

// 简单的速率限制器：内存版为第一层快路径；安全敏感接口（登录/上传）另加
// Blob 存储共享计数层（跨实例生效）。图片代理等高频路径仅用内存版即可。
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

// 获取可信客户端 IP：
// 1) 优先 EdgeOne 边缘注入的 EO-Client-IP（由平台覆盖，不可伪造）
// 2) 其次取 X-Forwarded-For 最右侧条目（由平台代理追加；左侧条目客户端可随意伪造）
// 3) 最后回退到 socket 地址（本地开发场景）
function getClientIp(req: Request): string {
  const eoIpRaw = req.headers['eo-client-ip']
  const eoIp = Array.isArray(eoIpRaw) ? eoIpRaw[0] : eoIpRaw
  if (typeof eoIp === 'string' && eoIp.trim()) return eoIp.trim()

  const xffRaw = req.headers['x-forwarded-for']
  const xff = Array.isArray(xffRaw) ? xffRaw.join(',') : xffRaw
  if (typeof xff === 'string' && xff.trim()) {
    const ips = xff.split(',').map((s) => s.trim()).filter(Boolean)
    if (ips.length > 0) return ips[ips.length - 1]
  }

  return req.socket?.remoteAddress || 'unknown'
}

// 速率限制中间件
export function rateLimiter(maxRequests: number = 20, windowMs: number = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req)
    const now = Date.now()

    const record = rateLimitMap.get(ip)

    if (!record || now > record.resetTime) {
      // 新记录或已过期
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs })
      // 惰性清理过期记录（serverless 中 setInterval 不可靠且会阻止实例回收）
      if (rateLimitMap.size > 500) {
        for (const [key, rec] of rateLimitMap) {
          if (now > rec.resetTime) rateLimitMap.delete(key)
        }
      }
      return next()
    }

    if (record.count >= maxRequests) {
      return res.status(429).json(reply(429, '请求过于频繁，请稍后再试', null))
    }

    record.count++
    next()
  }
}

// ---------------------------------------------------------------- 共享限流层

// 共享计数存储的最小接口（便于测试注入假实现）
export interface SharedWindowStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

// Blob 存储单例（惰性创建；Store 不可用或操作失败时自动降级为纯内存限流）
let sharedStore: Store | null | undefined
function getSharedStore(): Store | null {
  if (sharedStore !== undefined) return sharedStore
  try {
    // strong 一致性：读后写可见，保证跨实例计数尽量准确
    // 注：SDK 的 d.ts 将 projectId/token 标为必填，但运行时在 Pages 部署凭据下二者均可省略
    sharedStore = getStore({ name: 'imgbed-rl', consistency: 'strong' } as StoreOptions)
  } catch {
    sharedStore = null
  }
  return sharedStore
}

// 注入式转义：非 [a-zA-Z0-9] 字符 → _x{十六进制}x。原始字符不含 _，
// 转义序列以 _ 开头且定界，保证不同输入（如 IPv4 的 1.2 与 IPv6 片段）不碰撞
export function sanitizeLimitKey(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, (ch) => `_x${ch.charCodeAt(0).toString(16)}x`)
}

/**
 * 共享固定窗口限流器工厂：本地内存为第一层快路径（命中即拒，省一次存储往返），
 * Blob 存储为跨实例权威计数层；存储异常时降级为纯内存（与旧版行为一致）。
 * 注意：存储侧为读改写计数，并发下可能轻微少计（限流场景可接受）。
 */
export function createSharedWindowLimiter(store: SharedWindowStore | null) {
  const memMap = new Map<string, { count: number; resetTime: number }>()

  function memBump(key: string, windowMs: number, now: number) {
    const rec = memMap.get(key)
    if (!rec || now > rec.resetTime) {
      memMap.set(key, { count: 1, resetTime: now + windowMs })
      // 惰性清理过期记录，防止长期运行下 Map 无限膨胀
      if (memMap.size > 500) {
        for (const [k, r] of memMap) {
          if (now > r.resetTime) memMap.delete(k)
        }
      }
      return
    }
    rec.count++
  }

  return async function isLimited(
    bucketKey: string,
    maxRequests: number,
    windowMs: number = 60000,
  ): Promise<boolean> {
    const now = Date.now()
    const windowId = Math.floor(now / windowMs)
    const memKey = `${windowId}:${bucketKey}`

    // 内存快路径：本实例已超限直接拒绝（内存计数只会比全局少，超限判定不会误放行）
    const mem = memMap.get(memKey)
    if (mem && now <= mem.resetTime && mem.count >= maxRequests) return true

    if (!store) {
      memBump(memKey, windowMs, now)
      return false
    }

    const kvKey = `rl${sanitizeLimitKey(bucketKey)}${windowId}`
    try {
      const raw = await store.get(kvKey)
      const count = typeof raw === 'number' ? raw : Number(raw) || 0
      if (count >= maxRequests) {
        memBump(memKey, windowMs, now)
        return true
      }
      await store.set(kvKey, String(count + 1))
      memBump(memKey, windowMs, now)
      // 新窗口首次写入时顺手清理上一窗口的 key，避免共享存储中 rl* 键无限累积
      if (count === 0) {
        store.delete(`rl${sanitizeLimitKey(bucketKey)}${windowId - 1}`).catch(() => {})
      }
      return false
    } catch {
      // 存储不可用：降级为纯内存限流（尽力而为，与旧行为一致）
      memBump(memKey, windowMs, now)
      return false
    }
  }
}

// 生产单例：登录/上传等安全敏感接口使用（跨实例共享计数）
export const sharedLimiter = createSharedWindowLimiter(
  ((): SharedWindowStore | null => {
    const store = getSharedStore()
    if (!store) return null
    return {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, String(value)),
      delete: (key) => store.delete(key),
    }
  })(),
)

// 共享限流中间件：与 rateLimiter 同参，但计数跨实例共享
export function sharedRateLimiter(maxRequests: number, windowMs: number = 60000) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = getClientIp(req)
    if (await sharedLimiter(`${ip}/${req.baseUrl || ''}${req.path}`, maxRequests, windowMs)) {
      return res.status(429).json(reply(429, '请求过于频繁，请稍后再试', null))
    }
    next()
  }
}

// 身份验证中间件：校验 HMAC 签名 token
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const sysPassword = process.env.SITE_PASSWORD

  // 如果未设置密码，则不需要验证
  if (!sysPassword) {
    return next()
  }

  // 检查 Authorization header
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json(reply(401, '未授权访问', null))
  }

  const token = authHeader.substring(7)

  if (verifyAuthToken(token)) {
    return next()
  }

  return res.status(401).json(reply(401, '无效的访问令牌', null))
}

// 安全头中间件（仅作用于 /api 响应：JSON 与代理图片，不涉及前端静态页）
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  // 防止点击劫持
  res.setHeader('X-Frame-Options', 'DENY')
  // 防止 MIME 类型嗅探
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // HTTPS 强制
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  // 内容安全策略：本服务只返回 JSON 与图片，使用最严格策略与沙箱防护
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; sandbox; frame-ancestors 'none'; base-uri 'none'",
  )
  next()
}

export { getClientIp }
