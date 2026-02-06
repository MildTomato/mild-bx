/**
 * Converts CommandOption[] to arg package specification
 * Based on Vercel CLI patterns
 */

import type arg from "arg";
import type { CommandOption } from "./types.js";

/**
 * Type-safe conversion from CommandOption to arg Spec
 *
 * Transforms command options into the format expected by the `arg` package:
 * - { name: 'foo', type: String, shorthand: 'f' }
 *   → { '--foo': String, '-f': '--foo' }
 */
type ToArgSpec<T extends CommandOption> = {
  [K in T as `--${K["name"]}`]: K["type"] extends readonly [infer U]
    ? [U]
    : K["type"];
} & {
  [K in T as K["shorthand"] extends string
    ? `-${K["shorthand"]}`
    : never]: `--${K["name"]}`;
};

/**
 * Helper type to flatten intersection types for better IDE display
 */
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

/**
 * Converts an array of CommandOption definitions to an arg specification object
 *
 * @param options - Array of command option definitions
 * @returns An arg-compatible specification object
 *
 * @example
 * ```ts
 * const spec = getFlagsSpecification([
 *   { name: 'profile', shorthand: 'p', type: String, deprecated: false },
 *   { name: 'yes', shorthand: 'y', type: Boolean, deprecated: false },
 * ]);
 *
 * // Results in:
 * // { '--profile': String, '-p': '--profile', '--yes': Boolean, '-y': '--yes' }
 *
 * const args = arg(spec, { argv: process.argv.slice(2) });
 * // args['--profile'] is typed as string | undefined
 * // args['--yes'] is typed as boolean | undefined
 * ```
 */
export function getFlagsSpecification<T extends ReadonlyArray<CommandOption>>(
  options: T,
): Prettify<ToArgSpec<T[number]>> {
  const flagsSpecification: arg.Spec = {};

  for (const option of options) {
    // Add the long form: --name → Type
    // @ts-expect-error - TypeScript complains about readonly modifier on array types
    flagsSpecification[`--${option.name}`] = option.type;

    // Add shorthand alias if defined: -x → --name
    if (option.shorthand) {
      flagsSpecification[`-${option.shorthand}`] = `--${option.name}`;
    }
  }

  return flagsSpecification as Prettify<ToArgSpec<T[number]>>;
}
