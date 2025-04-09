declare module 'finnhub' {
    export interface QuoteData {
        c: number;  // Current price
        h: number;  // High price of the day
        l: number;  // Low price of the day
        o: number;  // Open price of the day
        pc: number; // Previous close price
        t: number;  // Timestamp
    }

    export interface SymbolSearchResult {
        count: number;
        result: Array<{
            description: string;
            displaySymbol: string;
            symbol: string;
            type: string;
            exchange: string;
        }>;
    }

    export interface CompanyProfile {
        country: string;
        currency: string;
        exchange: string;
        ipo: string;
        marketCapitalization: number;
        name: string;
        phone: string;
        shareOutstanding: number;
        ticker: string;
        weburl: string;
        logo: string;
        finnhubIndustry: string;
    }

    export class ApiClient {
        static instance: {
            authentications: {
                'api_key': {
                    apiKey: string;
                }
            }
        };
    }

    export class DefaultApi {
        constructor();
        setApiKey(key: string, value: string): void;
        quote(symbol: string, callback: (error: any, data: QuoteData, response: any) => void): void;
        symbolSearch(query: string, callback: (error: any, data: SymbolSearchResult, response: any) => void): void;
        companyProfile2(options: {symbol: string}, callback: (error: any, data: CompanyProfile, response: any) => void): void;
    }
}