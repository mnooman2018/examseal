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
  check-extractor <image-path> [--provider auto|gemini|groq]
      Send one photo with the §10 prompt and print the JSON. auto = Gemini with model
      fallback, then Groq as a last resort if GROQ_API_KEY is set.
  seed [--centres 20] [--release-in 150] [--reveal-after 120] [--dry-run]
      Create a demo exam on MST Testnet (§12) and write its secret files to
      demo-data/secrets/exam-<id>/. --dry-run checks everything and sends nothing.
  release --exam <id> --custodian 4[,5] [--wait]
      Release scripted custodian 4 and/or 5's pieces for every centre (one tx each).
      Refuses before release time unless --wait (waits in chain time, then sends).
  simulate [--trials 1000] [--seed examseal-sim-v1] [--codebooks 5]
      Run the §10 matcher simulation and write docs/SIMULATION.md (exit 2 if a target is missed).
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
      provider: { type: "string" },
      trials: { type: "string" },
      codebooks: { type: "string" },
      "release-in": { type: "string" },
      "reveal-after": { type: "string" },
      "dry-run": { type: "boolean" },
      rpc: { type: "string" },
      contract: { type: "string" },
      "out-root": { type: "string" },
      custodian: { type: "string" },
      wait: { type: "boolean" },
      "secrets-root": { type: "string" },
    },
  });
  switch (command) {
    case "validate-paper":
      return validatePaper(values);
    case "render":
      return render(values);
    case "check-extractor": {
      const { checkExtractor } = await import("./check-extractor");
      return checkExtractor(positionals[0], { provider: values.provider });
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
    case "release": {
      const { release, custodianAccountFromEnv, parseCustodianList } = await import("./release");
      if (!values.exam || !/^\d+$/.test(values.exam)) throw new UserError("--exam <id> is required, e.g. --exam 3");
      for (const n of parseCustodianList(values.custodian)) {
        await release(
          {
            examId: BigInt(values.exam),
            custodian: n,
            wait: values.wait,
            rpc: values.rpc,
            contract: values.contract,
            secretsRoot: values["secrets-root"],
          },
          custodianAccountFromEnv(n),
        );
      }
      return 0;
    }
    case "simulate": {
      const { simulate } = await import("./simulate");
      return simulate({
        trials: values.trials ? Number(values.trials) : undefined,
        seed: values.seed,
        codebooks: values.codebooks ? Number(values.codebooks) : undefined,
        paper: values.paper,
        out: values.out,
      });
    }
    default:
      console.log(USAGE);
      return command ? 1 : 0;
  }
}

// Set the exit code and let Node exit on its own. Calling process.exit() while fetch's keep-alive
// sockets are closing crashes Node on Windows (libuv "UV_HANDLE_CLOSING" assertion).
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    if (err instanceof UserError || err?.code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      console.error(`Error: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  },
);
