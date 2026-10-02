import { t } from './i18n'

/**
 * The updater reports raw English errors (electron-updater, network stack). Settings show what it means for the
 * person instead; unknown errors get a plain sentence, never the technical text.
 */
export function updateErrorText(message: string): string {
  if (/no published versions/i.test(message)) return t('Aucune version n’est encore publiée.')
  if (/app-update\.yml|ENOENT/i.test(message)) return t('Cette copie de MyPhotos ne peut pas chercher ses mises à jour : elle n’a pas été installée depuis une version publiée.')
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|getaddrinfo|net::ERR_|network|socket hang up/i.test(message)) return t('GitHub est injoignable. Êtes-vous connecté à internet ?')
  if (/rate limit|\b403\b|\b429\b/i.test(message)) return t('GitHub refuse la vérification pour le moment. Réessayez plus tard.')
  return t('Impossible de vérifier les mises à jour pour le moment.')
}
