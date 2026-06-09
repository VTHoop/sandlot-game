import { render, screen } from '@testing-library/react'
import { describe, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the Sandlot heading', () => {
    render(<App />)
    screen.getByRole('heading', { name: 'Sandlot' })
  })
})
