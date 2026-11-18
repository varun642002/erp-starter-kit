import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';

// Live count of accounts waiting for approval; only a Super Admin may read them.
export function usePendingAccessCount(): number {
  const { isSuperAdmin } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isSuperAdmin) {
      setCount(0);
      return;
    }
    const q = query(collection(db, 'users'), where('approved', '==', false));
    const unsubscribe = onSnapshot(
      q,
      (snap) => setCount(snap.size),
      () => setCount(0)
    );
    return unsubscribe;
  }, [isSuperAdmin]);

  return count;
}
