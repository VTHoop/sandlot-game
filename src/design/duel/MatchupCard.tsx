import { AttributePips } from '../../components/ui/AttributePips'
import { Card } from '../../components/ui/Card'

export interface MatchupSide {
  /** First initial + last name, e.g. "M. SLOANE". */
  name: string
  attrs: Readonly<Record<string, number>>
}

interface MatchupCardProps {
  pitcher: MatchupSide
  batter: MatchupSide
  dueUp: readonly string[]
}

function SideBlock({ side }: { side: MatchupSide }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-body text-[10px] tracking-wider text-chalk">{side.name}</span>
      {Object.entries(side.attrs).map(([label, value]) => (
        <AttributePips key={label} label={label} value={value} />
      ))}
    </div>
  )
}

/** The duel context: who's throwing, who's swinging, and who's coming up. */
export function MatchupCard({ pitcher, batter, dueUp }: MatchupCardProps) {
  return (
    <Card className="flex flex-1 flex-col gap-2 px-3 py-2.5">
      <SideBlock side={pitcher} />
      <hr className="border-edge border-t border-dashed" />
      <SideBlock side={batter} />
      <div className="mt-auto flex flex-col gap-0.5">
        <span className="font-body text-[10px] tracking-[0.15em] text-muted">DUE UP</span>
        {dueUp.map((name) => (
          <span key={name} className="font-body text-[10px] tracking-wider text-chalk">
            {name}
          </span>
        ))}
      </div>
    </Card>
  )
}
