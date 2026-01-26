import { useState, useEffect, useRef } from 'react';
import { Pencil, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { MarkdownRenderer } from './MarkdownRenderer';

interface EditableContentProps {
  content: string;
  onChange: (value: string) => void;
  onSave?: () => void;
  placeholder?: string;
}

/**
 * Editable content component with markdown preview.
 * - Default: Shows rendered markdown with "Edit" button
 * - Edit mode: Shows raw textarea with "Done" button
 * - Done button triggers save and returns to preview mode
 */
export function EditableContent({
  content,
  onChange,
  onSave,
  placeholder = "Start writing..."
}: EditableContentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [localContent, setLocalContent] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync with external content changes (e.g., from parent state)
  useEffect(() => {
    if (!isEditing) {
      setLocalContent(content);
    }
  }, [content, isEditing]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      // Place cursor at end
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  const handleEdit = () => {
    setLocalContent(content);
    setIsEditing(true);
  };

  const handleDone = () => {
    // Push changes to parent
    onChange(localContent);
    setIsEditing(false);
    // Trigger save after state update
    if (onSave) {
      setTimeout(onSave, 50);
    }
  };

  const handleChange = (value: string) => {
    setLocalContent(value);
    // Also update parent for any intermediate saves
    onChange(value);
  };

  // Handle Escape to cancel, Cmd/Ctrl+Enter to save
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setLocalContent(content);
      setIsEditing(false);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      handleDone();
    }
  };

  if (isEditing) {
    return (
      <div className="flex flex-col h-full">
        {/* Edit mode header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-amber-50 border-b border-amber-200">
          <div className="flex items-center gap-2 text-amber-700 text-xs font-medium">
            <Pencil className="w-3.5 h-3.5" />
            Editing (Markdown)
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-600">
              Esc to cancel, {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to save
            </span>
            <Button
              size="sm"
              onClick={handleDone}
              className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-3 text-xs"
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              Done
            </Button>
          </div>
        </div>

        {/* Textarea - uses viewport height for substantial editing area */}
        <textarea
          ref={textareaRef}
          value={localContent}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full flex-1 min-h-[50vh] p-6 text-sm font-mono text-zinc-700 bg-white border-0 resize-none focus:outline-none focus:ring-0"
          placeholder={placeholder}
        />
      </div>
    );
  }

  // Preview mode
  return (
    <div className="flex flex-col h-full">
      {/* Preview mode header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-50 border-b border-zinc-200">
        <div className="text-xs text-zinc-500 font-medium">
          Preview
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleEdit}
          className="h-7 px-3 text-xs"
        >
          <Pencil className="w-3.5 h-3.5 mr-1" />
          Edit
        </Button>
      </div>

      {/* Rendered content */}
      <div className="flex-1 overflow-auto p-6">
        {localContent ? (
          <MarkdownRenderer content={localContent} />
        ) : (
          <div
            className="text-zinc-400 italic cursor-pointer hover:text-zinc-500"
            onClick={handleEdit}
          >
            {placeholder} (click to edit)
          </div>
        )}
      </div>
    </div>
  );
}
