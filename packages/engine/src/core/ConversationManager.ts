// packages/engine/src/core/ConversationManager.ts
// Handles conversation memory as a chronological log tree

import { randomUUID } from 'crypto';
import { TreeStore } from './TreeStore.js';
import { ContentStore } from './ContentStore.js';
import { VectorStore } from './VectorStore.js';
import { FolderNode, DocumentNode, TreeConfig, ContentEditMode } from './types.js';

// References are just nodeIds - content is fetched on demand (hydration)
export interface ConversationReference {
  nodeId: string;
}

export interface TurnData {
  question: string;
  answer: string;
  references: ConversationReference[];
  timestamp?: string;
}

export interface ConversationSession {
  id: string;
  treeId: string;
  title: string;
  startedAt: string;
  turnCount: number;
}

export interface ConversationTurn {
  turnIndex: number;
  question: string;
  answer: string;
  references: ConversationReference[];
  timestamp: string;
  folderId: string;
}

/**
 * ConversationManager handles the "Memory" persistence layer.
 * It stores conversations as a chronological log in a dedicated tree.
 *
 * Structure:
 * - Tree: conversations-{kbId}
 *   - Folder (L0): Session {date} - {first question gist}
 *     - Folder (Leaf): Turn 01 - {question gist}
 *       - Document: Question
 *       - Document: Answer
 *       - Document: References
 *     - Folder (Leaf): Turn 02 - {question gist}
 *       ...
 */
export class ConversationManager {
  constructor(
    private treeStore: TreeStore,
    private contentStore: ContentStore,
    private vectorStore: VectorStore
  ) {}

  /**
   * Get the conversation tree ID for a knowledge base
   */
  getConversationTreeId(kbId: string): string {
    return `conversations-${kbId}`;
  }

  /**
   * Ensures the conversation tree exists for a knowledge base.
   * Creates it if it doesn't exist.
   */
  async ensureConversationTree(kbId: string): Promise<string> {
    const treeId = this.getConversationTreeId(kbId);

    const exists = await this.treeStore.treeExists(treeId);
    if (!exists) {
      await this.treeStore.createTree({
        id: treeId,
        name: `Conversations (${kbId})`,
        organizingPrinciple: 'Chronological log of user interactions and AI responses',
        autoPlace: false
      } as TreeConfig);
      console.log(`📝 Created conversation tree: ${treeId}`);
    }

    return treeId;
  }

  /**
   * Creates a new conversation session.
   * Returns the session folder node.
   */
  async createSession(kbId: string, title?: string): Promise<FolderNode> {
    const treeId = await this.ensureConversationTree(kbId);
    const tree = await this.treeStore.getTree(treeId);

    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const sessionTitle = title || `Session ${dateStr}`;

    const sessionId = randomUUID();
    const sessionNode: FolderNode = {
      id: sessionId,
      treeId,
      parentId: tree.rootNodeId,
      path: `/${sessionId}/`,
      type: 'folder',
      title: sessionTitle,
      gist: `Started at ${now.toLocaleString()}`,
      sortOrder: now.getTime(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    await this.treeStore.createFolder(treeId, tree.rootNodeId, sessionTitle, sessionNode.gist);

    // Get the actual created node
    const children = await this.treeStore.getChildren(tree.rootNodeId);
    const created = children.find(c => c.title === sessionTitle);

    if (!created) {
      throw new Error('Failed to create session folder');
    }

    console.log(`💬 Created conversation session: ${sessionTitle}`);
    return created as FolderNode;
  }

  /**
   * Gets or creates a session for today
   */
  async getOrCreateTodaySession(kbId: string): Promise<FolderNode> {
    const treeId = await this.ensureConversationTree(kbId);
    const tree = await this.treeStore.getTree(treeId);

    const today = new Date().toISOString().split('T')[0];
    const sessionTitle = `Session ${today}`;

    // Check if session exists
    const children = await this.treeStore.getChildren(tree.rootNodeId);
    const existing = children.find(c => c.title === sessionTitle);

    if (existing) {
      return existing as FolderNode;
    }

    // Create new session
    return this.createSession(kbId, sessionTitle);
  }

  /**
   * Logs a conversation turn into the session.
   * This is "Programmatic Ingestion" - no AI splitting, just raw logging.
   */
  async logTurn(
    kbId: string,
    sessionId: string,
    data: TurnData
  ): Promise<{ turnFolderId: string; turnIndex: number }> {
    const treeId = await this.ensureConversationTree(kbId);

    // Get session folder
    const sessionNode = await this.treeStore.getNode(sessionId);
    if (!sessionNode || sessionNode.type !== 'folder') {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Count existing turns to get the next index
    const existingTurns = await this.treeStore.getChildren(sessionId);
    const turnIndex = existingTurns.length + 1;

    const now = new Date();
    const timestamp = data.timestamp || now.toISOString();

    // Generate gist from question
    const questionGist = data.question.length > 50
      ? data.question.slice(0, 50).trim() + '...'
      : data.question;

    // 1. Create Turn Folder (Leaf Folder)
    const turnTitle = `Turn ${String(turnIndex).padStart(2, '0')} - ${questionGist}`;
    const turnFolder = await this.treeStore.createFolder(
      treeId,
      sessionId,
      turnTitle,
      `Q: ${questionGist}`
    );

    // 2. Create Question Document
    await this.createConversationDoc(
      treeId,
      turnFolder.id,
      'Question',
      data.question,
      0,
      'question'
    );

    // 3. Create Answer Document
    await this.createConversationDoc(
      treeId,
      turnFolder.id,
      'Answer',
      data.answer,
      1,
      'answer'
    );

    // 4. Create References Document (if any) - just store nodeIds
    if (data.references.length > 0) {
      // Extract just nodeIds for storage
      const nodeIds = data.references.map(r => r.nodeId);
      const refJson = JSON.stringify(nodeIds);

      await this.createConversationDoc(
        treeId,
        turnFolder.id,
        'References',
        refJson,
        2,
        'references'
      );
    }

    // Update session gist with latest turn info
    const updatedSession = await this.treeStore.getNode(sessionId);
    if (updatedSession) {
      updatedSession.gist = `${existingTurns.length + 1} turns - Last: ${questionGist}`;
      updatedSession.updatedAt = now.toISOString();
      await this.treeStore.saveNode(updatedSession);
    }

    console.log(`📝 Logged turn ${turnIndex} in session ${sessionNode.title}`);

    return { turnFolderId: turnFolder.id, turnIndex };
  }

  /**
   * Creates a document within a turn folder
   */
  private async createConversationDoc(
    treeId: string,
    parentId: string,
    title: string,
    text: string,
    sortOrder: number,
    role: 'question' | 'answer' | 'references'
  ): Promise<DocumentNode> {
    // 1. Store Content
    const atom = await this.contentStore.create({
      payload: text,
      mediaType: 'text/plain',
      createdBy: 'conversation-manager',
      editMode: 'readonly' as ContentEditMode
    });

    // 2. Create Document Node
    const doc = await this.treeStore.createDocument(
      treeId,
      parentId,
      title,
      text.slice(0, 100), // Gist is first 100 chars
      atom.id,
      'readonly' as ContentEditMode
    );

    // 3. Vectorize Question and Answer (not references) for recall
    if (role === 'question' || role === 'answer') {
      try {
        await this.vectorStore.add(doc.id, text);
        await this.vectorStore.save(treeId);
      } catch (err) {
        console.warn(`⚠️ Could not vectorize ${role}: ${err}`);
      }
    }

    return doc;
  }

  /**
   * List all sessions for a knowledge base
   */
  async listSessions(kbId: string): Promise<ConversationSession[]> {
    const treeId = this.getConversationTreeId(kbId);

    const exists = await this.treeStore.treeExists(treeId);
    if (!exists) {
      return [];
    }

    const tree = await this.treeStore.getTree(treeId);
    const sessions = await this.treeStore.getChildren(tree.rootNodeId);

    const result: ConversationSession[] = [];
    for (const session of sessions) {
      if (session.type !== 'folder') continue;

      const turns = await this.treeStore.getChildren(session.id);
      result.push({
        id: session.id,
        treeId,
        title: session.title,
        startedAt: session.createdAt,
        turnCount: turns.length
      });
    }

    // Sort by most recent first
    result.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    return result;
  }

  /**
   * Get all turns in a session
   */
  async getSessionTurns(sessionId: string): Promise<ConversationTurn[]> {
    const session = await this.treeStore.getNode(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const turnFolders = await this.treeStore.getChildren(sessionId);
    const turns: ConversationTurn[] = [];

    for (const turnFolder of turnFolders) {
      if (turnFolder.type !== 'folder') continue;

      const docs = await this.treeStore.getChildren(turnFolder.id);

      let question = '';
      let answer = '';
      const references: ConversationReference[] = [];

      for (const doc of docs) {
        if (doc.type !== 'document') continue;

        const content = await this.contentStore.get((doc as DocumentNode).contentId);
        const text = content?.payload || '';

        if (doc.title === 'Question') {
          question = text;
        } else if (doc.title === 'Answer') {
          answer = text;
        } else if (doc.title === 'References') {
          // Parse references - supports multiple formats for backward compatibility
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              // Could be array of strings (nodeIds) or array of objects
              for (const item of parsed) {
                if (typeof item === 'string') {
                  // New format: just nodeIds
                  references.push({ nodeId: item });
                } else if (item.nodeId) {
                  // Legacy JSON format with full objects
                  references.push({ nodeId: item.nodeId });
                }
              }
            }
          } catch {
            // Legacy text format: [1] **Title**\nNode: nodeId\nsnippet
            const refBlocks = text.split('\n\n---\n\n');
            for (const block of refBlocks) {
              const nodeMatch = block.match(/Node: (.+)/);
              if (nodeMatch) {
                references.push({ nodeId: nodeMatch[1] });
              }
            }
          }
        }
      }

      // Extract turn index from title "Turn 01 - ..."
      const turnMatch = turnFolder.title.match(/Turn (\d+)/);
      const turnIndex = turnMatch ? parseInt(turnMatch[1]) : turns.length + 1;

      turns.push({
        turnIndex,
        question,
        answer,
        references,
        timestamp: turnFolder.createdAt,
        folderId: turnFolder.id
      });
    }

    // Sort by turn index
    turns.sort((a, b) => a.turnIndex - b.turnIndex);

    return turns;
  }

  /**
   * Update a session (title, etc.)
   */
  async updateSession(
    sessionId: string,
    updates: { title?: string }
  ): Promise<ConversationSession> {
    const session = await this.treeStore.getNode(sessionId);
    if (!session || session.type !== 'folder') {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Apply updates
    if (updates.title) {
      session.title = updates.title;
    }
    session.updatedAt = new Date().toISOString();

    await this.treeStore.saveNode(session);

    // Get turn count
    const turns = await this.treeStore.getChildren(sessionId);

    return {
      id: session.id,
      treeId: session.treeId,
      title: session.title,
      startedAt: session.createdAt,
      turnCount: turns.length
    };
  }

  /**
   * Delete a session and all its turns
   */
  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.treeStore.getNode(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Get all turn folders
    const turns = await this.treeStore.getChildren(sessionId);

    // Delete each turn's documents and content
    for (const turn of turns) {
      const docs = await this.treeStore.getChildren(turn.id);
      for (const doc of docs) {
        if (doc.type === 'document') {
          // Delete content
          await this.contentStore.delete((doc as DocumentNode).contentId);
          // Remove from vector store
          await this.vectorStore.remove(doc.id);
        }
      }
    }

    // Delete the session folder (cascades to children)
    await this.treeStore.deleteNode(sessionId);

    console.log(`🗑️ Deleted conversation session: ${session.title}`);
  }
}
