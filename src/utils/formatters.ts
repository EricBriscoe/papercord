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