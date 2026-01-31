# FRAKTAG: Lessons Learned

## Meta-Lesson: Ingestion Quality Determines Retrieval Quality

**The Core Insight**: FRAKTAG's evolution was driven by one hard truth — garbage in creates garbage out. No amount of clever retrieval algorithms can compensate for poorly structured knowledge. The entire architecture evolved to enforce this principle.

---

## 1. LESSON: Automated Ingestion Is Seductive But Broken

### What I Tried
Automatic document splitting and tree placement using AI. The system would analyze documents, detect structure, and organize them into folders without human intervention.

### What Happened
- Bad splits: AI broke documents at arbitrary points, destroying semantic coherence
- Malformed trees: AI created nonsensical folder hierarchies that didn't match human mental models
- No recovery: Once ingested poorly, retrieval was permanently degraded

### What I Learned
**AI is good at proposing structure. Humans are good at approving structure.** The solution is not full automation, but proposal-based workflow with human gatekeeping.

### What I Built
React wizard with:
- Document minimap showing proposed splits
- Human review and merge capability
- Override folder placement
- TreeStore enforcement of strict taxonomy (Folders vs Documents vs Fragments)

### Key Takeaway
Treat ingestion as a one-time curation event, not a batch import operation. Spend 10 minutes curating a document. Save hours debugging bad retrieval.

---

## 2. LESSON: Magic Strings Kill Multi-Model Compatibility

### What I Tried
Prompt strings scattered throughout codebase. Inline string interpolation. No type safety.

### What Happened
- Model upgrades changed output format (Markdown wrapping instead of raw JSON)
- Local quantized models (4-bit, 6-bit) returned invalid JSON
- System parsed, failed, crashed
- No way to test prompts in isolation

### What I Learned
**LLMs are stochastic. Non-deterministic. Treat them like unreliable network calls, not pure functions.**

### What I Built
**Nugget Architecture**:
- Self-contained typed units of cognition (GlobalMapScan, AssessNeighborhood, GenerateGist)
- Each Nugget encapsulates prompt + input/output schema + validation logic
- `extractJSON` with regex cleanup handles model inconsistency
- Isolated testing: `fkt test-nugget` against different models

### Key Takeaway
Prompt engineering becomes software engineering when you formalize prompts as typed functions with validation. The brittleness is in the interface, not the model.

---

## 3. LESSON: Hardcoded Infrastructure Is Non-Portable

### What I Tried
Direct calls to `fs.readFile`, `OpenAI API`, `local filesystem paths`. Code assumed single execution environment.

### What Happened
Code worked on local Mac. Did not work on AWS Lambda. Could not deploy to cloud without major rewrites.

### What I Learned
**Local workstations and cloud Lambdas have mutually exclusive constraints:**
- Local: Stateful, low latency, filesystem access, limited concurrency
- Cloud: Stateless, high latency, S3 access, unlimited concurrency

Hardcoding either path prevents the other.

### What I Built
**Hexagonal Architecture (Ports & Adapters)**:
- `IStorage` interface: Implemented by `JsonStorage` (local) and `S3Storage` (cloud)
- `ILLMAdapter` interface: Implemented by `OpenAIAdapter`, `OllamaAdapter`, `MLXAdapter`
- Core domain (`Fractalizer`, `Navigator`) is pure TypeScript, infrastructure-agnostic

Three production setups now work:
1. **Cloud (SaaS)**: OpenAI + S3 + Lambda (10+ parallel requests)
2. **AMD Strix Halo (Local)**: Ollama + JsonStorage (Linux/Windows workstations)
3. **Apple Silicon (Local)**: MLX + JsonStorage (custom Python sidecar, bypasses Docker)

### Key Takeaway
Treat infrastructure as interchangeable adapters. LLMs are CPUs. Storage is RAM. The core logic should not care which ones it's using.

---

## 4. LESSON: Vector Search Alone Misses Structural Context

### What I Tried
Standard RAG: Chunk documents, embed chunks, vector search on user query.

### What Happened
Could not answer structural questions like "What are the main topics in the Engineering folder?" because vector search has no concept of hierarchy. Treated root-level policy document same as footnote in sub-folder.

### What I Learned
**Vector search finds semantic matches. Graph traversal finds structural relationships. Neither alone is sufficient.**

### What I Built
**Strict Taxonomy + Multi-Modal Retrieval**:
- Enforced schema: Folders (structure) vs Documents (content) vs Fragments (chunks)
- Persisted as graph (tree) structure
- Multi-stage ensemble retrieval:
    1. **Vector Neighborhood (Scout)**: Fast semantic search, finds deep fragments
    2. **Global Map Scan (Strategist)**: LLM analyzes tree structure, finds branches vector search misses (vocabulary mismatch, structural relevance)
    3. **Precision Drill**: Recursive exploration of candidate branches

### Key Takeaway
Vector search is fast and imprecise. Graph traversal is slow and structural. Ensemble beats either alone. Pay the latency cost for accuracy.

---

## 5. LESSON: Single-File Conversation Storage Does Not Scale

### What I Tried
Stored all conversations in single `conversations.json` tree file.

### What Happened
- O(N) performance degradation as history grew
- I/O cost of reading/writing a simple "Hello" increased linearly
- Memory bloat loading entire conversation tree
- Risk of "context bleed" where vector index of one massive tree pollutes results of another

### What I Learned
**Conversations are unbounded. Single-file storage creates linear degradation.**

### What I Built
**One Tree Per Session**:
- Sharded conversations into individual files (`conv-{uuid}.json`)
- O(1) load time regardless of total history size
- Session trees contain `linkedContext` metadata pointing to external knowledge bases discussed
- Conversations become first-class knowledge artifacts, not throwaway logs

### Key Takeaway
Conversations are data. Treat them like knowledge. Make them portable, versionable, and shareable.

---

## 6. LESSON: Local GPUs Cannot Handle Cloud-Scale Concurrency

### What I Tried
Used same parallel execution strategy on local hardware as cloud APIs.

### What Happened
**VRAM thrashing**: Local GPU constantly swapped model weights or KV caches when handling 10+ parallel requests. Led to:
- Timeouts
- Crashes
- Garbage output (hallucination, syntax errors)

### What I Learned
**Cloud APIs (OpenAI) scale horizontally. Local hardware (Apple Silicon, AMD) scales vertically.**

Firing 10 requests at local GPU causes thrashing. Firing 10 requests at OpenAI API works fine.

### What I Built
**Concurrency Control (Semaphores & Locks)**:
- Async `Semaphore` in LLM adapters
- `asyncio.Lock` in Python runner
- Forces serial execution (queue: 1) on local hardware
- Allows parallel execution on cloud
- Hardware constraint becomes config parameter, not hardcoded behavior

### Key Takeaway
GPU is not CPU. Respect hardware constraints. Serialize on local. Parallelize on cloud. Make it configurable.

---

## 7. LESSON: Large Context Windows Are Marketing, Not Reality

### What I Tried
Fed 200k character maps to local 30B models claiming 128k context windows.

### What Happened
**Gibberish output.** Models hallucinated, lost coherence, returned syntax errors.

### What I Learned
**Models claim 128k context. Reasoning accuracy degrades sharply as context fills ("Lost in the Middle" phenomenon).** Quantization makes this worse.

Local models have **effective attention span** much smaller than advertised context window.

### What I Built
**Chunking Discipline**:
- Reduced Global Map Scan chunk size: 200k → 25k characters
- Hard-limited context to 32k tokens in config
- **Reliability over capacity**: Better to perform 5 small, accurate serial scans than 1 massive, hallucinated parallel scan

**Quantization Standards**:
- Standardized on 8-bit or 6-bit quantization for local models (Qwen 30B)
- 4-bit models suffer syntax degradation (broken JSON) during complex reasoning
- Lower bit depth = faster inference but unreliable structured output

### Key Takeaway
Context is managed resource. RAM is not infinite. Budget it. Respect effective attention span, not marketing claims.

---

## 8. LESSON: Type Safety Matters More With Stochastic Systems

### What I Tried
Assumed LLM outputs would be consistent. Parsed JSON directly without validation.

### What Happened
- Models returned Markdown-wrapped JSON
- Models returned partial JSON (truncated)
- Models returned malformed JSON (trailing commas, unquoted keys)
- System crashed on parse failures

### What I Learned
**Deterministic systems can rely on type contracts. Stochastic systems cannot.** LLMs are closer to unreliable network calls than pure functions.

### What I Built
**Validation-First Parsing**:
- `extractJSON` function with regex cleanup (strips Markdown fences, fixes common syntax errors)
- Schema validation on extracted objects (Zod/TypeScript)
- Graceful degradation: Return partial results instead of crashing
- Nugget architecture enforces this pattern (each Nugget validates its own output)

### Key Takeaway
With stochastic systems, validate everything. Trust nothing. Build defense-in-depth validation layers.

---

## 9. LESSON: Portability Requires Self-Contained Artifacts

### What I Tried
Stored knowledge bases as database tables with external dependencies (vector indexes in separate services, metadata in SQL).

### What Happened
Knowledge bases were not portable. Could not:
- Git version them
- Share via USB
- Sync to S3 without complex migration scripts
- Move between environments without database schema compatibility

### What I Learned
**Knowledge should be filesystem artifacts, not database records.**

### What I Built
**Self-Contained Knowledge Bases**:
- Directory structure: `kb.json` (metadata) + `content/` (immutable content, SHA-256 deduplicated) + `indexes/` (vector embeddings) + `trees/` (organizational views)
- No external database dependencies
- Git-versionable
- Copy directory = copy knowledge base
- Portable across cloud/local/Mac/Windows

### Key Takeaway
If knowledge lives in a database, you don't own it. If knowledge lives in directories, you can copy it, version it, share it.

---

## 10. LESSON: Human-in-the-Loop Is Not a Compromise, It's the Architecture

### What I Tried
Initially: Fully automated AI system.
After failure: Grudgingly added human review as "temporary workaround."

### What I Learned
**Human-in-the-loop is not a bug. It's the feature.**

AI excels at proposing. Humans excel at approving. The correct architecture is:
1. AI analyzes and proposes structure
2. Human reviews and curates
3. System enforces quality via strict gates (TreeStore taxonomy)

This is not "AI augmenting humans" or "humans augmenting AI." It's a **division of labor based on comparative advantage.**

### What I Built
**Proposal-Based Workflow**:
- AI proposes document splits (regex, TOC detection, structural analysis)
- React wizard shows minimap, allows merge/rename/override
- TreeStore gatekeeper enforces taxonomy (Folders vs Documents vs Fragments, no mixed concerns)
- Human approval required before commit
- Audit log tracks every decision (actor: HUMAN, AI, or SYSTEM)

### Key Takeaway
Stop trying to remove humans from the loop. Design the loop to leverage human judgment where it matters (curation, quality gates) and AI speed where it matters (analysis, proposals).

---

## Strategic Lessons

### On Multi-Platform Support
**Decision**: Support three runtime environments (Cloud, AMD Local, Apple Local) from day one.

**Why it mattered**: Forced clean abstractions early. Hexagonal architecture was not optional. The constraints (stateful vs stateless, filesystem vs S3, parallel vs serial) became interface contracts, not implementation details.

**Cost**: 2-3x development time upfront.
**Benefit**: Zero refactoring cost when adding new adapters (e.g., Azure OpenAI, Anthropic Claude).

### On Quantization
**Decision**: Standardize on 8-bit/6-bit, reject 4-bit despite faster inference.

**Why it mattered**: 4-bit quantization breaks structured output (JSON) during complex reasoning. The speed gain is worthless if output is garbage.

**Trade-off**: Slower inference, higher VRAM usage.
**Result**: Reliable output. Worth the cost.

### On Context Budgeting
**Decision**: Hard-limit context to 32k tokens, chunk to 25k characters.

**Why it mattered**: Effective attention span << advertised context window. Respecting real limits prevents hallucination.

**Trade-off**: More serial requests, higher latency.
**Result**: Accuracy over speed. Correct trade-off for knowledge engine.

### On Conversations as Knowledge
**Decision**: Treat conversations as first-class knowledge artifacts (one tree per session, linkedContext metadata, portable).

**Why it mattered**: Conversations contain context about how knowledge was used. That context is valuable. Don't throw it away.

**Result**: Conversations become searchable, versionable, shareable. Not just logs.

---

## Architecture Principles That Emerged

### 1. Interchangeable Infrastructure
LLMs are CPUs. Storage is RAM. Network calls are I/O. Core logic should not know which ones it's using.

### 2. Validation-First Stochastic Outputs
LLMs are unreliable network calls. Parse defensively. Validate aggressively. Fail gracefully.

### 3. Human Curation as Quality Gate
AI proposes. Human approves. System enforces. This is the division of labor.

### 4. Portability as First-Class Requirement
Knowledge bases are directories. Copy them. Git version them. Share them. No database lock-in.

### 5. Hardware Constraints as Configuration
Cloud scales horizontally (parallel). Local scales vertically (serial). Make concurrency configurable, not hardcoded.

### 6. Reliability Over Capacity
Smaller context, higher accuracy. Slower inference, structured output. Quality over speed.

### 7. Ensemble Over Single Strategy
Vector search (fast, imprecise) + Graph traversal (slow, structural) beats either alone. Pay latency cost for accuracy.

---

## What This Architecture Enables

**Company of One**: A single architect augmented by AI needs a second brain that does not forget. FRAKTAG is that brain.

**Multi-Platform Deployment**: Same core logic runs on AWS Lambda (production SaaS), AMD workstations (local privacy), Apple Silicon (development). LLMs are interchangeable.

**Portable Knowledge**: Knowledge bases are self-contained directories. Git version them. Share via USB. Sync to S3. No vendor lock-in.

**Type-Safe Cognition**: LLM calls are typed functions with validation. Stochastic systems become predictable interfaces.

**Human-Curated Quality**: AI proposes. Human approves. Garbage in does not become garbage out.

**Ensemble Retrieval**: Vector search finds semantic matches. Graph traversal finds structural context. Combine both for high-fidelity answers.

---

## What I Would Do Differently

### 1. Start with Hexagonal Architecture from Day One
Don't hardcode infrastructure. Abstract I/O into interfaces immediately. The pain of clean separation is lower upfront than the cost of refactoring later.

### 2. Treat Prompts as Code from the Start
Formalize prompts as Nugget classes on first use. Do not scatter magic strings. The discipline pays off immediately when switching models.

### 3. Budget Context Conservatively
Do not trust advertised context windows. Start with 25k character chunks and 32k token limits. Increase only if needed. Reliability first.

### 4. Enforce Taxonomy Early
Do not allow mixed Folder/Document concerns. Strict schema prevents bad ingestion. Bad ingestion is permanent damage.

### 5. Log Everything with Actor Attribution
Audit logs are not optional. Track every decision (HUMAN, AI, SYSTEM) with timestamps. Essential for debugging and understanding system behavior.

---

## Repo
https://github.com/andreirx/FRAKTAG