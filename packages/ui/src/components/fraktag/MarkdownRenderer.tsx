import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with Tailwind Typography styling.
 * Uses prose classes for beautiful, readable formatting.
 */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  if (!content) {
    return <span className="text-zinc-400 italic">No content available</span>;
  }

  return (
    <div className={`prose prose-zinc prose-sm max-w-none
      prose-headings:font-semibold prose-headings:text-zinc-800
      prose-h1:text-xl prose-h1:border-b prose-h1:border-zinc-200 prose-h1:pb-2
      prose-h2:text-lg prose-h2:mt-6
      prose-h3:text-base
      prose-p:text-zinc-600 prose-p:leading-relaxed
      prose-a:text-purple-600 prose-a:no-underline hover:prose-a:underline
      prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-code:text-pink-600
      prose-pre:p-0 prose-pre:bg-transparent
      prose-blockquote:border-l-purple-400 prose-blockquote:bg-purple-50/50 prose-blockquote:py-1
      prose-li:text-zinc-600
      prose-strong:text-zinc-800
      prose-hr:border-zinc-200
      prose-table:border-collapse prose-table:w-full prose-table:text-sm
      prose-th:border prose-th:border-zinc-300 prose-th:bg-zinc-100 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold
      prose-td:border prose-td:border-zinc-200 prose-td:px-3 prose-td:py-2
      ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');

            // Check if this is a code block (has language) or inline code
            if (match) {
              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{ margin: 0, borderRadius: '0.5rem', fontSize: '0.875rem' }}
                >
                  {codeString}
                </SyntaxHighlighter>
              );
            }

            // Inline code - use default styling
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
