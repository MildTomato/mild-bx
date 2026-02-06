/**
 * Command specification types for declarative CLI definitions
 * Based on Vercel CLI patterns
 */

export type PrimitiveConstructor =
  | typeof String
  | typeof Boolean
  | typeof Number;

/**
 * Defines a command-line option/flag
 */
export interface CommandOption {
  /** The option name (used as --name) */
  readonly name: string;
  /** Single character shorthand (used as -x) */
  readonly shorthand: string | null;
  /** The type constructor for parsing */
  readonly type: PrimitiveConstructor | ReadonlyArray<PrimitiveConstructor>;
  /** Placeholder for argument in help text (e.g., "FILE", "NAME") */
  readonly argument?: string;
  /** Whether this option is deprecated */
  readonly deprecated: boolean;
  /** Description shown in help text */
  readonly description?: string;
  /** Extended description for documentation (markdown supported) */
  readonly longDescription?: string;
}

/**
 * Defines a positional argument
 */
export interface CommandArgument {
  /** The argument name */
  readonly name: string;
  /** Whether this argument is required */
  readonly required: boolean;
  /** Whether this argument can be repeated */
  readonly multiple?: true;
}

/**
 * Defines an example usage
 */
export interface CommandExample {
  /** Description of what the example does */
  readonly name: string;
  /** The actual command(s) to run */
  readonly value: string | ReadonlyArray<string>;
}

/**
 * Link to related documentation
 */
export interface SeeAlso {
  /** Display text */
  readonly title: string;
  /** URL path (relative or absolute) */
  readonly href: string;
}

/**
 * Complete command specification
 */
export interface Command {
  /** The command name */
  readonly name: string;
  /** Alternative names for this command */
  readonly aliases: ReadonlyArray<string>;
  /** Description shown in help text */
  readonly description: string;
  /** Extended description for documentation (markdown supported) */
  readonly longDescription?: string;
  /** Whether this is the default subcommand */
  readonly default?: true;
  /** Whether to hide from help output */
  readonly hidden?: true;
  /** Positional arguments */
  readonly arguments: ReadonlyArray<CommandArgument>;
  /** Nested subcommands */
  readonly subcommands?: ReadonlyArray<Command>;
  /** Command options/flags */
  readonly options: ReadonlyArray<CommandOption>;
  /** Usage examples */
  readonly examples: ReadonlyArray<CommandExample>;
  /** Related commands to link to */
  readonly relatedCommands?: ReadonlyArray<string>;
  /** Links to related guides or documentation */
  readonly seeAlso?: ReadonlyArray<SeeAlso>;
}

/**
 * Handler function signature for commands
 */
export type CommandHandler = (argv: string[]) => Promise<number | void>;

/**
 * Registry entry combining spec and handler
 */
export interface CommandEntry {
  /** The command specification */
  spec: Command;
  /** The handler function */
  handler: CommandHandler;
}
