import { IFileParser } from './IFileParser.js';
import { extractText } from 'unpdf';

export class PdfParser implements IFileParser {
    canHandle(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.pdf');
    }

    async parse(buffer: Buffer): Promise<string> {
        try {
            const { text } = await extractText(buffer);

            // Handle edge case where unpdf might return undefined or empty
            const pages = Array.isArray(text) ? text : (text ? [text] : []);

            if (pages.length === 0) {
                console.warn("⚠️ PDF parsed but contained no text layer.");
                return "";
            }

            return pages.map((pageContent, index) => {
                // 1. Create Explicit Page Marker
                // We use a distinct delimiter that the Splitter Prompt can easily see
                const pageMarker = `\n\n---=== PAGE ${index + 1} ===---\n\n`;

                // 2. Detect Large Vertical Gaps (Chapter breaks often have 4+ newlines in raw text)
                // We use a regex replacer to count the newlines
                const contentWithBreaks = pageContent.replace(/(\n\s*){3,}/g, (match) => {
                    // Count roughly how many lines of whitespace
                    const count = match.split('\n').length;
                    return `\n\n---=== VERTICAL BREAK (~${count} lines) ===---\n\n`;
                });

                // 3. Normalize standard paragraphs (2 newlines)
                // This keeps normal text readable while preserving the structure we just marked
                const cleanContent = contentWithBreaks
                    .replace(/(\n\s*){2}/g, '\n\n') // Standard paragraph
                    .trim();

                return pageMarker + cleanContent;
            }).join(''); // Join with empty string because pageMarker handles spacing

        } catch (error) {
            console.error('PDF parsing failed:', error);
            throw new Error('Failed to parse PDF content');
        }
    }
}
