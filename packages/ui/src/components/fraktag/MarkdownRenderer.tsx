import ReactMarkdown from 'react-markdown';

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
      prose-pre:bg-zinc-900 prose-pre:text-zinc-100 prose-pre:rounded-lg prose-pre:overflow-x-auto
      prose-blockquote:border-l-purple-400 prose-blockquote:bg-purple-50/50 prose-blockquote:py-1
      prose-li:text-zinc-600
      prose-strong:text-zinc-800
      prose-hr:border-zinc-200
      ${className}`}
    >
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
