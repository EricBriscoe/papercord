/**
 * Chart Generator Utility
 * 
 * This module provides functionality to generate visual charts for stock and crypto price data
 * using Chart.js and chartjs-node-canvas
 */

import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import * as fs from 'fs';
import * as path from 'path';
import { format } from 'date-fns';
import { yfDataService } from '../services/yfDataService';

// Output directory for generated chart images
const CHART_DIR = path.join(process.cwd(), 'data', 'cache', 'charts');

// Create directory if it doesn't exist
if (!fs.existsSync(CHART_DIR)) {
    fs.mkdirSync(CHART_DIR, { recursive: true });
}

// Available time frames for charts
export enum TimeFrame {
    DAY = '1d',
    WEEK = '1w',
    MONTH = '1m',
    THREE_MONTHS = '3m',
    SIX_MONTHS = '6m',
    YEAR = '1y',
    MAX = 'max'
}

// Time frame options mapping to days
export const timeFrameDays: Record<TimeFrame, number> = {
    [TimeFrame.DAY]: 1,
    [TimeFrame.WEEK]: 7,
    [TimeFrame.MONTH]: 30,
    [TimeFrame.THREE_MONTHS]: 90,
    [TimeFrame.SIX_MONTHS]: 180,
    [TimeFrame.YEAR]: 365,
    [TimeFrame.MAX]: 1825 // 5 years
};

// Time frame display labels
export const timeFrameLabels: Record<TimeFrame, string> = {
    [TimeFrame.DAY]: '1 Day',
    [TimeFrame.WEEK]: '1 Week',
    [TimeFrame.MONTH]: '1 Month',
    [TimeFrame.THREE_MONTHS]: '3 Months',
    [TimeFrame.SIX_MONTHS]: '6 Months',
    [TimeFrame.YEAR]: '1 Year',
    [TimeFrame.MAX]: 'Max'
};

// Dark mode theme colors
const THEME = {
    backgroundColor: '#222831',
    textColor: '#EEEEEE',
    gridColor: '#393E46',
    upColor: '#4ecca3', // Bright green for positive price movement
    downColor: '#FF2E63', // Bright red for negative price movement
    fontFamily: 'DejaVu Sans, Arial, Helvetica, sans-serif'
};

/**
 * Generate a price history chart for a stock symbol
 * 
 * @param symbol Stock ticker symbol
 * @param timeFrame TimeFrame enum specifying the duration to display
 * @returns Path to the generated chart image file
 */
export async function generateStockPriceChart(symbol: string, timeFrame: TimeFrame = TimeFrame.MONTH): Promise<string> {
    try {
        // Get days from time frame
        const days = timeFrameDays[timeFrame];
        
        // Calculate period in minutes based on days
        const periodMinutes = days * 1440; // Convert days to minutes (1440 = 24 * 60)
        const intervalMinutes = days <= 7 ? 60 : 1440; // Use hourly data for 7 days or less, daily otherwise
        
        // Fetch historical data from Yahoo Finance
        const historicalData = await yfDataService.getHistoricalData(symbol, periodMinutes, intervalMinutes);
        
        if (!historicalData?.chart?.result?.[0]?.timestamp || 
            !historicalData?.chart?.result?.[0]?.indicators?.quote?.[0]?.close) {
            throw new Error(`Failed to get historical data for ${symbol}`);
        }
        
        const result = historicalData.chart.result[0];
        const timestamps = result.timestamp || [];
        
        // Add null checks for indicators and quote
        const quotes = result.indicators && result.indicators.quote ? result.indicators.quote : [];
        const prices = quotes.length > 0 && quotes[0].close ? quotes[0].close : [];
        
        // Filter out any null values
        const validDataPoints = timestamps
            .map((time, index) => ({ time, price: prices[index] }))
            .filter(point => point.price !== null);
        
        if (validDataPoints.length < 2) {
            throw new Error(`Insufficient data points for ${symbol}`);
        }
        
        // Format dates for chart labels
        const labels = validDataPoints.map(point => {
            const date = new Date(point.time * 1000);
            return days <= 7 
                ? format(date, 'yyyy-MM-dd HH:mm')  // ISO format with time for short timeframes
                : format(date, 'yyyy-MM-dd');      // ISO format for longer timeframes
        });
        
        const dataPoints = validDataPoints.map(point => point.price);
        
        // Calculate min and max for better chart scaling (with 8% padding for dark mode)
        const min = Math.min(...dataPoints);
        const max = Math.max(...dataPoints);
        const padding = (max - min) * 0.08;
        
        // Generate color based on price movement (green for up, red for down)
        const startPrice = dataPoints[0];
        const endPrice = dataPoints[dataPoints.length - 1];
        const mainColor = endPrice >= startPrice ? THEME.upColor : THEME.downColor;
        
        // Calculate price change percentage for display
        const priceChange = endPrice - startPrice;
        const priceChangePercent = (priceChange / startPrice) * 100;
        const priceChangeFormatted = priceChange.toFixed(2);
        const priceChangePercentFormatted = priceChangePercent.toFixed(2);
        const priceChangeText = `${priceChangeFormatted} (${priceChangePercentFormatted}%)`;
        
        // Configure the chart with dark mode theme
        const chartConfig: ChartConfiguration = {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: `Price`,
                    data: dataPoints,
                    borderColor: mainColor,
                    backgroundColor: mainColor + '30', // 30 = 19% opacity in hex
                    fill: true,
                    tension: 0.3, // More curve for visual appeal
                    pointRadius: 0, // Hide points for cleaner look
                    borderWidth: 3, // Thicker line for dark background
                    pointHoverRadius: 6, // Larger hover points
                    pointHoverBackgroundColor: mainColor,
                    pointHoverBorderColor: THEME.textColor,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        display: false, // Hide legend for cleaner look
                    },
                    title: {
                        display: true,
                        text: [
                            `${symbol.toUpperCase()} - ${timeFrameLabels[timeFrame]} Price`,
                            `${priceChangePercent >= 0 ? '▲' : '▼'} ${priceChangeText}`
                        ],
                        color: THEME.textColor,
                        font: { 
                            size: 24, 
                            weight: 'bold',
                            family: THEME.fontFamily
                        },
                        padding: {
                            top: 25,
                            bottom: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: THEME.backgroundColor,
                        titleColor: THEME.textColor,
                        bodyColor: THEME.textColor,
                        borderColor: mainColor,
                        borderWidth: 1,
                        titleFont: {
                            size: 16,
                            weight: 'bold',
                            family: THEME.fontFamily
                        },
                        bodyFont: {
                            size: 14,
                            family: THEME.fontFamily
                        },
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            title: (items) => {
                                return items[0].label;
                            },
                            label: (context) => {
                                return `Price: $${context.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        display: true,
                        grid: {
                            color: THEME.gridColor,
                        },
                        ticks: {
                            color: THEME.textColor,
                            font: {
                                size: 14,
                                family: THEME.fontFamily
                            },
                            maxTicksLimit: days <= 7 ? 8 : 10,
                        }
                    },
                    y: {
                        display: true,
                        position: 'right', // Move the y-axis to the right
                        grid: {
                            color: THEME.gridColor,
                        },
                        ticks: {
                            color: THEME.textColor,
                            font: {
                                size: 14,
                                family: THEME.fontFamily
                            },
                            callback: (value) => `$${Number(value).toFixed(2)}`
                        },
                        min: min - padding,
                        max: max + padding
                    }
                },
                layout: {
                    padding: {
                        left: 10,
                        right: 20,
                        top: 20,
                        bottom: 20
                    }
                },
                elements: {
                    point: {
                        hitRadius: 8, // Larger hit area for points
                    },
                    line: {
                        capBezierPoints: true
                    }
                },
                interaction: {
                    mode: 'nearest',
                    axis: 'x',
                    intersect: false
                }
            }
        };
        
        // Create the chart image with dark background
        const chartJSNodeCanvas = new ChartJSNodeCanvas({
            width: 900, // Larger width for better readability
            height: 500, // Taller chart for better visualization
            backgroundColour: THEME.backgroundColor
        });
        
        // Render the chart to a buffer
        const buffer = await chartJSNodeCanvas.renderToBuffer(chartConfig);
        
        // Generate filename with timestamp to avoid caching issues
        const timestamp = new Date().getTime();
        const filename = `${symbol.toLowerCase()}-${timeFrame}-${timestamp}.png`;
        const filePath = path.join(CHART_DIR, filename);
        
        // Save the chart to disk
        fs.writeFileSync(filePath, buffer);
        console.debug(`Generated chart for ${symbol} at ${filePath}`);
        
        return filePath;
    } catch (error) {
        console.error(`Error generating chart for ${symbol}:`, error);
        throw error;
    }
}
