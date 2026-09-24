// Reading Set-Cookie from a server-side fetch() response.
//
// A server-to-server fetch does not put the Worker's cookies in the browser —
// the portal must read them here and issue its own cookie. `Headers.get()`
// folds multiple Set-Cookie headers into one comma-joined string (and the
// commas inside `Expires=Thu, 01 Jan …` make that ambiguous), so prefer the
// purpose-built `getSetCookie()` (Node ≥ 18.14 / undici) and only fall back to
// a cookie-aware split of the folded form.

export function getSetCookieLines(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const folded = headers.get('set-cookie');
  if (!folded) return [];
  // Split only at a comma that begins a new "name=" pair, never inside an Expires date.
  return folded.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/).map((s) => s.trim());
}

export interface ParsedSetCookie {
  value: string;
  maxAgeSeconds: number | null;
}

/** The named cookie's value from a response's Set-Cookie headers, or null. An empty value (a deletion) counts as absent. */
export function readSetCookie(headers: Headers, name: string): ParsedSetCookie | null {
  for (const line of getSetCookieLines(headers)) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const eq = pair.indexOf('=');
    if (eq <= 0 || pair.slice(0, eq) !== name) continue;
    const value = pair.slice(eq + 1);
    if (!value) continue;
    const maxAge = attrs.map((a) => /^max-age=(\d+)$/i.exec(a)?.[1]).find(Boolean);
    return { value, maxAgeSeconds: maxAge ? Number(maxAge) : null };
  }
  return null;
}
