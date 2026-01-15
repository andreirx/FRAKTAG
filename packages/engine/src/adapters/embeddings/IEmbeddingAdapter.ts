export interface IEmbeddingAdapter {
    embed(text: string): Promise<number[]>;
}
