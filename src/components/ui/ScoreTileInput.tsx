import { useEffect, useRef } from 'react'

const sanitize = (raw: string) => raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, 4)

interface ScoreTileInputProps {
  value: string
  onChange: (next: string) => void
  label: string
  disabled?: boolean
  /**
   * Move focus to this entry when it mounts — used when a seat-transition remount
   * should hand the keyboard to the fresh entry so keyboard users aren't dropped
   * to the document body. Imperative (a ref + effect), not the native `autoFocus`
   * attribute, so it never fires on first page load.
   */
  focusOnMount?: boolean
}

/**
 * Duel-number entry on the scoreboard tile, driven by the device's numeric
 * keyboard (ADR-0014) — never a raw-looking input, never spinners.
 */
export function ScoreTileInput({
  value,
  onChange,
  label,
  disabled = false,
  focusOnMount = false,
}: ScoreTileInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusOnMount && !disabled) inputRef.current?.focus()
  }, [focusOnMount, disabled])

  return (
    <label className="flex flex-col items-center gap-1.5">
      <span className="font-body text-[11px] tracking-[0.22em] text-muted uppercase">{label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="· · ·"
        disabled={disabled}
        value={value}
        onChange={(event) => {
          onChange(sanitize(event.target.value))
        }}
        className="w-36 appearance-none rounded-(--radius-tile) border border-edge bg-surface px-3 py-1 text-center font-display text-4xl tracking-wider text-chalk transition-colors placeholder:text-muted focus:border-chalk focus:outline-none disabled:opacity-40"
      />
    </label>
  )
}
