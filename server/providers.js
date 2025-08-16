// Provider abstraction for different AI models
export const providers = [
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2 3B',
    description: 'Balanced model for general chat',
    color: '#3b82f6'
  },
  {
    id: 'mistral:7b', 
    name: 'Mistral 7B',
    description: 'Strong reasoning and analysis',
    color: '#7c3aed'
  },
  {
    id: 'codellama:7b',
    name: 'Code Llama 7B', 
    description: 'Specialized for programming',
    color: '#059669'
  },
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2 1B',
    description: 'Fast and efficient responses',
    color: '#dc2626'
  }
];

export async function callProvider(modelId, messages) {
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