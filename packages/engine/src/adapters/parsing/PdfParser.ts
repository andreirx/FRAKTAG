import { IFileParser } from './IFileParser.js';
// @ts-ignore - Fixes TS1192. Runtime works because Node handles CJS default exports.
import pdf from 'pdf-parse';

export class PdfParser implements IFileParser {
    canHandle(fileName: string): boolean {
        return fileName.toLowerCase().endsWith('.pdf');
    }

    async parse(buffer: Buffer): Promise<string> {
        try {
            const data = await pdf(buffer);
            // Clean up common PDF artifacts (page numbers, excessive whitespace)
            return data.text
                .replace(/\n\s*\n/g, '\n\n') // Collapse excessive newlines
                .trim();
        } catch (error) {
            console.error('PDF parsing failed:', error);
            throw new Error('Failed to parse PDF content');
        }
    }
}
