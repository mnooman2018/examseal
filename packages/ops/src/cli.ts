import { parseArgs } from "node:util";
import { UserError } from "./env";
import { render } from "./render";
import { validatePaper } from "./validate-paper";

const USAGE = `Usage: pnpm ops <command> [options]

Commands:
  validate-paper [--paper <path>]
      Check demo-data/master-paper.json against the §9 authoring rules.
  render --centre <id> [--exam <id>] [--centres 20] [--paper <path>] [--out <dir>] [--force]
      Write a printable HTML variant for one centre (for leak photos).
  render --master [--paper <path>] [--out <dir>]
      Write the paper in master order, unshuffled (for the fake-leak photo).
  check-extractor <image-path>
      Send one photo to the Gemini vision model with the §10 prompt and print the JSON.
  seed [--centres 20] [--release-in 150] [--reveal-after 120] [--dry-run]
      Create a demo exam on MST Testnet (§12) and write its secret files to
      demo-data/secrets/exam-<id>/. --dry-run checks everything and sends nothing.
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      paper: { type: "string" },
      centre: { type: "string" },
      centres: { type: "string" },
      exam: { type: "string" },
      seed: { type: "string" },
      out: { type: "string" },
      force: { type: "boolean" },
      master: { type: "boolean" },
      "release-in": { type: "string" },
      "reveal-after": { type: "string" },
      "dry-run": { type: "boolean" },
      rpc: { type: "string" },
      contract: { type: "string" },
      "out-root": { type: "string" },
    },
  });
  switch (command) {
    case "validate-paper":
      return validatePaper(values);
    case "render":
      return render(values);
    case "check-extractor": {
      const { checkExtractor } = await import("./check-extractor");
      return checkExtractor(positionals[0]);
    }
    case "seed": {
      const { seed, configFromEnv } = await import("./seed");
      const r = await seed(
        {
          centres: Number(values.centres ?? 20),
          releaseIn: Number(values["release-in"] ?? 150),
          revealAfter: Number(values["reveal-after"] ?? 120),
          paper: values.paper,
          dryRun: values["dry-run"],
          rpc: values.rpc,
          contract: values.contract,
          outRoot: values["out-root"],
        },
        configFromEnv(),
      );
      return r || values["dry-run"] ? 0 : 1;
    }
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof UserError || err?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      console.error(`Error: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exit(1);
  },
);
