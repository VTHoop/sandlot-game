import { forwardRef, type InputHTMLAttributes } from 'react'

const base =
  'appearance-none border border-edge bg-surface text-chalk transition-colors placeholder:text-muted focus:border-chalk focus:outline-none disabled:opacity-40'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', ...rest },
  ref,
) {
  return <input ref={ref} className={`${base} ${className}`} {...rest} />
})
