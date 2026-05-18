import { spawnSync } from "node:child_process";

const DUPLICATION_THRESHOLD_PERCENT = 3;
const FALLOW_ARGS = [
  "dupes",
  "--mode",
  "mild",
  "--min-tokens",
  "50",
  "--min-lines",
  "5",
  "--skip-local",
  "--ignore-imports",
  "--format",
  "json",
  "--quiet",
];

function write(stream, value) {
  stream.write(String(value));
}

function fail(message) {
  write(process.stderr, message + "\n");
  process.exitCode = 1;
}

const result = spawnSync("fallow", FALLOW_ARGS, { encoding: "utf8" });

if (result.error) {
  fail("Failed to run fallow: " + result.error.message);
} else if (result.status !== 0) {
  write(process.stdout, result.stdout);
  write(process.stderr, result.stderr);
  process.exitCode = result.status ?? 1;
} else {
  try {
    const report = JSON.parse(result.stdout);
    const stats = report.stats;
    const rate = Number(stats.duplication_percentage);

    write(
      process.stdout,
      "Fallow mild duplication: " +
        rate.toFixed(1) +
        "% (" +
        stats.duplicated_lines +
        " duplicated lines, " +
        stats.clone_groups +
        " clone groups; threshold " +
        DUPLICATION_THRESHOLD_PERCENT +
        "%)\n",
    );

    if (rate > DUPLICATION_THRESHOLD_PERCENT) {
      write(process.stderr, "Duplicate-code threshold exceeded. Clone groups:\n");
      for (let i = 0; i < report.clone_groups.length; i++) {
        const group = report.clone_groups[i];
        write(process.stderr, "- group " + (i + 1) + "\n");
        for (const instance of group.instances) {
          write(process.stderr, "  " + instance.file + ":" + instance.start_line + "-" + instance.end_line + "\n");
        }
      }
      process.exitCode = 1;
    }
  } catch (error) {
    fail("Failed to parse fallow JSON output: " + String(error));
  }
}
