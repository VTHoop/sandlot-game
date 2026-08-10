// Enforces the whole-repo code-health floor in .codescene-thresholds against
// CodeScene's latest full analysis of main.
// Run from workspace root: CS_ACCESS_TOKEN=… pnpm codescene:check [--refresh]
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

const API_BASE = 'https://api.codescene.io/v2'
const DEFAULT_PROJECT_ID = '81097'
const THRESHOLDS_PATH = new URL('../.codescene-thresholds', import.meta.url)

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

interface Analysis {
  average: number
  hotspot: number
}

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(2)
}

function parseThresholds(raw: string): Thresholds {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    fail('.codescene-thresholds is not a JSON object')
  }
  const { average_code_health, hotspot_code_health } = parsed as Partial<Thresholds>
  if (typeof average_code_health !== 'number' || typeof hotspot_code_health !== 'number') {
    fail('.codescene-thresholds must define numeric average_code_health and hotspot_code_health')
  }
  return { average_code_health, hotspot_code_health }
}

async function get(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    fail(`GET ${path} returned HTTP ${response.status}. Check CS_ACCESS_TOKEN and the project id.`)
  }
  return response.json()
}

async function post(path: string, token: string): Promise<unknown> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    fail(`POST ${path} returned HTTP ${response.status}.`)
  }
  return response.json()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseScheduledId(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) {
    fail('Unexpected API shape: run-analysis response is not an object')
  }
  const id = (payload as { id?: unknown }).id
  if (typeof id !== 'number') {
    fail('Unexpected API shape: run-analysis returned no analysis id')
  }
  return id
}

function parseLatestAnalysisId(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const analyses = (payload as { analyses?: unknown }).analyses
  if (!Array.isArray(analyses) || analyses.length === 0) return null
  const id = (analyses.at(0) as { id?: unknown }).id
  return typeof id === 'number' ? id : null
}

// Polls for the triggered analysis specifically, rather than for a generic "ok" status —
// a concurrent analysis flipping the project status would otherwise read as ours.
async function awaitAnalysis(projectId: string, token: string, target: number): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const latest = parseLatestAnalysisId(await get(`/projects/${projectId}/analyses`, token))
    if (latest === target) return
  }
  fail(`Analysis ${target} did not finish within ${POLL_TIMEOUT_MS / 60_000} minutes.`)
}

function readScore(source: unknown, field: string): number {
  if (typeof source !== 'object' || source === null) {
    fail(`Unexpected API shape: ${field} is missing`)
  }
  const now = (source as { now?: unknown }).now
  if (typeof now !== 'number') {
    fail(`Unexpected API shape: ${field}.now is not a number`)
  }
  return now
}

function parseAnalysis(payload: unknown): Analysis {
  if (typeof payload !== 'object' || payload === null) {
    fail('Unexpected API shape: project response is not an object')
  }
  const analysis = (payload as { analysis?: unknown }).analysis
  if (typeof analysis !== 'object' || analysis === null) {
    fail('Unexpected API shape: no analysis on the project response')
  }
  const { code_health, hotspot_code_health } = analysis as {
    code_health?: unknown
    hotspot_code_health?: unknown
  }
  return {
    average: readScore(code_health, 'code_health'),
    hotspot: readScore(hotspot_code_health, 'hotspot_code_health'),
  }
}

function parseLatestAnalysisTime(payload: unknown): Date | null {
  if (typeof payload !== 'object' || payload === null) return null
  const analyses = (payload as { analyses?: unknown }).analyses
  if (!Array.isArray(analyses) || analyses.length === 0) return null
  const time = (analyses.at(0) as { analysistime?: unknown }).analysistime
  if (typeof time !== 'string') return null
  const parsed = new Date(time)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function reportAge(analysedAt: Date | null): void {
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
  const mark = passed ? '✓' : '✗'
  const verb = passed ? '≥' : '<'
  console.log(`${mark} ${label}: ${actual.toFixed(2)} ${verb} ${floor.toFixed(2)} floor`)
  return passed
}

const token = process.env.CS_ACCESS_TOKEN
if (!token) {
  fail('CS_ACCESS_TOKEN is not set. Create one at https://codescene.io/users/me/pat')
}

const projectId = process.env.CS_PROJECT_ID ?? DEFAULT_PROJECT_ID
const thresholds = parseThresholds(await readFile(THRESHOLDS_PATH, 'utf8'))

if (process.argv.includes('--refresh')) {
  const scheduled = parseScheduledId(await post(`/projects/${projectId}/run-analysis`, token))
  console.log(`Analysis ${scheduled} scheduled — waiting for it to finish…`)
  await awaitAnalysis(projectId, token, scheduled)
}

const analysis = parseAnalysis(await get(`/projects/${projectId}`, token))
reportAge(parseLatestAnalysisTime(await get(`/projects/${projectId}/analyses`, token)))

const averageOk = compare('Average code health', analysis.average, thresholds.average_code_health)
const hotspotOk = compare('Hotspot code health', analysis.hotspot, thresholds.hotspot_code_health)

if (!averageOk || !hotspotOk) {
  console.error(
    '\nCode health fell below the committed floor. Fix the code — never lower .codescene-thresholds to go green.',
  )
  process.exit(1)
}

console.log('\nCode health holds the floor.')
