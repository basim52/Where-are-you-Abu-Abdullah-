import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Connection test
export async function testFirestoreConnection() {
  const testPath = 'test/connection';
  try {
    // Attempt to fetch a non-existent document from a 'test' collection to verify connection
    // We use getDocFromServer to bypass cache and verify real connectivity
    const testDoc = doc(db, 'test', 'connection');
    await getDocFromServer(testDoc);
    console.log('Firestore connection verified');
  } catch (error: any) {
    // We ignore 403 because we mostly care about 404 (= connected) vs 500/offline
    // But since we WANT permission to read the test doc, a 403 is still indicative of rules issue
    if (error?.message?.includes('the client is offline')) {
      console.error("Please check your Firebase configuration or internet connection.");
    } else {
      console.error("Firestore connectivity check result:", error?.message);
      handleFirestoreError(error, OperationType.GET, testPath);
    }
  }
}

export const signInWithGoogle = async () => {
  console.log('Starting Google Login with Popup...', { 
    authDomain: firebaseConfig.authDomain,
    currentHost: window.location.hostname
  });
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log('Login success:', result.user.email);
    return result.user;
  } catch (error: any) {
    console.error('Detailed login error:', {
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    
    // Check for common cross-origin / iframe issues
    if (error.code === 'auth/internal-error' && error.message.includes('popup_closed_by_user')) {
      console.warn('User closed the popup before finishing login.');
    }
    
    if (error.code === 'auth/network-request-failed') {
      console.error('Network request failed. This might be due to an ad blocker or cross-site tracking protection.');
    }

    throw error;
  }
};
