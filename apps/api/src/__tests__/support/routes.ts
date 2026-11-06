import { z } from 'zod';

/**
 * The routes of the server, read from `printRoutes` (audit des tests d'isolation, 06/11): a sweep over them covers a
 * route added tomorrow without anyone listing it.
 */

/** A route of the server: its method and its path as declared, `:a|:b` where two routes name one segment apart. */
export interface Route {
  readonly method: string;
  readonly path: string;
}

/** The routes `printRoutes` draws as a tree, flattened; HEAD and the CORS preflight are left out. */
export function routesOf(tree: string): Route[] {
  const stack: string[] = [];
  const routes: Route[] = [];
  for (const line of tree.split('\n')) {
    const found = /^(?<indent>[│ ]*)[├└]── (?<segment>.+?)(?: \((?<methods>[A-Z, ]+)\))?$/u.exec(line);
    if (found?.groups === undefined) continue;
    const depth = (found.groups['indent'] ?? '').length / 4;
    const path = `${depth === 0 ? '' : (stack[depth - 1] ?? '')}${found.groups['segment'] ?? ''}`;
    stack[depth] = path;
    stack.length = depth + 1;
    for (const method of (found.groups['methods'] ?? '').split(', ')) {
      if (method !== '' && method !== 'HEAD' && method !== 'OPTIONS') routes.push({ method, path });
    }
  }
  return routes;
}

/** The names a segment may carry: `:creatorId|:id` is one segment, named both ways by two routes. */
export const namesOf = (segment: string): string[] =>
  segment.startsWith(':') ? segment.split('|').map((name) => name.replace(/^:/u, '')) : [];

/** The methods a sweep sends; HEAD and the preflight are left out by `routesOf`. */
export const MethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
