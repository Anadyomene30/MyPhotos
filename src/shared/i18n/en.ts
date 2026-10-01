/** English dictionary, split by area so translations can be added in parallel. Keys are the exact French strings. */
import { app } from './en/app'
import { common } from './en/common'
import { pages } from './en/pages'
import { server } from './en/server'
import { tools } from './en/tools'
import { viewer } from './en/viewer'

export const en: Record<string, string> = {
  ...common,
  ...app,
  ...viewer,
  ...tools,
  ...pages,
  ...server
}
