/** Minimal concurrency limiter with LIFO option (newest request first, useful for on-demand thumbnails while scrolling). */
export function limiter(concurrency: number, opts: { lifo?: boolean } = {}) {
  let active = 0
  const queue: Array<() => void> = []
  const next = (): void => {
    if (active >= concurrency) return
    const job = opts.lifo ? queue.pop() : queue.shift()
    if (!job) return
    active++
    job()
  }
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--
          next()
        })
      })
      next()
    })
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function throttle(fn: () => void, ms: number): () => void {
  let timer: NodeJS.Timeout | null = null
  let pending = false
  return () => {
    if (timer) {
      pending = true
      return
    }
    fn()
    timer = setTimeout(function tick() {
      if (pending) {
        pending = false
        fn()
        timer = setTimeout(tick, ms)
      } else timer = null
    }, ms)
  }
}

export function bytesLabel(n: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${Math.round(v * 10) / 10} ${units[i]}`
}
