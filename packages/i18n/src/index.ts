import { cs } from './cs.ts';
import { en, type Messages } from './en.ts';
import type { DeepPartial } from './types.ts';

/** Dotted-path key of every leaf string in the message tree, e.g. `'calls.status.answered'`. */
type LeafPath<T, Prefix extends string = ''> = T extends string
  ? Prefix extends `${infer P}.`
    ? P
    : never
  : {
      [K in keyof T & string]: LeafPath<T[K], `${Prefix}${K}.`>;
    }[keyof T & string];

export type MessageKey = LeafPath<Messages>;

/** Supported locales. `en` is complete (the source of truth); every other locale is
 * a `DeepPartial<Messages>` that falls back to `en` key-by-key (see `t()` below). */
export type Locale = 'en' | 'cs';

const DEFAULT_LOCALE: Locale = 'en';

const locales: Record<Locale, DeepPartial<Messages>> = { en, cs };

let currentLocale: Locale = DEFAULT_LOCALE;

/** The active locale (defaults to `'en'` until `setLocale` is called). */
export function getLocale(): Locale {
  return currentLocale;
}

/** Sets the active locale for subsequent `t()` calls. Boring by design — a module-level
 * variable, no context/provider — since nothing today needs a locale switch to
 * re-render already-mounted components (apps/web sets this once at startup from
 * `navigator.language`). */
export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

function lookup(dict: unknown, parts: readonly string[]): string | undefined {
  // biome-ignore lint/suspicious/noExplicitAny: walking a typed-but-dynamic tree by key
  let node: any = dict;
  for (const part of parts) {
    node = node?.[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Typed translator — `t('calls.status.answered')`. Resolves through the active
 * locale first, falling back to `en` per-key (so a partial locale like `cs` never
 * produces a missing string). No interpolation library; template-literal params only. */
export function t(key: MessageKey): string {
  const parts = key.split('.');
  if (currentLocale !== DEFAULT_LOCALE) {
    const localized = lookup(locales[currentLocale], parts);
    if (localized !== undefined) return localized;
  }
  const fallback = lookup(en, parts);
  if (fallback === undefined) {
    throw new Error(`i18n: missing message for key "${key}"`);
  }
  return fallback;
}

export { cs, type DeepPartial, en, type Messages };
