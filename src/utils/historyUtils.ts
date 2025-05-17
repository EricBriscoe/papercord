import { userDb, transactionDb, optionsDb, cryptoTransactionDb, priceCacheDb } from '../database/operations';
import { timeFrameDays } from './chartGenerator';
import { optionsService } from '../services/optionsService';
import { coinGeckoService } from '../services/coinGeckoService';
import { stockService } from '../services/stockService';

export async function generateEquitySeries(
  userId: string,
  timeframe: keyof typeof timeFrameDays,
  filter: 'stocks' | 'options' | 'crypto' | 'all'
): Promise<{ dates: string[]; equity: number[] }> {
  userDb.getOrCreateUser(userId);

  // Retrieve all relevant transactions first
  const stockTx =
    filter === 'stocks' || filter === 'all'
      ? transactionDb.getUserTransactions(userId, 100000)
      : [];
  const optionTx =
    filter === 'options' || filter === 'all'
      ? optionsDb.getUserTransactions(userId, 100000)
      : [];
  const cryptoTx =
    filter === 'crypto' || filter === 'all'
      ? cryptoTransactionDb.getUserTransactions(userId, 100000)
      : [];

  stockTx.sort(
    (a, b) =>
      new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );
  optionTx.sort(
    (a, b) =>
      new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );
  cryptoTx.sort(
    (a, b) =>
      new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );

  const now = new Date();
  let days = timeFrameDays[timeframe];
  if (timeframe === 'max') {
    const allTx = [...stockTx, ...optionTx, ...cryptoTx];
    if (allTx.length) {
      const earliest = allTx.reduce(
        (min: Date, tx: any) => {
          const t = new Date(tx.timestamp!);
          return t < min ? t : min;
        },
        new Date(allTx[0].timestamp!)
      );
      days = Math.ceil(
        (now.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)
      );
    } else {
      days = 0;
    }
  }

  const start = new Date(now);
  start.setDate(start.getDate() - days);
  const samples: Date[] = [];
  for (let i = 0; i <= days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    samples.push(d);
  }

  // Prefetch historical stock prices into memory map
  const stockSymbols = [...new Set(stockTx.map((t) => t.symbol))];
  const stockPriceHistory: Record<string, Record<string, number>> = {};
  for (const sym of stockSymbols) {
    stockPriceHistory[sym] = {};
    const historical = await stockService.getHistoricalPrices(
      sym,
      days * 24 * 60,
      24 * 60
    );
    for (const entry of historical) {
      const dateKey = entry.timestamp.split('T')[0];
      stockPriceHistory[sym][dateKey] = entry.price;
    }
  }

  const dates: string[] = [];
  const equity: number[] = [];

  for (const current of samples) {
    let cash = 100000;
    // cash flows
    for (const tx of stockTx) {
      if (new Date(tx.timestamp!) <= current) {
        cash += (tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity;
      }
    }
    for (const tx of optionTx) {
      if (new Date(tx.timestamp!) <= current) {
        const amt = tx.price * tx.quantity * 100;
        cash +=
          tx.type === 'open'
            ? tx.position === 'long'
              ? -amt
              : amt
            : tx.position === 'long'
            ? amt
            : -amt;
      }
    }
    for (const tx of cryptoTx) {
      if (new Date(tx.timestamp!) <= current) {
        cash += (tx.type === 'buy' ? -1 : 1) * tx.price * tx.quantity;
      }
    }

    // market value
    let mvStocks = 0;
    const dateKey = current.toISOString().split('T')[0];
    for (const sym of stockSymbols) {
      const qty = stockTx
        .filter((t) => new Date(t.timestamp!) <= current && t.symbol === sym)
        .reduce((sum, t) => sum + (t.type === 'buy' ? t.quantity : -t.quantity), 0);
      if (qty > 0) {
        const price = stockPriceHistory[sym]?.[dateKey] || 0;
        mvStocks += price * qty;
      }
    }

    let mvCrypto = 0;
    const cryptoIds = [...new Set(cryptoTx.map((t) => t.coinId))];
    for (const id of cryptoIds) {
      const qty = cryptoTx
        .filter((t) => new Date(t.timestamp!) <= current && t.coinId === id)
        .reduce((sum, t) => sum + (t.type === 'buy' ? t.quantity : -t.quantity), 0);
      if (qty > 0) {
        const prices = priceCacheDb.getTimeSeries(
          id,
          'coingecko',
          '1d',
          days + 1,
          start,
          now
        );
        const rec = prices.find((p) =>
          p.timestamp.startsWith(dateKey)
        );
        mvCrypto += (rec?.price || 0) * qty;
      }
    }

    dates.push(dateKey);
    equity.push(cash + mvStocks + mvCrypto);
  }

  return { dates, equity };
}

export async function generateAssetSeries(
  userId: string,
  timeframe: keyof typeof timeFrameDays
): Promise<{
  dates: string[];
  cash: number[];
  stocks: number[];
  crypto: number[];
  options: number[];
}> {
  userDb.getOrCreateUser(userId);
  const stockTx = transactionDb.getUserTransactions(userId, 100000);
  const optionTx = optionsDb.getUserTransactions(userId, 100000);
  const cryptoTx = cryptoTransactionDb.getUserTransactions(userId, 100000);
  stockTx.sort(
    (a, b) =>
      new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );
  cryptoTx.sort(
    (a, b) =>
      new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );
  optionTx.sort(
    (a, b) =>
      new Date(a.timestamp!).getTime() - new Date(b.timestamp!).getTime()
  );

  let days = timeFrameDays[timeframe];
  if (timeframe === 'max') {
    const all = [...stockTx, ...cryptoTx, ...optionTx];
    if (all.length) {
      const earliest = all.reduce(
        (m, e) => (new Date(e.timestamp!) < m ? new Date(e.timestamp!) : m),
        new Date(all[0].timestamp!)
      );
      days = Math.ceil(
        (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24)
      );
    }
  }

  const start = new Date();
  start.setDate(start.getDate() - days);

  const dates: string[] = [];
  const cash: number[] = [];
  const stocks: number[] = [];
  const crypto: number[] = [];
  const options: number[] = [];

  // fetch stock history
  const stockIds = [...new Set(stockTx.map((x) => x.symbol))];
  const stockPriceHistory: Record<string, Record<string, number>> = {};
  for (const sym of stockIds) {
    const hist = await stockService.getHistoricalPrices(sym, days * 24 * 60, 24 * 60);
    stockPriceHistory[sym] = {};
    for (const entry of hist) {
      const dateKey = entry.timestamp.split('T')[0];
      stockPriceHistory[sym][dateKey] = entry.price;
    }
  }

  // fetch crypto history
  const cryptoIds = [...new Set(cryptoTx.map((x) => x.coinId))];
  const priceHistory: Record<string, Record<string, number>> = {};
  for (const id of cryptoIds) {
    const { prices } = await coinGeckoService.getHistoricalPrices(id, days);
    priceHistory[id] = {};
    for (const [ts, p] of prices) {
      priceHistory[id][new Date(ts).toISOString().split('T')[0]] = p;
    }
  }

  // compute initial cash
  const finalCash = userDb.getCashBalance(userId);
  const totalStockFlowAll = stockTx.reduce(
    (sum, tx) =>
      sum + (tx.type === 'buy' ? -tx.price * tx.quantity : tx.price * tx.quantity),
    0
  );
  const totalCryptoFlowAll = cryptoTx.reduce(
    (sum, tx) =>
      sum + (tx.type === 'buy' ? -tx.price * tx.quantity : tx.price * tx.quantity),
    0
  );
  const totalOptFlowAll = optionTx.reduce((sum, tx) => {
    const amt = tx.price * tx.quantity * 100;
    return (
      sum +
      (tx.type === 'open'
        ? tx.position === 'long'
          ? -amt
          : amt
        : tx.position === 'long'
        ? amt
        : -amt)
    );
  }, 0);
  const initialCash = finalCash - (totalStockFlowAll + totalCryptoFlowAll + totalOptFlowAll);

  for (let i = 0; i <= days; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const dateStr = current.toISOString().split('T')[0];
    dates.push(dateStr);

    // cash
    let stockFlow = 0,
      cryptoFlow = 0,
      optFlow = 0;
    for (const tx of stockTx) {
      if (new Date(tx.timestamp!) <= current) {
        stockFlow += tx.type === 'buy' ? -tx.price * tx.quantity : tx.price * tx.quantity;
      }
    }
    for (const tx of cryptoTx) {
      if (new Date(tx.timestamp!) <= current) {
        cryptoFlow += tx.type === 'buy' ? -tx.price * tx.quantity : tx.price * tx.quantity;
      }
    }
    for (const tx of optionTx) {
      if (new Date(tx.timestamp!) <= current) {
        const amt = tx.price * tx.quantity * 100;
        optFlow += tx.type === 'open'
          ? tx.position === 'long'
            ? -amt
            : amt
          : tx.position === 'long'
          ? amt
          : -amt;
      }
    }
    cash.push(initialCash + stockFlow + cryptoFlow + optFlow);

    // positions
    // stocks
    let mvStock = 0;
    const syms = [...new Set(stockTx.map((x) => x.symbol))];
    for (const s of syms) {
      const qty = stockTx
        .filter((x) => new Date(x.timestamp!) <= current && x.symbol === s)
        .reduce((sum, x) => sum + (x.type === 'buy' ? x.quantity : -x.quantity), 0);
      if (qty > 0) {
        // get price from pre-fetched history
        let price = stockPriceHistory[s]?.[dateStr];
        if (price === undefined) {
          const datesArr = Object.keys(stockPriceHistory[s] || {}).sort();
          const priorDates = datesArr.filter((d) => d <= dateStr);
          const closestDate = priorDates.length ? priorDates[priorDates.length - 1] : datesArr[0];
          price = stockPriceHistory[s]?.[closestDate] || 0;
        }
        mvStock += price * qty;
      }
    }
    stocks.push(mvStock);

    // crypto
    let mvC = 0;
    for (const id of cryptoIds) {
      const qty = cryptoTx
        .filter((x) => new Date(x.timestamp!) <= current && x.coinId === id)
        .reduce((sum, x) => sum + (x.type === 'buy' ? x.quantity : -x.quantity), 0);
      if (qty > 0) {
        // get price from pre-fetched history
        let p = priceHistory[id]?.[dateStr];
        if (p === undefined) {
          const datesArr = Object.keys(priceHistory[id] || {}).sort();
          const priorDates = datesArr.filter((d) => d <= dateStr);
          const closestDate = priorDates.length ? priorDates[priorDates.length - 1] : datesArr[0];
          p = priceHistory[id]?.[closestDate] || 0;
        }
        mvC += p * qty;
      }
    }
    crypto.push(mvC);

    // options
    let mvOpt = 0;
    const contractKeys = [...new Set(optionTx.map((tx) =>
      `${tx.symbol}|${tx.optionType}|${tx.strikePrice}|${tx.expirationDate}`
    ))];
    for (const key of contractKeys) {
      const [sym, type, strikeStr, exp] = key.split('|');
      let netQty = 0;
      for (const tx of optionTx) {
        if (
          new Date(tx.timestamp!) <= current &&
          `${tx.symbol}|${tx.optionType}|${tx.strikePrice}|${tx.expirationDate}` === key
        ) {
          if (tx.type === 'open') {
            netQty += tx.position === 'long' ? tx.quantity : -tx.quantity;
          } else {
            netQty += tx.position === 'long' ? -tx.quantity : tx.quantity;
          }
        }
      }
      if (netQty) {
        const { price: perShare } = await optionsService.calculateOptionPrice(
          sym,
          type as 'call' | 'put',
          parseFloat(strikeStr),
          exp
        );
        mvOpt += (perShare || 0) * 100 * Math.abs(netQty);
      }
    }
    options.push(mvOpt);
  }

  return { dates, cash, stocks, crypto, options };
}
