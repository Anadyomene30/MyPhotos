import { describe, expect, it } from 'vitest'
import { updateErrorText } from '@shared/updateError'

describe('update error text', () => {
  it('says what the updater errors mean, never the raw English', () => {
    expect(updateErrorText('No published versions on GitHub')).toBe('Aucune version n’est encore publiée.')
    expect(updateErrorText("ENOENT: no such file or directory, open '/Applications/MyPhotos.app/Contents/Resources/app-update.yml'")).toMatch(/version publiée/)
    expect(updateErrorText('getaddrinfo ENOTFOUND api.github.com')).toMatch(/injoignable/)
    expect(updateErrorText('HttpError: 403 rate limit exceeded')).toMatch(/plus tard/)
    expect(updateErrorText('Something else entirely')).toBe('Impossible de vérifier les mises à jour pour le moment.')
  })
})
