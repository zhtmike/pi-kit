/**
 * pi-kit configuration — pi's overlay convention: defaults, then the agent-dir
 * file (`PI_CODING_AGENT_DIR/pi-kit.json`), then the project file
 * (`<project>/.pi/pi-kit.json`); later layers overwrite keys whole (arrays
 * replace, never merge). Any layer may carry a partial file; unknown keys and
 * invalid values throw naming the file and the valid choices — never a silent
 * fallback. Destructive/refuse shapes are rejected at load: a standing allow
 * may only cover ask-tier shapes.
 */

import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { ALL_ACTIONS, type ApprovalAction } from "./approvals.ts";

export const CONFIG_NAME = "pi-kit.json";

/**
 * Shapes a standing allow may pin — every gate action except `destructive`
 * (session-grantable only). One vocabulary with approvals.ts.
 */
export type AskShape = Exclude<ApprovalAction, "destructive">;
export const ASK_SHAPES: readonly AskShape[] = ALL_ACTIONS.filter((a) => a !== "destructive") as readonly AskShape[];

export interface StandingAllow {
	/** Repository identity "owner/name" (case-insensitive), or "*" for every repo. */
	repo: string;
	/** Ask-tier shapes this repo pre-approves; the owner check (ownerLogins) still applies. */
	shapes: AskShape[];
}

export interface PiKitConfig {
	/** Name used in trailers, markers, and disclosures. */
	agentName: string;
	/** Logins whose remotes `git push` may resolve to; empty means every push is refused. */
	ownerLogins: string[];
	/** Per-repo standing pre-approvals (tools and ask-tier command shapes). */
	standingAllows: StandingAllow[];
}

export const DEFAULT_CONFIG: PiKitConfig = {
	agentName: "pi",
	ownerLogins: [],
	standingAllows: [],
};

function readConfigFile(file: string): Record<string, unknown> {
	let raw: string;
	try {
		raw = fs.readFileSync(file, "utf8");
	} catch (e: any) {
		if (e.code === "ENOENT") return {};
		throw e;
	}
	if (raw.trim() === "") return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e: any) {
		throw new Error(`invalid JSON in ${file}: ${e.message}`);
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`invalid config in ${file}: expected a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

function applyOverrides(cfg: PiKitConfig, overrides: Record<string, unknown>, source: string): PiKitConfig {
	const known = new Set(Object.keys(DEFAULT_CONFIG));
	for (const [key, value] of Object.entries(overrides)) {
		if (!known.has(key)) {
			throw new Error(`unknown config key '${key}' in ${source} — valid keys: ${[...known].join(", ")}`);
		}
		if (key === "agentName") {
			if (typeof value !== "string" || value === "") {
				throw new Error(`config key 'agentName' in ${source} must be a non-empty string, got ${JSON.stringify(value)}`);
			}
			cfg.agentName = value;
		} else if (key === "ownerLogins") {
			if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v === "")) {
				throw new Error(`config key 'ownerLogins' in ${source} must be an array of non-empty strings, got ${JSON.stringify(value)}`);
			}
			cfg.ownerLogins = value;
		} else if (key === "standingAllows") {
			if (!Array.isArray(value)) {
				throw new Error(`config key 'standingAllows' in ${source} must be an array of {repo, shapes}, got ${JSON.stringify(value)}`);
			}
			cfg.standingAllows = value.map((entry, i) => {
				if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
					throw new Error(`standingAllows[${i}] in ${source} must be an object {repo, shapes}, got ${JSON.stringify(entry)}`);
				}
				const { repo, shapes } = entry as Record<string, unknown>;
				if (typeof repo !== "string" || repo === "") {
					throw new Error(`standingAllows[${i}].repo in ${source} must be a non-empty string ("owner/name" or "*"), got ${JSON.stringify(repo)}`);
				}
				if (!Array.isArray(shapes) || shapes.length === 0 || shapes.some((s) => typeof s !== "string")) {
					throw new Error(`standingAllows[${i}].shapes in ${source} must be a non-empty array of shape names, got ${JSON.stringify(shapes)}`);
				}
				for (const s of shapes) {
					if (!(ASK_SHAPES as readonly string[]).includes(s)) {
						throw new Error(
							`standingAllows[${i}].shapes in ${source} names '${s}' — not a standing-allowable shape. ` +
								`Destructive and refuse shapes are never pre-approvable; valid shapes: ${ASK_SHAPES.join(", ")}`,
						);
					}
				}
				return { repo, shapes: shapes as AskShape[] };
			});
		}
	}
	return cfg;
}

/**
 * Load the effective configuration: defaults, then the agent-dir file, then the
 * project file. Throws with the offending file path and valid choices on any
 * invalid input.
 */
export function loadConfig(projectRoot: string = process.cwd()): PiKitConfig {
	const agentDir = process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), ".pi", "agent");
	let cfg = { ...DEFAULT_CONFIG, ownerLogins: [...DEFAULT_CONFIG.ownerLogins], standingAllows: [...DEFAULT_CONFIG.standingAllows] };
	cfg = applyOverrides(cfg, readConfigFile(path.join(agentDir, CONFIG_NAME)), path.join(agentDir, CONFIG_NAME));
	cfg = applyOverrides(cfg, readConfigFile(path.join(projectRoot, ".pi", CONFIG_NAME)), path.join(projectRoot, ".pi", CONFIG_NAME));
	return cfg;
}

/** Whether `shapes` covers `shape` for the repo identified as `repoIdent` ("owner/name" or undefined outside a parseable remote). */
export function standingCovers(cfg: PiKitConfig, repoIdent: string | undefined, shape: AskShape): boolean {
	return cfg.standingAllows.some((e) => (e.repo === "*" || (repoIdent !== undefined && e.repo.toLowerCase() === repoIdent.toLowerCase())) && e.shapes.includes(shape));
}
