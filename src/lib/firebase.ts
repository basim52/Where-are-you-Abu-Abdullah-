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
  const errorStr = error instanceof Error ? error.message : String(error);
  const isQuotaError = errorStr.includes('resource-exhausted') || errorStr.includes('Quota exceeded');

  const errInfo: FirestoreErrorInfo = {
    error: errorStr,
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
  
  if (isQuotaError) {
    // Return early for quota errors to prevent crashing the whole app
    console.warn('Firestore Quota Exceeded. Please try again tomorrow.');
    return; 
  }
  
  throw new Error(JSON.stringify(errInfo));
}

// Connection test
export async function testFirestoreConnection(silent = false) {
  const testPath = 'test/connection';
  try {
    const testDoc = doc(db, 'test', 'connection');
    await getDocFromServer(testDoc);
    if (!silent) console.log('Firestore connection verified');
  } catch (error: any) {
    const isQuotaError = error?.message?.includes('Quota exceeded') || error?.message?.includes('resource-exhausted');
    if (isQuotaError) {
      if (!silent) console.warn("Firestore Quota exceeded during connection check.");
      return;
    }
    
    if (error?.message?.includes('the client is offline')) {
      if (!silent) console.error("Please check your Firebase configuration or internet connection.");
    } else {
      if (!silent) {
        console.error("Firestore connectivity check result:", error?.message);
        handleFirestoreError(error, OperationType.GET, testPath);
      }
    }
  }
}

export const signInWithGoogle = async () => {
  const currentHost = window.location.hostname;
  const authDomain = firebaseConfig.authDomain;
  
  console.log('--- Login Debug Info ---');
  console.log('Current Host:', currentHost);
  console.log('Firebase Auth Domain:', authDomain);
  console.log('Identity Platform Settings: Popup redirected to ' + authDomain);
  
  try {
    const result = await signInWithPopup(auth, googleProvider);
    console.log('Login success:', result.user.email);
    return result.user;
  } catch (error: any) {
    console.error('--- Login Error ---');
    console.error('Code:', error.code);
    console.error('Message:', error.message);
    
    if (error.code === 'auth/unauthorized-domain') {
       console.error(`ERROR: The domain "${currentHost}" is not authorized. Please add it to your Firebase console.`);
    }
    
    if (error.code === 'auth/internal-error' && error.message.includes('popup_closed_by_user')) {
      console.warn('User closed the popup.');
    }

    throw error;
  }
};
