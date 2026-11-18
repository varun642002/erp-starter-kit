import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import {
  User as FirebaseUser,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  updateProfile,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import { doc, getDoc, getDocFromCache, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { Role } from '../types/erp';
import { markStartup } from '../utils/startupTiming';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  role: Role;
  approved: boolean;
  company: string;
  branchId: string;
  phone?: string;
  createdAt?: any;
  lastLogin?: any;
}

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  assignedBranchId: string;
  loading: boolean;
  authError: string | null;
  profileError: string | null;
  isApproved: boolean;
  isSuperAdmin: boolean;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOutUser: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  clearAuthError: () => void;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEFAULT_COMPANY = 'Acme Agro Equipment';
const DEFAULT_BRANCH = 'branch-1';

function friendlyAuthError(error: any): string {
  switch (error?.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.';
    case 'auth/invalid-email':
      return 'That email address is not valid.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled for this project.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google sign-in window was closed before finishing.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google sign-in.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    default:
      return error?.message || 'Authentication failed. Please try again.';
  }
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  // While a sign-up is in flight, the sign-up flow itself creates the profile.
  const signUpInFlight = useRef(false);

  const assignedBranchId = userProfile?.branchId || DEFAULT_BRANCH;
  const isApproved = !!userProfile?.approved;
  const isSuperAdmin = isApproved && userProfile?.role === 'Super Admin';

  // Load the profile document, creating an unapproved one on first sign-in.
  // `fresh` forces a read from the server (used by "check again"); otherwise a saved copy of the profile
  // opens the app at once and the server copy is checked quietly right after.
  const syncUserProfile = async (user: FirebaseUser, displayNameOverride?: string, fresh = false) => {
    setProfileError(null);
    try {
      const userDocRef = doc(db, 'users', user.uid);

      if (!fresh) {
        let cached: Awaited<ReturnType<typeof getDocFromCache>> | null = null;
        try {
          cached = await getDocFromCache(userDocRef);
        } catch {
          cached = null; // nothing saved on this device yet
        }
        if (cached && cached.exists()) {
          setUserProfile(cached.data() as UserProfile);
          getDoc(userDocRef)
            .then((snap) => {
              if (snap.exists() && auth.currentUser?.uid === user.uid) setUserProfile(snap.data() as UserProfile);
            })
            .catch(() => {});
          updateDoc(userDocRef, { lastLogin: serverTimestamp() }).catch(() => {});
          return;
        }
      }

      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        setUserProfile(userSnap.data() as UserProfile);
        // Only non-privileged fields may be updated by the user themselves.
        updateDoc(userDocRef, { lastLogin: serverTimestamp() }).catch(() => {});
        return;
      }

      const newProfile = {
        uid: user.uid,
        email: user.email || '',
        displayName: displayNameOverride || user.displayName || user.email?.split('@')[0] || 'ERP User',
        photoURL: user.photoURL ?? null,
        role: 'Salesperson' as Role,
        approved: false,
        company: DEFAULT_COMPANY,
        branchId: DEFAULT_BRANCH,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      };
      await setDoc(userDocRef, newProfile);
      setUserProfile({ ...newProfile, createdAt: undefined, lastLogin: undefined });
    } catch (err: any) {
      console.error('Error loading user profile:', err);
      setUserProfile(null);
      setProfileError(
        err?.code === 'permission-denied'
          ? 'Your account profile could not be read. Please contact your administrator.'
          : 'Could not load your account profile. Check your connection and try again.'
      );
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        if (!signUpInFlight.current) {
          await syncUserProfile(user);
        }
      } else {
        setUserProfile(null);
        setProfileError(null);
      }
      setLoading(false);
      markStartup('sign-in-and-profile-ready');
    });

    return () => unsubscribe();
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (error: any) {
      console.error('Sign-in error:', error);
      setAuthError(friendlyAuthError(error));
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, password: string, displayName: string) => {
    setAuthError(null);
    signUpInFlight.current = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const name = displayName.trim();
      if (name) {
        await updateProfile(cred.user, { displayName: name });
      }
      await syncUserProfile(cred.user, name || undefined);
    } catch (error: any) {
      console.error('Sign-up error:', error);
      setAuthError(friendlyAuthError(error));
      throw error;
    } finally {
      signUpInFlight.current = false;
    }
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      setAuthError(friendlyAuthError(error));
      throw error;
    }
  };

  const resetPassword = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (error: any) {
      console.error('Password reset error:', error);
      setAuthError(friendlyAuthError(error));
      throw error;
    }
  };

  const signOutUser = async () => {
    try {
      await signOut(auth);
      setFirebaseUser(null);
      setUserProfile(null);
    } catch (error: any) {
      console.error('Sign-out error:', error);
      setAuthError(error.message || 'Failed to sign out.');
    }
  };

  const refreshProfile = async () => {
    if (auth.currentUser) {
      await syncUserProfile(auth.currentUser, undefined, true);
    }
  };

  const clearAuthError = () => setAuthError(null);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        userProfile,
        assignedBranchId,
        loading,
        authError,
        profileError,
        isApproved,
        isSuperAdmin,
        signInWithEmail,
        signUpWithEmail,
        signInWithGoogle,
        resetPassword,
        signOutUser,
        refreshProfile,
        clearAuthError
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const defaultAuthContext: AuthContextType = {
  firebaseUser: null,
  userProfile: null,
  assignedBranchId: DEFAULT_BRANCH,
  loading: false,
  authError: null,
  profileError: null,
  isApproved: false,
  isSuperAdmin: false,
  signInWithEmail: async () => {},
  signUpWithEmail: async () => {},
  signInWithGoogle: async () => {},
  resetPassword: async () => {},
  signOutUser: async () => {},
  refreshProfile: async () => {},
  clearAuthError: () => {}
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    return defaultAuthContext;
  }
  return context;
};
