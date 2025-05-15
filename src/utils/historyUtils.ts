import { userDb, transactionDb, optionsDb, cryptoTransactionDb, priceCacheDb } from '../database/operations';
import { timeFrameDays } from './chartGenerator';

export async function generateEquitySeries(
  userId: string,
  timeframe: keyof typeof timeFrameDays,
  filter: 'stocks' | 'options' | 'crypto' | 'all'
): Promise<{ dates: string[]; equity: number[] }> {
  userDb.getOrCreateUser(userId);

  // Retrieve all relevant transactions first
  const stockTx = (filter === 'stocks' || filter === 'all')
    ? transactionDb.getUserTransactions(userId, 100000)
    : [];
  const optionTx = (filter === 'options' || filter === 'all')
    ? optionsDb.getUserTransactions(userId, 100000)
    : [];
  const cryptoTx = (filter === 'crypto' || filter === 'all')
    ? cryptoTransactionDb.getUserTransactions(userId, 100000)
    : [];

  // Sort transactions by timestamp ascending
  stockTx.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
  optionTx.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
  cryptoTx.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());

  const now = new Date();
  // Determine number of days: dynamic for 'max', fixed otherwise
  let days = timeFrameDays[timeframe];
  if (timeframe === 'max') {
    const allTx = [...stockTx, ...optionTx, ...cryptoTx];
    if (allTx.length) {
      const earliest = allTx.reduce((min: Date, tx: any) => {
        const t = new Date(tx.timestamp!);
        return t < min ? t : min;
      }, new Date(allTx[0].timestamp!));
      const diff = now.getTime() - earliest.getTime();
      days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    } else {
      days = 0;
    }
  }

  // Build list of sample dates
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const samples: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    samples.push(d);
  }

  const dates: string[] = [];
  const equity: number[] = [];

  for (const current of samples) {
    // Compute cash balance at this date
    let cash = 100000;
    for (const tx of stockTx) {
      const t = new Date(tx.timestamp!);
      if (t <= current) {
        cash += (tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity;
      }
    }
    for (const tx of optionTx) {
      const t = new Date(tx.timestamp!);
      if (t <= current) {
        const amt = tx.price * tx.quantity * 100;
        cash += tx.type === 'open'
          ? tx.position === 'long' ? -amt : amt
          : tx.position === 'long' ? amt : -amt;
      }
    }
    for (const tx of cryptoTx) {
      const t = new Date(tx.timestamp!);
      if (t <= current) {
        cash += (tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity;
      }
    }

    // Market value of positions at this date
    let mv = 0;
    // Stocks
    const symbols = [...new Set(stockTx.map(t => t.symbol))];
    for (const sym of symbols) {
      const qty = stockTx
        .filter(t => new Date(t.timestamp!) <= current && t.symbol === sym)
        .reduce((sum, t) => sum + (t.type === 'buy' ? t.quantity : -t.quantity), 0);
      if (qty > 0) {
        const prices = priceCacheDb.getTimeSeries(sym, 'yahoo', '1d', days + 1, start, now);
        const rec = prices.find(p => p.timestamp.startsWith(current.toISOString().split('T')[0]));
        mv += (rec?.price || 0) * qty;
      }
    }
    // Crypto
    const coins = [...new Set(cryptoTx.map(t => t.coinId))];
    for (const id of coins) {
      const qty = cryptoTx
        .filter(t => new Date(t.timestamp!) <= current && t.coinId === id)
        .reduce((sum, t) => sum + (t.type === 'buy' ? t.quantity : -t.quantity), 0);
      if (qty > 0) {
        const prices = priceCacheDb.getTimeSeries(id, 'coingecko', '1d', days + 1, start, now);
        const rec = prices.find(p => p.timestamp.startsWith(current.toISOString().split('T')[0]));
        mv += (rec?.price || 0) * qty;
      }
    }

    dates.push(current.toISOString().split('T')[0]);
    equity.push(cash + mv);
  }

  return { dates, equity };
}
