// Passkey (WebAuthn) ceremonies. The backend (webauthn-rs) sends options with
// base64url strings for binary fields and expects credentials in the same form.

function fromB64url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toB64url(buf: ArrayBuffer | null | undefined): string | undefined {
  if (!buf) return undefined;
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Descriptor = { id: string; type: string; transports?: string[] };

function decodeDescriptors(list?: Descriptor[]) {
  return list?.map((c) => ({ ...c, id: fromB64url(c.id) })) as PublicKeyCredentialDescriptor[] | undefined;
}

export function passkeysAvailable(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential && window.isSecureContext;
}

/** Run navigator.credentials.create with server options; returns the JSON credential for the server */
export async function createPasskey(options: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pk = (options as { publicKey: any }).publicKey;
  const publicKey: PublicKeyCredentialCreationOptions = {
    ...pk,
    challenge: fromB64url(pk.challenge),
    user: { ...pk.user, id: fromB64url(pk.user.id) },
    excludeCredentials: decodeDescriptors(pk.excludeCredentials),
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled");
  const res = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    extensions: cred.getClientExtensionResults(),
    response: {
      attestationObject: toB64url(res.attestationObject),
      clientDataJSON: toB64url(res.clientDataJSON),
      transports: res.getTransports?.(),
    },
  };
}

/** Run navigator.credentials.get with server options; returns the JSON credential for the server */
export async function getPasskey(options: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pk = (options as { publicKey: any }).publicKey;
  const publicKey: PublicKeyCredentialRequestOptions = {
    ...pk,
    challenge: fromB64url(pk.challenge),
    allowCredentials: decodeDescriptors(pk.allowCredentials),
  };
  const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey sign-in was cancelled");
  const res = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: toB64url(cred.rawId),
    type: cred.type,
    extensions: cred.getClientExtensionResults(),
    response: {
      authenticatorData: toB64url(res.authenticatorData),
      clientDataJSON: toB64url(res.clientDataJSON),
      signature: toB64url(res.signature),
      userHandle: toB64url(res.userHandle),
    },
  };
}
