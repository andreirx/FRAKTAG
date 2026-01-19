import { IFileParser } from '../adapters/parsing/IFileParser.js';
import { PdfParser } from '../adapters/parsing/PdfParser.js';
import { TextParser } from '../adapters/parsing/TextParser.js';

export class FileProcessor {
    private parsers: IFileParser[];

    constructor() {
        // Order matters: specific parsers first, generic fallback last
        this.parsers = [
            new PdfParser(),
            new TextParser()
        ];
    }

    async process(fileName: string, buffer: Buffer): Promise<string | null> {
        for (const parser of this.parsers) {
            if (parser.canHandle(fileName)) {
                try {
                    return await parser.parse(buffer);
                } catch (error) {
                    // If a parser claims it can handle it but fails (e.g. binary in .txt),
                    // we return null to skip ingestion.
                    console.warn(`Skipping ${fileName}:`, error instanceof Error ? error.message : error);
                    return null;
                }
            }
        }
        console.warn(`Skipping ${fileName}: No suitable parser found`);
        return null;
    }
}
