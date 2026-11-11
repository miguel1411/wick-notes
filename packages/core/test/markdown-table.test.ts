import { describe, expect, it } from 'vitest'
import { parseTableDelimiter } from '../src/markdown-table'

describe('parseTableDelimiter', () => {
  it('lee la alineación de cada columna', () => {
    expect(parseTableDelimiter('|:---|:---:|---:|---|').align).toEqual(['left', 'center', 'right', null])
    expect(parseTableDelimiter(':-- | --:').align).toEqual(['left', 'right'])
  })

  it('sin anchos si todos los segmentos miden lo mismo', () => {
    expect(parseTableDelimiter('|---|---|---|').widths).toBeNull()
    expect(parseTableDelimiter('| --- | --- |').widths).toBeNull()
    expect(parseTableDelimiter('|------|').widths).toBeNull()
    // Los dos puntos de la alineación no cuentan.
    expect(parseTableDelimiter('|:---|:---:|---:|---|').widths).toBeNull()
  })

  it('anchos proporcionales a los guiones de cada columna', () => {
    expect(parseTableDelimiter('|----|------------|').widths).toEqual([4, 12])
    expect(parseTableDelimiter('| :--- | ----------: |').widths).toEqual([3, 10])
  })

  it('admite filas dentro de citas y listas', () => {
    expect(parseTableDelimiter('> |--|----|').widths).toEqual([2, 4])
    expect(parseTableDelimiter('   |--|----|\r').widths).toEqual([2, 4])
  })
})
