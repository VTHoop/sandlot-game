import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from './Button'

afterEach(cleanup)

describe('Button', () => {
  it('defaults to type="button" so it never submits forms', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button', { name: 'Go' }).getAttribute('type')).toBe('button')
  })

  it('applies the consequence variant classes', () => {
    render(<Button variant="consequence">Lock</Button>)
    expect(screen.getByRole('button', { name: 'Lock' }).className).toContain('bg-consequence')
  })
})
