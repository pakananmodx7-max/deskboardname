import { describe, expect, it, vi } from 'vitest'

import { logError, logInfo, scrub } from '../src/logger.js'

describe('scrub', () => {
  const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzbm90YXJlYWxzaWduYXR1cmU'

  it('redacts a JWT-shaped bearer token', () => {
    expect(scrub(`Authorization: Bearer ${fakeJwt}`)).toBe('Authorization: Bearer [redacted]')
  })

  it('leaves ordinary text untouched', () => {
    expect(scrub('classroom not found')).toBe('classroom not found')
  })
})

describe('logInfo / logError — stderr only, never stdout', () => {
  it('logInfo writes to stderr, not stdout', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    logInfo('server started')

    expect(stderrSpy).toHaveBeenCalledOnce()
    expect(stdoutSpy).not.toHaveBeenCalled()
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
  })

  it('logError writes to stderr, not stdout, and scrubs a token embedded in the error message', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const fakeJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dGhpc2lzbm90YXJlYWxzaWduYXR1cmU'

    logError('auth failed', new Error(`token ${fakeJwt} rejected`))

    expect(stdoutSpy).not.toHaveBeenCalled()
    const written = stderrSpy.mock.calls[0][0] as string
    expect(written).not.toContain('eyJ')
    expect(written).toContain('[redacted]')
    stderrSpy.mockRestore()
    stdoutSpy.mockRestore()
  })
})
