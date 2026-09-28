/**
 * Model choice for a subagent. Pure: no pi imports, so it is unit-testable.
 *
 * Order (first match wins):
 *   1. `model` in the agent definition frontmatter   (user-authored)
 *   2. `simpleSubagent.model` in ~/.pi/agent/settings.json (user-authored)
 *   3. the main session's current model + thinking level
 *
 * The LLM has no say: no tool parameter reaches this function.
 * A configured model that cannot be used is an error, never a silent fallback.
 */

export interface ModelLookup {
	/** true if provider/id exists in the registry and has credentials */
	isUsable(provider: string, id: string): boolean;
}

export interface ModelChoice {
	/** value for `--model`, always "provider/id" (optionally with ":thinking") */
	model: string;
	/** value for `--thinking`, only when inherited from the session or set in settings */
	thinking?: string;
	source: "agent" | "settings" | "session";
}

export interface ModelInputs {
	agentName?: string;
	agentModel?: string;
	settingsModel?: string;
	settingsThinking?: string;
	sessionModel?: { provider: string; id: string };
	sessionThinking?: string;
}

export function chooseModel(input: ModelInputs, lookup: ModelLookup): ModelChoice {
	if (input.agentModel) {
		checkConfigured(input.agentModel, `agent "${input.agentName}" frontmatter`, lookup);
		return { model: input.agentModel, source: "agent" };
	}
	if (input.settingsModel) {
		checkConfigured(input.settingsModel, "settings.json simpleSubagent.model", lookup);
		return { model: input.settingsModel, thinking: input.settingsThinking, source: "settings" };
	}
	if (input.sessionModel) {
		return {
			model: `${input.sessionModel.provider}/${input.sessionModel.id}`,
			thinking: input.sessionThinking,
			source: "session",
		};
	}
	throw new Error("No model: the main session has no active model and none is configured.");
}

function checkConfigured(spec: string, where: string, lookup: ModelLookup): void {
	const [ref] = spec.split(":"); // allow "provider/id:high"
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) {
		throw new Error(`Model "${spec}" in ${where} must be "provider/id" (e.g. from \`pi --list-models\`).`);
	}
	const provider = ref.slice(0, slash);
	const id = ref.slice(slash + 1);
	if (!lookup.isUsable(provider, id)) {
		throw new Error(
			`Model "${spec}" in ${where} is unknown or has no credentials. Fix the config; not falling back to another model.`,
		);
	}
}
