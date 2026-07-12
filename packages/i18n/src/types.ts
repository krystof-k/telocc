/** Recursively optional version of a message tree — lets a locale (e.g. `cs`) cover
 * only some keys while staying type-checked against the shape of `en`. */
export type DeepPartial<T> = T extends string
  ? string
  : {
      [K in keyof T]?: DeepPartial<T[K]>;
    };
