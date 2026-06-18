import { ChangeDetectionStrategy, Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, FormControl, Validators, ReactiveFormsModule } from '@angular/forms';
import { FinanceEngine } from './services/finance';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  public engine = inject(FinanceEngine);
  Math = Math;

  incomeCount = computed(() => this.engine.transactions().filter(t => t.type === 'income').length);
  expenseCount = computed(() => this.engine.transactions().filter(t => t.type === 'expense').length);

  // Form Controls
  transactionForm = new FormGroup({
    type: new FormControl<'income' | 'expense'>('expense', { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(0.01)] }),
    category: new FormControl<string>('Food & Dining', { nonNullable: true, validators: [Validators.required] }),
    date: new FormControl<string>(new Date().toISOString().substring(0, 10), { nonNullable: true, validators: [Validators.required] }),
    note: new FormControl<string>('', { nonNullable: true })
  });

  budgetForm = new FormGroup({
    monthlyLimit: new FormControl<number>(1500, { nonNullable: true, validators: [Validators.required, Validators.min(1)] }),
    'Food & Dining': new FormControl<number>(300, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    'Rent & Housing': new FormControl<number>(800, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    'Bills & Utilities': new FormControl<number>(200, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    Transport: new FormControl<number>(100, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    Entertainment: new FormControl<number>(150, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    Shopping: new FormControl<number>(200, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    'Health & Fitness': new FormControl<number>(100, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    Other: new FormControl<number>(100, { nonNullable: true, validators: [Validators.required, Validators.min(0)] })
  });

  authForm = new FormGroup({
    email: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.minLength(6)] }),
    phoneNumber: new FormControl<string>('', { nonNullable: true })
  });

  goalForm = new FormGroup({
    name: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    targetAmount: new FormControl<number | null>(null, { validators: [Validators.required, Validators.min(1)] }),
    currentAmount: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    category: new FormControl<string>('Savings', { nonNullable: true, validators: [Validators.required] }),
    targetDate: new FormControl<string>(new Date().toISOString().substring(0, 10), { nonNullable: true, validators: [Validators.required] }),
    smartSpecific: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    smartMeasurable: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    smartAchievable: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    smartRelevant: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    smartTimeBound: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] })
  });

  // Signal properties to track UI status
  selectedType = signal<'expense' | 'income'>('expense');
  searchQuery = signal<string>('');
  typeFilter = signal<'all' | 'expense' | 'income'>('all');
  categoryFilter = signal<string>('all');
  
  // UI Tabs / Screens
  activeTab = signal<'dashboard' | 'transactions' | 'budgets' | 'advisor' | 'subscriptions'>('dashboard');
  activeSubTab = signal<'predictions' | 'goals'>('predictions');
  showAddGoalForm = signal<boolean>(false);
  showAuthPanel = signal<boolean>(false);
  authMode = signal<'login' | 'signUp'>('login');
  authError = signal<string | null>(null);
  authSuccessMsg = signal<string | null>(null);

  // Interactive UI details
  selectedDonutSlice = signal<{ category: string; amount: number; percent: number } | null>(null);
  hoveredTrendIndex = signal<number | null>(null);
  showBudgetSuccessToast = signal<boolean>(false);

  // Recharts-style Line Chart: Past 6 Months spending trend
  last6MonthsSpending = computed(() => {
    const now = new Date();
    // Build chronological array of ending year+month combos for past 6 calendar months
    const months: { year: number; month: number; label: string; amount: number; yearMonthStr: string }[] = [];
    
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = d.toLocaleDateString('en-US', { month: 'short' });
      const year = d.getFullYear();
      const month = d.getMonth();
      const yearMonthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
      months.push({
        year,
        month,
        label: `${label} '${String(year).substring(2)}`,
        amount: 0,
        yearMonthStr
      });
    }

    // Accumulate actual transaction expenses for these months
    const currentTrans = this.engine.transactions();
    currentTrans
      .filter(t => t.type === 'expense')
      .forEach(t => {
        const prefix = t.date.substring(0, 7); // e.g. "2026-06"
        const matched = months.find(m => m.yearMonthStr === prefix);
        if (matched) {
          matched.amount += t.amount;
        }
      });

    // We calculate SVG geometry matching a typical Recharts responsive container behavior
    const width = 500;
    const height = 200;
    const paddingLeft = 55;
    const paddingRight = 20;
    const paddingTop = 25;
    const paddingBottom = 35;

    const chartWidth = width - paddingLeft - paddingRight;
    const chartHeight = height - paddingTop - paddingBottom;

    const maxSpent = Math.max(...months.map(m => m.amount), 100);

    const points = months.map((m, idx) => {
      const x = paddingLeft + (idx / (months.length - 1)) * chartWidth;
      const ratio = m.amount / maxSpent;
      const y = paddingTop + chartHeight - (ratio * chartHeight);
      
      // Calculate delta versus previous calendar month in sequence
      let diffLabel = '';
      if (idx > 0) {
        const prev = months[idx - 1].amount;
        if (prev > 0) {
          const diff = ((m.amount - prev) / prev) * 100;
          if (diff > 0) {
            diffLabel = `+${diff.toFixed(0)}% m-o-m increase`;
          } else if (diff < 0) {
            diffLabel = `${diff.toFixed(0)}% m-o-m decrease`;
          } else {
            diffLabel = '0% change m-o-m';
          }
        } else if (m.amount > 0) {
          diffLabel = '+100% m-o-m increase';
        } else {
          diffLabel = '0% spend';
        }
      } else {
        diffLabel = 'Baseline Month';
      }

      return {
        ...m,
        x,
        y,
        index: idx,
        diffLabel
      };
    });

    // Generate path strokes
    let linePath = '';
    let areaPath = '';
    if (points.length > 0) {
      linePath = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        linePath += ` L ${points[i].x} ${points[i].y}`;
      }
      areaPath = `${linePath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;
    }

    // Grid tick lines
    const gridLines: { y: number; val: string }[] = [];
    const ticksCount = 4;
    for (let i = 0; i <= ticksCount; i++) {
      const ratio = i / ticksCount;
      const yVal = paddingTop + ratio * chartHeight;
      const amountVal = maxSpent - (ratio * maxSpent);
      gridLines.push({
        y: yVal,
        val: `$${Math.round(amountVal)}`
      });
    }

    return {
      points,
      linePath,
      areaPath,
      gridLines,
      width,
      height,
      paddingLeft,
      paddingRight,
      paddingTop,
      paddingBottom,
      maxSpent
    };
  });

  // Category listing options updated reactively
  categoriesList = computed(() => {
    return this.selectedType() === 'expense'
      ? ['Food & Dining', 'Rent & Housing', 'Bills & Utilities', 'Transport', 'Entertainment', 'Shopping', 'Health & Fitness', 'Other']
      : ['Salary', 'Freelance', 'Investments', 'Gift', 'Other'];
  });

  // Filter lists
  allExpenseCategories = ['Food & Dining', 'Rent & Housing', 'Bills & Utilities', 'Transport', 'Entertainment', 'Shopping', 'Health & Fitness', 'Other'];
  allIncomeCategories = ['Salary', 'Freelance', 'Investments', 'Gift', 'Other'];

  // Donut chart segments
  donutSlices = computed(() => {
    const spending = this.engine.categorySpending();
    const total = this.engine.totalExpense();
    if (total <= 0) return [];

    let accumulatedPercent = 0;
    const categories = Object.keys(spending);
    const colors = [
      '#f43f5e', // rose / Food
      '#3b82f6', // blue / Rent
      '#10b981', // emerald / Bills
      '#f59e0b', // amber / Transport
      '#8b5cf6', // violet / Entertainment
      '#ec4899', // pink / Shopping
      '#06b6d4', // cyan / Health
      '#9333ea', // purple / Other
      '#14b8a6', // teal
      '#84cc16'  // lime
    ];

    return categories.map((cat, idx) => {
      const amount = spending[cat];
      const percent = amount / total;
      const slice = {
        category: cat,
        amount,
        percent: percent * 100,
        color: colors[idx % colors.length],
        dashArray: '251.3',
        dashOffset: 251.3 - (percent * 251.3),
        rotation: (accumulatedPercent * 360) - 90
      };
      accumulatedPercent += percent;
      return slice;
    });
  });

  // Bar Graph columns containing relative heights
  last7DaysSpending = computed(() => {
    const now = new Date();
    const days: { dateStr: string; label: string; amount: number }[] = [];

    // Prepopulate last 7 days from now (inclusive)
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().substring(0, 10);
      days.push({
        dateStr,
        label: d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }),
        amount: 0
      });
    }

    // Sum transactions belonging to these dates
    const currentTrans = this.engine.transactions();
    currentTrans
      .filter(t => t.type === 'expense')
      .forEach(t => {
        const itemDate = t.date;
        const matched = days.find(d => d.dateStr === itemDate);
        if (matched) {
          matched.amount += t.amount;
        }
      });

    const maxSpent = Math.max(...days.map(d => d.amount), 50); // scales correctly even if no expense exists
    return days.map(d => ({
      ...d,
      heightPercentage: Math.max((d.amount / maxSpent) * 100, 4) // min height of 4% for style
    }));
  });

  // Dynamic Transaction filter
  filteredTransactions = computed(() => {
    let list = this.engine.transactions();

    // Query Notes filter
    const query = this.searchQuery().toLowerCase().trim();
    if (query) {
      list = list.filter(t =>
        t.note.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query)
      );
    }

    // Type Filter
    const type = this.typeFilter();
    if (type !== 'all') {
      list = list.filter(t => t.type === type);
    }

    // Category Filter
    const cat = this.categoryFilter();
    if (cat !== 'all') {
      list = list.filter(t => t.category === cat);
    }

    return list;
  });

  ngOnInit() {
    // Sync local budgets back to the reactive forms on initialization
    const currentBudget = this.engine.budget();
    this.budgetForm.patchValue({
      monthlyLimit: currentBudget.monthlyLimit,
      ...currentBudget.categoryLimits
    });
  }

  toggleType(type: 'expense' | 'income') {
    this.selectedType.set(type);
    this.transactionForm.patchValue({
      type: type,
      category: type === 'expense' ? 'Food & Dining' : 'Salary'
    });
  }

  submitTransaction() {
    if (this.transactionForm.invalid) return;

    const val = this.transactionForm.value;
    this.engine.addTransaction({
      type: val.type as 'expense' | 'income',
      amount: val.amount || 0,
      category: val.category || 'Other',
      date: val.date || new Date().toISOString().substring(0, 10),
      note: val.note || ''
    });

    // Reset controls
    this.transactionForm.patchValue({
      amount: null,
      note: ''
    });
    this.transactionForm.get('amount')?.markAsPristine();
    this.transactionForm.get('amount')?.markAsUntouched();
  }

  deleteTransaction(id: string) {
    this.engine.deleteTransaction(id);
  }

  updateBudgetSettings() {
    if (this.budgetForm.invalid) return;

    const val = this.budgetForm.value;
    const monthlyLimit = val.monthlyLimit as number;
    const limits: Record<string, number> = {
      'Food & Dining': val['Food & Dining'] ?? 0,
      'Rent & Housing': val['Rent & Housing'] ?? 0,
      'Bills & Utilities': val['Bills & Utilities'] ?? 0,
      Transport: val.Transport ?? 0,
      Entertainment: val.Entertainment ?? 0,
      Shopping: val.Shopping ?? 0,
      'Health & Fitness': val['Health & Fitness'] ?? 0,
      Other: val.Other ?? 0
    };

    this.engine.updateBudget(monthlyLimit, limits);

    this.showBudgetSuccessToast.set(true);
    setTimeout(() => this.showBudgetSuccessToast.set(false), 3000);
  }

  submitGoal() {
    if (this.goalForm.invalid) return;

    const val = this.goalForm.value;
    this.addFinancialGoal({
      name: val.name || '',
      targetAmount: val.targetAmount || 0,
      currentAmount: val.currentAmount ?? 0,
      category: val.category || 'Savings',
      targetDate: val.targetDate || new Date().toISOString().substring(0, 10),
      smartSpecific: val.smartSpecific || '',
      smartMeasurable: val.smartMeasurable || '',
      smartAchievable: val.smartAchievable || '',
      smartRelevant: val.smartRelevant || '',
      smartTimeBound: val.smartTimeBound || ''
    });

    this.goalForm.reset({
      name: '',
      targetAmount: null,
      currentAmount: 0,
      category: 'Savings',
      targetDate: new Date().toISOString().substring(0, 10),
      smartSpecific: '',
      smartMeasurable: '',
      smartAchievable: '',
      smartRelevant: '',
      smartTimeBound: ''
    });
    this.showAddGoalForm.set(false);
  }

  onAuthSubmit() {
    if (this.authForm.invalid) return;
    this.authError.set(null);
    this.authSuccessMsg.set(null);

    const email = this.authForm.controls.email.value;
    const password = this.authForm.controls.password.value;
    const phoneNumber = this.authForm.controls.phoneNumber.value;

    if (this.authMode() === 'login') {
      this.engine.login(email, password)
        .then(() => {
          this.authSuccessMsg.set('Welcome Back! Secure sync is successfully active.');
          this.authForm.reset();
          setTimeout(() => this.showAuthPanel.set(false), 2000);
        })
        .catch(err => {
          console.error(err);
          this.authError.set(this.formatAuthError(err.code || err.message));
        });
    } else {
      this.engine.signUp(email, password, phoneNumber)
        .then(() => {
          this.authSuccessMsg.set('Account successfully created! Data is synced safely.');
          this.authForm.reset();
          setTimeout(() => this.showAuthPanel.set(false), 2000);
        })
        .catch(err => {
          console.error(err);
          this.authError.set(this.formatAuthError(err.code || err.message));
        });
    }
  }

  quickTestSignIn() {
    this.authError.set(null);
    this.authSuccessMsg.set(null);
    // Standard test account for instant sandbox exploration
    const testEmail = 'portfolio-sandbox@aetherwealth.com';
    const testPass = 'sandbox123';
    
    this.engine.login(testEmail, testPass)
      .then(() => {
        this.authSuccessMsg.set('Logged into demo sandbox. Realtime cloud replication active!');
        setTimeout(() => this.showAuthPanel.set(false), 2000);
      })
      .catch((err) => {
        // If account doesn't exist yet, sign it up immediately!
        if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
          this.engine.signUp(testEmail, testPass)
            .then(() => {
              this.authSuccessMsg.set('Demo sandbox created. Live firestore triggers loaded!');
              setTimeout(() => this.showAuthPanel.set(false), 2000);
            })
            .catch(signUpErr => {
              this.authError.set(this.formatAuthError(signUpErr.code || signUpErr.message));
            });
        } else {
          this.authError.set(this.formatAuthError(err.code || err.message));
        }
      });
  }

  formatAuthError(code: string): string {
    const mode = this.authMode();
    if (code.includes('auth/invalid-email')) return 'Invalid Email Address syntax.';
    if (code.includes('auth/user-disabled')) return 'This account has been disabled.';
    if (code.includes('auth/user-not-found')) {
      return mode === 'login'
        ? 'No registered account found with this email. Click "Sign Up" above to register.'
        : 'Registered email already exists. Click "Sign In" to access your account.';
    }
    if (code.includes('auth/wrong-password') || code.includes('auth/invalid-credential')) {
      return mode === 'login'
        ? 'Invalid email or password. Please verify your credentials or click "Sign Up" if you are a new user.'
        : 'This email is already registered. Try signing in, or use another email.';
    }
    if (code.includes('auth/email-already-in-use')) return 'This email is already in use by another user. Please Sign In.';
    if (code.includes('auth/weak-password')) return 'Password must be at least 6 characters.';
    return 'Authentication error: ' + code;
  }

  fetchAIInsights() {
    this.engine.requestAIInsights();
  }

  fetchSubscriptionAnalysis() {
    this.engine.requestSubscriptionAnalysis();
  }

  changeSubStatus(id: string, status: 'active' | 'paused' | 'under_review') {
    this.engine.updateSubscriptionStatus(id, status);
  }

  addFinancialGoal(g: { name: string; targetAmount: number; currentAmount: number; category: string; targetDate: string; smartSpecific: string; smartMeasurable: string; smartAchievable: string; smartRelevant: string; smartTimeBound: string }) {
    this.engine.addGoal(g);
  }

  deleteFinancialGoal(id: string) {
    this.engine.deleteGoal(id);
  }

  updateFinancialGoalAmount(id: string, currentAmount: number) {
    this.engine.updateGoalAmount(id, currentAmount);
  }

  changeFinancialGoalStatus(id: string, status: 'in_progress' | 'completed' | 'paused') {
    this.engine.updateGoalStatus(id, status);
  }

  fetchFinancialGoalAdvice(goalId: string) {
    this.engine.requestGoalAdvice(goalId);
  }

  clearAllLedgerData() {
    if (confirm('Are you absolutely sure you want to clear all transactions, subscription and smart goal logs? They will be permanently deleted.')) {
      this.engine.wipeAllData();
    }
  }
}
