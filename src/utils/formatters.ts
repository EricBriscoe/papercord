import { formatInTimeZone } from 'date-fns-tz';

/**
 * Format a currency value with $ symbol and 2 decimal places
 */
export function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

/**
 * Format a percentage
 */
export function formatPercent(percent: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(percent / 100);
}

/**
 * Format a date with timezone information
 * Defaults to America/New_York timezone but can be customized
 */
export function formatTimestamp(date: Date | string, timezone = 'America/New_York'): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return formatInTimeZone(dateObj, timezone, 'MMM d, yyyy HH:mm zzz');
}

/**
 * Properly encodes a URL by replacing spaces with plus signs
 * Works around issues with URLs from Finnhub that contain spaces
 * @param url The URL to encode
 * @returns Properly encoded URL
 */
export function encodeUrlWithPlus(url: string): string {
  if (!url) return '';
  
  try {
    // First fix common issues with spaces that should be plus signs
    const spacesFixed = url.replace(/ /g, '+');
    
    // Then parse it to make sure it's a valid URL
    new URL(spacesFixed);
    
    return spacesFixed;
  } catch (error) {
    // If there's an error with the URL even after replacing spaces,
    // return the original to avoid making things worse
    console.log(`URL encoding failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return url;
  }
}