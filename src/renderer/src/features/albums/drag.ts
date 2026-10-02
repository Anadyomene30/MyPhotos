export const DRAG_MIME = 'application/x-myphotos-assets'

export function readDraggedIds(dt: DataTransfer): number[] | null {
  const raw = dt.getData(DRAG_MIME)
  if (!raw) return null
  try {
    const ids = JSON.parse(raw) as unknown
    return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === 'number') : null
  } catch {
    return null
  }
}

/** Small "stack" drag image with a count badge. */
export function setDragImage(dt: DataTransfer, thumbUrl: string | null, n: number): void {
  const el = document.createElement('div')
  el.style.cssText = 'position:fixed;top:-200px;left:-200px;width:72px;height:72px;border-radius:10px;overflow:visible;'
  el.innerHTML = `
    <div style="position:absolute;inset:0;border-radius:var(--dh-radius-card);background:var(--tile) ${thumbUrl ? `url('${thumbUrl}') center/cover` : ''};border:2px solid var(--dh-elevated)"></div>
    ${n > 1 ? `<div style="position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;padding:0 6px;border-radius:var(--dh-radius-pill);background:var(--dh-accent);color:var(--dh-on-label);font:700 12px -apple-system,Segoe UI,sans-serif;display:grid;place-items:center">${n}</div>` : ''}`
  document.body.appendChild(el)
  dt.setDragImage(el, 36, 36)
  setTimeout(() => el.remove(), 0)
}
