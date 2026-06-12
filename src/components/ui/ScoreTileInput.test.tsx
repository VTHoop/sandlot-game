import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScoreTileInput } from './ScoreTileInput'

afterEach(cleanup)

function type(value: string) {
  fireEvent.change(screen.getByLabelText(/your number/i), { target: { value } })
}

describe('ScoreTileInput', () => {
  it('passes digits through', () => {
    const onChange = vi.fn()
    render(<ScoreTileInput label="your number" value="" onChange={onChange} />)
    type('472')
    expect(onChange).toHaveBeenCalledWith('472')
  })

  it('strips non-digits and leading zeros', () => {
    const onChange = vi.fn()
    render(<ScoreTileInput label="your number" value="" onChange={onChange} />)
    type('0a4x7!2')
    expect(onChange).toHaveBeenCalledWith('472')
  })

  it('caps at four digits', () => {
    const onChange = vi.fn()
    render(<ScoreTileInput label="your number" value="100" onChange={onChange} />)
    type('10009')
    expect(onChange).toHaveBeenCalledWith('1000')
  })

  it('uses the numeric keyboard and never spinners', () => {
    render(<ScoreTileInput label="your number" value="" onChange={() => {}} />)
    const input = screen.getByLabelText(/your number/i)
    expect(input.getAttribute('inputmode')).toBe('numeric')
    expect(input.getAttribute('type')).toBe('text')
  })

  it('disables while locked', () => {
    render(<ScoreTileInput label="your number" value="472" onChange={() => {}} disabled />)
    expect((screen.getByLabelText(/your number/i) as HTMLInputElement).disabled).toBe(true)
  })
})
