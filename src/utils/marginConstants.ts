import { ColorResolvable } from 'discord.js';

/**
 * Margin requirement constants
 * 
 * These constants define the different thresholds used in the margin system,
 * shared across the application to ensure consistent margin calculations.
 */

// Initial margin requirement (50% = 2:1 leverage)
export const INITIAL_MARGIN_PERCENTAGE = 0.5;

// Maintenance margin requirement (25% = 4:1 leverage)
export const MAINTENANCE_MARGIN_PERCENTAGE = 0.25;

// Warning threshold (30% - give warning when close to maintenance margin)
export const WARNING_THRESHOLD = 0.30;

// Margin call threshold (at maintenance level)
export const MARGIN_CALL_THRESHOLD = MAINTENANCE_MARGIN_PERCENTAGE;

// Liquidation threshold (20% - forced liquidation if margin drops this low)
export const LIQUIDATION_THRESHOLD = 0.2;

// Helper function to get margin status text
export function getMarginStatusText(marginEquityRatio: number): string {
    if (marginEquityRatio >= WARNING_THRESHOLD) {
        return '✅ Good Standing';
    } else if (marginEquityRatio >= MARGIN_CALL_THRESHOLD) {
        return '⚠️ Warning: Approaching Margin Call';
    } else if (marginEquityRatio >= LIQUIDATION_THRESHOLD) {
        return '🚨 MARGIN CALL - Action Required';
    } else {
        return '❌ LIQUIDATION IN PROGRESS';
    }
}

// Helper function to get margin status color
export function getMarginStatusColor(marginEquityRatio: number): ColorResolvable {
    if (marginEquityRatio >= WARNING_THRESHOLD) {
        return 0x00FF00; // Green
    } else if (marginEquityRatio >= MARGIN_CALL_THRESHOLD) {
        return 0xFFFF00; // Yellow
    } else if (marginEquityRatio >= LIQUIDATION_THRESHOLD) {
        return 0xFF9900; // Orange
    } else {
        return 0xFF0000; // Red
    }
}

export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}