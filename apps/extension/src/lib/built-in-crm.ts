/**
 * The CRM address a hosted build carries (ADR 0067, second amendement du 19/11): the official address of the CRM whose
 * image builds the extension, read from the deployment's configuration, never from a request nor a CRM setting. Pure:
 * read by `wxt.config.ts`, which fails the build on a bad value, and by the extension at run time.
 */

/** Letters, digits and hyphens, two labels at least, no final dot nor wildcard: a deployed CRM's name, in ASCII. */
const DNS_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

/**
 * The origin a hosted build is made for, null when none is given (Charles's computer, development). Throws on anything
 * else than `https://<name>`: plain HTTP, an IP address, localhost, another port, a path, a query, credentials, a
 * wildcard, a final dot, a name that is not plain ASCII (`xn--…`).
 */
export function builtInCrmOf(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  const refuse = (why: string): never => {
    throw new Error(`EXTENSION_CRM_ORIGIN refusée (ADR 0067, second amendement) : ${why}.`);
  };
  if (!value.startsWith('https://')) refuse('elle doit commencer par https://');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse('ce n’est pas une adresse');
  }
  if (url.username !== '' || url.password !== '') refuse('elle ne porte pas d’identifiants');
  if (url.port !== '') refuse('elle reste sur le port par défaut');
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') refuse('elle n’a ni chemin ni paramètre');
  if (value.replace(/\/$/u, '') !== url.origin) refuse('elle s’écrit en minuscules, sans rien après le nom');
  if (!DNS_NAME.test(url.hostname))
    refuse('un nom de domaine, ni IP, ni localhost, ni joker, ni point final');
  if (url.hostname.split('.').some((label) => label.startsWith('xn--'))) refuse('un nom en ASCII');
  return url.origin;
}

/**
 * The image's two addresses agree (avis Sécurité et Bilan du 20/11 sur #870): when the deployment gives both the CRM's
 * WEB_ORIGIN and a built-in address, they name the same site, a final slash aside, or the build fails. An extension
 * granted another site would send the team's sessions there. Nothing to compare when either is missing or empty.
 * WEB_ORIGIN is read as an origin, so a final slash, capitals or the default port written out are no difference.
 */
export function assertSameCrm(builtIn: string | null, webOrigin: string | undefined): void {
  const web = webOrigin?.trim() ?? '';
  if (builtIn === null || web === '' || originOf(web) === builtIn) return;
  throw new Error(
    `EXTENSION_CRM_ORIGIN refusée (ADR 0067, second amendement) : elle doit être l’adresse du CRM (WEB_ORIGIN).`,
  );
}

/** The origin of an address, null when it is none (avis Bilan du 20/11 sur #883). */
function originOf(raw: string): string | null {
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
