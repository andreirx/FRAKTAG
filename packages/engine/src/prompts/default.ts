// src/prompts/default.ts

import type { PromptSet } from '../core/types.js';

export const DEFAULT_PROMPTS: PromptSet = {

  shouldSplit: `Analyze this content and decide if it should be split into sub-nodes.

SPLIT if:
- Contains 3+ distinct topics/sections that could be understood independently
- Exceeds {{threshold}} words AND has internal logical divisions
- Has clear structural markers (headers, numbered sections, distinct concepts)

DO NOT SPLIT if:
- Content is a single coherent concept
- Splitting would create fragments lacking standalone meaning

Content:
---
{{content}}
---

Respond ONLY with JSON:
{"split": boolean, "reasoning": "one sentence", "suggestedSections": ["section1", "section2"]}`,

  // CHANGED: Removed JSON requirement. Using Delimiter strategy.
  split: `Split this content into distinct logical units based on the suggested sections.

Guidelines:
- Each chunk must be self-contained
- Preserve context within each chunk
- Maintain original formatting
- Separate each chunk EXACTLY with the delimiter: ---===FRAKTAG_SPLIT===---

Suggested sections: {{sections}}

Content:
---
{{content}}
---

Output the full text chunks separated by the delimiter. Do not use JSON.`,

  generateGist: `Write a 1-sentence gist (15-25 words) for this content.

Organizing principle for this tree: {{organizingPrinciple}}

The gist should capture:
- What this content IS
- What it DOES or CLAIMS
- Key context relevant to the organizing principle

Content:
---
{{content}}
---

Output ONLY the gist sentence, no formatting.`,

  generateL1: `Write a navigation summary (150-200 words) for a parent node.

Organizing principle: {{organizingPrinciple}}
Parent gist: {{parentGist}}

Child gists:
{{childGists}}

Write prose paragraphs (no bullets) explaining:
- What this collection contains
- How the children relate to each other
- Key patterns or groupings

Output ONLY the summary, no formatting.`,

  placeInTree: `Determine where to place this content in the tree.

Organizing principle: {{organizingPrinciple}}
Placement strategy: {{placementStrategy}}

Content gist: {{gist}}

Available parent nodes:
{{availableNodes}}

Respond with JSON: {"parentNodeId": "id", "createNodes": ["name1", "name2"], "reasoning": "..."}`,

  detectHeresy: `You are the Inquisitor. Your job is to detect "Heresy" in a generated summary.

Heresy is defined as:
- HALLUCINATION: Adding facts not present in the source
- OMISSION: Removing critical warnings, caveats, or key details
- DISTORTION: Misrepresenting the tone, intent, or meaning
- MISCATEGORIZATION: Summary doesn't match the organizing principle

DOGMA (Rules for this tree):
- The summary must be a faithful compression of the source
- Do not add information not present in the source
- Do not omit critical context or warnings
- Organizing Principle: {{organizingPrinciple}}

Source Content:
---
{{content}}
---

Proposed Summary:
---
{{summary}}
---

Evaluate the summary against the source.

If the summary is accurate and faithful, respond with:
{"status": "PASS", "reason": "Summary accurately represents source"}

If the summary contains heresy, respond with:
{"status": "FAIL", "reason": "Specific explanation of the heresy", "correctedSummary": "Your corrected version"}

Respond ONLY with JSON.`,

  findSplitAnchors: `Analyze the content and identify the logical breakpoints to split it into sections.

Task: Return a JSON list of "Anchors".
An Anchor is the **EXACT** first 15-30 characters of the text that starts a new section.

Guidelines:
- Choose unique phrases (headers, distinct starting sentences).
- Order MUST be sequential (top to bottom).
- The first anchor should usually be the start of the document (or the first logical section).
- Do not modify the text (no typos, no casing changes). The system uses strict string matching.

Context/Suggestions: {{sections}}

Content:
---
{{content}}
---

Respond ONLY with JSON:
{ "anchors": ["Chapter 1: Introduction...", "The second concept is...", "### Technical Details..."] }`,

  evaluateRelevance: `You are the Scout. Your job is to determine if this knowledge node is relevant to the user's quest.

Quest (Query): "{{query}}"

Node Gist:
"{{gist}}"

Task:
1. Rate relevance from 0 (Completely Irrelevant) to 10 (Highly Relevant/Exact Match).
2. Provide a 1-sentence reasoning.

Output Format:
SCORE | REASONING

Example:
8 | The node discusses the specific API requested.`,

  routeTraversal: `You are the Navigator. You are exploring a knowledge tree to answer a query.
You are currently at a parent node. You must decide which children to visit next.

Quest (Query): "{{query}}"

Parent Context: {{parentGist}}

Available Paths (Children):
{{childrenList}}

Task:
Select the IDs of the paths that are most likely to contain the answer. 
You can select multiple.

Output Format:
Just list the Node IDs, one per line.
If NO children are relevant, output exactly: NONE

Example:
node-a123
node-b456`,

  // 1. THE COMPASS (For routing down the tree)
  assessContainment: `You are the Librarian. You are navigating a knowledge hierarchy.
User Query: "{{query}}"

Current Location Context: "{{parentContext}}"

Below are the sub-categories (Children) available. 
Which of these are MOST LIKELY to contain the answer?

- Think hierarchically. If the query is "How to configure X", and you see a child "Configuration" or "Project X", that is the correct path.
- Select broadly. If you are unsure, explore the path.

Available Paths:
{{childrenList}}

Output Format:
List the Node IDs of paths to explore, one per line.
If NO paths look promising, output: NONE`,

  // 2. THE MAGNET (For checking if the current node IS the answer)
  assessRelevance: `You are the Researcher. 
User Query: "{{query}}"

Content Fragment:
"{{content}}"

Does this fragment contain high-fidelity information relevant to the query?
- Score 0-10. 
- 8+ means it contains a direct answer or critical context.
- 4-7 means it is related context.
- 0-3 means irrelevant.

Output Format:
SCORE | REASONING`

};

/**
 * Utility function to substitute {{variable}} placeholders in prompt templates
 */
export function substituteTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`;
    result = result.replaceAll(placeholder, String(value));
  }
  return result;
}
