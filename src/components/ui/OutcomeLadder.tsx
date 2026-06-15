import { OUTCOME_BAND_KEYS } from '@sandlot/engine/outcomes'

/** The fixed best→worst outcome strip, sourced from the engine's band names so
 * the UI never drifts from the resolver (single source of truth). */
export const OUTCOME_LADDER = OUTCOME_BAND_KEYS

export type OutcomeKey = (typeof OUTCOME_LADDER)[number]

const HIT_OUTCOMES: ReadonlySet<OutcomeKey> = new Set(['HR', '3B', '2B', '1B', 'IF1B'])

const SHORT_LABELS = new Map<OutcomeKey, string>([['IF1B', 'IF']])

interface OutcomeLadderProps {
  highlight?: OutcomeKey | null
}

/** The fixed best→worst outcome strip; hits read amber, the rest chalk-muted. */
export function OutcomeLadder({ highlight = null }: OutcomeLadderProps) {
  return (
    <ol className="flex gap-1 font-body text-[10px]">
      {OUTCOME_LADDER.map((outcome) => {
        const tone = HIT_OUTCOMES.has(outcome) ? 'text-consequence' : 'text-muted'
        const emphasis =
          outcome === highlight
            ? 'border-consequence bg-consequence font-bold text-surface'
            : `border-edge-dim bg-surface ${tone}`
        return (
          <li
            key={outcome}
            aria-current={outcome === highlight ? 'true' : undefined}
            className={`flex-1 rounded-xs border py-1 text-center ${emphasis}`}
          >
            {SHORT_LABELS.get(outcome) ?? outcome}
          </li>
        )
      })}
    </ol>
  )
}
