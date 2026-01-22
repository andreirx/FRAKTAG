// src/adapters/llm/ILLMAdapter.ts

/**
 * Interface for LLM adapters
 * Provides a unified interface for different LLM providers
 */
export interface ILLMAdapter {
  /**
   * Complete a prompt with the configured LLM
   * @param prompt - The prompt template or direct prompt text
   * @param variables - Variables to substitute in the prompt (if using templates)
   * @param options - Optional maximum number of tokens
   * @returns The completion text from the LLM
   */
  complete(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    options?: { maxTokens?: number }
  ): Promise<string>;

  /**
   * Stream a completion from the LLM
   * @param prompt - The prompt template or direct prompt text
   * @param variables - Variables to substitute in the prompt (if using templates)
   * @param onChunk - Callback for each chunk of text received
   * @param options - Optional maximum number of tokens
   * @returns The full completion text
   */
  stream?(
    prompt: string,
    variables: Record<string, string | number | string[]>,
    onChunk: (chunk: string) => void,
    options?: { maxTokens?: number }
  ): Promise<string>;

  /**
   * Test the connection to the LLM service
   * @returns true if connection is successful, false otherwise
   */
  testConnection(): Promise<boolean>;
}
