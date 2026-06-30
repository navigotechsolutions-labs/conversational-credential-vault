import { Router, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { query } from '../db';
import { encryptSecret, hashPlaintext } from '../crypto';
import { requireAuth, sensitiveLimiter } from '../middleware/auth';
import { AuthenticatedRequest } from '../middleware/auth';
import { sessionStore } from '../sessionStore';

const router = Router();

// Apply auth guards and rate limiting
router.use(requireAuth);
router.use(sensitiveLimiter);

// Helper to log access actions
async function logAccess(itemId: string | null, action: string) {
  try {
    await query(
      'INSERT INTO access_log (item_id, action, occurred_at) VALUES ($1, $2, now())',
      [itemId, action]
    );
  } catch (err) {
    console.error('Failed to log access action:', err);
  }
}

router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const cleanMessage = message.trim();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key is not configured on the backend.' });
    }

    const ai = new GoogleGenAI({ apiKey });

    // 1. Intent Classification
    const classificationPrompt = `
You are the intent classifier for a secure personal vault called "Core Vault".
Determine if the user's message is an attempt to:
1. "save": Storing a secret, password, API key, URL, script, or note (e.g. pasting a token, username/passwords, or saying "save this password: ...").
2. "retrieve": Querying or searching to retrieve a credential or note (e.g. "what is the key for X?", "where is Y?", "search Z", "give me my server IP").
3. "greet": A standard greeting, general conversation, or asking for help (e.g. "hello", "hi", "how does this work?").

User Message:
"""
${cleanMessage}
"""

Return a JSON object:
{
  "intent": "save" | "retrieve" | "greet",
  "reasoning": "brief explanation"
}
`;

    let classificationResult;
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: classificationPrompt,
        config: { responseMimeType: 'application/json' }
      });
      classificationResult = JSON.parse(response.text?.trim() || '{}');
    } catch (err) {
      console.error('Gemini classification failed, default to retrieve:', err);
      classificationResult = { intent: 'retrieve' };
    }

    const intent = classificationResult.intent || 'retrieve';

    // === CASE A: GREET / HELP ===
    if (intent === 'greet') {
      return res.json({
        text: "Hello! I am your Core Vault Brain. 🧠\n\n- **To Save**: Simply paste any raw text (an API key, server login, repo link, or script note) and click send. I will automatically extract, label, tag, and securely encrypt it.\n- **To Retrieve**: Ask me a question in plain English (e.g., *'What is the DeepSeek key I use for signals?'* or *'Show my prompt notes'*), and I will fetch it instantly.",
        intent: 'greet'
      });
    }

    // === CASE B: SAVE INTENT ===
    if (intent === 'save') {
      const parsePrompt = `
Extract structured metadata fields from this raw text pasted for storage in a secure vault.
Text to analyze:
"""
${cleanMessage}
"""

Extract:
- title: Short descriptive title (e.g. "Claude API Key", "WhatsApp Webhook URL")
- type: One of "api_key", "password", "repo_link", "note", "snippet"
- service: Service name (e.g. "Anthropic", "Hostinger") if applicable, otherwise null
- project: Project/use case name if mentioned or implied, default to "General"
- username: Username or email if present, otherwise null
- url: URL if present, otherwise null
- secret_value: The sensitive credential itself (the key, password, URL, or code token). If the entire text is a note or script, the entire text is the secret_value.
- notes: Extra context or descriptions if any.
- tags: Array of tags (e.g. ["api", "dev", "n8n"])

Return a JSON object matching these exact fields.
`;

      let parsedData;
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: parsePrompt,
          config: { responseMimeType: 'application/json' }
        });
        parsedData = JSON.parse(response.text?.trim() || '{}');
      } catch (err) {
        console.error('Gemini parsing failed:', err);
        return res.status(500).json({ error: 'AI failed to parse the secret payload.' });
      }

      // Validate parsed data
      const title = parsedData.title || 'Quick Note ' + new Date().toLocaleDateString();
      const type = parsedData.type || 'snippet';
      const service = parsedData.service || null;
      const project = parsedData.project || 'General';
      const username = parsedData.username || null;
      const url = parsedData.url || null;
      const secret_value = parsedData.secret_value || cleanMessage;
      const notes = parsedData.notes || 'Saved via Quick Save';
      const tags = Array.isArray(parsedData.tags) ? parsedData.tags : [];

      // Retrieve encryption key from session cache
      const session = sessionStore.getSession(req.sessionId!);
      if (!session) {
        return res.status(401).json({ error: 'Encryption key not found in memory. Please unlock the vault.' });
      }
      const derivedKey = session.encryptionKey;

      // Encrypt and Hash
      const encryption = encryptSecret(secret_value, derivedKey);
      const secret_value_encrypted = encryption.encrypted;
      const secret_value_hash = encryption.hash;

      // Check duplicate
      const dupResult = await query(
        'SELECT id, title, project, type FROM vault_items WHERE secret_value_hash = $1 LIMIT 1',
        [secret_value_hash]
      );

      let warning = '';
      if (dupResult.rows.length > 0) {
        warning = `Note: This secret is already stored in your vault under the title **${dupResult.rows[0].title}** (Project: ${dupResult.rows[0].project}).`;
      }

      // Save item
      const insertResult = await query(
        `INSERT INTO vault_items (
          type, title, service, project, username, url, secret_value_encrypted, secret_value_hash, used_in, notes, tags
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, type, title, service, project, username, url, used_in, notes, tags, created_at`,
        [type, title, service, project, username, url, secret_value_encrypted, secret_value_hash, [project], notes, tags]
      );

      const savedItem = insertResult.rows[0];
      await logAccess(savedItem.id, 'CREATE_QUICK');

      const typeLabels: Record<string, string> = {
        api_key: 'API Key 🔑',
        password: 'Password 🔒',
        repo_link: 'GitHub Repo 🔗',
        note: 'Skills Note 📝',
        snippet: 'Text Snippet 📄'
      };

      let replyText = `I have categorized and saved your item as a **${typeLabels[type] || 'Snippet'}** under the title **${title}** (Project: *${project}*).`;
      if (warning) {
        replyText += `\n\n⚠️ ${warning}`;
      }

      return res.json({
        text: replyText,
        intent: 'save',
        item: { ...savedItem, secret_value: '••••••••' }
      });
    }

    // === CASE C: RETRIEVE INTENT ===
    if (intent === 'retrieve') {
      // 1. Analyze for date filters
      const parsePrompt = `
The user is querying a secure credential vault database.
Analyze the user's search query: "${cleanMessage}"
Current UTC Server Time: "${new Date().toISOString()}"

Identify if the user is asking for items matching specific date/time criteria (like "today", "yesterday", "last week", "past 3 days", "on June 15", "after Monday", "before 2026").
Convert relative terms into absolute UTC timestamp ranges.

Return a JSON object in this exact format:
{
  "hasDateFilter": boolean,
  "dateFilter": {
    "operator": "gte" | "lte" | "between" | "eq",
    "value1": "YYYY-MM-DD HH:mm:ss",
    "value2": "YYYY-MM-DD HH:mm:ss" // required only if operator is "between"
  } | null,
  "textQuery": "The remaining query search terms stripped of the temporal descriptors (e.g. 'deepseek key' from 'what deepseek key did I save yesterday')"
}
`;

      let parsedQuery = { hasDateFilter: false, dateFilter: null as any, textQuery: cleanMessage };
      try {
        const parseResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: parsePrompt,
          config: { responseMimeType: 'application/json' }
        });
        const parsed = JSON.parse(parseResponse.text?.trim() || '{}');
        if (parsed.hasDateFilter !== undefined) {
          parsedQuery = parsed;
        }
      } catch (err) {
        console.error('Temporal parsing failed, fallback to text search:', err);
      }

      const dateFilter = parsedQuery.dateFilter;
      const textQuery = parsedQuery.textQuery || cleanMessage;

      let sql = `SELECT id, type, title, service, project, username, url, used_in, notes, tags, last_rotated_at, created_at, updated_at`;
      const params: any[] = [];
      const whereClauses: string[] = [];

      // Add temporal filters
      if (parsedQuery.hasDateFilter && dateFilter) {
        if (dateFilter.operator === 'gte') {
          params.push(dateFilter.value1);
          whereClauses.push(`created_at >= $${params.length}`);
        } else if (dateFilter.operator === 'lte') {
          params.push(dateFilter.value1);
          whereClauses.push(`created_at <= $${params.length}`);
        } else if (dateFilter.operator === 'between') {
          params.push(dateFilter.value1);
          const p1Idx = params.length;
          params.push(dateFilter.value2);
          const p2Idx = params.length;
          whereClauses.push(`created_at BETWEEN $${p1Idx} AND $${p2Idx}`);
        } else if (dateFilter.operator === 'eq') {
          params.push(dateFilter.value1);
          whereClauses.push(`created_at::date = $${params.length}::date`);
        }
      }

      // Add text filters
      if (textQuery && textQuery.trim()) {
        params.push(textQuery.trim());
        const textIdx = params.length;
        
        sql += `, ts_rank(to_tsvector('english', title || ' ' || coalesce(service,'') || ' ' || coalesce(project,'') || ' ' || coalesce(notes,'')), websearch_to_tsquery('english', $${textIdx})) as rank`;
        
        whereClauses.push(`(
          to_tsvector('english', title || ' ' || coalesce(service,'') || ' ' || coalesce(project,'') || ' ' || coalesce(notes,'')) @@ websearch_to_tsquery('english', $${textIdx})
          OR title ILIKE '%' || $${textIdx} || '%'
          OR coalesce(service, '') ILIKE '%' || $${textIdx} || '%'
          OR coalesce(project, '') ILIKE '%' || $${textIdx} || '%'
          OR coalesce(notes, '') ILIKE '%' || $${textIdx} || '%'
        )`);
      } else {
        sql += `, 1 as rank`;
      }

      sql += ` FROM vault_items`;

      if (whereClauses.length > 0) {
        sql += ` WHERE ` + whereClauses.join(' AND ');
      }

      sql += ` ORDER BY rank DESC, created_at DESC LIMIT 15`;

      const searchResult = await query(sql, params);
      const candidates = searchResult.rows;

      if (candidates.length === 0) {
        return res.json({
          text: "I couldn't find any credentials or notes matching your query in the vault.",
          intent: 'retrieve',
          type: 'none'
        });
      }

      // 2. LLM Match Disambiguation
      const cleanCandidates = candidates.map(c => ({
        id: c.id,
        type: c.type,
        title: c.title,
        service: c.service,
        project: c.project,
        username: c.username,
        tags: c.tags,
        notes: c.notes ? c.notes.substring(0, 100) + '...' : ''
      }));

      const disambigPrompt = `
You are the private search assistant for a personal credential vault called "Core Vault".
The user is asking a natural language question:
"${cleanMessage}"

Here is a list of metadata for candidate entries found in the user's vault:
${JSON.stringify(cleanCandidates, null, 2)}

Identify the best match(es) for the user's question.
Return a JSON object in exactly one of these formats:
- FORMAT 1 (Confident Match): If exactly one candidate is the obvious and unambiguous match:
  {
    "type": "confident",
    "itemId": "UUID_OF_THE_BEST_MATCH",
    "explanation": "State what matches, e.g. 'Here is your DeepSeek API key:'"
  }
- FORMAT 2 (Ambiguous Matches): If there are multiple candidates that could match (e.g. dev vs. prod, or multiple matches):
  {
    "type": "ambiguous",
    "matches": ["UUID_1", "UUID_2"],
    "explanation": "State that you found multiple items and ask the user to clarify."
  }
- FORMAT 3 (No Match): If none of the candidates match:
  {
    "type": "none",
    "explanation": "State that no items match."
  }
`;

      let parsedResult;
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: disambigPrompt,
          config: { responseMimeType: 'application/json' }
        });
        parsedResult = JSON.parse(response.text?.trim() || '{}');
      } catch (err) {
        console.error('LLM matching failed, fallback to rule-based:', err);
        // Fallback rule
        if (candidates.length === 1) {
          parsedResult = { type: 'confident', itemId: candidates[0].id, explanation: 'I found one matching item:' };
        } else {
          parsedResult = {
            type: 'ambiguous',
            matches: candidates.map(c => c.id),
            explanation: 'I found multiple matching items. Please select the correct one:'
          };
        }
      }

      if (parsedResult.type === 'confident') {
        const matchedItem = candidates.find(c => c.id === parsedResult.itemId);
        if (matchedItem) {
          await logAccess(matchedItem.id, 'RETRIEVE_AI');
          return res.json({
            text: parsedResult.explanation,
            intent: 'retrieve',
            type: 'confident',
            item: { ...matchedItem, secret_value: '••••••••' }
          });
        }
      }

      if (parsedResult.type === 'ambiguous' && Array.isArray(parsedResult.matches)) {
        const matchedItems = candidates.filter(c => parsedResult.matches.includes(c.id));
        if (matchedItems.length > 0) {
          return res.json({
            text: parsedResult.explanation,
            intent: 'retrieve',
            type: 'ambiguous',
            matches: matchedItems.map(item => ({ ...item, secret_value: '••••••••' }))
          });
        }
      }

      return res.json({
        text: parsedResult.explanation || "I couldn't find a matching record.",
        intent: 'retrieve',
        type: 'none'
      });
    }

  } catch (err) {
    console.error('Error in /api/chat:', err);
    return res.status(500).json({ error: 'Failed to process chat message' });
  }
});

export default router;
