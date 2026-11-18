import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  limit,
  orderBy,
  writeBatch,
  Unsubscribe
} from 'firebase/firestore';
import { db } from './firebase';
import {
  Product,
  Branch,
  Warehouse,
  Customer,
  Supplier,
  SalesOrder,
  Invoice,
  GoodsReceivedNote,
  StockTransfer,
  ContractorProject,
  PaymentReceipt,
  Expense,
  CompanySettings,
  ActivityAuditLog
} from '../types/erp';

// Save single document to Firestore
export async function saveFirestoreDoc(collectionName: string, id: string, data: any) {
  try {
    const docRef = doc(db, collectionName, id);
    await setDoc(docRef, sanitizeForFirestore(data), { merge: true });
    return true;
  } catch (error) {
    console.error(`Error saving to ${collectionName}/${id}:`, error);
    return false;
  }
}

// Delete document from Firestore
export async function deleteFirestoreDoc(collectionName: string, id: string) {
  try {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
    return true;
  } catch (error) {
    console.error(`Error deleting from ${collectionName}/${id}:`, error);
    return false;
  }
}

// Subscribe to real-time changes on a collection, optionally filtered by branchId
export function subscribeToCollection<T>(
  collectionName: string,
  onUpdate: (data: T[]) => void,
  branchId?: string,
  onError?: (err: Error) => void,
  // For long histories: when reading every branch, take only the newest `max` documents by `field`.
  latest?: { field: string; max: number }
): Unsubscribe {
  try {
    const colRef = collection(db, collectionName);
    const q = branchId && branchId !== 'all'
      ? query(colRef, where('branchId', '==', branchId))
      : latest
        ? query(colRef, orderBy(latest.field, 'desc'), limit(latest.max))
        : colRef;

    return onSnapshot(
      q,
      (snapshot) => {
        const items: T[] = [];
        snapshot.forEach((doc) => {
          items.push({ ...doc.data(), id: doc.id } as T);
        });
        onUpdate(items);
      },
      (error) => {
        console.warn(`Snapshot subscription error for ${collectionName}:`, error);
        if (onError) onError(error);
      }
    );
  } catch (error: any) {
    console.error(`Error subscribing to ${collectionName}:`, error);
    return () => {};
  }
}

// Helper to remove undefined values before writing to Firestore
function sanitizeForFirestore(obj: any): any {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);

  const clean: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean;
}

// Check if collection is empty
export async function isCollectionEmpty(collectionName: string): Promise<boolean> {
  try {
    const colRef = collection(db, collectionName);
    const q = query(colRef, limit(1));
    const snapshot = await getDocs(q);
    return snapshot.empty;
  } catch (error) {
    console.warn(`Could not check if collection ${collectionName} is empty:`, error);
    // Return false on error so we don't blindly attempt to write if access is restricted or offline
    return false;
  }
}

// Seed initial collections to Firestore
export async function seedInitialFirestoreData(initialData: {
  products: Product[];
  projects: ContractorProject[];
  customers: Customer[];
  suppliers: Supplier[];
  warehouses: Warehouse[];
  branches: Branch[];
  salesOrders: SalesOrder[];
  invoices: Invoice[];
  expenses: Expense[];
  payments: PaymentReceipt[];
  settings: CompanySettings;
  auditLogs?: ActivityAuditLog[];
}) {
  try {
    const productsEmpty = await isCollectionEmpty('products');
    if (!productsEmpty) {
      console.log('Firestore already contains data or is in offline mode, skipping initial seed.');
      return false;
    }

    console.log('Seeding initial data to Cloud Firestore...');

    // Helper to batch write an array
    const batchWriteArray = async (collectionName: string, items: any[]) => {
      if (!items || items.length === 0) return;
      const batch = writeBatch(db);
      for (const item of items) {
        if (item && item.id) {
          const ref = doc(db, collectionName, item.id);
          batch.set(ref, sanitizeForFirestore(item));
        }
      }
      await batch.commit();
    };

    await batchWriteArray('products', initialData.products);
    await batchWriteArray('projects', initialData.projects);
    await batchWriteArray('customers', initialData.customers);
    await batchWriteArray('suppliers', initialData.suppliers);
    await batchWriteArray('warehouses', initialData.warehouses);
    await batchWriteArray('branches', initialData.branches);
    await batchWriteArray('salesOrders', initialData.salesOrders);
    await batchWriteArray('invoices', initialData.invoices);
    await batchWriteArray('expenses', initialData.expenses);
    await batchWriteArray('payments', initialData.payments);
    if (initialData.auditLogs && initialData.auditLogs.length > 0) {
      await batchWriteArray('auditLogs', initialData.auditLogs);
    }

    // Save company settings
    const settingsRef = doc(db, 'settings', 'companyConfig');
    await setDoc(settingsRef, sanitizeForFirestore(initialData.settings));

    console.log('Firestore seeded successfully!');
    return true;
  } catch (err) {
    console.warn('Firestore seeding notice (using local offline state if unauthenticated):', err);
    return false;
  }
}
