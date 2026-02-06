/**
 * Project auth-provider command router
 */

import arg from "arg";
import { authProviderSubcommand, listSubcommand, addSubcommand, enableSubcommand, disableSubcommand } from "./command.js";
import { getFlagsSpecification } from "@/util/commands/get-flags-specification.js";
import { globalCommandOptions } from "@/util/commands/arg-common.js";
import { renderHelp } from "@/util/commands/help.js";
import { projectCommand } from "@/commands/project/command.js";
import { listAuthProviders } from "./src/list.js";
import { addAuthProvider } from "./src/add.js";
import { enableAuthProvider, disableAuthProvider } from "./src/toggle.js";

export { authProviderSubcommand };

export async function authProviderCommand(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  // Handle help for main command
  if (subcommand === "--help" || subcommand === "-h" || !subcommand) {
    renderHelp(authProviderSubcommand, { parent: projectCommand });
    return 0;
  }

  // Route to subcommand handlers
  switch (subcommand) {
    case "list": {
      const spec = getFlagsSpecification([...listSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(listSubcommand, { parent: authProviderSubcommand });
        return 0;
      }

      await listAuthProviders({
        json: args["--json"],
        profile: args["--profile"],
      });
      return 0;
    }

    case "add": {
      const spec = getFlagsSpecification([...addSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(addSubcommand, { parent: authProviderSubcommand });
        return 0;
      }

      const provider = args._[0];
      await addAuthProvider(provider, {
        "client-id": args["--client-id"],
        secret: args["--secret"],
        "secret-from-env": args["--secret-from-env"],
        url: args["--url"],
        "redirect-uri": args["--redirect-uri"],
        "skip-nonce-check": args["--skip-nonce-check"],
        "dry-run": args["--dry-run"],
        json: args["--json"],
        yes: args["--yes"],
        profile: args["--profile"],
      });
      return 0;
    }

    case "enable": {
      const spec = getFlagsSpecification([...enableSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(enableSubcommand, { parent: authProviderSubcommand });
        return 0;
      }

      const provider = args._[0];
      if (!provider) {
        console.error("Error: Provider argument is required");
        console.error(`Example: supa project auth-provider ${subcommand} google`);
        console.error(`Run 'supa project auth-provider ${subcommand} --help' for more information`);
        return 1;
      }
      await enableAuthProvider(provider, {
        "dry-run": args["--dry-run"],
        json: args["--json"],
        profile: args["--profile"],
      });
      return 0;
    }

    case "disable": {
      const spec = getFlagsSpecification([...disableSubcommand.options, ...globalCommandOptions]);
      let args: arg.Result<typeof spec>;
      try {
        args = arg(spec, { argv: rest, permissive: false });
      } catch (err) {
        if (err instanceof Error) {
          console.error(`Error: ${err.message}`);
        }
        return 1;
      }

      if (args["--help"]) {
        renderHelp(disableSubcommand, { parent: authProviderSubcommand });
        return 0;
      }

      const provider = args._[0];
      if (!provider) {
        console.error("Error: Provider argument is required");
        console.error(`Example: supa project auth-provider ${subcommand} google`);
        console.error(`Run 'supa project auth-provider ${subcommand} --help' for more information`);
        return 1;
      }
      await disableAuthProvider(provider, {
        "dry-run": args["--dry-run"],
        json: args["--json"],
        profile: args["--profile"],
      });
      return 0;
    }

    default: {
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(authProviderSubcommand, { parent: projectCommand });
      return 1;
    }
  }
}

export default authProviderCommand;
