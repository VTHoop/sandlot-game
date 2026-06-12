import { useState } from 'react'
import { Button } from '../components/ui/Button'
import { DuelCommit } from './duel/DuelCommit'
import { SHOWCASE_SCENARIO } from './duel/fixture'
import { RevealMotion } from './duel/RevealMotion'
import { WaitingTurn } from './duel/WaitingTurn'
import './duel.css'

export { SHOWCASE_SCENARIO }

const TABS = [
  { id: 'pitcher', label: 'PITCHER' },
  { id: 'batter', label: 'BATTER' },
  { id: 'reveal', label: 'REVEAL' },
  { id: 'waiting', label: 'WAITING' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function DesignShowcase() {
  const [tab, setTab] = useState<TabId>('pitcher')
  const [replayKey, setReplayKey] = useState(0)

  return (
    <main className="min-h-dvh px-4 py-8 font-body">
      <h1 className="text-center font-display text-2xl tracking-wider text-chalk">
        SANDLOT — THE DUEL
      </h1>
      <p className="text-center text-sm text-muted">
        Parked design showcase · not wired into the app
      </p>
      <nav aria-label="Duel states" className="flex justify-center gap-2 py-5">
        {TABS.map(({ id, label }) => (
          <Button
            key={id}
            variant={tab === id ? 'consequence' : 'surface'}
            aria-pressed={tab === id}
            className="px-4 py-2 text-xs"
            onClick={() => {
              setTab(id)
            }}
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="mx-auto flex h-[680px] w-85 flex-col overflow-hidden rounded-3xl border-4 border-black/60 bg-linear-to-b from-canvas-high to-canvas shadow-2xl">
        {tab === 'pitcher' && (
          <DuelCommit seat="pitcher" opponentLocked={false} opponentOnline={false} />
        )}
        {tab === 'batter' && (
          <DuelCommit
            seat="batter"
            opponentLocked
            opponentOnline
            onReveal={() => {
              setTab('reveal')
            }}
          />
        )}
        {tab === 'reveal' && (
          <RevealMotion
            key={replayKey}
            scenario={SHOWCASE_SCENARIO}
            onReplay={() => {
              setReplayKey((k) => k + 1)
            }}
          />
        )}
        {tab === 'waiting' && <WaitingTurn />}
      </div>
    </main>
  )
}
