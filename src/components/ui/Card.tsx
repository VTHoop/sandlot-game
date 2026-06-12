import type { HTMLAttributes } from 'react'

/** A dusk-surface panel: the standard container for grouped duel content. */
export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-(--radius-tile) border border-edge bg-surface ${className}`}
      {...rest}
    />
  )
}
