import type { AgentAction, AgentProposal } from "../types.js";

export class DirectorAgent {
  decide(proposals: AgentProposal[]): AgentAction[] {
    const actions = proposals.flatMap((proposal) => proposal.actions ?? []);
    if (actions.length > 0) {
      return actions;
    }

    const best = [...proposals].sort((left, right) => right.confidence - left.confidence).at(0);

    return [
      {
        type: "say",
        content: best?.content ?? "I am observing, remembering, and waiting for the next useful step.",
      },
    ];
  }
}
