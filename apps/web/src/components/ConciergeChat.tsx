import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { invokeEdge } from '../lib/edgeInvoke';
import { errorText } from '../lib/errors';

type Message = {
    role: 'user' | 'assistant';
    content: string;
};

export default function ConciergeChat() {
    const [isOpen, setIsOpen] = React.useState(false);
    const [input, setInput] = React.useState('');
    const [messages, setMessages] = React.useState<Message[]>([
        { role: 'assistant', content: 'Hi! I can help you find food. Try "I want spicy pizza under 15k".' }
    ]);

    const sendM = useMutation({
        mutationFn: async (text: string) => {
            // In a real app, we'd pass conversation history or session ID
            const { data } = await invokeEdge<{ reply: string }>('concierge', {
                message: text,
                history: messages
            });
            return data.reply;
        },
        onSuccess: (reply) => {
            setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        },
        onError: (e) => {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorText(e)}` }]);
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || sendM.isPending) return;
        const text = input.trim();
        setMessages(prev => [...prev, { role: 'user', content: text }]);
        setInput('');
        sendM.mutate(text);
    };

    if (!isOpen) {
        return (
            <button
                className="fixed bottom-4 right-4 bg-black text-white p-4 rounded-full shadow-xl hover:bg-gray-800 transition-colors z-50 flex items-center gap-2"
                onClick={() => setIsOpen(true)}
            >
                <span>✨ AI Assistant</span>
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 w-80 h-96 bg-white rounded-2xl shadow-2xl flex flex-col border border-gray-200 z-50 overflow-hidden">
            <div className="p-3 bg-gray-100 border-b border-gray-200 flex justify-between items-center">
                <div className="font-semibold text-sm">Food Concierge</div>
                <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-black">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-black text-white' : 'bg-gray-100 text-gray-800'
                            }`}>
                            {m.content}
                        </div>
                    </div>
                ))}
                {sendM.isPending && (
                    <div className="flex justify-start">
                        <div className="bg-gray-100 text-gray-400 rounded-2xl px-3 py-2 text-sm animate-pulse">
                            Thinking...
                        </div>
                    </div>
                )}
            </div>

            <form onSubmit={handleSubmit} className="p-3 border-t border-gray-200 flex gap-2">
                <input
                    className="flex-1 input text-sm"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask for food..."
                />
                <button type="submit" disabled={sendM.isPending || !input.trim()} className="btn btn-primary px-3">
                    ➤
                </button>
            </form>
        </div>
    );
}
