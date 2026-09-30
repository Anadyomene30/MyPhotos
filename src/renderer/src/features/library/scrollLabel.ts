import { create } from 'zustand'

/** Title of the group under the toolbar while scrolling, shown in the toolbar. */
export const useScrollLabel = create<{ label: string | null; set(l: string | null): void }>((set) => ({
  label: null,
  set: (label) => set((s) => (s.label === label ? s : { label }))
}))
