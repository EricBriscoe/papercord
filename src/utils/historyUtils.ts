import { userDb, transactionDb, optionsDb, cryptoTransactionDb, priceCacheDb } from '../database/operations';
import { timeFrameDays } from './chartGenerator';
import { optionsService } from '../services/optionsService';
import { coinGeckoService } from '../services/coinGeckoService';

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

export async function generateAssetSeries(
  userId: string,
  timeframe: keyof typeof timeFrameDays
): Promise<{ dates: string[]; cash: number[]; stocks: number[]; crypto: number[]; options: number[] }> {
  userDb.getOrCreateUser(userId);
  const stockTx = transactionDb.getUserTransactions(userId, 100000);
  const optionTx = optionsDb.getUserTransactions(userId, 100000);
  const cryptoTx = cryptoTransactionDb.getUserTransactions(userId, 100000);
  stockTx.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
  cryptoTx.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
  optionTx.sort((a, b) => new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime());
  let days = timeFrameDays[timeframe];
  if (timeframe === 'max') {
    const all = [...stockTx, ...cryptoTx, ...optionTx];
    if (all.length) {
      const earliest = all.reduce((m, e) => new Date(e.timestamp!) < m ? new Date(e.timestamp!) : m, new Date(all[0].timestamp!));
      days = Math.ceil((Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24));
    }
  }
  const start = new Date();
  start.setDate(start.getDate() - days);
  const dates: string[] = [];
  const cash: number[] = [];
  const stocks: number[] = [];
  const crypto: number[] = [];
  const options: number[] = [];
const cryptoIds = [...new Set(cryptoTx.map(x => x.coinId))];
const priceHistory: Record<string, Record<string, number>> = {};
for (const id of cryptoIds) {
  const { prices } = await coinGeckoService.getHistoricalPrices(id, days);
  priceHistory[id] = {};
  for (const [ts, p] of prices) {
    const date = new Date(ts).toISOString().split('T')[0];
    priceHistory[id][date] = p;
  }
}
const finalCash = userDb.getCashBalance(userId);
const totalStockFlowAll = stockTx.reduce((sum, tx) => sum + ((tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity), 0);
const totalCryptoFlowAll = cryptoTx.reduce((sum, tx) => sum + ((tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity), 0);
const totalOptFlowAll = optionTx.reduce((sum, tx) => {
  const amt = tx.price * tx.quantity * 100;
  return sum + (tx.type === 'open'
    ? (tx.position === 'long' ? -amt : amt)
    : (tx.position === 'long' ? amt : -amt));
}, 0);
const initialCash = finalCash - (totalStockFlowAll + totalCryptoFlowAll + totalOptFlowAll);
  for (let i = 0; i <= days; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const dateStr = current.toISOString().split('T')[0];
    dates.push(dateStr);
    let stockFlow = 0, cryptoFlow = 0, optFlow = 0;
    for (const tx of stockTx) {
      if (new Date(tx.timestamp!) <= current) {
        stockFlow += (tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity;
      }
    }
    for (const tx of cryptoTx) {
      if (new Date(tx.timestamp!) <= current) {
        cryptoFlow += (tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity;
      }
    }
    for (const tx of optionTx) {
      const t = new Date(tx.timestamp!);
      if (t <= current) {
        const amt = tx.price * tx.quantity * 100;
        if (tx.type === 'open') {
          optFlow += tx.position === 'long' ? -amt : amt;
        } else {
          optFlow += tx.position === 'long' ? amt : -amt;
        }
      }
    }
    cash.push(initialCash + stockFlow + cryptoFlow + optFlow);
    let mvStock = 0;
    const syms = [...new Set(stockTx.map(x => x.symbol))];
    for (const s of syms) {
      const qty = stockTx.filter(x => new Date(x.timestamp!) <= current && x.symbol === s)
        .reduce((sum, x) => sum + (x.type === 'buy' ? x.quantity : -x.quantity), 0);
      if (qty > 0) {
        const prices = priceCacheDb.getTimeSeries(s, 'yahoo', '1d', days + 1, start, new Date());
        let rec = prices.find(p => p.timestamp.startsWith(dateStr));
        if (!rec && prices.length > 0) {
          rec = prices.reduce((prev, curr) => {
            const prevDiff = Math.abs(new Date(prev.timestamp).getTime() - current.getTime());
            const currDiff = Math.abs(new Date(curr.timestamp).getTime() - current.getTime());
            return currDiff < prevDiff ? curr : prev;
          }, prices[0]);
        }
        mvStock += (rec?.price || 0) * qty;
      }
    }
    stocks.push(mvStock);
    let mvCrypto = 0;
    for (const id of cryptoIds) {
      const qty = cryptoTx
        .filter(x => new Date(x.timestamp!) <= current && x.coinId === id)
        .reduce((sum, x) => sum + (x.type === 'buy' ? x.quantity : -x.quantity), 0);
      if (qty > 0) {
        let p = priceHistory[id][dateStr];
        if (p === undefined) {
          const availableDates = Object.keys(priceHistory[id]);
          if (availableDates.length > 0) {
            const nearest = availableDates.reduce((prev, curr) => {
              const prevDiff = Math.abs(new Date(prev).getTime() - current.getTime());
              const currDiff = Math.abs(new Date(curr).getTime() - current.getTime());
              return currDiff < prevDiff ? curr : prev;
            }, availableDates[0]);
            p = priceHistory[id][nearest];
          } else {
            p = 0;
          }
        }
        mvCrypto += p * qty;
      }
    }
    crypto.push(mvCrypto);
    // compute options market value instead of cumulative flow
    let mvOptions = 0;
    const contractKeys = [...new Set(optionTx.map(tx => `${tx.symbol}|${tx.optionType}|${tx.strikePrice}|${tx.expirationDate}`))];
    for (const key of contractKeys) {
      const [sym, type, strikeStr, exp] = key.split('|');
      let netQty = 0;
      for (const tx2 of optionTx) {
        const t2 = new Date(tx2.timestamp!);
        if (t2 <= current && `${tx2.symbol}|${tx2.optionType}|${tx2.strikePrice}|${tx2.expirationDate}` === key) {
          if (tx2.type === 'open') netQty += tx2.position === 'long' ? tx2.quantity : -tx2.quantity;
          else netQty += tx2.position === 'long' ? -tx2.quantity : tx2.quantity;
        }
      }
      if (netQty !== 0) {
        const { price: perShare } = await optionsService.calculateOptionPrice(
          sym, type as 'call'|'put', parseFloat(strikeStr), exp
        );
        if (perShare) mvOptions += perShare * 100 * Math.abs(netQty);
      }
    }
    options.push(mvOptions);
  }
  return { dates, cash, stocks, crypto, options };
}
