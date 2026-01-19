export interface IFileParser {
    /**
     * Can this parser handle this file?
     */
    canHandle(fileName: string, mimeType?: string): boolean;

    /**
     * Convert buffer to text
     */
    parse(buffer: Buffer): Promise<string>;
}
