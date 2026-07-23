import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useMemo } from 'react'

export default function EquationPreview({ formula }: { formula: string }) {
  const html = useMemo(
    () =>
      katex.renderToString(formula || '\\phantom{x}', {
        displayMode: true,
        throwOnError: false,
      }),
    [formula],
  )

  return (
    <div
      className="docx-equation-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
