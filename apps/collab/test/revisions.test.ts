import { describe, expect, it, vi } from 'vitest'
import { RevisionStore } from '../src/revisions'

describe('lecturas guardadas para fusionar', () => {
  const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill)

  it('misma nota y mismo estado → misma revisión; otra nota no la ve', () => {
    const store = new RevisionStore()
    const a = store.remember('doc1', bytes(10))
    expect(store.remember('doc1', bytes(10))).toBe(a)
    expect(store.remember('doc2', bytes(10))).not.toBe(a)
    expect(store.get('doc1', a)).toEqual(bytes(10))
    expect(store.get('doc2', a)).toBeNull()
    expect(store.get('doc1', 'otra')).toBeNull()
  })

  it('caducan con el tiempo', () => {
    vi.useFakeTimers()
    try {
      const store = new RevisionStore({ ttlMs: 1000, maxBytes: 1e6 })
      const a = store.remember('doc', bytes(5))
      vi.advanceTimersByTime(999)
      expect(store.get('doc', a)).not.toBeNull()
      vi.advanceTimersByTime(2)
      expect(store.get('doc', a)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('sin pasar del límite de memoria: se van primero las más antiguas', () => {
    const store = new RevisionStore({ ttlMs: 1e9, maxBytes: 25 })
    const a = store.remember('doc', bytes(10, 1))
    const b = store.remember('doc', bytes(10, 2))
    // Leer otra vez la primera la hace la más reciente.
    expect(store.remember('doc', bytes(10, 1))).toBe(a)
    const c = store.remember('doc', bytes(10, 3))
    expect(store.get('doc', b)).toBeNull()
    expect(store.get('doc', a)).not.toBeNull()
    expect(store.get('doc', c)).not.toBeNull()
  })
})
