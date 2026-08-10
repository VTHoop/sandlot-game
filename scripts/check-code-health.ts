// Enforces the whole-repo code-health floor in .codescene-thresholds against
// CodeScene's latest full analysis of main.
// Run from workspace root: pnpm codescene:check [--refresh]
//
// This is the absolute half of the code-health gate. The CodeScene PR bot judges a
// change *relative* to main (Code Health Decline, Low Code Health in New Code); it
// stays green while the repo slides downward one acceptable PR at a time. This checks
// the aggregate itself, so that slide fails a build.
//
// --refresh triggers a fresh analysis of main and waits for it. Without it the check
// grades whatever analysis CodeScene last happened to run, which has been as stale as
// six weeks — use --refresh anywhere the result gates something.
//
// Exit codes: 0 pass · 1 below threshold · 2 misconfigured or unreachable.
import { readFile } from 'node:fs/promises'

// The project is fixed for this repo. Deliberately not configurable: an env-supplied id
// would flow into the request URL, which is a genuine SSRF taint path for one knob
// nobody needs. A fork edits this line.
const PROJECT_URL = 'https://api.codescene.io/v2/projects/81097'

// A full analysis of this repo completes in well under a minute; the ceiling is here so
// a wedged job fails the build instead of hanging it.
const POLL_INTERVAL_MS = 10_000
const POLL_TIMEOUT_MS = 600_000

// Without --refresh the scores can predate main by weeks. A stale analysis that *passes*
// is the dangerous case, so surface the age rather than trusting a green result blindly.
const STALE_ANALYSIS_DAYS = 14
const MS_PER_DAY = 86_400_000

interface Thresholds {
  average_code_health: number
  hotspot_code_health: number
}

interface Scores {
  average: number
  hotspot: number
}

interface AnalysisRecord {
  id: number
  analysedAt: Date | null
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(2)
}

function asObject(value: unknown, subject: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    fail(`Unexpected API shape: ${subject} is not an object`)
  }
  return value as Record<string, unknown>
}

function parseThresholds(raw: string): Thresholds {
  const parsed = asObject(JSON.parse(raw), '.codescene-thresholds')
  const { average_code_health, hotspot_code_health } = parsed as Partial<Thresholds>
  if (typeof average_code_health !== 'number' || typeof hotspot_code_health !== 'number') {
    fail('.codescene-thresholds must define numeric average_code_health and hotspot_code_health')
  }
  return { average_code_health, hotspot_code_health }
}

// Takes the metric value, not its key: reading it out by literal name at the call site
// keeps this off the computed-member-access path Codacy flags as an injection sink.
function scoreOf(metric: unknown, label: string): number {
  const now = asObject(metric, label).now
  if (typeof now !== 'number') {
    fail(`Unexpected API shape: ${label}.now is not a number`)
  }
  return now
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Wraps the project's endpoints in domain methods so callers pass intent rather than
// threading a token and a URL fragment through every call.
function codeSceneProject(token: string) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  async function send(url: string, method: string): Promise<unknown> {
    const response = await fetch(url, { method, headers })
    if (!response.ok) {
      fail(`${method} ${url} returned HTTP ${response.status}. Check CS_ACCESS_TOKEN.`)
    }
    return response.json()
  }

  async function currentScores(): Promise<Scores> {
    const payload = asObject(await send(PROJECT_URL, 'GET'), 'project response')
    const analysis = asObject(payload.analysis, 'analysis')
    return {
      average: scoreOf(analysis.code_health, 'code_health'),
      hotspot: scoreOf(analysis.hotspot_code_health, 'hotspot_code_health'),
    }
  }

  async function latestAnalysis(): Promise<AnalysisRecord | null> {
    const payload = asObject(await send(`${PROJECT_URL}/analyses`, 'GET'), 'analyses response')
    const analyses = payload.analyses
    if (!Array.isArray(analyses) || analyses.length === 0) return null
    const newest = asObject(analyses.at(0), 'analysis record')
    if (typeof newest.id !== 'number') return null
    const time = typeof newest.analysistime === 'string' ? new Date(newest.analysistime) : null
    return {
      id: newest.id,
      analysedAt: time !== null && !Number.isNaN(time.getTime()) ? time : null,
    }
  }

  async function scheduleAnalysis(): Promise<number> {
    const payload = asObject(await send(`${PROJECT_URL}/run-analysis`, 'POST'), 'run-analysis')
    if (typeof payload.id !== 'number') {
      fail('Unexpected API shape: run-analysis returned no analysis id')
    }
    return payload.id
  }

  // Waits for the triggered analysis specifically, rather than for a generic "ok" status —
  // a concurrent analysis flipping the project status would otherwise read as ours.
  async function awaitAnalysis(target: number): Promise<void> {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS)
      const latest = await latestAnalysis()
      if (latest?.id === target) return
    }
    fail(`Analysis ${target} did not finish within ${POLL_TIMEOUT_MS / 60_000} minutes.`)
  }

  return { currentScores, latestAnalysis, scheduleAnalysis, awaitAnalysis }
}

function reportAge(analysis: AnalysisRecord | null): void {
  const analysedAt = analysis?.analysedAt ?? null
  if (analysedAt === null) {
    console.log('Last full analysis: unknown')
    return
  }
  const ageDays = (Date.now() - analysedAt.getTime()) / MS_PER_DAY
  const stamp = analysedAt.toISOString().slice(0, 10)
  console.log(`Last full analysis: ${stamp} (${Math.floor(ageDays)}d ago)`)
  if (ageDays > STALE_ANALYSIS_DAYS) {
    console.warn(
      `⚠ That analysis predates the ${STALE_ANALYSIS_DAYS}-day freshness window — these scores may not reflect current main.`,
    )
  }
}

function compare(label: string, actual: number, floor: number): boolean {
  const passed = actual >= floor
  console.log(
    `${passed ? '✓' : '✗'} ${label}: ${actual.toFixed(2)} ${passed ? '≥' : '<'} ${floor.toFixed(2)} floor`,
  )
  return passed
}

const token = process.env.CS_ACCESS_TOKEN
if (!token) {
  fail('CS_ACCESS_TOKEN is not set. Create one at https://codescene.io/users/me/pat')
}

// Literal path: pnpm runs scripts from the workspace root, as `pnpm emit-grid` also assumes.
const thresholds = parseThresholds(await readFile('.codescene-thresholds', 'utf8'))
const project = codeSceneProject(token)

if (process.argv.includes('--refresh')) {
  const scheduled = await project.scheduleAnalysis()
  console.log(`Analysis ${scheduled} scheduled — waiting for it to finish…`)
  await project.awaitAnalysis(scheduled)
}

const scores = await project.currentScores()
reportAge(await project.latestAnalysis())

const averageOk = compare('Average code health', scores.average, thresholds.average_code_health)
const hotspotOk = compare('Hotspot code health', scores.hotspot, thresholds.hotspot_code_health)

if (!averageOk || !hotspotOk) {
  console.error(
    '\nCode health fell below the committed floor. Fix the code — never lower .codescene-thresholds to go green.',
  )
  process.exit(1)
}

console.log('\nCode health holds the floor.')
