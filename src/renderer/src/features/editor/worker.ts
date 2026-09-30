/// <reference lib="webworker" />
import { renderEdit } from '@shared/edit/pipeline'
import type { PhotoEdit } from '@shared/edit/types'

export interface WorkerRequest {
  id: number
  buf: Uint8ClampedArray
  w: number
  h: number
  edit: PhotoEdit
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, buf, w, h, edit } = ev.data
  renderEdit(buf, w, h, 4, edit)
  ;(self as unknown as Worker).postMessage({ id, buf, w, h }, [buf.buffer])
}
