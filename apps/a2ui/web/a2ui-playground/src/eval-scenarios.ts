import catalog from "../../../docs/a2ui_generation_eval_scenarios.json" with { type: "json" };

export interface EvalScenario {
  id: string;
  name: string;
  tags: string[];
  userPrompt: string;
}

export const EVAL_SCENARIOS: EvalScenario[] = catalog.scenarios
  .filter(
    (scenario): scenario is typeof scenario & { userPrompt: string } =>
      typeof scenario.userPrompt === "string" && scenario.userPrompt.trim().length > 0,
  )
  .map(({ id, name, tags, userPrompt }) => ({ id, name, tags, userPrompt }));
