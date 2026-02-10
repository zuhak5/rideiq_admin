import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { registerPasskey } from '../lib/passkeys';
import { errorText } from '../lib/errors';

export default function PasskeySettingsPage() {
    const qc = useQueryClient();
    const [toast, setToast] = React.useState<string | null>(null);

    const keysQ = useQuery({
        queryKey: ['user_passkeys'],
        queryFn: async () => {
            const { data, error } = await supabase
                .from('user_passkeys')
                .select('*')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return data;
        }
    });

    const registerM = useMutation({
        mutationFn: registerPasskey,
        onSuccess: () => {
            setToast('Passkey added!');
            qc.invalidateQueries({ queryKey: ['user_passkeys'] });
        },
        onError: (e) => setToast(`Error: ${errorText(e)}`)
    });

    const deleteM = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase.from('user_passkeys').delete().eq('id', id);
            if (error) throw error;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['user_passkeys'] });
        },
        onError: (e) => setToast(`Error: ${errorText(e)}`)
    });

    const cantRegister = !window.PublicKeyCredential;

    return (
        <div className="p-4 md:p-6 space-y-4 max-w-2xl mx-auto">
            <div className="card p-6">
                <h2 className="text-xl font-bold mb-2">Passkeys</h2>
                <p className="text-sm text-gray-600 mb-6">
                    Sign in securely without a password using your face, fingerprint, or device PIN.
                </p>

                {cantRegister && (
                    <div className="bg-orange-50 text-orange-800 p-3 rounded-xl mb-4 text-sm">
                        Your browser does not support passkeys.
                    </div>
                )}

                <button
                    className="btn btn-primary"
                    onClick={() => registerM.mutate()}
                    disabled={registerM.isPending || cantRegister}
                >
                    {registerM.isPending ? 'Registering...' : 'Add new Passkey'}
                </button>

                {toast && <div className="mt-4 text-sm text-gray-700 bg-gray-100 p-2 rounded">{toast}</div>}

                <div className="mt-8 space-y-4">
                    <h3 className="font-semibold text-sm text-gray-500 uppercase tracking-wider">Your Passkeys</h3>

                    {keysQ.isLoading && <div className="text-sm text-gray-400">Loading...</div>}

                    {(keysQ.data ?? []).length === 0 && !keysQ.isLoading && (
                        <div className="text-sm text-gray-400 italic">No passkeys registered yet.</div>
                    )}

                    {(keysQ.data ?? []).map(k => (
                        <div key={k.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-xl">
                            <div>
                                <div className="font-medium">Passkey {k.id.slice(0, 8)}...</div>
                                <div className="text-xs text-gray-400">
                                    Added {new Date(k.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <button
                                className="text-red-600 hover:bg-red-50 p-2 rounded-lg text-sm"
                                onClick={() => {
                                    if (confirm('Delete this passkey?')) deleteM.mutate(k.id);
                                }}
                            >
                                Remove
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
