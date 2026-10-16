// Match cali_valid_push_endpoint. Add a provider only after verifying its ownership.
export function isAllowedPushEndpoint(endpoint: string): boolean {
  if (endpoint.length > 2048 || Array.from(endpoint).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return false
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false
    return ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(url.hostname)
      || /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
  } catch { return false }
}

export async function sendPushRequest(details: { endpoint: string; headers: Record<string, string>; body: Uint8Array | null }, fetcher: typeof fetch = fetch, timeoutMs = 8000) {
  if (!isAllowedPushEndpoint(details.endpoint)) throw new Error('Unsupported push endpoint')
  const response = await fetcher(details.endpoint, {
    method: 'POST', headers: details.headers, body: details.body ? new Uint8Array(details.body) : null,
    redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
  })
  // No notification response body is needed; do not buffer arbitrary remote content.
  void response.body?.cancel().catch(() => undefined)
  if (!response.ok) throw Object.assign(new Error('Push service rejected delivery'), {
    statusCode: response.status, headers: { 'retry-after': response.headers.get('retry-after') ?? '' },
  })
}

export async function processBatch<T>(items: T[], process: (item: T) => Promise<void>, concurrency = 4) {
  let next = 0
  const errors: unknown[] = []
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      try { await process(items[next++]) } catch (error) { errors.push(error) }
    }
  }))
  if (errors.length) throw errors[0]
}
