import { FastifyInstance } from 'fastify';

// Fixed prototype rates only. INR per 1 unit of display currency; not live FX.
const INR_PER_UNIT: Record<string, number> = { INR: 1, USD: 83, EUR: 90, GBP: 105 };
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };

export default async function currencyRoutes(fastify: FastifyInstance) {
  fastify.get('/api/currency/convert', async (req, reply) => {
    const { amount: rawAmount, to = 'INR' } = req.query as { amount?: string; to?: string };
    const amount = Number(rawAmount);
    const currency = to.toUpperCase();
    if (!Number.isFinite(amount) || amount < 0 || !INR_PER_UNIT[currency]) {
      return reply.status(400).send({ success: false, error: 'INVALID_CURRENCY_REQUEST', message: 'Provide a non-negative amount and INR, USD, EUR, or GBP.' });
    }
    const inrAmount = amount;
    const convertedAmount = Number((inrAmount / INR_PER_UNIT[currency]).toFixed(2));
    return { success: true, baseCurrency: 'INR', baseAmount: inrAmount, currency, symbol: SYMBOL[currency], convertedAmount, rateInrPerUnit: INR_PER_UNIT[currency], rateType: 'fixed_demo_rate' };
  });
}
