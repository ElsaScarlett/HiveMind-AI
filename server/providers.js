// Provider abstraction for different AI models
export const providers = [
  // Existing Ollama models
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    description: 'Balanced model for general chat',
    color: '#3b82f6',
    type: 'ollama'
  },
  {
    id: 'mistral:7b', 
    name: 'Mistral 7B',
    description: 'Strong reasoning and analysis',
    color: '#7c3aed',
    type: 'ollama'
  },
  {
    id: 'codellama:7b',
    name: 'Code Llama 7B', 
    description: 'Specialized for programming',
    color: '#059669',
    type: 'ollama'
  },
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    description: 'Fast and efficient responses',
    color: '#dc2626',
    type: 'ollama'
  },
  // New free cloud models
  {
    id: 'hf-llama',
    name: 'HF Llama Chat',
    description: 'Free cloud conversational AI',
    color: '#ff6b35',
    type: 'huggingface',
    model: 'microsoft/DialoGPT-large'
  },
  {
    id: 'hf-mistral-tiny',
    name: 'HF Mistral Tiny',
    description: 'Fast free reasoning model',
    color: '#ff1744',
    type: 'huggingface', 
    model: 'mistralai/Mistral-7B-Instruct-v0.1'
  }
];

// Enhanced provider calling with multiple APIs
export async function callProvider(modelId, messages) {
  const provider = providers.find(p => p.id === modelId);
  
  if (!provider) {
    throw new Error(`Provider ${modelId} not found`);
  }

  switch(provider.type) {
    case 'ollama':
      return await callOllamaProvider(modelId, messages);
    case 'huggingface':
      return await callHuggingFaceProvider(provider.model, messages);
    default:
      throw new Error(`Unknown provider type: ${provider.type}`);
  }
}

// Existing Ollama function
async function callOllamaProvider(modelId, messages) {
  const response = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelId,
      messages: messages,
      stream: false,
    }),
  });
  
  const data = await response.json();
  return data.message?.content || 'No response';
}

// New Hugging Face function
async function callHuggingFaceProvider(model, messages) {
  // Convert messages to text format for HuggingFace
  const conversationText = messages.map(msg => {
    if (msg.role === 'user') return `Human: ${msg.content}`;
    if (msg.role === 'assistant') return `Assistant: ${msg.content}`;
    return msg.content;
  }).join('\n') + '\nAssistant:';

  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: 'POST',
    headers: { 
      'Authorization': 'Bearer hf_jYupshSVKHuiJeeUgowMMZWyVpNACno$$$',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      inputs: conversationText,
      parameters: {
        max_new_tokens: 150,
        temperature: 0.7,
        return_full_text: false
      }
    }),
  });

  const data = await response.json();
  
  if (data.error) {
    throw new Error(`HuggingFace API error: ${data.error}`);
  }
  
  return data[0]?.generated_text?.trim() || 'No response from HuggingFace model';
}