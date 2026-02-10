import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { errorText } from '../lib/errors';
import { supabase } from '../lib/supabaseClient';

export default function TeenInvitePage() {
    const { token } = useParams();
    const nav = useNavigate();
    const [status, setStatus] = React.useState<'idle' | 'accepting' | 'success' | 'error'>('idle');
    const [error, setError] = React.useState<string | null>(null);

    const acceptM = useMutation({
        mutationFn: async () => {
            const tk = (token ?? '').trim();
            if (!tk) throw new Error('Missing invite token');
            const { error } = await supabase.rpc('family_accept_invite', { p_invite_token: tk });
            if (error) throw error;
        },
        onSuccess: () => {
            setStatus('success');
            setTimeout(() => nav('/rider'), 2000); // Redirect to rider home
        },
        onError: (e) => {
            setStatus('error');
            setError(errorText(e));
        }
    });

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
            <div className="card max-w-md w-full p-8 text-center space-y-4">
                <h2 className="text-2xl font-bold">Family Invitation</h2>

                {status === 'idle' && (
                    <>
                        <p className="text-gray-600">
                            You've been invited to join a RideIQ Family account.
                            You'll be able to request rides managed by your guardian.
                        </p>
                        <div className="pt-4">
                            <button
                                className="btn btn-primary w-full"
                                onClick={() => acceptM.mutate()}
                                disabled={acceptM.isPending}
                            >
                                {acceptM.isPending ? 'Accepting...' : 'Accept Invitation'}
                            </button>
                        </div>
                    </>
                )}

                {status === 'success' && (
                    <div className="bg-emerald-50 text-emerald-800 p-4 rounded-xl">
                        <div className="font-medium">Welcome to the family!</div>
                        <div className="text-sm mt-1">Redirecting you...</div>
                    </div>
                )}

                {status === 'error' && (
                    <div className="bg-red-50 text-red-800 p-4 rounded-xl">
                        <div className="font-medium">Unable to accept</div>
                        <div className="text-sm mt-1">{error}</div>
                        <button className="text-xs underline mt-2" onClick={() => nav('/home')}>Go Home</button>
                    </div>
                )}
            </div>
        </div>
    );
}
