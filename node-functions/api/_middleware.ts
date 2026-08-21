import type { NextFunction, Request, Response } from 'express'
import { verifyAuthToken } from './_utils'
import { reply } from './_reply'

// 简单的速率限制器（内存版，serverless 多实例下为尽力而为的防护）
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
  // 内容安全策略：本服务只返回 JSON 与图片，使用最严格策略
  // （X-XSS-Protection 已废弃，不再设置）
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  )
  next()
}
