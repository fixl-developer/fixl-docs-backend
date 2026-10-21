import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const isConfigured =
  process.env.UPSTASH_REDIS_REST_URL &&
  !process.env.UPSTASH_REDIS_REST_URL.startsWith('https://your-redis')

const noop = { limit: async () => ({ success: true }) } as unknown as Ratelimit

function makeLimiter(prefix: string, limit: number, window: string): Ratelimit {
  if (!isConfigured) return noop
  const redis = Redis.fromEnv()
  return new Ratelimit({
    redis,
    limiter: Ratelimit.fixedWindow(limit, window as Parameters<typeof Ratelimit.fixedWindow>[1]),
    analytics: true,
    prefix,
  })
}

export const uploadLimiter = makeLimiter('htmldrop:upload', 5, '60 m')
export const viewLimiter   = makeLimiter('htmldrop:view',   100, '1 m')
