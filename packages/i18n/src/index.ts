import { en, type Messages } from './en.ts';

/** Dotted-path key of every leaf string in the message tree, e.g. `'calls.status.answered'`. */
type LeafPath<T, Prefix extends string = ''> = T extends string
  ? Prefix extends `${infer P}.`
    ? P
    : never
  : {
      [K in keyof T & string]: LeafPath<T[K], `${Prefix}${K}.`>;
    }[keyof T & string];

export type MessageKey = LeafPath<Messages>;

function lookup(key: string): string {
  const parts = key.split('.');
  // biome-ignore lint/suspicious/noExplicitAny: walking a typed-but-dynamic tree by key
  let node: any = en;
  for (const part of parts) {
    node = node?.[part];
  }
  if (typeof node !== 'string') {
    throw new Error(`i18n: missing message for key "${key}"`);
  }
  return node;
}

/** Typed translator — `t('calls.status.answered')`. No interpolation library; template-literal params only. */
export function t(key: MessageKey): string {
  return lookup(key);
}

export { en, type Messages };
