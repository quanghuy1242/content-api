#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPRESSIONS_PATH = resolve(REPO_ROOT, ".advise-suppressions.json");
const AISLOP_ARGS = ["exec", "aislop", "scan", "--json", "--exclude", "node_modules,dist,coverage,.wrangler,migrations"];
const FALLOW_ARGS = ["exec", "fallow", "dupes", "--mode", "semantic", "--min-tokens", "150", "--min-lines", "10", "--skip-local", "--ignore-imports", "--format", "json", "--quiet"];

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function loadSuppressions() {
  try {
    const data = JSON.parse(readFileSync(SUPPRESSIONS_PATH, "utf8"));
    return data.suppressions ?? [];
  } catch {
    return [];
  }
}

function makeAislopKey(d) {
  return `${d.filePath}@@${d.rule}`;
}

function sortInstances(instances) {
  return [...instances].sort((a, b) => a.file.localeCompare(b.file));
}

function makeFallowSignature(group) {
  return sortInstances(group.instances)
    .map((i) => i.file)
    .join("|");
}

function runTool(cmd, args, label) {
  const result = spawnSync("corepack", ["pnpm", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], cwd: REPO_ROOT });
  if (result.error) {
    process.stderr.write(`${label} failed to run: ${result.error.message}\n`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    process.stderr.write(`${label} produced non-JSON output (exit ${result.status})\n`);
    return null;
  }
}

function filterAislop(diagnostics, suppressions) {
  const suppressed = new Set(
    suppressions
      .filter((s) => s.tool === "aislop")
      .map((s) => `${s.file}@@${s.rule}`)
  );
  return diagnostics.filter((d) => !suppressed.has(makeAislopKey(d)));
}

function filterFallow(cloneGroups, suppressions) {
  const suppressed = new Set(
    suppressions.filter((s) => s.tool === "fallow").map((s) => s.files)
  );
  return cloneGroups.filter((g) => !suppressed.has(makeFallowSignature(g)));
}

function summarizeFallowGroup(g) {
  if (!g.instances?.length) return "?";
  const sorted = sortInstances(g.instances);
  const totalLines = sorted.reduce((sum, i) => sum + (i.end_line - i.start_line + 1), 0);
  const avg = Math.round(totalLines / sorted.length);
  const files = sorted.map((i) => `${i.file}:${i.start_line}-${i.end_line}`);
  const signature = sorted.map((i) => `${i.file}:${i.start_line}`).join("|");
  return `${files.join(" | ")} (~${avg} lines, ${g.token_count} tokens)  [sig: ${signature}]`;
}

const suppressions = loadSuppressions();
const aislopResult = runTool("aislop", AISLOP_ARGS, "aislop");
const fallowResult = runTool("fallow", FALLOW_ARGS, "fallow");

if (!aislopResult || !fallowResult) {
  process.exit(1);
}

const newAislop = filterAislop(aislopResult.diagnostics ?? [], suppressions);
const newFallow = filterFallow(fallowResult.clone_groups ?? [], suppressions);

const totalAislop = aislopResult.diagnostics?.length ?? 0;
const totalFallow = (fallowResult.clone_groups ?? []).length;
const suppressedAislop = totalAislop - newAislop.length;
const suppressedFallow = totalFallow - newFallow.length;

if (newAislop.length === 0 && newFallow.length === 0) {
  process.stdout.write(`${GREEN}${BOLD}advise:${RESET}${GREEN} all findings suppressed (${suppressedAislop} aislop, ${suppressedFallow} fallow)\n${RESET}`);
  process.exit(0);
}

if (newAislop.length > 0) {
  process.stdout.write(`\n${YELLOW}${BOLD}AISLOP${RESET} ${YELLOW}(${newAislop.length} new, ${suppressedAislop} suppressed)${RESET}\n`);
  for (const d of newAislop) {
    process.stdout.write(`  ${YELLOW}WARN${RESET} ${d.filePath}:${d.line} ${BOLD}${d.rule}${RESET} — ${d.message}\n`);
  }
}

if (newFallow.length > 0) {
  process.stdout.write(`\n${YELLOW}${BOLD}FALLOW${RESET} ${YELLOW}(${newFallow.length} new, ${suppressedFallow} suppressed)${RESET}\n`);
  for (const g of newFallow) {
    process.stdout.write(`  ${YELLOW}DUP${RESET} ${summarizeFallowGroup(g)}\n`);
  }
}

process.stdout.write(`\n${RED}${newAislop.length + newFallow.length} new finding(s) — review and approve then add to .advise-suppressions.json${RESET}\n`);
process.exit(1);
