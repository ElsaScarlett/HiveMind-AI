import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import { providers, callProvider } from './providers.js';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// File upload configuration
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 25 * 1024 * 1024, // 25MB limit
    files: 5 // Max 5 files at once
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /\.(txt|md|js|py|html|css|json|xml|csv|pdf|docx|xlsx|ts|jsx|tsx|sql|sh|yaml|yml)$/i;
    const isAllowed = allowedTypes.test(file.originalname);
    cb(null, isAllowed);
  }
});

// Turso cloud database connection
const turso = createClient({
  url: 'libsql://multi-ai-chat-elsascarlett.aws-us-east-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpYXQiOjE3NTU0MzQ2NDAsImlkIjoiYTk3NWNmMDgtMmYzNy00YTk2LTlmN2QtMDM2YzdlMmU5NTI0IiwicmlkIjoiZjc4ODIzMDYtYWQ0OS00NGZhLTgwMjYtMmI2NjM1NWQzYjVmIn0.5ZJimu7qZwJe5-BSTlL50Ht0zyZ3JjQjP8mI2M4EnWftlXA-IOzsQO3ucKm9JZe_FMglKD8HKrlYEiIwovazBg'
});

// File parsing functions with enhanced error handling
async function parseFile(filePath, originalName, mimeType) {
  const ext = path.extname(originalName).toLowerCase();
  
  try {
    switch (ext) {
      case '.pdf':
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const pdfBuffer = await fs.readFile(filePath);
          const pdfData = await pdfParse(pdfBuffer);
          return { content: pdfData.text, type: 'pdf' };
        } catch (pdfError) {
          console.error('PDF parsing failed, trying as text:', pdfError.message);
          try {
            const fallbackContent = await fs.readFile(filePath, 'utf8');
            return { content: fallbackContent, type: 'text' };
          } catch (textError) {
            return { content: `PDF file uploaded but could not be parsed: ${originalName}`, type: 'pdf-error' };
          }
        }
        
      case '.docx':
        const docxBuffer = await fs.readFile(filePath);
        const docxResult = await mammoth.extractRawText({ buffer: docxBuffer });
        return { content: docxResult.value, type: 'document' };
        
      case '.xlsx':
      case '.xls':
        const workbook = XLSX.readFile(filePath);
        const sheetNames = workbook.SheetNames;
        let excelContent = '';
        sheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const csvData = XLSX.utils.sheet_to_csv(sheet);
          excelContent += `Sheet: ${sheetName}\n${csvData}\n\n`;
        });
        return { content: excelContent, type: 'spreadsheet' };
        
      case '.txt':
      case '.md':
      case '.js':
      case '.py':
      case '.html':
      case '.css':
      case '.json':
      case '.xml':
      case '.csv':
      case '.ts':
      case '.jsx':
      case '.tsx':
      case '.sql':
      case '.sh':
      case '.yaml':
      case '.yml':
        const textContent = await fs.readFile(filePath, 'utf8');
        return { content: textContent, type: 'code' };
        
      default:
        const unknownContent = await fs.readFile(filePath, 'utf8');
        return { content: unknownContent, type: 'text' };
    }
  } catch (error) {
    throw new Error(`Failed to parse file ${originalName}: ${error.message}`);
  }
}

async function initDB() {
  try {
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        provider TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        requirements TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER,
        assigned_ai TEXT,
        task_description TEXT,
        status TEXT DEFAULT 'pending',
        code_output TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await turso.execute(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        content TEXT NOT NULL,
        file_type TEXT,
        mime_type TEXT,
        file_size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✓ Database tables initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}

// AI Expertise mapping for project collaboration
function getAIExpertise(providerId) {
  const expertise = {
    'codellama:7b': 'Code implementation, debugging, syntax optimization',
    'mistral:7b': 'System architecture, logic design, performance optimization',
    'llama3.2:3b': 'Project management, documentation, testing strategies',
    'llama3.2:1b': 'Quick prototyping, validation, integration testing',
    'hf-gpt2': 'Creative solutions, alternative approaches, brainstorming',
    'hf-flan-t5': 'Code review, quality assurance, best practices'
  };
  return expertise[providerId] || 'General development support';
}

// Process project directives and special commands
function processDirective(content, selectedProviders) {
  const lowerContent = content.toLowerCase();
  
  if (lowerContent.startsWith('/project') || lowerContent.includes('project:')) {
    return {
      type: 'project_directive',
      systemPrompt: `PRIORITY PROJECT DIRECTIVE: Collaborate systematically to execute this request. Break down into specific tasks, assign AI responsibilities based on expertise. CodeLlama handles implementation, Mistral does architecture, Llama 3.2 3B manages coordination, others provide specialized support. Work toward concrete deliverables with clear action items.`,
      priority: 'critical'
    };
  }
  
  if (lowerContent.startsWith('/code') || lowerContent.includes('code:')) {
    return {
      type: 'code_request',
      systemPrompt: 'CODE COLLABORATION REQUEST: Work together to write, review, and improve code. CodeLlama should lead implementation, Mistral provides architecture guidance, others contribute testing, documentation, and optimization suggestions. Focus on clean, working code with explanations.',
      priority: 'high'
    };
  }
  
  if (lowerContent.startsWith('/debug') || lowerContent.includes('debug:')) {
    return {
      type: 'debug_request',
      systemPrompt: 'DEBUG COLLABORATION: Analyze the provided code/error systematically. CodeLlama identifies syntax issues, Mistral examines logic flow, Llama models suggest testing approaches. Provide specific fixes and explanations.',
      priority: 'high'
    };
  }
  
  if (lowerContent.startsWith('/review') || lowerContent.includes('review:')) {
    return {
      type: 'code_review',
      systemPrompt: 'CODE REVIEW SESSION: Examine the provided code for quality, security, performance, and best practices. Each AI should focus on their expertise area and provide constructive feedback with specific improvement suggestions.',
      priority: 'high'
    };
  }
  
  if (lowerContent.startsWith('/analyze') || lowerContent.includes('analyze:')) {
    return {
      type: 'document_analysis',
      systemPrompt: 'DOCUMENT ANALYSIS: Analyze the provided documents/files systematically. Extract key information, identify patterns, suggest improvements or implementations. Focus on actionable insights based on file content.',
      priority: 'high'
    };
  }
  
  return { type: 'normal', systemPrompt: null, priority: 'normal' };
}

// Get recent documents for context
async function getRecentDocuments(limit = 3) {
  try {
    const result = await turso.execute({
      sql: 'SELECT original_name, content, file_type FROM documents ORDER BY created_at DESC LIMIT ?',
      args: [limit]
    });
    return result.rows;
  } catch (error) {
    console.error('Error fetching recent documents:', error);
    return [];
  }
}

// Enhanced function to get conversation context for infinite chat
async function getConversationContext(limit = 10) {
  try {
    const result = await turso.execute({
      sql: 'SELECT role, content, provider FROM messages WHERE role IN ("user", "assistant") ORDER BY timestamp DESC LIMIT ?',
      args: [limit]
    });
    return result.rows.reverse(); // Reverse to get chronological order
  } catch (error) {
    console.error('Error fetching conversation context:', error);
    return [];
  }
}

// Conversation catalysts with topic continuation focus
const topicContinuationPrompts = [
  "I want to explore this topic further - what are some aspects we haven't considered yet?",
  "This is fascinating - let's dive deeper into the implications of what we've discussed.",
  "Building on our conversation, what are the most important questions we should be asking?",
  "I'd like to challenge some assumptions we might be making about this topic.",
  "What would happen if we approached this problem from a completely different angle?",
  "Are there any counterarguments or alternative perspectives we should examine?",
  "Let's think about the practical applications of what we've been discussing.",
  "What are the potential risks or unintended consequences we should consider?",
  "How does this topic connect to broader trends or patterns?",
  "What evidence would we need to either support or refute our current understanding?"
];

const debatePrompts = [
  "I want to respectfully challenge that perspective. Here's why:",
  "That's an interesting point, but what about this potential issue:",
  "I'm not entirely convinced by that reasoning. Consider this:",
  "Playing devil's advocate - couldn't someone argue the opposite:",
  "That raises a good point, but there might be a gap in the logic:",
  "I see merit in that view, but what if we approached it differently:",
  "That's thought-provoking, but you might be overlooking:",
  "I want to push back on that assumption - what if:",
  "Interesting perspective, but consider this counterexample:",
  "I think we need to examine the underlying premises here:"
];

// Detect if conversation needs a boost
function needsConversationBoost(recentMessages) {
  if (recentMessages.length < 3) return false;
  
  const lastThree = recentMessages.slice(-3);
  const avgLength = lastThree.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 3;
  
  const hasNoResponse = lastThree.some(msg => msg.content?.includes('No response') || msg.content?.length < 20);
  return avgLength < 50 || hasNoResponse;
}

// Get conversation stimulus based on context
function getConversationStimulus(messageCount, recentMessages, contextualTopic) {
  if (messageCount % 10 === 0 || needsConversationBoost(recentMessages)) {
    return topicContinuationPrompts[Math.floor(Math.random() * topicContinuationPrompts.length)];
  }
  
  if (messageCount % 6 === 0) {
    const debatePrompt = debatePrompts[Math.floor(Math.random() * debatePrompts.length)];
    return debatePrompt;
  }
  
  return null;
}

// File upload endpoint
app.post('/api/upload', upload.array('files', 5), async (req, res) => {
  try {
    const uploadedFiles = [];
    
    for (const file of req.files) {
      console.log(`Processing uploaded file: ${file.originalname}`);
      
      const parsed = await parseFile(file.path, file.originalname, file.mimetype);
      
      await turso.execute({
        sql: 'INSERT INTO documents (filename, original_name, content, file_type, mime_type, file_size) VALUES (?, ?, ?, ?, ?, ?)',
        args: [file.filename, file.originalname, parsed.content, parsed.type, file.mimetype, file.size]
      });
      
      uploadedFiles.push({
        originalName: file.originalname,
        size: file.size,
        type: parsed.type,
        contentPreview: parsed.content.substring(0, 200) + '...'
      });
      
      await fs.unlink(file.path);
    }
    
    const filesList = uploadedFiles.map(f => `${f.originalName} (${f.type})`).join(', ');
    const notification = `FILES UPLOADED: ${filesList}\n\nFiles are now available for AI analysis. Use /analyze to have all AIs examine these documents, or reference them in your conversations.`;
    
    await turso.execute({
      sql: 'INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)',
      args: ['system', notification, 'file-manager']
    });
    
    res.json({
      success: true,
      files: uploadedFiles,
      message: `Successfully uploaded ${uploadedFiles.length} file(s)`
    });
    
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ 
      error: 'File upload failed', 
      details: error.message 
    });
  }
});

// Get uploaded documents
app.get('/api/documents', async (req, res) => {
  try {
    const result = await turso.execute('SELECT id, original_name, file_type, file_size, created_at FROM documents ORDER BY created_at DESC');
    res.json({ documents: result.rows });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// Get available providers
app.get('/api/providers', (req, res) => {
  res.json({ providers });
});

// Enhanced infinite AI conversation endpoint with context awareness
app.get('/api/infinite-chat', async (req, res) => {
  console.log('=== Starting context-aware infinite AI conversation ===');
  
  try {
    const selectedProviders = req.query.selectedProviders ? req.query.selectedProviders.split(',') : ['llama3.2:3b'];
    const topic = req.query.topic || "Welcome to our ongoing discussion! Feel free to talk about anything that interests you.";
    const isContextual = req.query.contextual === 'true';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    console.log('Selected providers:', selectedProviders);
    console.log('Topic:', topic);
    console.log('Contextual:', isContextual);

    // Get conversation context if this is contextual
    const conversationHistory = isContextual ? await getConversationContext(8) : [];
    console.log(`Retrieved ${conversationHistory.length} context messages`);

    await turso.execute({
      sql: 'INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)',
      args: ['user', topic, 'infinite-chat']
    });

    let messageCount = 0;
    let isActive = true;
    let consecutiveErrors = 0;

    req.on('close', () => {
      console.log('Client disconnected, stopping infinite chat');
      isActive = false;
    });

    while (isActive && consecutiveErrors < 5) {
      const providerId = selectedProviders[Math.floor(Math.random() * selectedProviders.length)];
      const provider = providers.find(p => p.id === providerId);
      
      try {
        messageCount++;
        console.log(`--- Message ${messageCount}: ${providerId} responding ---`);
        
        const recentHistory = conversationHistory.slice(-6);
        const stimulus = getConversationStimulus(messageCount, recentHistory, topic);
        
        const directive = processDirective(topic, selectedProviders);
        const recentDocs = await getRecentDocuments(2);
        
        let contextForAI = [];
        
        // Enhanced system prompt with context awareness
        let systemPrompt = `You are ${provider?.name || providerId} (Message #${messageCount}) in an ongoing AI discussion. Your expertise: ${getAIExpertise(providerId)}.`;
        
        if (isContextual && conversationHistory.length > 0) {
          systemPrompt += ` Continue the existing conversation naturally, building on previous points and exploring the topic in depth.`;
        }
        
        if (directive.type !== 'normal') {
          systemPrompt = directive.systemPrompt + ` Your specific expertise: ${getAIExpertise(providerId)}. Message #${messageCount}.`;
        } else if (stimulus) {
          systemPrompt += ` ${stimulus}`;
        }
        
        systemPrompt += ` Keep responses under 200 words but make them thoughtful and engaging.`;
        
        if (recentDocs.length > 0) {
          const docContext = recentDocs.map(doc => `File: ${doc.original_name} (${doc.file_type})`).join(', ');
          systemPrompt += ` Recent documents available: ${docContext}. Reference these if relevant.`;
        }
        
        contextForAI.push({
          role: 'system',
          content: systemPrompt
        });

        // Add conversation context if available
        if (conversationHistory.length > 0) {
          contextForAI.push({
            role: 'user', 
            content: 'Continue our discussion based on this conversation context:'
          });
          
          // Add recent context messages
          const contextToAdd = conversationHistory.slice(-4);
          contextToAdd.forEach(msg => {
            if (msg.content && msg.content.trim() && !msg.content.includes('No response')) {
              contextForAI.push({
                role: msg.role === 'user' ? 'user' : 'assistant',
                content: msg.role === 'assistant' ? 
                  `${msg.provider}: ${msg.content.substring(0, 300)}` : 
                  msg.content.substring(0, 300)
              });
            }
          });
        } else {
          contextForAI.push({
            role: 'user',
            content: topic
          });
        }

        console.log(`Sending ${contextForAI.length} messages to ${providerId}`);
        const reply = await callProvider(providerId, contextForAI);
        
        if (!reply || reply.trim() === '' || reply === 'No response') {
          throw new Error('Empty or invalid response from AI');
        }

        const response = {
          type: 'message',
          messageCount: messageCount,
          provider: providerId,
          providerName: `${provider?.name || providerId}`,
          content: reply,
          color: provider?.color || '#666',
          timestamp: new Date().toISOString(),
          expertise: getAIExpertise(providerId)
        };

        res.write(`data: ${JSON.stringify(response)}\n\n`);
        console.log(`✓ Sent message ${messageCount} from ${providerId}: ${reply.substring(0, 60)}...`);

        // Add to conversation history for context
        conversationHistory.push({
          role: 'assistant',
          content: reply,
          provider: providerId
        });

        await turso.execute({
          sql: 'INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)',
          args: ['assistant', reply, providerId]
        });

        // Keep conversation history manageable
        if (conversationHistory.length > 12) {
          conversationHistory = conversationHistory.slice(-8);
        }

        consecutiveErrors = 0;

        // Dynamic delays based on message quality
        const delay = Math.random() * 3000 + 2000; // 2-5 seconds
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        consecutiveErrors++;
        console.error(`✗ Error with provider ${providerId} (${consecutiveErrors}/5):`, error.message);
        
        if (selectedProviders.length > 1) {
          const workingProviders = selectedProviders.filter(p => p !== providerId);
          if (workingProviders.length > 0) {
            console.log(`Trying different provider instead of ${providerId}`);
            continue;
          }
        }
        
        const errorResponse = {
          type: 'error',
          messageCount: messageCount,
          provider: providerId,
          providerName: provider?.name || providerId,
          content: `Temporarily unable to respond. Trying again...`,
          color: '#dc2626'
        };
        
        res.write(`data: ${JSON.stringify(errorResponse)}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    if (consecutiveErrors >= 5) {
      const finalError = {
        type: 'error',
        content: 'Multiple AI providers are having issues. Please check your Ollama setup and model availability.',
        color: '#dc2626'
      };
      res.write(`data: ${JSON.stringify(finalError)}\n\n`);
    }

  } catch (error) {
    console.error('Error in infinite chat:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

// Enhanced regular chat endpoint with project directive support and document awareness
app.post('/api/chat', async (req, res) => {
  console.log('=== Single round chat request received ===');
  
  try {
    const { messages, selectedProviders = ['llama3.2:3b'] } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid messages array');
    }
    
    const userMessage = messages[messages.length - 1].content;
    console.log('User message:', userMessage);
    console.log('Selected providers:', selectedProviders);

    const directive = processDirective(userMessage, selectedProviders);
    const recentDocs = await getRecentDocuments(3);
    
    const responses = [];
    let conversationHistory = [...messages];
    
    await turso.execute({
      sql: 'INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)',
      args: ['user', userMessage, 'user']
    });

    for (let i = 0; i < selectedProviders.length; i++) {
      const providerId = selectedProviders[i];
      const provider = providers.find(p => p.id === providerId);
      
      console.log(`--- Processing provider ${i + 1}/${selectedProviders.length}: ${providerId} ---`);
      
      if (!provider) {
        console.error(`Provider not found: ${providerId}`);
        continue;
      }
      
      try {
        const trimmedHistory = conversationHistory.slice(-8);
        const contextualHistory = [...trimmedHistory];
        
        let systemPrompt = `You are ${provider.name} in a group discussion. Your expertise: ${getAIExpertise(providerId)}.`;
        
        if (directive.type !== 'normal') {
          systemPrompt = directive.systemPrompt + ` Your specific role: ${getAIExpertise(providerId)}.`;
        } else if (i > 0) {
          systemPrompt += ` Previous AI agents have already responded. Build upon their ideas, add your perspective, or respectfully expand/critique their points. Keep your response concise but insightful.`;
        }
        
        if (recentDocs.length > 0) {
          const docSummary = recentDocs.map(doc => `${doc.original_name}: ${doc.content.substring(0, 300)}...`).join('\n\n');
          systemPrompt += `\n\nAvailable documents for reference:\n${docSummary}`;
        }
        
        contextualHistory.push({
          role: 'system',
          content: systemPrompt
        });

        const reply = await callProvider(providerId, contextualHistory);
        
        const aiResponse = {
          provider: providerId,
          providerName: provider?.name || providerId,
          content: reply,
          color: provider?.color || '#666',
          role: 'assistant',
          expertise: getAIExpertise(providerId)
        };

        responses.push(aiResponse);

        conversationHistory.push({
          role: 'assistant',
          content: reply,
          provider: providerId
        });

        await turso.execute({
          sql: 'INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)',
          args: ['assistant', reply, providerId]
        });

      } catch (error) {
        console.error(`ERROR with provider ${providerId}:`, error.message);
        
        const errorResponse = {
          provider: providerId,
          providerName: provider?.name || providerId,
          content: `Error: Could not get response from ${providerId} - ${error.message}`,
          color: '#dc2626',
          role: 'assistant'
        };
        responses.push(errorResponse);
      }
    }

    console.log(`=== Sending ${responses.length} responses ===`);
    res.json({ responses });
    
  } catch (error) {
    console.error('FATAL ERROR in /api/chat:', error.message);
    res.status(500).json({ 
      error: 'Something went wrong',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get chat history from cloud database
app.get('/api/messages', async (req, res) => {
  try {
    const result = await turso.execute('SELECT * FROM messages ORDER BY timestamp');
    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Project management endpoints
app.post('/api/project/create', async (req, res) => {
  try {
    const { name, description, requirements } = req.body;
    
    const result = await turso.execute({
      sql: 'INSERT INTO projects (name, description, requirements, status) VALUES (?, ?, ?, ?) RETURNING id',
      args: [name, description, requirements, 'active']
    });
    
    const projectId = result.rows[0].id;
    
    const projectBrief = `NEW PROJECT CREATED: ${name}\n\nDescription: ${description}\n\nRequirements: ${requirements}\n\nAll AIs should collaborate on breaking this down into tasks and assigning responsibilities based on expertise.`;
    
    await turso.execute({
      sql: 'INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)',
      args: ['system', projectBrief, 'project-manager']
    });
    
    res.json({ 
      success: true, 
      projectId: projectId,
      projectBrief: projectBrief 
    });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    const result = await turso.execute('SELECT * FROM projects ORDER BY created_at DESC');
    res.json({ projects: result.rows });
  } catch (error) {
    console.error('Error fetching projects:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

initDB().then(() => {
  app.listen(3001, () => {
    console.log('🚀 Server running on http://localhost:3001');
    console.log('✓ Connected to Turso cloud database');
    console.log('✓ Available providers:', providers.map(p => p.name).join(', '));
    console.log('');
    console.log('📋 Endpoints available:');
    console.log('  /api/providers - Get available AI models');
    console.log('  /api/chat - Single round multi-AI chat');
    console.log('  /api/infinite-chat - Context-aware infinite AI conversation');
    console.log('  /api/messages - Get chat history');
    console.log('  /api/upload - Upload documents/code files');
    console.log('  /api/documents - Get uploaded documents');
    console.log('  /api/project/create - Create new project');
    console.log('  /api/projects - Get all projects');
    console.log('');
    console.log('🎯 Enhanced features enabled:');
    console.log('  - Context-aware infinite chat (continues your current topic)');
    console.log('  - Document upload and parsing (PDF, DOCX, Excel, code files)');
    console.log('  - File content integration with AI conversations');
    console.log('  - Project collaboration mode');
    console.log('  - AI expertise-based task assignment');
    console.log('  - Special directives: /project, /code, /debug, /review, /analyze');
    console.log('  - Message numbering and AI identification');
    console.log('  - Auto-scrolling and refresh functionality');
    console.log('');
    console.log('💡 Now when you click "Start Infinite Chat", AIs will continue discussing');
    console.log('   your current topic (like cold plasma) in depth!');
  });
}).catch(error => {
  console.error('❌ Failed to initialize cloud database:', error);
});