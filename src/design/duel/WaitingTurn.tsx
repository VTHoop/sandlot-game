import { Scoreboard } from '../../components/ui/Scoreboard'
import { DuelChrome } from './DuelChrome'
import { FieldDiagram } from './FieldDiagram'
import { SHOWCASE_SCENARIO } from './fixture'
import { formatInning } from './scenario'

/** The async between-turns state: calm, ambient, no actions to take. */
export function WaitingTurn() {
  const scenario = SHOWCASE_SCENARIO
  return (
    <DuelChrome
      situation={
        <>
          <b className="text-consequence">{scenario.opponent}</b> is picking her pitch
        </>
      }
      opponent={scenario.opponent}
      opponentOnline
    >
      <div className="relative flex flex-1 flex-col items-center gap-6 px-5 pt-6 pb-5">
        <span className="duel-firefly top-32 left-8" />
        <span className="duel-firefly top-52 right-10" style={{ animationDelay: '3s' }} />
        <span className="duel-firefly bottom-24 left-14" style={{ animationDelay: '6s' }} />
        <Scoreboard
          away={{
            label: scenario.opponent.slice(0, 3).toUpperCase(),
            runs: scenario.scoreBefore.opp,
            hits: scenario.hitsBefore.opp,
          }}
          home={{
            label: 'YOU',
            runs: scenario.scoreBefore.you,
            hits: scenario.hitsBefore.you,
          }}
          inning={formatInning(scenario)}
          outs={scenario.outs}
        />
        <FieldDiagram />
        <p className="font-display text-xl tracking-wider text-chalk">
          IT&rsquo;S {scenario.opponent.toUpperCase()}&rsquo;S TURN
        </p>
        <p className="flex items-center gap-2 text-center font-body text-sm text-muted">
          <span className="duel-waiting-pulse size-2 rounded-full bg-consequence" />
          We&rsquo;ll nudge you when it&rsquo;s your swing
        </p>
      </div>
    </DuelChrome>
  )
}
