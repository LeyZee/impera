/**
 * A few lines of DOM building for the popup: text always goes in as text (a name from the CRM never becomes markup),
 * and SVG icons come only from the fixed set in icons.ts.
 */

type Child = Node | string | null | false | undefined;
type Attrs = Readonly<Record<string, string | number | boolean | undefined>>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: readonly Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === false || child === undefined) continue;
    element.append(child);
  }
  return element;
}
