// packages/engine/src/core/ConversationManager.ts
// One Tree = One Conversation Session
// All conversation trees stored in Internal KB (main storage)

import { randomUUID } from 'crypto';
import { TreeStore } from './TreeStore.js';
import { ContentStore } from './ContentStore.js';
import { VectorStore } from './VectorStore.js';
import { DocumentNode, TreeConfig, ContentEditMode } from './types.js';

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
  id: string;       // Tree ID (conv-{uuid})
  title: string;
  startedAt: string;
  updatedAt: string;
  turnCount: number;
  linkedContext?: {
    kbId?: string;
    treeIds: string[];
  };
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
 * ConversationManager handles conversation persistence.
 * Each conversation is its own Tree (conv-{uuid}), stored in Internal KB.
 *
 * Structure per conversation tree:
 * - Root
 *   - Turn 01 - {question gist} (Folder)
 *     - Question (Document)
 *     - Answer (Document)
 *     - References (Document)
 *   - Turn 02 - ... (Folder)
 *     ...
 */
export class ConversationManager {
  constructor(
    private treeStore: TreeStore,
    private contentStore: ContentStore,
    private vectorStore: VectorStore
  ) {}

  /**
   * Creates a new conversation session as a separate Tree.
   */
  async createSession(
    title: string,
    linkedContext: { kbId?: string; treeIds: string[] }
  ): Promise<ConversationSession> {
    const sessionId = `conv-${randomUUID()}`;
    const now = new Date().toISOString();

    const config: TreeConfig = {
      id: sessionId,
      name: title || `Chat ${new Date().toLocaleDateString()}`,
      type: 'conversation',
      organizingPrinciple: 'Chronological log of user interactions.',
      autoPlace: false,
      linkedContext,
    };

    await this.treeStore.createTree(config);
    console.log(`📝 Created conversation tree: ${sessionId} (${config.name})`);

    return {
      id: sessionId,
      title: config.name,
      startedAt: now,
      updatedAt: now,
      turnCount: 0,
      linkedContext,
    };
  }

  /**
   * List all conversation sessions (trees with type='conversation')
   */
  async listSessions(): Promise<ConversationSession[]> {
    const trees = await this.treeStore.listTrees();

    const sessions: ConversationSession[] = [];
    for (const tree of trees) {
      // Match by type or by conv- prefix (backward compat)
      if (tree.type === 'conversation' || tree.id.startsWith('conv-')) {
        const turns = await this.treeStore.getChildren(tree.rootNodeId);
        sessions.push({
          id: tree.id,
          title: tree.name,
          startedAt: tree.createdAt,
          updatedAt: tree.updatedAt,
          turnCount: turns.length,
          linkedContext: tree.linkedContext,
        });
      }
    }

    // Sort by most recent first
    sessions.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return sessions;
  }

  /**
   * Logs a conversation turn into the session's tree.
   */
  async logTurn(
    sessionId: string,
    data: TurnData
  ): Promise<{ turnFolderId: string; turnIndex: number }> {
    const tree = await this.treeStore.getTree(sessionId);

    // Count existing turns
    const existingTurns = await this.treeStore.getChildren(tree.rootNodeId);
    const turnIndex = existingTurns.length + 1;

    const questionGist = data.question.length > 50
      ? data.question.slice(0, 50).trim() + '...'
      : data.question;

    // 1. Create Turn Folder
    const turnTitle = `Turn ${String(turnIndex).padStart(2, '0')} - ${questionGist}`;
    const turnFolder = await this.treeStore.createFolder(
      sessionId,
      tree.rootNodeId,
      turnTitle,
      `Q: ${questionGist}`
    );

    // 2. Create Question Document
    await this.createConversationDoc(sessionId, turnFolder.id, 'Question', data.question, 0, 'question');

    // 3. Create Answer Document
    await this.createConversationDoc(sessionId, turnFolder.id, 'Answer', data.answer, 1, 'answer');

    // 4. Create References Document (if any)
    if (data.references.length > 0) {
      const nodeIds = data.references.map(r => r.nodeId);
      await this.createConversationDoc(sessionId, turnFolder.id, 'References', JSON.stringify(nodeIds), 2, 'references');
    }

    console.log(`📝 Logged turn ${turnIndex} in conversation ${sessionId}`);
    return { turnFolderId: turnFolder.id, turnIndex };
  }

  private async createConversationDoc(
    treeId: string,
    parentId: string,
    title: string,
    text: string,
    sortOrder: number,
    role: 'question' | 'answer' | 'references'
  ): Promise<DocumentNode> {
    const atom = await this.contentStore.create({
      payload: text,
      mediaType: 'text/plain',
      createdBy: 'conversation-manager',
      editMode: 'readonly' as ContentEditMode
    });

    const doc = await this.treeStore.createDocument(
      treeId,
      parentId,
      title,
      text.slice(0, 100),
      atom.id,
      'readonly' as ContentEditMode
    );

    // Vectorize Q/A for recall within this conversation
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
   * Get all turns in a session
   */
  async getSessionTurns(sessionId: string): Promise<ConversationTurn[]> {
    const tree = await this.treeStore.getTree(sessionId);
    const turnFolders = await this.treeStore.getChildren(tree.rootNodeId);
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
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (typeof item === 'string') {
                  references.push({ nodeId: item });
                } else if (item.nodeId) {
                  references.push({ nodeId: item.nodeId });
                }
              }
            }
          } catch {
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

    turns.sort((a, b) => a.turnIndex - b.turnIndex);
    return turns;
  }

  /**
   * Update a session (title, linkedContext, etc.)
   */
  async updateSession(
    sessionId: string,
    updates: { title?: string }
  ): Promise<void> {
    const updateFields: any = {};
    if (updates.title) updateFields.name = updates.title;
    await this.treeStore.updateTreeConfig(sessionId, updateFields);
  }

  /**
   * Delete a conversation session (delete the entire tree)
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.treeStore.deleteTree(sessionId);
    console.log(`🗑️ Deleted conversation: ${sessionId}`);
  }
}
