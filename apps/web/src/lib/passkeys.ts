import { invokeEdge } from './edgeInvoke';

// Utilities for Base64URL encoding/decoding
function bufferToBase64URL(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let string = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        string += String.fromCharCode(bytes[i]);
    }
    return btoa(string)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

function base64URLToBuffer(base64URL: string): ArrayBuffer {
    const base64 = base64URL.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(padLen);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

export async function registerPasskey() {
    if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser');
    if (!window.isSecureContext) throw new Error('Passkeys require a secure context (HTTPS or localhost)');

    // 1. Get options from server
    const { data: options } = await invokeEdge<any>('passkey-register', { step: 'begin' });
    const challengeId: string = options.challengeId;

    // 2. Decode challenge & user ID
    const publicKey: PublicKeyCredentialCreationOptions = {
        ...options.publicKey,
        challenge: base64URLToBuffer(options.publicKey.challenge),
        user: {
            ...options.publicKey.user,
            id: base64URLToBuffer(options.publicKey.user.id),
        },
        // Ensure params are array
        pubKeyCredParams: options.publicKey.pubKeyCredParams,
        excludeCredentials: options.publicKey.excludeCredentials?.map((c: any) => ({
            ...c,
            id: base64URLToBuffer(c.id),
        }))
    };

    // 3. Create credential
    const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
    if (!credential) throw new Error('Credential creation failed');

    const response = credential.response as AuthenticatorAttestationResponse;

    // 4. Send response to server
    const body = {
        step: 'finish',
        challengeId,
        credential: {
            id: credential.id,
            rawId: bufferToBase64URL(credential.rawId),
            type: credential.type,
            authenticatorAttachment: (credential as any).authenticatorAttachment ?? null,
            clientExtensionResults: credential.getClientExtensionResults(),
            response: {
                clientDataJSON: bufferToBase64URL(response.clientDataJSON),
                attestationObject: bufferToBase64URL(response.attestationObject),
                transports: (response as any).getTransports?.() ?? [],
            },
        },
    };

    await invokeEdge('passkey-register', body);
    return true;
}

export async function authenticatePasskey() {
    if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser');
    if (!window.isSecureContext) throw new Error('Passkeys require a secure context (HTTPS or localhost)');

    // 1. Get options from server
    const { data: options } = await invokeEdge<any>('passkey-authenticate', { step: 'begin' });
    const challengeId: string = options.challengeId;

    // 2. Decode challenge
    const publicKey: PublicKeyCredentialRequestOptions = {
        ...options.publicKey,
        challenge: base64URLToBuffer(options.publicKey.challenge),
        allowCredentials: options.publicKey.allowCredentials?.map((c: any) => ({
            ...c,
            id: base64URLToBuffer(c.id),
        })),
    };

    // 3. Get credential
    const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
    if (!credential) throw new Error('Authentication failed');

    const response = credential.response as AuthenticatorAssertionResponse;

    // 4. Send to server
    const body = {
        step: 'finish',
        challengeId,
        credential: {
            id: credential.id,
            rawId: bufferToBase64URL(credential.rawId),
            type: credential.type,
            clientExtensionResults: credential.getClientExtensionResults(),
            response: {
                clientDataJSON: bufferToBase64URL(response.clientDataJSON),
                authenticatorData: bufferToBase64URL(response.authenticatorData),
                signature: bufferToBase64URL(response.signature),
                userHandle: response.userHandle ? bufferToBase64URL(response.userHandle) : null,
            },
        },
    };

    const { data: result } = await invokeEdge<any>('passkey-authenticate', body);
    return result as { ok?: boolean; verified?: boolean; error?: string };
}
