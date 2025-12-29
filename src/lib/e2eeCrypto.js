let sodiumPromise = null;
let didSelfTest = false;

function toBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const s = String(value || '');
  const binary = atob(s);
  const u8 = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    u8[i] = binary.charCodeAt(i);
  }
  return u8;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function u8Equal(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function storageKey(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return `peoplepower:e2ee:identityKey:${normalized}`;
}

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function initSodium() {
  if (!sodiumPromise) {
    sodiumPromise = import('tweetnacl').then((mod) => {
      const s = mod?.default ?? mod;

      if (!didSelfTest && typeof import.meta !== 'undefined' && import.meta?.env?.DEV) {
        didSelfTest = true;
        try {
          // Check scalarMult symmetry (ECDH correctness)
          const a = s.box.keyPair();
          const b = s.box.keyPair();
          const ab = s.scalarMult(a.secretKey, b.publicKey);
          const ba = s.scalarMult(b.secretKey, a.publicKey);
          if (!u8Equal(ab, ba)) throw new Error('scalarMult mismatch');

          // Check secretbox round-trip
          const key = s.hash(ab).subarray(0, 32);
          const nonce = s.randomBytes(s.secretbox.nonceLength);
          const msg = textEncoder.encode('pp-e2ee-self-test');
          const boxed = s.secretbox(msg, nonce, key);
          const opened = s.secretbox.open(boxed, nonce, key);
          if (!opened) throw new Error('secretbox open failed');
          if (!u8Equal(opened, msg)) throw new Error('secretbox roundtrip mismatch');
        } catch (e) {
          console.warn('[e2ee] crypto self-test failed (dev only)', e);
        }
      }

      return s;
    });
  }

  return sodiumPromise;
}

export async function getOrCreateIdentityKeypair(email) {
  const s = await initSodium();
  const key = storageKey(email);

  if (typeof window !== 'undefined') {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? safeParse(raw) : null;
    if (parsed?.publicKey && parsed?.privateKey) {
      return { publicKey: String(parsed.publicKey), privateKey: String(parsed.privateKey) };
    }
  }

  const kp = s.box.keyPair();
  const publicKey = toBase64(kp.publicKey);
  const privateKey = toBase64(kp.secretKey);

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, JSON.stringify({ publicKey, privateKey }));
  }

  return { publicKey, privateKey };
}

export async function getIdentityPublicKey(email) {
  const kp = await getOrCreateIdentityKeypair(email);
  return kp.publicKey;
}

export async function deriveSharedSecretKey(myPrivateKeyB64, otherPublicKeyB64) {
  const s = await initSodium();
  const mySk = fromBase64(myPrivateKeyB64);
  const otherPk = fromBase64(otherPublicKeyB64);

  // X25519 scalar multiplication
  const shared = s.scalarMult(mySk, otherPk);

  // Derive a stable 32-byte secretbox key from the shared secret.
  // tweetnacl.hash returns 64 bytes (SHA-512); take first 32 bytes.
  const hashed = s.hash(shared);
  return hashed.subarray(0, 32);
}

export async function encryptText(plaintext, keyBytes) {
  const s = await initSodium();
  const nonce = s.randomBytes(s.secretbox.nonceLength);
  const messageBytes = textEncoder.encode(String(plaintext));
  const cipher = s.secretbox(messageBytes, nonce, keyBytes);

  return {
    v: 1,
    nonce: toBase64(nonce),
    cipher: toBase64(cipher),
  };
}

export async function decryptText(payload, keyBytes) {
  const s = await initSodium();
  const nonce = fromBase64(payload?.nonce || '');
  const cipher = fromBase64(payload?.cipher || '');
  const msg = s.secretbox.open(cipher, nonce, keyBytes);
  if (!msg) throw new Error('Failed to decrypt message');
  return textDecoder.decode(msg);
}
