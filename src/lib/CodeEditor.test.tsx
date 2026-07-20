import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { CodeEditor } from './CodeEditor'

describe('CodeEditor', () => {
  it('mounts a CodeMirror view and renders the initial value', () => {
    render(<CodeEditor value={'{\n  "a": 1\n}'} onChange={() => {}} ariaLabel="body" />)
    const content = screen.getByLabelText('body')
    expect(content).toBeInTheDocument()
    expect(content.textContent).toContain('"a": 1')
  })

  it('shows the placeholder only while the document is empty', () => {
    const { rerender } = render(<CodeEditor value="" onChange={() => {}} ariaLabel="body" placeholder="value" />)
    expect(screen.getByText('value')).toBeInTheDocument()
    rerender(<CodeEditor value="filled" onChange={() => {}} ariaLabel="body" placeholder="value" />)
    expect(screen.queryByText('value')).not.toBeInTheDocument()
  })

  it('reflects external value changes into the document', async () => {
    function Host() {
      const [value, setValue] = useState('first')
      return (
        <>
          <button onClick={() => setValue('second')}>swap</button>
          <CodeEditor value={value} onChange={() => {}} ariaLabel="body" />
        </>
      )
    }
    render(<Host />)
    expect(screen.getByLabelText('body').textContent).toContain('first')
    fireEvent.click(screen.getByText('swap'))
    await waitFor(() => expect(screen.getByLabelText('body').textContent).toContain('second'))
  })
})
