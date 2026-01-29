from huggingface_hub import snapshot_download

print("⬇️  Downloading Chat Model (Qwen 30B)...")
snapshot_download(repo_id="mlx-community/Qwen3-Coder-30B-A3B-Instruct-6bit")

print("\n⬇️  Downloading Embedding Model (Nomic 1.5)...")
snapshot_download(repo_id="nomic-ai/nomic-embed-text-v1.5")

print("\n✅ Downloads Complete!")
