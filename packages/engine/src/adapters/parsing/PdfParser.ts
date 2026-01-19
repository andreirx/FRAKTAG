// packages/engine/src/adapters/parsing/PdfParser.ts

import { IFileParser } from './IFileParser.js';
import { extractText } from 'unpdf';

export class PdfParser implements IFileParser {
  canHandle(fileName: string): boolean {
    return fileName.toLowerCase().endsWith('.pdf');
  }

  async parse(buffer: Buffer): Promise<string> {
    try {
      // FIX: Convert Node.js Buffer to standard Uint8Array
      // We slice the underlying ArrayBuffer to ensure we get exactly the data view
      // This strips the "Buffer" prototype and satisfies unpdf's strict check
      const standardData = new Uint8Array(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      );

      const { text } = await extractText(standardData);
      
      // Handle edge case where unpdf might return undefined or empty
      const pages = Array.isArray(text) ? text : (text ? [text] : []);

      if (pages.length === 0) {
        console.warn("⚠️ PDF parsed but contained no text layer (Scanned image?).");
        return "";
      }

      return pages.map((pageContent, index) => {
        // 1. Create Explicit Page Marker
        const pageMarker = `\n\n---=== PAGE ${index + 1} ===---\n\n`;

        // 2. Detect Large Vertical Gaps
        const contentWithBreaks = pageContent.replace(/(\n\s*){3,}/g, (match) => {
           const count = match.split('\n').length;
           return `\n\n---=== VERTICAL BREAK (~${count} lines) ===---\n\n`;
        });

        // 3. Normalize standard paragraphs
        const cleanContent = contentWithBreaks
            .replace(/(\n\s*){2}/g, '\n\n')
            .trim();

        return pageMarker + cleanContent;
      }).join(''); 

    } catch (error) {
      console.error('PDF parsing failed:', error);
      throw new Error('Failed to parse PDF content');
    }
  }
}
