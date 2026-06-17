import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User, Auth } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, Firestore } from 'firebase/firestore';

export interface Transaction {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  date: string;
  note: string;
  createdAt: string;
}

export interface Budget {
  monthlyLimit: number;
  categoryLimits: Record<string, number>;
}

export interface AIInsight {
  monthlySummary: string;
  recommendations: string[];
  prediction: string;
  insights: {
    title: string;
    text: string;
    severity: 'good' | 'warning' | 'info';
  }[];
}

const FIREBASE_CONFIG = {
  projectId: "gen-lang-client-0875324053",
  appId: "1:491056580385:web:81c0a606e14a78983ae060",
  apiKey: "AIzaSyC7AJgBXdVsly3WpDQts-YwiGDr7KROFcg",
  authDomain: "gen-lang-client-0875324053.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-12db1844-0263-4351-94f9-db41924e2587",
  storageBucket: "gen-lang-client-0875324053.firebasestorage.app",
  messagingSenderId: "491056580385"
};

@Injectable({
  providedIn: 'root'
})
export class FinanceEngine {
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  // Firebase elements
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private db: Firestore | null = null;

  // State Signals
  transactions = signal<Transaction[]>([]);
  budget = signal<Budget>({
    monthlyLimit: 1500,
    categoryLimits: {
      'Food & Dining': 300,
      'Rent & Housing': 800,
      'Bills & Utilities': 200,
      'Transport': 100,
      'Entertainment': 150,
      'Shopping': 200,
      'Health & Fitness': 100,
      'Other': 100
    }
  });

  currentUser = signal<User | null>(null);
  authLoading = signal<boolean>(true);
  syncStatus = signal<'offline' | 'saved_offline' | 'syncing' | 'synced'>('offline');
  aiInsights = signal<AIInsight | null>(null);
  aiLoading = signal<boolean>(false);
  aiError = signal<string | null>(null);

  // Notifications
  notifications = signal<{ id: string; message: string; type: 'warning' | 'info'; date: string }[]>([]);

  // Computed Values
  totalIncome = computed(() => {
    return this.transactions()
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  totalExpense = computed(() => {
    return this.transactions()
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
  });

  netBalance = computed(() => {
    return this.totalIncome() - this.totalExpense();
  });

  categorySpending = computed(() => {
    const spending: Record<string, number> = {};
    this.transactions()
      .filter(t => t.type === 'expense')
      .forEach(t => {
        spending[t.category] = (spending[t.category] || 0) + t.amount;
      });
    return spending;
  });

  budgetRatio = computed(() => {
    const limit = this.budget().monthlyLimit;
    if (limit <= 0) return 0;
    return Math.min((this.totalExpense() / limit) * 100, 100);
  });

  constructor() {
    this.loadLocalData();
    if (this.isBrowser) {
      this.initFirebase();
    }
  }

  private initFirebase() {
    try {
      this.app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApp();
      this.auth = getAuth(this.app);
      this.db = getFirestore(this.app, FIREBASE_CONFIG.firestoreDatabaseId);

      this.authLoading.set(true);

      onAuthStateChanged(this.auth, async (user) => {
        this.currentUser.set(user);
        this.authLoading.set(false);

        if (user) {
          this.syncStatus.set('syncing');
          await this.syncWithCloud(user.uid);
        } else {
          this.syncStatus.set('offline');
        }
      });
    } catch (e) {
      console.error('Firebase failed to initialize, using offline simulation', e);
      this.authLoading.set(false);
      this.syncStatus.set('offline');
    }
  }

  private loadLocalData() {
    if (!this.isBrowser) return;

    try {
      const localTrans = localStorage.getItem('finance_transactions');
      const localBudget = localStorage.getItem('finance_budget');
      const localInsights = localStorage.getItem('finance_insights');

      if (localTrans) {
        this.transactions.set(JSON.parse(localTrans));
      } else {
        // Hydrate with some default transactions for beautiful initial render and easy testing
        const sampleTrans: Transaction[] = [
          {
            id: 'sample-1',
            type: 'income',
            amount: 3200,
            category: 'Salary',
            date: new Date().toISOString().substring(0, 7) + '-01',
            note: 'Monthly salary credit',
            createdAt: new Date().toISOString()
          },
          {
            id: 'sample-2',
            type: 'expense',
            amount: 800,
            category: 'Rent & Housing',
            date: new Date().toISOString().substring(0, 7) + '-02',
            note: 'Apartment Rent',
            createdAt: new Date().toISOString()
          },
          {
            id: 'sample-3',
            type: 'expense',
            amount: 145.50,
            category: 'Food & Dining',
            date: new Date().toISOString().substring(0, 7) + '-05',
            note: 'Weekly Grocery Shopping',
            createdAt: new Date().toISOString()
          },
          {
            id: 'sample-4',
            type: 'expense',
            amount: 55,
            category: 'Bills & Utilities',
            date: new Date().toISOString().substring(0, 7) + '-06',
            note: 'High-speed Internet',
            createdAt: new Date().toISOString()
          },
          {
            id: 'sample-5',
            type: 'expense',
            amount: 45.20,
            category: 'Entertainment',
            date: new Date().toISOString().substring(0, 7) + '-10',
            note: 'Movie tickets and snacks',
            createdAt: new Date().toISOString()
          },
          {
            id: 'sample-6',
            type: 'income',
            amount: 350,
            category: 'Freelance',
            date: new Date().toISOString().substring(0, 7) + '-12',
            note: 'Landing page design service',
            createdAt: new Date().toISOString()
          }
        ];
        this.transactions.set(sampleTrans);
        localStorage.setItem('finance_transactions', JSON.stringify(sampleTrans));
      }

      if (localBudget) {
        this.budget.set(JSON.parse(localBudget));
      }

      if (localInsights) {
        this.aiInsights.set(JSON.parse(localInsights));
      }

      this.checkBudgets();
    } catch (e) {
      console.error('LocalStorage load failed', e);
    }
  }

  private saveLocalData() {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem('finance_transactions', JSON.stringify(this.transactions()));
      localStorage.setItem('finance_budget', JSON.stringify(this.budget()));
      if (this.aiInsights()) {
        localStorage.setItem('finance_insights', JSON.stringify(this.aiInsights()));
      }
      this.checkBudgets();

      if (!this.currentUser()) {
        this.syncStatus.set('saved_offline');
        setTimeout(() => this.syncStatus.set('offline'), 2000);
      }
    } catch (e) {
      console.error('LocalStorage save failed', e);
    }
  }

  private async syncWithCloud(uid: string) {
    if (!this.db) return;

    try {
      const userDocRef = doc(this.db, 'users', uid);
      const userSnap = await getDoc(userDocRef);

      if (userSnap.exists()) {
        const cloudData = userSnap.data();
        if (cloudData['transactions']) {
          this.transactions.set(cloudData['transactions']);
          localStorage.setItem('finance_transactions', JSON.stringify(cloudData['transactions']));
        }
        if (cloudData['budget']) {
          this.budget.set(cloudData['budget']);
          localStorage.setItem('finance_budget', JSON.stringify(cloudData['budget']));
        }
        if (cloudData['insights']) {
          this.aiInsights.set(cloudData['insights']);
          localStorage.setItem('finance_insights', JSON.stringify(cloudData['insights']));
        }
        this.syncStatus.set('synced');
      } else {
        // User first login, push current local data to cloud
        await setDoc(userDocRef, {
          transactions: this.transactions(),
          budget: this.budget(),
          insights: this.aiInsights(),
          updatedAt: new Date().toISOString()
        });
        this.syncStatus.set('synced');
      }
      this.checkBudgets();
    } catch (e) {
      console.error('Failed to sync with Firestore', e);
      this.syncStatus.set('offline');
    }
  }

  private async pushToCloud() {
    const user = this.currentUser();
    if (!user || !this.db) return;

    this.syncStatus.set('syncing');
    try {
      const userDocRef = doc(this.db, 'users', user.uid);
      await setDoc(userDocRef, {
        transactions: this.transactions(),
        budget: this.budget(),
        insights: this.aiInsights(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
      this.syncStatus.set('synced');
    } catch (e) {
      console.error('Firestore save failed', e);
      this.syncStatus.set('offline');
    }
  }

  checkBudgets() {
    const msgs: { id: string; message: string; type: 'warning' | 'info'; date: string }[] = [];
    const expense = this.totalExpense();
    const limit = this.budget().monthlyLimit;

    // Total monthly limit exceed calculation
    if (expense > limit) {
      msgs.push({
        id: 'budget-warn',
        message: `Crucial! Total monthly expenses ($${expense.toFixed(2)}) have exceeded your overall budget ($${limit.toFixed(2)})!`,
        type: 'warning',
        date: new Date().toISOString().substring(0, 10)
      });
    } else if (expense > limit * 0.85) {
      msgs.push({
        id: 'budget-info',
        message: `Caution: Overall expenses are at ${Math.round((expense/limit)*100)}% of your monthly budget. Spending is tight!`,
        type: 'info',
        date: new Date().toISOString().substring(0, 10)
      });
    }

    // Category limits calculation
    const spending = this.categorySpending();
    const catLimits = this.budget().categoryLimits;

    for (const [cat, catLimit] of Object.entries(catLimits)) {
      const spent = spending[cat] || 0;
      if (spent > catLimit) {
        msgs.push({
          id: `budget-warn-${cat}`,
          message: `Overshot limit! Category '${cat}' has exceeded its specified budget by $${(spent - catLimit).toFixed(2)} ($${spent.toFixed(2)} / $${catLimit.toFixed(2)}).`,
          type: 'warning',
          date: new Date().toISOString().substring(0, 10)
        });
      } else if (spent > catLimit * 0.85) {
        msgs.push({
          id: `budget-info-${cat}`,
          message: `Category warning: '${cat}' spending reaches ${Math.round((spent/catLimit)*100)}% of its limit ($${spent.toFixed(2)} / $${catLimit.toFixed(2)}).`,
          type: 'info',
          date: new Date().toISOString().substring(0, 10)
        });
      }
    }

    this.notifications.set(msgs);
  }

  addTransaction(t: Omit<Transaction, 'id' | 'createdAt'>) {
    const newTrans: Transaction = {
      ...t,
      id: 'tx-' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString()
    };

    this.transactions.update(prev => [newTrans, ...prev]);
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  deleteTransaction(id: string) {
    this.transactions.update(prev => prev.filter(t => t.id !== id));
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  updateBudget(monthlyLimit: number, categoryLimits: Record<string, number>) {
    this.budget.set({
      monthlyLimit,
      categoryLimits
    });
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  // AI Insights Generation using secure backend service
  async requestAIInsights() {
    this.aiLoading.set(true);
    this.aiError.set(null);

    try {
      const payload = {
        transactions: this.transactions(),
        budget: this.budget().monthlyLimit
      };

      const res = await fetch('/api/ai-insights', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`API returned status code: ${res.status}`);
      }

      const report: AIInsight = await res.json();
      this.aiInsights.set(report);
      
      if (this.isBrowser) {
        localStorage.setItem('finance_insights', JSON.stringify(report));
      }

      if (this.currentUser()) {
        this.pushToCloud();
      }
    } catch (err: unknown) {
      const e = err as Error;
      console.error('Failed to generate AI financial insights', e);
      this.aiError.set(e.message || 'Server timeout or connection failure.');
    } finally {
      this.aiLoading.set(false);
    }
  }

  // Account Management
  async signUp(email: string, pass: string) {
    if (!this.auth) throw new Error('Auth not initialized.');
    this.authLoading.set(true);
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email, pass);
      return cred.user;
    } catch (err: unknown) {
      this.authLoading.set(false);
      throw err;
    }
  }

  async login(email: string, pass: string) {
    if (!this.auth) throw new Error('Auth not initialized.');
    this.authLoading.set(true);
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, pass);
      return cred.user;
    } catch (err: unknown) {
      this.authLoading.set(false);
      throw err;
    }
  }

  async logout() {
    if (!this.auth) return;
    try {
      await signOut(this.auth);
      this.currentUser.set(null);
      this.syncStatus.set('offline');
      // Clear personal states, re-load local storage
      this.loadLocalData();
    } catch (e) {
      console.error('Sign Out failed', e);
    }
  }
}
