import type { GameContext } from '@sandlot/engine/game'
import type { Roster } from './roster'

interface DuelPlayProps {
  roster?: Roster
  context?: GameContext
}

// TODO(SAN-47): implemented in the green commit.
export function DuelPlay(_props: DuelPlayProps = {}) {
  return null
}
