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

  split: `Split this content into distinct logical units based on the suggested sections.

Guidelines:
- Each chunk must be self-contained
- Preserve context within each chunk
- Maintain original formatting

Suggested sections: {{sections}}

Content:
---
{{content}}
---

Return ONLY a JSON array of strings: ["chunk1...", "chunk2..."]`,

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

Respond ONLY with JSON.`
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
