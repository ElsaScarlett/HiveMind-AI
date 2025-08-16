import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { providers, callProvider } from './providers.js';

const app = express();
app.use(cors());
app.use(express.json());

const dbPromise = open({
  filename: './chat.db',
  driver: sqlite3.Database,
});

async function initDB() {
  const db = await dbPromise;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// Get available providers
app.get('/api/providers', (req, res) => {
  res.json({ providers });
});

// Multi-agent chat endpoint - SEQUENTIAL CONVERSATION
app.post('/api/chat', async (req, res) => {
  console.log('=== Chat request received ===');
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  
  try {
    const { messages, selectedProviders = ['llama3.2:3b'] } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new Error('Invalid messages array');
    }
    
    const userMessage = messages[messages.length - 1].content;
    console.log('User message:', userMessage);
    console.log('Selected providers:', selectedProviders);

    const responses = [];
    let conversationHistory = [...messages];
    
    // Save user message first
    const db = await dbPromise;
    await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
      ['user', userMessage, 'user']);
    console.log('User message saved to database');

    // Call each provider SEQUENTIALLY so they can build on each other
    for (let i = 0; i < selectedProviders.length; i++) {
      const providerId = selectedProviders[i];
      const provider = providers.find(p => p.id === providerId);
      
      console.log(`\n--- Processing provider ${i + 1}/${selectedProviders.length}: ${providerId} ---`);
      
      if (!provider) {
        console.error(`Provider not found: ${providerId}`);
        continue;
      }
      
      try {
        // Add context about the conversation flow
        const contextualHistory = [...conversationHistory];
        if (i > 0) {
          // Add instruction for building on previous responses
          contextualHistory.push({
            role: 'system',
            content: `You are ${provider.name} in a group discussion. Previous AI agents have already responded. Build upon their ideas, add your perspective, or respectfully expand/critique their points. Keep your response concise but insightful.`
          });
        }

        console.log(`Calling ${providerId} with ${contextualHistory.length} messages`);
        const reply = await callProvider(providerId, contextualHistory);
        console.log(`Received reply from ${providerId}:`, reply.substring(0, 100) + '...');
        
        const aiResponse = {
          provider: providerId,
          providerName: provider?.name || providerId,
          content: reply,
          color: provider?.color || '#666',
          role: 'assistant'
        };

        responses.push(aiResponse);

        // Add this AI's response to the conversation history for the next AI
        conversationHistory.push({
          role: 'assistant',
          content: reply,
          provider: providerId
        });

        // Save to database
        await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
          ['assistant', reply, providerId]);
        console.log(`Response from ${providerId} saved to database`);

      } catch (error) {
        console.error(`ERROR with provider ${providerId}:`, error.message);
        console.error('Stack trace:', error.stack);
        
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

    console.log(`\n=== Sending ${responses.length} responses ===`);
    res.json({ responses });
    
  } catch (error) {
    console.error('FATAL ERROR in /api/chat:', error.message);
    console.error('Full error:', error);
    console.error('Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Something went wrong',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Auto-chat endpoint for AI-to-AI discussions
app.post('/api/auto-chat', async (req, res) => {
  console.log('=== Auto-chat request received ===');
  
  try {
    const { topic, selectedProviders, messages } = req.body;
    console.log('Topic:', topic);
    console.log('Selected providers:', selectedProviders);
    
    const responses = [];
    let conversationHistory = [...messages];
    
    // Add the topic as a system message
    conversationHistory.push({
      role: 'system',
      content: `New discussion topic: "${topic}". As AI participants, discuss this topic naturally. Each AI should bring their unique perspective. Keep responses conversational and build on each other's ideas.`
    });

    // Each AI responds to the topic and each other
    for (let i = 0; i < selectedProviders.length; i++) {
      const providerId = selectedProviders[i];
      const provider = providers.find(p => p.id === providerId);
      
      try {
        // Add context for the AI about the discussion
        const contextualHistory = [...conversationHistory];
        contextualHistory.push({
          role: 'system',
          content: `You are ${provider.name}. You're participating in a group AI discussion about "${topic}". ${i === 0 ? 'You\'re starting the discussion.' : 'Previous AIs have shared their thoughts. Add your perspective, agree, disagree, or build upon their ideas.'} Be conversational and engaging.`
        });

        const reply = await callProvider(providerId, contextualHistory);
        
        const aiResponse = {
          provider: providerId,
          providerName: provider?.name || providerId,
          content: reply,
          color: provider?.color || '#666',
          role: 'assistant'
        };

        responses.push(aiResponse);

        // Add this AI's response to the conversation for the next AI
        conversationHistory.push({
          role: 'assistant',
          content: reply,
          provider: providerId
        });

        // Save to database
        const db = await dbPromise;
        await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
          ['assistant', reply, providerId]);

      } catch (error) {
        console.error(`Error with provider ${providerId} in auto-chat:`, error);
      }
    }

    res.json({ responses });
  } catch (error) {
    console.error('Error in auto-chat:', error);
    res.status(500).json({ error: 'Auto-chat failed', details: error.message });
  }
});

// Get chat history
app.get('/api/messages', async (req, res) => {
  try {
    const db = await dbPromise;
    const messages = await db.all('SELECT * FROM messages ORDER BY timestamp');
    res.json({ messages });
  } catch (error) {
    console.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

initDB().then(() => {
  app.listen(3001, () => {
    console.log('Server running on http://localhost:3001');
    console.log('Available providers:', providers.map(p => p.name).join(', '));
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
});