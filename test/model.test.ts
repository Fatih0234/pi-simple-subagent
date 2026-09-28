// Failure modes guarded here:
//  1. nothing configured -> must use the *session's current* model, not pi's startup default
//  2. configured model unknown / no credentials -> must throw, never fall back silently
//  3. malformed configured model ("sonnet") -> must throw instead of letting pi fuzzy-match
//  4. precedence: agent frontmatter > settings > session
//  5. session thinking level is inherited only together with the session model
import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseModel } from "../model.ts";

const usable = (ok: string[]) => ({ isUsable: (p: string, id: string) => ok.includes(`${p}/${id}`) });
const session = { provider: "github-copilot", id: "claude-opus-5.5" };

test("inherits the live session model and thinking when nothing is configured", () => {
	const c = chooseModel({ sessionModel: session, sessionThinking: "high" }, usable([]));
	assert.deepEqual(c, { model: "github-copilot/claude-opus-5.5", thinking: "high", source: "session" });
});

test("agent frontmatter beats settings beats session", () => {
	const lookup = usable(["a/agent-model", "s/settings-model"]);
	const all = { agentName: "scout", agentModel: "a/agent-model", settingsModel: "s/settings-model", sessionModel: session };
	assert.equal(chooseModel(all, lookup).source, "agent");
	assert.equal(chooseModel({ ...all, agentModel: undefined }, lookup).source, "settings");
});

test("agent model does not inherit the session thinking level", () => {
	const c = chooseModel({ agentName: "x", agentModel: "a/m", sessionModel: session, sessionThinking: "max" }, usable(["a/m"]));
	assert.equal(c.thinking, undefined);
});

test("configured model without credentials throws instead of falling back", () => {
	assert.throws(
		() => chooseModel({ settingsModel: "anthropic/claude-sonnet-4", sessionModel: session }, usable([])),
		/no credentials.*not falling back/,
	);
});

test("configured model must be provider/id, fuzzy names are rejected", () => {
	for (const bad of ["sonnet", "/x", "x/"]) {
		assert.throws(() => chooseModel({ agentName: "a", agentModel: bad, sessionModel: session }, usable([])), /provider\/id/);
	}
});

test("thinking suffix on a configured model is allowed", () => {
	assert.equal(chooseModel({ settingsModel: "a/m:low" }, usable(["a/m"])).model, "a/m:low");
});

test("no session model and nothing configured is an error", () => {
	assert.throws(() => chooseModel({}, usable([])), /No model/);
});
