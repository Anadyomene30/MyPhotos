/**
 * The household folder, as LesDaguesHautes' spec/01-comptes-et-foyer.md describes it (§ 4, 5, 5 bis, 6).
 * Ported from the launcher (Passage, src-tauri/src/foyer.rs) as product-owned code.
 *
 * Rule n° 1 of the spec: no file of the household folder is written by two devices. MyPhotos writes
 * `foyer.json` once (when it creates the household), the profile of a member it creates, and its own
 * `appareils/<device_id>.json`. Nothing else: the library and the originals stay on this machine (§ 11).
 *
 * The household is optional. Without it MyPhotos works exactly as before; the launcher's machine-wide
 * pre-setting is only a proposal, never required.
 */
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { Db } from './db'
import { t } from '@shared/i18n'
import type { HouseholdFolder, HouseholdMember, HouseholdStatus } from '@shared/types'

/** Product name in the household folder, as produits/catalogue.json gives it. */
export const HOUSEHOLD_APP = 'myphotos'

/** Object heads drawn by the house (design/DIRECTION-ARTISTIQUE.md, rule 6). The list is open: a profile may carry another one. */
export const MEMBER_OBJECTS = ['fleur', 'lampe', 'theiere', 'pavillon', 'globe'] as const

/** profil.json as written on disk (§ 4). Unknown fields are kept when MyPhotos rewrites nothing but its own files. */
export interface Profile {
  member_id: string
  name: string
  objet: string
  avatar?: string
  archived_at?: string
  created_at: string
  updated_at: string
}

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

/** Names macOS leaves on non-Mac volumes and network shares (`._x` doubles, `.DS_Store`): never household data (§ 6). */
export const isNoise = (name: string): boolean => name.startsWith('._') || name === '.DS_Store'

/** Write next to the target, then rename: the file is the old one or the new one, never half. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n')
  await rename(tmp, file)
}

/**
 * iCloud Drive replaces a file not downloaded yet by `.<name>.icloud`. Ask for it (macOS) and report it missing for now:
 * the next read finds it.
 */
function requestDownload(file: string): void {
  if (process.platform !== 'darwin') return
  const placeholder = join(dirname(file), `.${basename(file)}.icloud`)
  if (existsSync(placeholder)) execFile('brctl', ['download', file], () => undefined)
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = JSON.parse(await readFile(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') requestDownload(file)
    return null
  }
}

function toProfile(v: Record<string, unknown> | null): Profile | null {
  if (!v || typeof v.member_id !== 'string' || !v.member_id || typeof v.name !== 'string') return null
  return {
    ...(v as unknown as Profile),
    objet: typeof v.objet === 'string' ? v.objet : '',
    created_at: typeof v.created_at === 'string' ? v.created_at : '',
    updated_at: typeof v.updated_at === 'string' ? v.updated_at : ''
  }
}

export const toMember = (p: Profile): HouseholdMember => ({ id: p.member_id, name: p.name, objet: p.objet })

export async function readProfile(dir: string, memberId: string): Promise<Profile | null> {
  if (!/^[\w-]{1,64}$/.test(memberId)) return null
  return toProfile(await readJson(join(dir, 'membres', memberId, 'profil.json')))
}

/** The household of a folder: its name and its members (archived ones hidden, § 13). */
export async function readHousehold(dir: string): Promise<HouseholdFolder & { profiles: Profile[] }> {
  const foyer = await readJson(join(dir, 'foyer.json'))
  const profiles: Profile[] = []
  const entries = await readdir(join(dir, 'membres'), { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (isNoise(e.name) || e.name.startsWith('.') || !e.isDirectory()) continue
    const p = await readProfile(dir, e.name)
    if (p && !p.archived_at && p.member_id === e.name) profiles.push(p)
  }
  profiles.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.name.localeCompare(b.name))
  return {
    exists: foyer !== null,
    name: typeof foyer?.name === 'string' ? foyer.name : null,
    members: profiles.map(toMember),
    profiles
  }
}

export async function createHousehold(dir: string, name: string): Promise<void> {
  const file = join(dir, 'foyer.json')
  if (existsSync(file)) throw new Error(t('Ce dossier a déjà un foyer.'))
  await writeJsonAtomic(file, { format: 1, foyer_id: randomUUID(), name: name.trim(), created_at: now() })
}

export async function createMember(dir: string, name: string, objet: string): Promise<Profile> {
  const n = name.trim().slice(0, 40)
  if (!n) throw new Error(t('Il faut un prénom.'))
  if (!/^[a-z]{1,24}$/.test(objet)) throw new Error(t('Objet inconnu.'))
  const at = now()
  const p: Profile = { member_id: randomUUID(), name: n, objet, created_at: at, updated_at: at }
  await writeJsonAtomic(join(dir, 'membres', p.member_id, 'profil.json'), p)
  return p
}

/** Same values as the launcher writes (Rust's std::env::consts::OS). */
export function osName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : platform
}

let cachedMachine: string | undefined
export function machineName(): string {
  if (cachedMachine) return cachedMachine
  if (process.platform === 'darwin') {
    try {
      const n = execFileSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 }).trim()
      if (n) return (cachedMachine = n)
    } catch {
      /* fall through */
    }
  }
  return (cachedMachine = process.env.COMPUTERNAME || hostname().replace(/\.local$/, '') || 'cet ordinateur')
}

export async function writeDevice(dir: string, deviceId: string, memberId: string, name = machineName()): Promise<void> {
  await writeJsonAtomic(join(dir, 'appareils', `${deviceId}.json`), {
    device_id: deviceId,
    member_id: memberId,
    app: HOUSEHOLD_APP,
    name,
    os: osName(),
    last_seen: now()
  })
}

// ── the launcher's machine-wide pre-setting (§ 5 bis): read, never written by an app ──

/** `app.getPath('appData')` without Electron: ~/Library/Application Support on macOS, %APPDATA% on Windows. */
export function defaultAppDataDir(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support')
  if (platform === 'win32') return env.APPDATA ?? join(home, 'AppData', 'Roaming')
  return env.XDG_CONFIG_HOME ?? join(home, '.config')
}

export const presetFile = (appDataDir: string): string => join(appDataDir, 'LesDaguesHautes', 'foyer.local.json')

export async function readPreset(file: string): Promise<{ dir: string; memberId: string } | null> {
  const v = await readJson(file)
  if (!v || v.format !== 1 || typeof v.foyer_dir !== 'string' || typeof v.member_id !== 'string' || !v.foyer_dir || !v.member_id) return null
  return { dir: v.foyer_dir, memberId: v.member_id }
}

// ── this installation's state, in the `settings` table (§ 4: never in the household folder) ──

const K = { dir: 'foyer_dir', member: 'member_id', device: 'device_id', name: 'foyer_name', members: 'foyer_members', seen: 'foyer_seen_at', owner: 'owner_name' } as const

export interface HouseholdHost {
  db: Db
  setting(key: string): string | null
  setSetting(key: string, value: string | null): void
}

export class Household {
  constructor(private host: HouseholdHost, private preset: string | null = null) {}

  get dir(): string | null {
    return this.host.setting(K.dir)
  }
  get memberId(): string | null {
    return this.host.setting(K.member)
  }
  get deviceId(): string | null {
    return this.host.setting(K.device)
  }
  get joined(): boolean {
    return Boolean(this.dir && this.memberId)
  }

  /** Members as last read from the folder, so guests still see them while the folder is out of reach. */
  members(): HouseholdMember[] {
    if (!this.joined) return []
    try {
      const v: unknown = JSON.parse(this.host.setting(K.members) ?? '[]')
      return Array.isArray(v) ? (v as HouseholdMember[]) : []
    } catch {
      return []
    }
  }

  member(id: string | null | undefined): HouseholdMember | null {
    return id ? (this.members().find((m) => m.id === id) ?? null) : null
  }

  /** Re-read the folder. Keeps the member list, the household name and owner_name in step with the profiles. */
  async refresh(): Promise<boolean> {
    const dir = this.dir
    if (!dir || !this.memberId) return false
    if (!(await stat(join(dir, 'foyer.json')).then((s) => s.isFile(), () => false))) return false
    const h = await readHousehold(dir)
    if (!h.exists) return false
    this.host.setSetting(K.members, JSON.stringify(h.members))
    this.host.setSetting(K.name, h.name)
    this.host.setSetting(K.seen, String(Date.now()))
    const me = h.members.find((m) => m.id === this.memberId)
    if (me && me.name && me.name !== this.host.setting(K.owner)) this.host.setSetting(K.owner, me.name)
    return true
  }

  async status(): Promise<HouseholdStatus> {
    const reachable = await this.refresh()
    const seen = this.host.setting(K.seen)
    let preset: HouseholdStatus['preset'] = null
    if (!this.joined && this.preset) {
      const p = await readPreset(this.preset)
      const h = p ? await readHousehold(p.dir).catch(() => null) : null
      const m = h?.exists ? h.members.find((x) => x.id === p!.memberId) : undefined
      if (p && m) preset = { dir: p.dir, member: m }
    }
    return {
      joined: this.joined,
      dir: this.joined ? this.dir : null,
      name: this.joined ? this.host.setting(K.name) : null,
      me: this.joined ? (this.member(this.memberId) ?? null) : null,
      reachable,
      seenAt: seen ? Number(seen) : null,
      preset
    }
  }

  /** Attach this installation to a member (§ 5, step 3), then migrate the existing data (§ 10). */
  async join(dir: string, memberId: string): Promise<HouseholdStatus> {
    if (!isAbsolute(dir)) throw new Error(t('Dossier invalide.'))
    const h = await readHousehold(dir)
    if (!h.exists) throw new Error(t('Ce dossier n’a pas encore de foyer.'))
    const me = h.profiles.find((p) => p.member_id === memberId)
    if (!me) throw new Error(t('Ce membre n’est pas dans le foyer.'))
    // a device_id never changes member (§ 3, rule 4): another member gets a new one
    let device = this.deviceId
    if (!device || this.memberId !== memberId) device = randomUUID()
    await writeDevice(dir, device, memberId)
    this.host.setSetting(K.device, device)
    this.host.setSetting(K.member, memberId)
    this.host.setSetting(K.dir, dir)
    this.host.setSetting(K.owner, me.name)
    claimUnownedAlbums(this.host.db, memberId)
    return this.status()
  }

  /** Forget the folder. The member and device stay, so joining again as the same member reuses the same device file. */
  leave(): void {
    this.host.setSetting(K.dir, null)
    this.host.setSetting(K.members, null)
    this.host.setSetting(K.name, null)
    this.host.setSetting(K.seen, null)
  }

  /** At startup: say this device is alive (`last_seen`), and pick up profile changes. Silent when the folder is away. */
  async touch(): Promise<void> {
    const dir = this.dir
    const member = this.memberId
    const device = this.deviceId
    if (!dir || !member || !device) return
    if (!(await this.refresh().catch(() => false))) return
    await writeDevice(dir, device, member).catch(() => undefined)
  }
}

/**
 * spec/01 § 10: on attaching, the data already there becomes the joining member's, all `perso`.
 * Only albums without an owner are claimed: see docs/REMONTEES.md, MYPHOTOS-02, for an installation that changes member.
 */
export function claimUnownedAlbums(db: Db, memberId: string): number {
  return Number(db.prepare("UPDATE albums SET owner_id = ?, visibility = 'perso', shared_with = '[]' WHERE owner_id IS NULL").run(memberId).changes)
}
