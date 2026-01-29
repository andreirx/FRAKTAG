// packages/engine/src/nuggets/NuggetTester.ts

import { ILLMAdapter } from '../adapters/llm/ILLMAdapter.js';
import { substituteTemplate } from '../prompts/default.js';
import { BaseNugget } from './BaseNugget.js';
import { GlobalMapScanNugget } from './GlobalMapScan.js';
import { AssessVectorCandidatesNugget } from './AssessVectorCandidates.js';
import { AssessNeighborhoodNugget } from './AssessNeighborhood.js';
import { GenerateGistNugget } from './GenerateGist.js';
import { GenerateTitleNugget } from './GenerateTitle.js';
import { ProposePlacementNugget } from './ProposePlacement.js';
import { AiSplitNugget } from './AiSplit.js';
import { OracleAskNugget } from './OracleAsk.js';
import { OracleChatNugget } from './OracleChat.js';
import { AnswerGistNugget } from './AnswerGist.js';
import { TurnGistNugget } from './TurnGist.js';
import { AnalyzeTreeStructureNugget } from './AnalyzeTreeStructure.js';

// ============ DIAGNOSTIC LLM PROXY ============

interface LLMCallRecord {
  renderedPrompt: string;
  promptCharCount: number;
  options: Record<string, any>;
  rawOutput: string;
  outputCharCount: number;
  ttftMs: number | null;  // Time to first token (only measurable via streaming)
  totalMs: number;
}

/**
 * Wraps an ILLMAdapter and records every call's inputs and outputs.
 * Used by the tester to capture the exact rendered prompt, raw output, and timing.
 */
class DiagnosticLLMProxy implements ILLMAdapter {
  readonly modelName?: string;
  readonly adapterName?: string;
  lastCall: LLMCallRecord | null = null;

  constructor(private inner: ILLMAdapter) {
    this.modelName = inner.modelName;
    this.adapterName = inner.adapterName;
  }

  async complete(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    options?: { maxTokens?: number; expectsJSON?: boolean }
  ): Promise<string> {
    // Render the prompt ourselves to capture it (same logic as BaseLLMAdapter.preparePrompt)
    const processedVars: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(variables)) {
      processedVars[key] = Array.isArray(value) ? value.join('\n') : value;
    }
    const renderedPrompt = substituteTemplate(prompt, processedVars);

    const start = Date.now();
    const rawOutput = await this.inner.complete(prompt, variables, options);
    const totalMs = Date.now() - start;

    this.lastCall = {
      renderedPrompt,
      promptCharCount: renderedPrompt.length,
      options: options || {},
      rawOutput,
      outputCharCount: rawOutput.length,
      ttftMs: null, // Not available from complete()
      totalMs,
    };

    return rawOutput;
  }

  async testConnection(): Promise<boolean> {
    return this.inner.testConnection();
  }

  getLastCall(): LLMCallRecord | null {
    return this.lastCall;
  }
}

// ============ TEST CASES ============

export interface NuggetTestCase {
  name: string;
  create: (llm: ILLMAdapter) => BaseNugget<any, any>;
  sampleInput: any;
  validate: (output: any) => { pass: boolean; message: string };
}

function buildTestCases(): NuggetTestCase[] {
  return [
    {
      name: 'GlobalMapScan',
      create: (llm) => new GlobalMapScanNugget(llm),
      sampleInput: {
        query: 'How does authentication work?',
        treeMap: '📂 Root\n  📂 Auth [id-auth]\n    📄 Login Flow [id-login]\n  📂 API [id-api]',
      },
      validate: (out) => ({
        pass: Array.isArray(out.targetIds) && typeof out.reasoning === 'string',
        message: `targetIds: ${JSON.stringify(out.targetIds)}, reasoning: "${out.reasoning?.slice(0, 60)}"`,
      }),
    },
    {
      name: 'AssessVectorCandidates',
      create: (llm) => new AssessVectorCandidatesNugget(llm),
      sampleInput: {
        query: 'What is the database schema?',
        neighborhoods: 'NEIGHBORHOOD (Score: 0.85)\nFOCUS NODE [id-schema] (document): Database Schema\n   Gist: Defines all tables...',
      },
      validate: (out) => ({
        pass: Array.isArray(out.relevantNodeIds),
        message: `relevantNodeIds: ${JSON.stringify(out.relevantNodeIds)}`,
      }),
    },
    {
      name: 'AssessNeighborhood',
      create: (llm) => new AssessNeighborhoodNugget(llm),
      sampleInput: {
        query: 'What are the API endpoints?',
        parentContext: 'API Documentation',
        depthContext: 'Orientation (Broad Search)',
        childrenList: 'ID: id-rest\nType: 📄 document\nTitle: REST Endpoints\nGist: All REST API endpoints',
      },
      validate: (out) => ({
        pass: Array.isArray(out.relevantIds),
        message: `relevantIds: ${JSON.stringify(out.relevantIds)}`,
      }),
    },
    {
      name: 'GenerateGist',
      create: (llm) => new GenerateGistNugget(llm),
      sampleInput: {
        content: 'The quick brown fox jumps over the lazy dog. This document describes the behavior of foxes in various ecosystems.',
        organizingPrinciple: 'Animal behavior research',
      },
      validate: (out) => ({
        pass: typeof out === 'string' && out.length > 0 && out.length < 500,
        message: `gist (${out.length} chars): "${out.slice(0, 80)}"`,
      }),
    },
    {
      name: 'GenerateTitle',
      create: (llm) => new GenerateTitleNugget(llm),
      sampleInput: {
        content: 'This guide explains how to set up continuous integration using GitHub Actions with Node.js projects.',
        organizingPrinciple: 'Software development documentation',
      },
      validate: (out) => ({
        pass: typeof out === 'string' && out.length > 0 && out.length <= 100,
        message: `title: "${out}"`,
      }),
    },
    {
      name: 'ProposePlacement',
      create: (llm) => new ProposePlacementNugget(llm),
      sampleInput: {
        documentTitle: 'CI/CD Setup Guide',
        documentGist: 'How to configure continuous integration pipelines',
        leafFolders: '- ID: folder-guides\n  Title: Guides\n  Gist: How-to guides\n  Path: /Guides\n\n- ID: folder-api\n  Title: API\n  Gist: API documentation\n  Path: /API',
      },
      validate: (out) => ({
        pass: typeof out.targetFolderId === 'string' && typeof out.confidence === 'number',
        message: `folder: ${out.targetFolderId}, confidence: ${out.confidence}`,
      }),
    },
    {
      name: 'AiSplit',
      create: (llm) => new AiSplitNugget(llm),
      sampleInput: {
        content: '# Introduction\nThis is the intro.\n\n# Methods\nWe used several methods.\n\n# Results\nThe results were significant.',
        organizingPrinciple: 'Research paper structure',
      },
      validate: (out) => ({
        pass: Array.isArray(out) && out.length > 0 && out.every((s: any) => s.title && s.text),
        message: `${out.length} splits: ${out.map((s: any) => s.title).join(', ')}`,
      }),
    },
    {
      name: 'OracleAsk',
      create: (llm) => new OracleAskNugget(llm),
      sampleInput: {
        context: '--- [SOURCE 1] Title: "Config Guide" ---\nThe config file is at /etc/app.json. Set "port" to 3000.',
        query: 'Where is the config file?',
      },
      validate: (out) => ({
        pass: typeof out === 'string' && out.length > 0,
        message: `answer (${out.length} chars): "${out.slice(0, 80)}"`,
      }),
    },
    {
      name: 'OracleChat',
      create: (llm) => new OracleChatNugget(llm),
      sampleInput: {
        historyContext: 'RECENT CONVERSATION HISTORY:\nUser: What is X?\nAI: X is a framework.\n---',
        ragContext: 'CONTEXT (Search Results):\n--- [SOURCE 1] X Framework ---\nX supports plugins.',
        question: 'Does it support plugins?',
      },
      validate: (out) => ({
        pass: typeof out === 'string' && out.length > 0,
        message: `answer (${out.length} chars): "${out.slice(0, 80)}"`,
      }),
    },
    {
      name: 'AnswerGist',
      create: (llm) => new AnswerGistNugget(llm),
      sampleInput: {
        answer: 'The configuration file is located at /etc/app.json. You need to set the port to 3000 and the database URL to your PostgreSQL instance.',
      },
      validate: (out) => ({
        pass: typeof out === 'string' && out.length > 0 && out.length <= 200,
        message: `gist: "${out}"`,
      }),
    },
    {
      name: 'TurnGist',
      create: (llm) => new TurnGistNugget(llm),
      sampleInput: {
        question: 'Where is the config file?',
        answer: 'The config file is at /etc/app.json.',
      },
      validate: (out) => ({
        pass: typeof out === 'string' && out.length > 0 && out.length <= 200,
        message: `gist: "${out}"`,
      }),
    },
    {
      name: 'AnalyzeTreeStructure',
      create: (llm) => new AnalyzeTreeStructureNugget(llm),
      sampleInput: {
        organizingPrinciple: 'Technical documentation',
        dogma: 'None',
        treeMap: '📂 Root\n  📂 API [id-api]\n    📄 REST Endpoints [id-rest]\n  📂 Guides [id-guides]',
      },
      validate: (out) => ({
        pass: Array.isArray(out.issues),
        message: `${out.issues.length} issues found`,
      }),
    },
  ];
}

// ============ TEST RESULT ============

export interface NuggetTestResult {
  name: string;
  pass: boolean;
  validationMessage: string;
  durationMs: number;
  error?: string;
  // Diagnostic data
  adapter: string;
  model: string;
  sampleInput: any;
  renderedPrompt: string | null;
  promptCharCount: number;
  rawOutput: string | null;
  outputCharCount: number;
  parsedOutput: any;
  expectsJSON: boolean;
  ttftMs: number | null;
}

// ============ RUNNER ============

export async function runNuggetTests(
  llm: ILLMAdapter,
  filterName?: string
): Promise<NuggetTestResult[]> {
  let cases = buildTestCases();
  if (filterName) {
    cases = cases.filter(c => c.name.toLowerCase() === filterName.toLowerCase());
    if (cases.length === 0) {
      console.log(`No nugget found with name "${filterName}". Available: ${buildTestCases().map(c => c.name).join(', ')}`);
      return [];
    }
  }

  const proxy = new DiagnosticLLMProxy(llm);
  const results: NuggetTestResult[] = [];

  for (const tc of cases) {
    proxy.lastCall = null as any;
    const start = Date.now();

    try {
      const nugget = tc.create(proxy);
      const output = await nugget.run(tc.sampleInput);
      const validation = tc.validate(output);
      const durationMs = Date.now() - start;
      const call = proxy.getLastCall();

      results.push({
        name: tc.name,
        pass: validation.pass,
        validationMessage: validation.message,
        durationMs,
        adapter: proxy.adapterName || 'unknown',
        model: proxy.modelName || 'unknown',
        sampleInput: tc.sampleInput,
        renderedPrompt: call?.renderedPrompt ?? null,
        promptCharCount: call?.promptCharCount ?? 0,
        rawOutput: call?.rawOutput ?? null,
        outputCharCount: call?.outputCharCount ?? 0,
        parsedOutput: output,
        expectsJSON: nugget.expectsJSON,
        ttftMs: call?.ttftMs ?? null,
      });
    } catch (e: any) {
      const durationMs = Date.now() - start;
      const call = proxy.getLastCall();
      results.push({
        name: tc.name,
        pass: false,
        validationMessage: '',
        durationMs,
        error: e.message || String(e),
        adapter: proxy.adapterName || 'unknown',
        model: proxy.modelName || 'unknown',
        sampleInput: tc.sampleInput,
        renderedPrompt: call?.renderedPrompt ?? null,
        promptCharCount: call?.promptCharCount ?? 0,
        rawOutput: call?.rawOutput ?? null,
        outputCharCount: call?.outputCharCount ?? 0,
        parsedOutput: null,
        expectsJSON: false,
        ttftMs: call?.ttftMs ?? null,
      });
    }
  }

  return results;
}

// ============ REPORT GENERATION ============

function hr(char: string = '=', width: number = 80): string {
  return char.repeat(width);
}

function section(title: string): string {
  return `\n${hr('-')}\n${title}\n${hr('-')}`;
}

function indent(text: string, prefix: string = '  '): string {
  return text.split('\n').map(line => prefix + line).join('\n');
}

export function generateTextReport(results: NuggetTestResult[]): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;

  // Header
  lines.push(hr('='));
  lines.push('FRAKTAG NUGGET TEST REPORT');
  lines.push(hr('='));
  lines.push(`Timestamp:  ${now}`);
  lines.push(`Adapter:    ${results[0]?.adapter || 'unknown'}`);
  lines.push(`Model:      ${results[0]?.model || 'unknown'}`);
  lines.push(`Tests:      ${results.length} total, ${passed} passed, ${failed} failed`);
  lines.push(`Total time: ${results.reduce((sum, r) => sum + r.durationMs, 0)}ms`);
  lines.push(hr('='));

  // Per-nugget sections
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.pass ? 'PASS' : 'FAIL';
    const statusIcon = r.pass ? '[PASS]' : '[FAIL]';

    lines.push(`\n\n${hr('=')}`);
    lines.push(`${statusIcon} ${r.name}  (${r.durationMs}ms)`);
    lines.push(hr('='));

    // Metadata
    lines.push(`Adapter:      ${r.adapter}`);
    lines.push(`Model:        ${r.model}`);
    lines.push(`ExpectsJSON:  ${r.expectsJSON}`);
    lines.push(`Duration:     ${r.durationMs}ms`);
    if (r.ttftMs !== null) {
      lines.push(`TTFT:         ${r.ttftMs}ms`);
    }

    // Input
    lines.push(section('INPUT (API Arguments)'));
    lines.push(indent(JSON.stringify(r.sampleInput, null, 2)));

    // Rendered Prompt
    lines.push(section(`RENDERED PROMPT (${r.promptCharCount} chars)`));
    if (r.renderedPrompt) {
      lines.push(indent(r.renderedPrompt));
    } else {
      lines.push(indent('(not captured — LLM call may have failed before rendering)'));
    }

    // Raw Output
    lines.push(section(`RAW LLM OUTPUT (${r.outputCharCount} chars)`));
    if (r.rawOutput) {
      lines.push(indent(r.rawOutput));
    } else {
      lines.push(indent('(no output)'));
    }

    // Parsed Output
    lines.push(section('PARSED OUTPUT'));
    if (r.parsedOutput !== null && r.parsedOutput !== undefined) {
      const serialized = typeof r.parsedOutput === 'string'
        ? r.parsedOutput
        : JSON.stringify(r.parsedOutput, null, 2);
      lines.push(indent(serialized));
    } else {
      lines.push(indent('(parse failed or no output)'));
    }

    // Validation
    lines.push(section('VALIDATION'));
    lines.push(`  Result:  ${status}`);
    if (r.validationMessage) {
      lines.push(`  Detail:  ${r.validationMessage}`);
    }
    if (r.error) {
      lines.push(`  Error:   ${r.error}`);
    }
  }

  // Summary
  lines.push(`\n\n${hr('=')}`);
  lines.push('SUMMARY');
  lines.push(hr('='));
  for (const r of results) {
    const icon = r.pass ? '[PASS]' : '[FAIL]';
    const extra = r.error ? ` — ${r.error.slice(0, 60)}` : '';
    lines.push(`  ${icon} ${r.name.padEnd(28)} ${String(r.durationMs).padStart(6)}ms  prompt:${String(r.promptCharCount).padStart(6)}  output:${String(r.outputCharCount).padStart(6)}${extra}`);
  }
  lines.push('');
  lines.push(`Total: ${passed}/${results.length} passed  |  ${results.reduce((s, r) => s + r.durationMs, 0)}ms`);
  lines.push(hr('='));

  return lines.join('\n');
}
