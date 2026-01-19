import { IFileParser } from './IFileParser.js';

export class TextParser implements IFileParser {
    // Extensions known to be text
    private textExtensions = new Set([
        '.txt', '.md', '.markdown', '.json', '.js', '.ts', '.py', '.go',
        '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yaml',
        '.yml', '.sh', '.bash', '.env'
    ]);

    // Extensions known to be binary (fast fail)
    private binaryExtensions = new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
        '.zip', '.tar', '.gz', '.7z', '.rar',
        '.exe', '.bin', '.dll', '.so', '.dylib',
        '.pdf', // Handled by PdfParser
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx' // TODO: Add DocxParser later
    ]);

    canHandle(fileName: string): boolean {
        // We handle everything that isn't explicitly binary
        // The parse method will do a content check to be sure
        const ext = '.' + fileName.split('.').pop()?.toLowerCase();
        return !this.binaryExtensions.has(ext);
    }

    async parse(buffer: Buffer): Promise<string> {
        if (this.isBinary(buffer)) {
            throw new Error('Detected binary content in text parser');
        }
        return buffer.toString('utf-8');
    }

    /**
     * Heuristic: Check for null bytes in the first 1024 bytes
     */
    private isBinary(buffer: Buffer): boolean {
        const checkLen = Math.min(buffer.length, 1024);
        for (let i = 0; i < checkLen; i++) {
            if (buffer[i] === 0x00) return true; // Null byte indicates binary
        }
        return false;
    }
}
