import { Button } from '../../components/ui/Button'
import { DuelSeat, SeatKind, type SeatKinds } from './seatAgent'

const SEAT_LABEL = new Map<DuelSeat, string>([
  [DuelSeat.Pitcher, 'PITCHER'],
  [DuelSeat.Batter, 'BATTER'],
])
const KIND_LABEL = new Map<SeatKind, string>([
  [SeatKind.Human, 'HUMAN'],
  [SeatKind.Bot, 'BOT'],
])
// A literal array (not an object index) to iterate the two kinds — keeps the map
// off the object-injection sink, matching the roster/adapter convention.
const KIND_OPTIONS: readonly SeatKind[] = [SeatKind.Human, SeatKind.Bot]

interface SeatControlsProps {
  seats: SeatKinds
  onChange: (seat: DuelSeat, kind: SeatKind) => void
}

function SeatRow({
  seat,
  current,
  onChange,
}: {
  seat: DuelSeat
  current: SeatKind
  onChange: (seat: DuelSeat, kind: SeatKind) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-body text-[11px] tracking-[0.18em] text-muted uppercase">
        {SEAT_LABEL.get(seat)}
      </span>
      <div className="flex gap-1">
        {KIND_OPTIONS.map((kind) => (
          <Button
            key={kind}
            variant={current === kind ? 'consequence' : 'surface'}
            aria-pressed={current === kind}
            aria-label={`Set ${seat} to ${kind}`}
            className="px-3 py-1 text-[11px]"
            onClick={() => {
              onChange(seat, kind)
            }}
          >
            {KIND_LABEL.get(kind)}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * Per-seat human/bot selector for the PLAY tab (SAN-48). Each seat is set
 * independently, so the same control covers human-vs-human (hotseat), human-vs-bot,
 * and bot-vs-bot. Changing a seat re-seeds the half-inning with the new fill.
 */
export function SeatControls({ seats, onChange }: SeatControlsProps) {
  return (
    <div className="flex flex-col gap-1.5 border-edge border-b px-5 py-3">
      <SeatRow seat={DuelSeat.Pitcher} current={seats[DuelSeat.Pitcher]} onChange={onChange} />
      <SeatRow seat={DuelSeat.Batter} current={seats[DuelSeat.Batter]} onChange={onChange} />
    </div>
  )
}
