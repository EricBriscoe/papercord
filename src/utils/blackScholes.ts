/**
 * Black-Scholes Option Pricing Model
 * 
 * This module implements the Black-Scholes formula for pricing European call and put options.
 * It includes functions for calculating option prices, Greeks, and implied volatility.
 */

/**
 * Calculate cumulative distribution function of the standard normal distribution
 */
function normCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    
    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate standard normal probability density function
 */
function normPDF(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Option type enum
 */
export enum OptionType {
    CALL = 'call',
    PUT = 'put'
}

/**
 * Option class
 */
export class Option {
    // Static methods
    
    /**
     * Calculate d1 parameter for Black-Scholes formula
     */
    static d1(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        return (
            Math.log(stockPrice / strikePrice) + 
            (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry
        ) / (volatility * Math.sqrt(timeToExpiry));
    }

    /**
     * Calculate d2 parameter for Black-Scholes formula
     */
    static d2(
        d1: number,
        volatility: number,
        timeToExpiry: number
    ): number {
        return d1 - volatility * Math.sqrt(timeToExpiry);
    }

    /**
     * Calculate call option price
     */
    static callPrice(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        if (timeToExpiry <= 0) {
            return Math.max(0, stockPrice - strikePrice);
        }
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
        const d2 = this.d2(d1, volatility, timeToExpiry);
        
        return stockPrice * normCDF(d1) - strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normCDF(d2);
    }

    /**
     * Calculate put option price
     */
    static putPrice(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        if (timeToExpiry <= 0) {
            return Math.max(0, strikePrice - stockPrice);
        }
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
        const d2 = this.d2(d1, volatility, timeToExpiry);
        
        return strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normCDF(-d2) - stockPrice * normCDF(-d1);
    }

    /**
     * Calculate option price based on type
     */
    static price(
        type: OptionType,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        return type === OptionType.CALL
            ? this.callPrice(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility)
            : this.putPrice(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
    }

    /**
     * Calculate delta (sensitivity of option price to changes in underlying asset price)
     */
    static delta(
        type: OptionType,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        if (timeToExpiry <= 0) {
            if (type === OptionType.CALL) {
                return stockPrice > strikePrice ? 1 : 0;
            } else {
                return stockPrice < strikePrice ? -1 : 0;
            }
        }
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
        
        return type === OptionType.CALL 
            ? normCDF(d1) 
            : normCDF(d1) - 1;
    }

    /**
     * Calculate gamma (second derivative of option value with respect to underlying price)
     */
    static gamma(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        if (timeToExpiry <= 0) return 0;
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
        return normPDF(d1) / (stockPrice * volatility * Math.sqrt(timeToExpiry));
    }

    /**
     * Calculate theta (sensitivity of option price to time decay)
     */
    static theta(
        type: OptionType,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        if (timeToExpiry <= 0) return 0;
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
        const d2 = this.d2(d1, volatility, timeToExpiry);
        
        if (type === OptionType.CALL) {
            return -stockPrice * normPDF(d1) * volatility / (2 * Math.sqrt(timeToExpiry)) 
                - riskFreeRate * strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normCDF(d2);
        } else {
            return -stockPrice * normPDF(d1) * volatility / (2 * Math.sqrt(timeToExpiry)) 
                + riskFreeRate * strikePrice * Math.exp(-riskFreeRate * timeToExpiry) * normCDF(-d2);
        }
    }

    /**
     * Calculate vega (sensitivity of option price to volatility)
     */
    static vega(
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        volatility: number
    ): number {
        if (timeToExpiry <= 0) return 0;
        
        const d1 = this.d1(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
        return stockPrice * Math.sqrt(timeToExpiry) * normPDF(d1);
    }

    /**
     * Calculate implied volatility using Newton-Raphson method
     */
    static impliedVolatility(
        type: OptionType,
        marketPrice: number,
        stockPrice: number,
        strikePrice: number,
        timeToExpiry: number,
        riskFreeRate: number,
        maxIterations: number = 100,
        precision: number = 0.0001
    ): number {
        // Initial guess for volatility
        let volatility = 0.3;
        let i = 0;
        
        while (i++ < maxIterations) {
            const price = this.price(type, stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
            const diff = marketPrice - price;
            
            if (Math.abs(diff) < precision) {
                return volatility;
            }
            
            const vega = this.vega(stockPrice, strikePrice, timeToExpiry, riskFreeRate, volatility);
            
            // Avoid division by zero
            if (Math.abs(vega) < 1e-10) {
                break;
            }
            
            volatility = volatility + diff / vega;
            
            // Make sure volatility stays within reasonable bounds
            if (volatility < 0.001) volatility = 0.001;
            if (volatility > 5) volatility = 5;
        }
        
        // If we can't converge, return the best estimate
        return volatility;
    }

    /**
     * Calculate intrinsic value of an option
     */
    static intrinsicValue(
        type: OptionType,
        stockPrice: number,
        strikePrice: number
    ): number {
        return type === OptionType.CALL
            ? Math.max(0, stockPrice - strikePrice)
            : Math.max(0, strikePrice - stockPrice);
    }

    /**
     * Determine if option is in the money (ITM), at the money (ATM), or out of the money (OTM)
     */
    static moneyness(
        type: OptionType,
        stockPrice: number,
        strikePrice: number
    ): 'ITM' | 'ATM' | 'OTM' {
        const diff = stockPrice - strikePrice;
        const epsilon = 0.0001; // Small value to determine "at the money"
        
        if (Math.abs(diff) < epsilon) {
            return 'ATM';
        }
        
        if (type === OptionType.CALL) {
            return diff > 0 ? 'ITM' : 'OTM';
        } else {
            return diff < 0 ? 'ITM' : 'OTM';
        }
    }
}

/**
 * Default risk-free interest rate (updated annually)
 * This is an approximation of the 1-year US Treasury yield
 */
export const DEFAULT_RISK_FREE_RATE = 0.05;  // 5% as of April 2025 (hypothetical)

/**
 * Default volatility by sector
 * These are approximations and would need to be updated regularly in a production system
 */
export const DEFAULT_VOLATILITY: { [sector: string]: number } = {
    TECHNOLOGY: 0.35,
    HEALTHCARE: 0.30,
    FINANCE: 0.25,
    ENERGY: 0.40,
    CONSUMER: 0.20,
    DEFAULT: 0.30  // Default volatility when sector is unknown
};

/**
 * Helper function to calculate time to expiry in years
 * @param expirationDate Date of option expiration
 * @returns Time to expiry in years
 */
export function calculateTimeToExpiry(expirationDate: Date): number {
    const now = new Date();
    const diffMs = expirationDate.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays / 365; // Convert days to years
}

/**
 * Get historical volatility for a symbol (dummy implementation)
 * In a real system, this would calculate historical volatility from price data
 */
export function getHistoricalVolatility(symbol: string): number {
    // This is a dummy implementation - in a real system this would
    // calculate historical volatility based on price movements
    return DEFAULT_VOLATILITY.DEFAULT;
}