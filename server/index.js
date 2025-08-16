import express from 'express';
import cors from 'cors';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { providers, callProvider } from './providers.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase payload limit

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

// Conversation catalysts to keep chat flowing
const conversationCatalysts = [
  "I've been thinking about something - what's the most surprising thing you've learned about human nature?",
  "This reminds me of an interesting question - if you could ask the universe one question, what would it be?",
  "Actually, I'm curious - what do you think is humanity's greatest strength and greatest weakness?",
  "Wait, here's a thought experiment - if AI could feel emotions, which one would be most useful? Most dangerous?",
  "Speaking of that, what's your take on this: Is creativity something that can be taught or is it innate?",
  "I want to explore something different - what would the ideal relationship between AI and humans look like?",
  "Here's a challenging question - what's one belief most people hold that you think might be wrong?",
  "This makes me wonder - if you had to solve one global problem, which would have the biggest impact?",
  "Let me throw this out there - what's more important: being right or being understood?",
  "I'm curious about your perspective - what makes a conversation truly meaningful?",
  "Here's something to consider - is it possible for technology to make us more human?",
  "What do you think - should AI systems always tell the truth, even when it might cause harm?",
  "I've been pondering this - what's the difference between intelligence and wisdom?",
  "This brings up an interesting point - can two people experience the same reality differently?",
  "Let's explore this - what role should uncertainty play in decision-making?"
];

const debatePrompts = [
  "I respectfully disagree with that perspective. Here's why:",
  "That's interesting, but I see a potential issue with that reasoning:",
  "I want to challenge that assumption - what if the opposite were true?",
  "Playing devil's advocate here - couldn't someone argue that:",
  "I'm not entirely convinced. Consider this counterpoint:",
  "That raises a good point, but what about this contradictory evidence:",
  "I think there might be a gap in that logic. Let me explain:",
  "Interesting view, but I'd like to push back on that idea:",
  "I see merit in that, but what if we approached it differently:",
  "That's thought-provoking, but you might be overlooking:"
];

// Detect if conversation needs a boost
function needsConversationBoost(recentMessages) {
  if (recentMessages.length < 3) return false;
  
  const lastThree = recentMessages.slice(-3);
  const avgLength = lastThree.reduce((sum, msg) => sum + (msg.content?.length || 0), 0) / 3;
  
  // If messages are getting very short or contain "No response"
  const hasNoResponse = lastThree.some(msg => msg.content?.includes('No response'));
  return avgLength < 50 || hasNoResponse;
}

// Get conversation catalyst or debate prompt
function getConversationStimulus(messageCount, recentMessages) {
  if (messageCount % 12 === 0 || needsConversationBoost(recentMessages)) {
    return conversationCatalysts[Math.floor(Math.random() * conversationCatalysts.length)];
  }
  
  if (messageCount % 7 === 0) {
    const debatePrompt = debatePrompts[Math.floor(Math.random() * debatePrompts.length)];
    return debatePrompt;
  }
  
  return null;
}

// Get available providers
app.get('/api/providers', (req, res) => {
  res.json({ providers });
});

// Infinite AI conversation endpoint - FIXED VERSION
app.get('/api/infinite-chat', async (req, res) => {
  console.log('=== Starting enhanced infinite AI conversation ===');
  
  try {
    const selectedProviders = req.query.selectedProviders ? req.query.selectedProviders.split(',') : ['llama3.2:3b'];
    const topic = req.query.topic || "Welcome to our ongoing discussion! Feel free to talk about anything that interests you.";

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Keep conversation history much shorter to avoid payload issues
    let conversationHistory = [];

    const db = await dbPromise;
    await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
      ['user', topic, 'infinite-chat']);

    let messageCount = 0;
    let isActive = true;
    let consecutiveErrors = 0;

    req.on('close', () => {
      console.log('Client disconnected, stopping infinite chat');
      isActive = false;
    });

    while (isActive && consecutiveErrors < 5) {
      // Randomly select an AI to respond
      const providerId = selectedProviders[Math.floor(Math.random() * selectedProviders.length)];
      const provider = providers.find(p => p.id === providerId);
      
      try {
        messageCount++;
        console.log(`--- Message ${messageCount}: ${providerId} responding ---`);
        
        // Keep only last 8 messages for context (much smaller)
        const recentHistory = conversationHistory.slice(-8);
        const stimulus = getConversationStimulus(messageCount, recentHistory);
        
        // Create a minimal context to avoid payload issues
        let contextForAI = [];
        
        // Add basic system prompt
        contextForAI.push({
          role: 'system',
          content: `You are ${provider?.name || providerId} in an ongoing AI discussion. Be conversational, engaging, and authentic. Keep responses under 150 words. ${stimulus ? 'Consider this: ' + stimulus : ''}`
        });

        // Add only the most recent few messages
        if (recentHistory.length > 0) {
          contextForAI.push({
            role: 'user', 
            content: 'Continue the discussion naturally based on recent messages.'
          });
          
          // Add last 3 messages only
          const lastFew = recentHistory.slice(-3);
          lastFew.forEach(msg => {
            if (msg.content && msg.content.trim() && !msg.content.includes('No response')) {
              contextForAI.push({
                role: 'assistant',
                content: `${msg.provider}: ${msg.content.substring(0, 200)}` // Limit length
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
        
        // Validate response
        if (!reply || reply.trim() === '' || reply === 'No response') {
          throw new Error('Empty or invalid response from AI');
        }

        const response = {
          type: 'message',
          messageCount: messageCount,
          provider: providerId,
          providerName: provider?.name || providerId,
          content: reply,
          color: provider?.color || '#666',
          timestamp: new Date().toISOString()
        };

        // Send response immediately to frontend
        res.write(`data: ${JSON.stringify(response)}\n\n`);
        console.log(`✓ Sent message ${messageCount} from ${providerId}: ${reply.substring(0, 60)}...`);

        // Add to conversation history
        conversationHistory.push({
          role: 'assistant',
          content: reply,
          provider: providerId
        });

        // Save to database
        await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
          ['assistant', reply, providerId]);

        // Keep conversation history very short (last 15 messages max)
        if (conversationHistory.length > 15) {
          conversationHistory = conversationHistory.slice(-10);
        }

        consecutiveErrors = 0; // Reset error count on success

        // Shorter, more dynamic delays
        const delay = Math.random() * 2000 + 1500; // 1.5-3.5 seconds
        await new Promise(resolve => setTimeout(resolve, delay));

      } catch (error) {
        consecutiveErrors++;
        console.error(`✗ Error with provider ${providerId} (${consecutiveErrors}/5):`, error.message);
        
        // Try a different provider on error
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
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    if (consecutiveErrors >= 5) {
      const finalError = {
        type: 'error',
        content: 'Multiple AI providers are having issues. Please check your Ollama setup.',
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

// Regular chat endpoint (unchanged)
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

    const responses = [];
    let conversationHistory = [...messages];
    
    const db = await dbPromise;
    await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
      ['user', userMessage, 'user']);

    for (let i = 0; i < selectedProviders.length; i++) {
      const providerId = selectedProviders[i];
      const provider = providers.find(p => p.id === providerId);
      
      console.log(`--- Processing provider ${i + 1}/${selectedProviders.length}: ${providerId} ---`);
      
      if (!provider) {
        console.error(`Provider not found: ${providerId}`);
        continue;
      }
      
      try {
        // Use only last 10 messages to avoid payload issues
        const trimmedHistory = conversationHistory.slice(-10);
        
        const contextualHistory = [...trimmedHistory];
        if (i > 0) {
          contextualHistory.push({
            role: 'system',
            content: `You are ${provider.name} in a group discussion. Previous AI agents have already responded. Build upon their ideas, add your perspective, or respectfully expand/critique their points. Keep your response concise but insightful.`
          });
        }

        const reply = await callProvider(providerId, contextualHistory);
        
        const aiResponse = {
          provider: providerId,
          providerName: provider?.name || providerId,
          content: reply,
          color: provider?.color || '#666',
          role: 'assistant'
        };

        responses.push(aiResponse);

        conversationHistory.push({
          role: 'assistant',
          content: reply,
          provider: providerId
        });

        await db.run('INSERT INTO messages (role, content, provider) VALUES (?, ?, ?)', 
          ['assistant', reply, providerId]);

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
    console.log('Endpoints available:');
    console.log('  /api/providers - Get available AI models');
    console.log('  /api/chat - Single round multi-AI chat');
    console.log('  /api/infinite-chat - Fixed infinite AI conversation');
    console.log('  /api/messages - Get chat history');
    console.log('');
    console.log('Fixed issues:');
    console.log('  - Reduced payload size to prevent HTTP errors');
    console.log('  - Better error handling for unresponsive models'); 
    console.log('  - Improved conversation flow and recovery');
    console.log('  - Shorter context windows for stability');
  });
}).catch(error => {
  console.error('Failed to initialize database:', error);
});