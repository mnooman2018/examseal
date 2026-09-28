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
