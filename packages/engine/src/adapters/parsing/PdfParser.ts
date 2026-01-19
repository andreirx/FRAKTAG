import { IFileParser } from './IFileParser.js';
import { createRequire } from 'module';

// Initialize a require function for this ESM module
const require = createRequire(import.meta.url);

// Use require() to load the CJS library cleanly
const pdf = require('pdf-parse');

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
