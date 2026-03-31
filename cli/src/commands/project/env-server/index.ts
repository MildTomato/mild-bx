import { envServerCommand } from "./command.js";
import { renderHelp } from "@/util/commands/help.js";
import { resetEnvServer } from "./src/reset.js";
import { syncEnvServer } from "./src/sync.js";

export { envServerCommand };

export default async function envServer(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    renderHelp(envServerCommand);
    return 0;
  }

  const json = rest.includes("--json");
  const yes = rest.includes("--yes") || rest.includes("-y");
  const profileIdx = rest.findIndex((a) => a === "--profile" || a === "-p");
  const profile = profileIdx !== -1 ? rest[profileIdx + 1] : undefined;

  switch (subcommand) {
    case "reset":
      await resetEnvServer({ yes, json, profile });
      return 0;
    case "sync":
      await syncEnvServer({ json, profile });
      return 0;
    default:
      console.error(`Unknown subcommand: ${subcommand}`);
      renderHelp(envServerCommand);
      return 1;
  }
}
