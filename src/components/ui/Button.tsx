import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'consequence' | 'surface' | 'ghost'

const base =
  'inline-flex select-none items-center justify-center rounded-(--radius-control) font-display tracking-wider transition active:translate-y-px disabled:pointer-events-none disabled:opacity-40'

const VARIANTS = new Map<ButtonVariant, string>([
  [
    'consequence',
    'border-b-4 border-consequence-deep bg-consequence text-surface shadow-(--shadow-consequence)',
  ],
  ['surface', 'border border-edge bg-surface text-chalk'],
  ['ghost', 'bg-transparent text-muted'],
])

/**
 * The classes a `Button` of `variant` wears — exported for a navigation link that
 * must look like a button while staying a link (an `<a>`, not a `<button>`).
 */
export function buttonClassName(variant: ButtonVariant): string {
  return `${base} ${VARIANTS.get(variant) ?? ''}`
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
}

export function Button({
  variant = 'surface',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={`${buttonClassName(variant)} ${className}`} {...rest} />
}
