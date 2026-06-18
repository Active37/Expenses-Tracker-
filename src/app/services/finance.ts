import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User, Auth } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, Firestore } from 'firebase/firestore';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
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
  };
}

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

export interface Subscription {
  id: string;
  name: string;
  cost: number;
  frequency: 'monthly' | 'yearly' | 'weekly' | 'other';
  renewalDate: string;
  status: 'active' | 'paused' | 'under_review';
  isDuplicate: boolean;
  duplicateWith?: string;
  priceIncreased: boolean;
  priceChangePercentage?: number;
  previousPrice?: number;
  detectedFromTransactionIds: string[];
  notes?: string;
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
  projectedExpense: number;
  projectedSurplusDeficit: number;
  isDeficit: boolean;
  seasonalityInsights: string;
}

export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  category: string;
  targetDate: string;
  status: 'in_progress' | 'completed' | 'paused';
  createdAt: string;
  smartSpecific: string;
  smartMeasurable: string;
  smartAchievable: string;
  smartRelevant: string;
  smartTimeBound: string;
  aiAdvice?: string;
  aiSuggestedBudgetAdjustments?: string[];
  aiProgressTracking?: string;
  loadingAdvice?: boolean;
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
  subscriptions = signal<Subscription[]>([]);
  subLoading = signal<boolean>(false);
  subError = signal<string | null>(null);
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

  goals = signal<FinancialGoal[]>([]);
  goalsLoading = signal<boolean>(false);
  goalsError = signal<string | null>(null);

  currentUser = signal<User | null>(null);
  authLoading = signal<boolean>(true);
  syncStatus = signal<'offline' | 'saved_offline' | 'syncing' | 'synced'>('offline');
  aiInsights = signal<AIInsight | null>(null);
  aiLoading = signal<boolean>(false);
  aiError = signal<string | null>(null);
  userPhone = signal<string>('');
  private registeredPhonePending = '';

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

  subscriptionCostLoad = computed(() => {
    return this.subscriptions()
      .filter(s => s.status === 'active')
      .reduce((sum, s) => sum + s.cost, 0);
  });

  alertSubscriptions = computed(() => {
    return this.subscriptions()
      .filter(s => s.status !== 'paused' && (s.isDuplicate || s.priceIncreased));
  });

  priceHikeSubscriptions = computed(() => {
    return this.subscriptions()
      .filter(s => s.status !== 'paused' && s.priceIncreased);
  });

  duplicateSubscriptions = computed(() => {
    return this.subscriptions()
      .filter(s => s.status !== 'paused' && s.isDuplicate);
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
        this.transactions.set([]);
        localStorage.setItem('finance_transactions', JSON.stringify([]));
      }

      const localSubs = localStorage.getItem('finance_subscriptions');
      if (localSubs) {
        this.subscriptions.set(JSON.parse(localSubs));
      } else {
        this.subscriptions.set([]);
        localStorage.setItem('finance_subscriptions', JSON.stringify([]));
      }

      if (localBudget) {
        this.budget.set(JSON.parse(localBudget));
      } else {
        const defaultBudget = {
          monthlyLimit: 0,
          categoryLimits: {
            'Food & Dining': 0,
            'Rent & Housing': 0,
            'Bills & Utilities': 0,
            'Transport': 0,
            'Entertainment': 0,
            'Shopping': 0,
            'Health & Fitness': 0,
            'Other': 0
          }
        };
        this.budget.set(defaultBudget);
        localStorage.setItem('finance_budget', JSON.stringify(defaultBudget));
      }

      if (localInsights) {
        this.aiInsights.set(JSON.parse(localInsights));
      }

      const localGoals = localStorage.getItem('finance_goals');
      if (localGoals) {
        this.goals.set(JSON.parse(localGoals));
      } else {
        this.goals.set([]);
        localStorage.setItem('finance_goals', JSON.stringify([]));
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
      localStorage.setItem('finance_subscriptions', JSON.stringify(this.subscriptions()));
      localStorage.setItem('finance_goals', JSON.stringify(this.goals()));
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
      let userSnap;
      try {
        userSnap = await getDoc(userDocRef);
      } catch (err) {
        this.handleFirestoreError(err, OperationType.GET, `users/${uid}`);
        return;
      }

      if (userSnap.exists()) {
        const cloudData = userSnap.data();
        if (cloudData['phoneNumber']) {
          this.userPhone.set(cloudData['phoneNumber']);
        } else {
          this.userPhone.set('');
        }
        if (cloudData['transactions']) {
          this.transactions.set(cloudData['transactions']);
          localStorage.setItem('finance_transactions', JSON.stringify(cloudData['transactions']));
        }
        if (cloudData['budget']) {
          this.budget.set(cloudData['budget']);
          localStorage.setItem('finance_budget', JSON.stringify(cloudData['budget']));
        }
        if (cloudData['subscriptions']) {
          this.subscriptions.set(cloudData['subscriptions']);
          localStorage.setItem('finance_subscriptions', JSON.stringify(cloudData['subscriptions']));
        }
        if (cloudData['goals']) {
          this.goals.set(cloudData['goals']);
          localStorage.setItem('finance_goals', JSON.stringify(cloudData['goals']));
        }
        if (cloudData['insights']) {
          this.aiInsights.set(cloudData['insights']);
          localStorage.setItem('finance_insights', JSON.stringify(cloudData['insights']));
        }
        this.syncStatus.set('synced');
      } else {
        // User first login, initialize brand new secure ledger with a clean slate (zero mock data) so they can key in their real data
        this.transactions.set([]);
        this.subscriptions.set([]);
        this.goals.set([]);
        this.aiInsights.set(null);
        this.notifications.set([]);
        this.userPhone.set(this.registeredPhonePending || '');

        const initialBudget = {
          monthlyLimit: 0,
          categoryLimits: {
            'Food & Dining': 0,
            'Rent & Housing': 0,
            'Bills & Utilities': 0,
            'Transport': 0,
            'Entertainment': 0,
            'Shopping': 0,
            'Health & Fitness': 0,
            'Other': 0
          }
        };

        this.budget.set(initialBudget);

        try {
          await setDoc(userDocRef, {
            transactions: [],
            budget: initialBudget,
            subscriptions: [],
            goals: [],
            insights: null,
            phoneNumber: this.registeredPhonePending || '',
            updatedAt: new Date().toISOString()
          });
        } catch (err) {
          this.handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
        }

        this.registeredPhonePending = '';

        localStorage.setItem('finance_transactions', JSON.stringify([]));
        localStorage.setItem('finance_subscriptions', JSON.stringify([]));
        localStorage.setItem('finance_goals', JSON.stringify([]));
        localStorage.setItem('finance_budget', JSON.stringify(initialBudget));
        localStorage.removeItem('finance_insights');

        this.syncStatus.set('synced');
      }
      this.checkBudgets();
    } catch (e) {
      console.error('Failed to sync with Firestore', e);
      this.syncStatus.set('offline');
      if (e instanceof Error && e.message && e.message.includes('{"error"')) {
        throw e;
      }
    }
  }

  private async pushToCloud() {
    const user = this.currentUser();
    if (!user || !this.db) return;

    this.syncStatus.set('syncing');
    try {
      const userDocRef = doc(this.db, 'users', user.uid);
      try {
        await setDoc(userDocRef, {
          transactions: this.transactions(),
          budget: this.budget(),
          subscriptions: this.subscriptions(),
          goals: this.goals(),
          insights: this.aiInsights(),
          phoneNumber: this.userPhone(),
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (err) {
        this.handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
      }
      this.syncStatus.set('synced');
    } catch (e) {
      console.error('Firestore save failed', e);
      this.syncStatus.set('offline');
      if (e instanceof Error && e.message && e.message.includes('{"error"')) {
        throw e;
      }
    }
  }

  private handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
    const errInfo: FirestoreErrorInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: this.auth?.currentUser?.uid || null,
        email: this.auth?.currentUser?.email || null,
        emailVerified: this.auth?.currentUser?.emailVerified || null,
        isAnonymous: this.auth?.currentUser?.isAnonymous || null,
        tenantId: this.auth?.currentUser?.tenantId || null,
        providerInfo: this.auth?.currentUser?.providerData?.map(provider => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || []
      },
      operationType,
      path
    };
    const stringified = JSON.stringify(errInfo);
    console.error('Firestore Error: ', stringified);
    throw new Error(stringified);
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

  // AI subscription detection & tracking flow
  async requestSubscriptionAnalysis() {
    this.subLoading.set(true);
    this.subError.set(null);
    try {
      const payload = {
        transactions: this.transactions()
      };

      const res = await fetch('/api/analyze-subscriptions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Analyze subscriptions endpoint returned status: ${res.status}`);
      }

      const detected: Subscription[] = await res.json();
      
      // Merge detected subscriptions while preserving manual status overrides like paused/review
      const currentList = this.subscriptions();
      const merged = detected.map(newSub => {
        const existing = currentList.find(s => s.name.toLowerCase() === newSub.name.toLowerCase());
        if (existing) {
          return {
            ...newSub,
            id: existing.id,
            status: existing.status
          };
        }
        return newSub;
      });

      this.subscriptions.set(merged);
      
      if (this.isBrowser) {
        localStorage.setItem('finance_subscriptions', JSON.stringify(merged));
      }

      if (this.currentUser()) {
        this.pushToCloud();
      }
    } catch (err: unknown) {
      const e = err as Error;
      console.error('Failed to analyze subscriptions via AI', e);
      this.subError.set(e.message || 'Server connection or processing timeout.');
    } finally {
      this.subLoading.set(false);
    }
  }

  updateSubscriptionStatus(id: string, status: 'active' | 'paused' | 'under_review') {
    this.subscriptions.update(prev => prev.map(sub => sub.id === id ? { ...sub, status } : sub));
    
    if (this.isBrowser) {
      localStorage.setItem('finance_subscriptions', JSON.stringify(this.subscriptions()));
    }

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  // Financial Goals Management
  addGoal(goalInput: Omit<FinancialGoal, 'id' | 'createdAt' | 'status'>) {
    const newGoal: FinancialGoal = {
      ...goalInput,
      id: 'goal-' + Math.random().toString(36).substring(2, 9),
      status: 'in_progress',
      createdAt: new Date().toISOString()
    };

    this.goals.update(prev => [newGoal, ...prev]);
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  deleteGoal(id: string) {
    this.goals.update(prev => prev.filter(g => g.id !== id));
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  updateGoalAmount(id: string, currentAmount: number) {
    this.goals.update(prev => prev.map(g => {
      if (g.id === id) {
        const completed = currentAmount >= g.targetAmount;
        return {
          ...g,
          currentAmount,
          status: completed ? 'completed' : g.status
        };
      }
      return g;
    }));
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  updateGoalStatus(id: string, status: 'in_progress' | 'completed' | 'paused') {
    this.goals.update(prev => prev.map(g => g.id === id ? { ...g, status } : g));
    this.saveLocalData();

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  async requestGoalAdvice(goalId: string) {
    // Set loading indicator on this specific goal
    this.goals.update(prev => prev.map(g => g.id === goalId ? { ...g, loadingAdvice: true } : g));
    this.goalsError.set(null);

    try {
      const selectedGoal = this.goals().find(g => g.id === goalId);
      if (!selectedGoal) throw new Error('Goal not found');

      const payload = {
        goal: selectedGoal,
        transactions: this.transactions(),
        budget: this.budget()
      };

      const res = await fetch('/api/analyze-goal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Advisor endpoint returned status: ${res.status}`);
      }

      const adviceResult = await res.json();
      
      this.goals.update(prev => prev.map(g => {
        if (g.id === goalId) {
          return {
            ...g,
            aiAdvice: adviceResult.advice,
            aiSuggestedBudgetAdjustments: adviceResult.suggestedBudgetAdjustments,
            aiProgressTracking: adviceResult.progressTracking,
            loadingAdvice: false
          };
        }
        return g;
      }));

      this.saveLocalData();

      if (this.currentUser()) {
        this.pushToCloud();
      }
    } catch (err: unknown) {
      const e = err as Error;
      console.error('Goal advice generation failed', e);
      this.goalsError.set(e.message || 'Server timeout or connection failure asking the AI.');
      this.goals.update(prev => prev.map(g => g.id === goalId ? { ...g, loadingAdvice: false } : g));
    }
  }

  // Account Management
  async signUp(email: string, pass: string, phoneNumber?: string) {
    if (!this.auth) throw new Error('Auth not initialized.');
    this.authLoading.set(true);
    try {
      if (phoneNumber) {
        this.registeredPhonePending = phoneNumber;
      } else {
        this.registeredPhonePending = '';
      }
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
      this.userPhone.set('');
      this.syncStatus.set('offline');
      // Clear personal states, re-load local storage
      this.loadLocalData();
    } catch (e) {
      console.error('Sign Out failed', e);
    }
  }

  wipeAllData() {
    this.transactions.set([]);
    this.subscriptions.set([]);
    this.goals.set([]);
    this.aiInsights.set(null);
    this.notifications.set([]);

    const emptyBudget = {
      monthlyLimit: 0,
      categoryLimits: {
        'Food & Dining': 0,
        'Rent & Housing': 0,
        'Bills & Utilities': 0,
        'Transport': 0,
        'Entertainment': 0,
        'Shopping': 0,
        'Health & Fitness': 0,
        'Other': 0
      }
    };
    this.budget.set(emptyBudget);

    if (this.isBrowser) {
      localStorage.setItem('finance_transactions', JSON.stringify([]));
      localStorage.setItem('finance_subscriptions', JSON.stringify([]));
      localStorage.setItem('finance_goals', JSON.stringify([]));
      localStorage.setItem('finance_budget', JSON.stringify(emptyBudget));
      localStorage.removeItem('finance_insights');
    }

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  addSubscription(subInput: { name: string; cost: number; frequency: 'weekly' | 'monthly' | 'yearly'; renewalDate: string; notes?: string }) {
    const newSub: Subscription = {
      ...subInput,
      id: 'sub-' + Math.random().toString(36).substring(2, 9),
      status: 'active',
      isDuplicate: false,
      priceIncreased: false,
      detectedFromTransactionIds: []
    };

    this.subscriptions.update(prev => [newSub, ...prev]);

    if (this.isBrowser) {
      localStorage.setItem('finance_subscriptions', JSON.stringify(this.subscriptions()));
    }

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }

  deleteSubscription(id: string) {
    this.subscriptions.update(prev => prev.filter(s => s.id !== id));

    if (this.isBrowser) {
      localStorage.setItem('finance_subscriptions', JSON.stringify(this.subscriptions()));
    }

    if (this.currentUser()) {
      this.pushToCloud();
    }
  }
}
