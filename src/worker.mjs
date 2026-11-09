// Follows the Omarchy theme: builds Orca's colors from the current Omarchy theme and applies them
// with appearance.apply. Watches ~/.local/state/omarchy/current, where omarchy-theme-set swaps the
// `theme` folder in and writes `theme.name` last.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const CURRENT = join(homedir(), '.local/state/omarchy/current')
const THEME = join(CURRENT, 'theme')
const OMARCHY_PATH = process.env.OMARCHY_PATH || '/usr/share/omarchy'
const THEME_COLOR = join(OMARCHY_PATH, 'bin/omarchy-theme-color')
const ARTIFACT_LIMIT = 16000 // Orca refuses artifacts over 16 KiB
const GROUPS = ['sidebar', 'tabs', 'chat', 'links', 'diff', 'git', 'charts', 'syntax', 'terminal']
const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const ANSI_KEYS = [...ANSI, ...ANSI.map((k) => 'bright' + k[0].toUpperCase() + k.slice(1))]

// Orca does not tell workers its UI language; the system locale is what Orca follows by default.
const MESSAGES = {
  en: {
    paused: (n) => `${n} (paused)`,
    pausedTip: 'Omarchy: following is off. Turn it on in Settings → Plugins → Omarchy.',
    pausedResult: 'Following the Omarchy theme is off',
    unchanged: (n) => `No changes (${n})`,
    summary: (n, t, r, b) => `${n}: ${t} app colors, ${r} syntax rules, ${b}`,
    appliedTip: (s) => `Omarchy: ${s}. Click to reapply.`,
    applied: (s) => `Applied ${s}`,
    failedTip: (m) => `Omarchy: could not apply (${m}). Click to try again.`,
    failedResult: (m) => `Could not apply: ${m}`,
    followOff: 'Stopped following the Omarchy theme',
    followOn: 'Following the Omarchy theme'
  },
  pt: {
    paused: (n) => `${n} (pausado)`,
    pausedTip: 'Omarchy: acompanhamento desligado. Ligue em Configurações → Plugins → Omarchy.',
    pausedResult: 'O acompanhamento do tema do Omarchy está desligado',
    unchanged: (n) => `Sem mudanças (${n})`,
    summary: (n, t, r, b) => `${n}: ${t} cores de interface, ${r} regras de sintaxe, ${b === 'dark' ? 'escuro' : 'claro'}`,
    appliedTip: (s) => `Omarchy: ${s}. Clique para reaplicar.`,
    applied: (s) => `Aplicado ${s}`,
    failedTip: (m) => `Omarchy: não aplicou (${m}). Clique para tentar de novo.`,
    failedResult: (m) => `Não aplicou: ${m}`,
    followOff: 'Acompanhamento do tema do Omarchy desligado',
    followOn: 'Acompanhamento do tema do Omarchy ligado'
  }
}
const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || 'en'
const T = MESSAGES[locale.toLowerCase().startsWith('pt') ? 'pt' : 'en']

let orca = null
let watcher = null
let timer = null
let poll = null
let retries = 0
let lastApplied = null // app+terminal of the last successful apply
let lastSeen = null // theme.name + theme.generation last seen
const disposables = []

const isHex = (v) => typeof v === 'string' && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)
const read = (p) => readFileSync(p, 'utf8')
const tryRead = (p) => { try { return read(p) } catch { return null } }
const themeStamp = () => `${(tryRead(join(CURRENT, 'theme.name')) || '').trim()}|${(tryRead(join(CURRENT, 'theme.generation')) || '').trim()}`

// Palette resolved by Omarchy itself (aliases, color0..15, mode); falls back to reading colors.toml.
function palette() {
  return new Promise((resolve) => {
    if (!existsSync(THEME_COLOR)) return resolve(parseColorsToml())
    execFile(THEME_COLOR, ['--all'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve(parseColorsToml())
      const p = {}
      for (const line of stdout.split('\n')) {
        const i = line.indexOf('\t')
        if (i > 0) p[line.slice(0, i)] = line.slice(i + 1).trim()
      }
      resolve(p)
    })
  })
}

function parseColorsToml() {
  const p = {}
  for (const line of read(join(THEME, 'colors.toml')).split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']([^"']*)["']/)
    if (m) p[m[1]] = m[2]
  }
  if (!p.mode) p.mode = p.theme_type
  if (!p.mode) {
    if (existsSync(join(THEME, 'light.mode'))) p.mode = 'light'
    else if (/^#[0-9a-f]{6}$/i.test(p.background || '')) {
      const n = parseInt(p.background.slice(1), 16)
      p.mode = ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255) > 382 ? 'light' : 'dark'
    } else p.mode = 'dark'
  }
  const ghostty = tryRead(join(THEME, 'ghostty.conf')) || ''
  for (const line of ghostty.split('\n')) {
    const m = line.match(/^\s*palette\s*=\s*(\d+)\s*=\s*#?([0-9a-f]{6})/i)
    if (m && +m[1] < 16 && !p['color' + m[1]]) p['color' + m[1]] = '#' + m[2].toLowerCase()
  }
  return p
}

function build(p, vs, cfg) {
  const c = (...keys) => { for (const k of keys) if (isHex(p[k])) return p[k]; return p.foreground }
  const vc = vs.colors || {}
  const v = (key, ...fallback) => (isHex(vc[key]) ? vc[key] : c(...fallback))
  if (!isHex(p.background) || !isHex(p.foreground)) throw new Error('theme has no background/foreground')

  const bg = p.background, fg = p.foreground, accent = c('accent', 'blue')
  const dark = c('dark_background', 'background'), darker = c('darker_background', 'dark_background', 'background')
  const lighter = c('lighter_background', 'selection'), sel = c('selection', 'lighter_background')
  const muted = c('muted', 'dark_foreground'), bright = c('bright_foreground', 'foreground')
  const [red, green, yellow, cyan, magenta] = ['red', 'green', 'yellow', 'cyan', 'magenta'].map((k) => c(k))
  const alpha = (hex, a) => hex.slice(0, 7) + a

  const tokens = {
    '--background': bg, '--editor-surface': bg, '--foreground': fg,
    '--card': dark, '--card-foreground': fg,
    '--popover': lighter, '--popover-foreground': fg,
    '--primary': accent, '--primary-foreground': darker,
    '--secondary': sel, '--secondary-foreground': c('light_foreground', 'foreground'),
    '--muted': dark, '--muted-foreground': muted,
    '--accent': lighter, '--accent-foreground': fg,
    '--border': sel, '--input': sel, '--ring': accent,
    '--sidebar': dark, '--sidebar-foreground': fg, '--sidebar-border': sel
  }
  const extra = {
    sidebar: {
      '--sidebar-primary': accent, '--sidebar-primary-foreground': darker,
      '--sidebar-accent': lighter, '--sidebar-accent-foreground': fg, '--sidebar-ring': accent,
      '--worktree-sidebar': dark, '--worktree-sidebar-foreground': fg,
      '--worktree-sidebar-accent': lighter, '--worktree-sidebar-accent-foreground': fg,
      '--worktree-sidebar-border': sel, '--worktree-sidebar-ring': accent,
      '--worktree-sidebar-active': sel, '--worktree-sidebar-active-border': accent,
      '--host-badge': lighter, '--host-badge-foreground': accent
    },
    tabs: {
      '--tab-bar': dark, '--tab-active': bg, '--tab-active-foreground': fg,
      '--tab-active-indicator': accent, '--tab-inactive': dark, '--tab-inactive-foreground': muted,
      '--split-divider': sel, '--split-divider-hover': accent
    },
    chat: {
      '--chat-user-message': lighter, '--chat-bold-foreground': bright,
      '--chat-muted-foreground': muted, '--chat-inline-code': lighter,
      '--chat-inline-code-foreground': v('textPreformat.foreground', 'cyan'),
      '--chat-code-block': dark, '--chat-selection': sel, '--chat-selection-foreground': fg
    },
    links: { '--text-link': v('textLink.foreground', 'accent') },
    diff: {
      '--diff-added': green, '--diff-added-background': alpha(green, '26'),
      '--diff-added-emphasis': alpha(green, '55'), '--diff-added-gutter': green,
      '--diff-removed': red, '--diff-removed-background': alpha(red, '26'),
      '--diff-removed-emphasis': alpha(red, '55'), '--diff-removed-gutter': red
    },
    git: {
      '--git-decoration-added': v('gitDecoration.addedResourceForeground', 'green'),
      '--git-decoration-modified': v('gitDecoration.modifiedResourceForeground', 'yellow'),
      '--git-decoration-deleted': v('gitDecoration.deletedResourceForeground', 'red'),
      '--git-decoration-renamed': v('gitDecoration.renamedResourceForeground', 'cyan'),
      '--git-decoration-untracked': v('gitDecoration.untrackedResourceForeground', 'green'),
      '--git-decoration-copied': cyan,
      '--git-decoration-ignored': v('gitDecoration.ignoredResourceForeground', 'muted')
    },
    charts: { '--chart-1': accent, '--chart-2': green, '--chart-3': yellow, '--chart-4': magenta, '--chart-5': cyan }
  }
  for (const [group, values] of Object.entries(extra)) if (cfg[group]) Object.assign(tokens, values)

  const base = cfg.mode === 'dark' || cfg.mode === 'light' ? cfg.mode : p.mode === 'light' ? 'light' : 'dark'
  const app = { schemaVersion: 1, base, tokens }
  if (cfg.syntax) {
    const styleOk = /^(?:(?:italic|bold|underline|strikethrough)(?: (?:italic|bold|underline|strikethrough))*)?$/
    const rules = []
    for (const rule of vs.tokenColors || []) {
      let scope = rule.scope
      const st = rule.settings || {}
      if (typeof scope === 'string') scope = scope.split(',').map((s) => s.trim()).filter(Boolean)
      if (!Array.isArray(scope) || !scope.length) continue
      const settings = {}
      if (isHex(st.foreground)) settings.foreground = st.foreground
      const fs = typeof st.fontStyle === 'string' ? st.fontStyle.trim() : ''
      if (fs && styleOk.test(fs)) settings.fontStyle = fs
      if (Object.keys(settings).length) rules.push({ scope: scope.slice(0, 64), settings })
    }
    if (rules.length) app.tokenColors = rules
  }
  let appText = JSON.stringify(app)
  while (Buffer.byteLength(appText) > ARTIFACT_LIMIT && app.tokenColors?.length) {
    app.tokenColors.pop() // drop trailing syntax rules until it fits
    appText = JSON.stringify(app)
  }

  const term = { foreground: fg, background: bg, cursor: c('cursor', 'accent'), selectionBackground: c('selection_background', 'selection') }
  if (isHex(p.selection_foreground)) term.selectionForeground = p.selection_foreground
  ANSI_KEYS.forEach((k, i) => {
    if ((cfg.terminal || i === 0) && isHex(p['color' + i])) term[k] = p['color' + i]
  })
  if (!term.black) term.black = darker // Orca needs at least one ANSI color

  return {
    app: appText,
    terminal: JSON.stringify({ schemaVersion: 1, mode: base, terminal: term }),
    base,
    tokens: Object.keys(tokens).length,
    rules: app.tokenColors?.length || 0
  }
}

async function settings() {
  const s = (await orca.settings.get()) || {}
  const cfg = { follow: s.follow !== false, mode: typeof s.mode === 'string' ? s.mode : 'auto' }
  for (const g of GROUPS) cfg[g] = s[g] !== false
  return cfg
}

async function status(patch) {
  try { await orca.host.call('statusBar.update', { id: 'theme', ...patch }) } catch (e) { orca.log(`statusBar: ${e?.message || e}`) }
}

async function applyNow(force) {
  const cfg = await settings()
  const name = (tryRead(join(CURRENT, 'theme.name')) || '').trim() || 'omarchy'
  if (!cfg.follow) {
    await status({ text: T.paused(name), tone: 'neutral', tooltip: T.pausedTip })
    return T.pausedResult
  }
  let vs = {}
  try { vs = JSON.parse(read(join(THEME, 'vscode-theme.json'))) } catch { /* theme without a VS Code file: base colors only */ }
  const out = build(await palette(), vs, cfg)
  const key = out.app + '\n' + out.terminal
  if (!force && key === lastApplied) return T.unchanged(name)

  for (let attempt = 1; ; attempt++) {
    const { revision } = await orca.host.call('appearance.read')
    try {
      await orca.host.call('appearance.apply', { expectedRevision: revision, app: out.app, terminal: out.terminal })
      break
    } catch (e) {
      if (e?.code !== 'conflict' || attempt >= 3) throw e
    }
  }
  lastApplied = key
  lastSeen = themeStamp()
  orca.log(`applied ${name}: ${out.tokens} tokens, ${out.rules} syntax rules, ${out.base}`)
  const summary = T.summary(name, out.tokens, out.rules, out.base)
  await status({ text: name, tone: 'neutral', tooltip: T.appliedTip(summary) })
  return T.applied(summary)
}

// Coalesces event bursts; retries when the theme is mid-switch (a file is missing).
function schedule(force = false, delay = 250) {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      await applyNow(force)
      retries = 0
    } catch (e) {
      const msg = e?.message || String(e)
      if (retries++ < 5) {
        orca.log(`attempt ${retries} failed (${msg}); retrying`)
        schedule(force, 500 * retries)
      } else {
        retries = 0
        orca.log(`failed: ${msg}`)
        await status({ tone: 'warning', tooltip: T.failedTip(msg) })
      }
    }
  }, delay)
}

function startWatcher() {
  try {
    watcher = watch(CURRENT, (_event, file) => {
      if (!file || file === 'theme.name' || file === 'theme' || file === 'theme.generation') schedule()
    })
    watcher.on('error', (e) => {
      orca.log(`watcher: ${e?.message || e}; recreating`)
      watcher?.close()
      watcher = null
      setTimeout(startWatcher, 5000)
    })
  } catch (e) {
    orca.log(`watch unavailable (${e?.message || e}); relying on the periodic check`)
  }
}

export default async function activate(api) {
  orca = api
  disposables.push(
    orca.commands.register('omarchy.reapply', async () => {
      try { return await applyNow(true) } catch (e) { return T.failedResult(e?.message || e) }
    }),
    orca.commands.register('omarchy.toggleFollow', async () => {
      const cfg = await settings()
      await orca.settings.set('follow', !cfg.follow)
      return cfg.follow ? T.followOff : T.followOn
    }),
    orca.settings.onDidChange(() => schedule(true, 100))
  )
  orca.log(`started; locale ${locale}`)
  startWatcher()
  // Safety net in case a watcher event is lost.
  poll = setInterval(() => { if (themeStamp() !== lastSeen) schedule() }, 30000)
  schedule(false, 0) // covers theme switches made while Orca was closed
}

export function deactivate() {
  clearTimeout(timer)
  clearInterval(poll)
  watcher?.close()
  for (const d of disposables.splice(0)) { try { d.dispose() } catch { /* already disposed */ } }
}
