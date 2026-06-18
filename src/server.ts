import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import {join} from 'node:path';
import {GoogleGenAI} from '@google/genai';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(express.json());

const angularApp = new AngularNodeAppEngine();

/**
 * AI-Powered Expense Tracker Insights Endpoint
 */
app.post('/api/ai-insights', async (req, res) => {
  try {
    const { transactions, budget } = req.body;
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY not configured. Please add it via the Secrets panel.'
      });
      return;
    }

    const ai = new GoogleGenAI({ apiKey });

    const formattedTransactions = (transactions || []).map((t: { type: string; amount: number; category: string; date: string; note?: string }) =>
      `- ${t.type.toUpperCase()}: $${t.amount} in category '${t.category}' on ${t.date} (${t.note || 'No note'})`
    ).join('\n');

    const prompt = `
You are an expert financial advisor and AI wealth coach.
Analyze the following user's financial transactions and monthly budget, then provide clear, highly personalized financial insights, next-month budget predictions, and tactical recommendations.

Monthly Budget Limit: $${budget || 0}
Transactions list:
${formattedTransactions || 'No transactions recorded yet.'}

Provide your response in the following strict JSON format (do not use any other fields, do not include markdown codes, just return valid raw JSON):
{
  "monthlySummary": "A cohesive, professional 2-3 sentence overview of this month's budget tracking and general performance.",
  "recommendations": [
    "Specific recommendation 1 with concrete math details (e.g., 'You spent $120 on dining out this week, consider reducing it to save $50')",
    "Specific recommendation 2",
    "Specific recommendation 3"
  ],
  "prediction": "A detailed mathematical forecast of next month's spending and savings based on current trajectories.",
  "insights": [
    {
      "title": "Category Peak / Budget Siren",
      "text": "Detailed explanation of a warning, healthy pattern, or trend.",
      "severity": "warning" // 'good' | 'warning' | 'info'
    }
  ]
}

Return ONLY raw JSON, conforming exactly to this structure.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text || '';
    const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanedText);
    res.json(data);
  } catch (err: unknown) {
    const errorDetails = err as Error;
    console.error('API Error:', errorDetails);
    res.status(500).json({
      error: 'Failed to generate financial report.',
      details: errorDetails.message
    });
  }
});

/**
 * AI-Powered Subscription Detection & Analytics Endpoint
 */
app.post('/api/analyze-subscriptions', async (req, res) => {
  try {
    const { transactions } = req.body;
    const apiKey = process.env['GEMINI_API_KEY'];
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY not configured. Please add it via the Secrets panel.'
      });
      return;
    }

    const ai = new GoogleGenAI({ apiKey });

    const formattedTransactions = (transactions || []).map((t: { id: string; type: string; amount: number; category: string; date: string; note?: string }) =>
      `- [ID: ${t.id}] ${t.type.toUpperCase()}: $${t.amount} in category '${t.category}' on ${t.date} (${t.note || 'No note'})`
    ).join('\n');

    const prompt = `
You are an expert AI subscription auditor and cost-saving specialist.
Your task is to analyze the following user transactions list, detect recurring subscription payments (Netflix, Spotify, Apple Music, AWS, utilities, recurring server hostings, gym memberships, software licenses, etc.), and analyze their details.

Specifically look for:
1. Recurring transactions occurring monthly, weekly, or yearly with highly similar or identical note/description and amounts.
2. Potential DUPLICATE subscriptions inside the same category or serving identical content streams (e.g., Apple Music and Spotify, or two concurrent video platforms, or duplicated payments for same merchant).
3. Significant PRICE INCREASES (at least 5% increase compared to previous occurrences of the same subscription).
4. Calculate renewal dates dynamically: look at the date of the most recent transaction for a detected subscription and project it forward based on its frequency (e.g. if Netflix latest payment was 2026-06-15, monthly renewal is 2026-07-15).

Transactions list:
${formattedTransactions || 'No transactions recorded yet.'}

Provide your response in a strict raw JSON array of subscriptions (no markdown blocks, no formatting wrapper, just direct raw JSON array matching this typescript interface):
interface Subscription {
  id: string; // generate a clean unique string, e.g., 'sub-' + random characters or merchant slug
  name: string; // clear commercial name of subscription (e.g., 'Netflix', 'Spotify Premium')
  cost: number; // cost of the most recent occurrence (number)
  frequency: 'monthly' | 'yearly' | 'weekly' | 'other';
  renewalDate: string; // YYYY-MM-DD projected next billing date
  status: 'active'; // default status as active
  isDuplicate: boolean; // True if similar service/duplicate payment is detected
  duplicateWith?: string; // name of other subscription duplicate was flagged against (e.g. 'Spotify')
  priceIncreased: boolean; // True if price increased by over 5% compared to previous occurrence(s)
  priceChangePercentage?: number; // percentage of increase (e.g., 33.3)
  previousPrice?: number; // previous price before the increase occurred
  detectedFromTransactionIds: string[]; // transaction IDs where this subscription was recorded
  notes?: string; // a concise user alert explaining any duplicates or price changes (e.g., "Price increased from $14.99 to $19.99 last month")
}

Return ONLY a valid JSON array matching the structure above. No preamble, no backticks.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    const text = response.text || '';
    const cleanedText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanedText);
    res.json(data);
  } catch (err: unknown) {
    const errorDetails = err as Error;
    console.error('API analyze-subscriptions Error:', errorDetails);
    res.status(500).json({
      error: 'Failed to analyze subscription profile.',
      details: errorDetails.message
    });
  }
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
