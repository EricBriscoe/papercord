import { formatInTimeZone } from 'date-fns-tz';
import { Client, TextChannel } from 'discord.js';
import { getAllSubscribedChannels } from '../database/operations';

/**
 * Format a currency value with $ symbol and 2 decimal places
 */
export function formatCurrency(value: number): string {
    // Handle NaN, undefined, or null values
    if (value === undefined || value === null || isNaN(value)) {
        return '$0.00';
    }
    
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

/**
 * Format a large number in a human-readable way with appropriate suffix (K, M, B, T)
 * For example, 1234567 becomes $1.23 million
 */
export function formatLargeNumber(value: number): string {
    // Handle NaN, undefined, or null values
    if (value === undefined || value === null || isNaN(value)) {
        return '$0.00';
    }
    
    // Define thresholds and corresponding suffixes
    const thresholds = [
        { value: 1e12, suffix: ' trillion' },
        { value: 1e9, suffix: ' billion' },
        { value: 1e6, suffix: ' million' },
        { value: 1e3, suffix: ' thousand' },
        { value: 1, suffix: '' }
    ];
    
    // Find the appropriate threshold
    const threshold = thresholds.find(t => value >= t.value);
    
    if (!threshold) {
        return formatCurrency(value); // Fallback to regular formatting
    }
    
    // Format the number with 1 decimal place for values over 1000
    const formattedValue = value / threshold.value;
    const decimalPlaces = threshold.value === 1 ? 2 : 1;
    
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces
    }).format(formattedValue) + threshold.suffix;
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

/**
 * Format a number with specified decimal places
 */
export function formatNumber(value: number, decimals: number = 2): string {
  // Handle NaN, undefined, or null values
  if (value === undefined || value === null || isNaN(value)) {
    return '0.00';
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/**
 * Format a cryptocurrency amount with higher precision (8 decimal places by default)
 * This is useful for currencies like Bitcoin where small fractions have value
 */
export function formatCryptoAmount(value: number, decimals: number = 8): string {
  // Handle NaN, undefined, or null values
  if (value === undefined || value === null || isNaN(value)) {
    return '0.00000000';
  }
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0, // Don't show unnecessary zeros
    maximumFractionDigits: decimals
  }).format(value);
}

/**
 * Format a cryptocurrency price with adaptive precision
 * Shows more decimal places for very small values, fewer for larger values
 */
export function formatCryptoPrice(value: number): string {
  // Handle NaN, undefined, or null values
  if (value === undefined || value === null || isNaN(value)) {
    return '$0.00';
  }
  
  // Determine appropriate precision based on value magnitude
  let decimals = 2; // Default for normal-sized values
  
  if (value < 0.0001) {
    decimals = 8; // Very tiny values
  } else if (value < 0.01) {
    decimals = 6; // Small values
  } else if (value < 1) {
    decimals = 4; // Medium-small values
  }
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).format(value);
}

/**
 * Format a number to a string with a specified number of significant figures
 * Used for crypto values where precision is important
 */
export function formatCryptoSigFig(value: number, sigFigs: number = 2): string {
  if (value === undefined || value === null || isNaN(value)) {
    return '0';
  }
  // Use toPrecision for significant figures, then remove trailing zeros
  const str = Number(value).toPrecision(sigFigs);
  // Remove trailing decimal if present
  return str.replace(/\.0+$/, '');
}

/**
 * Broadcast a message to all subscribed channels, but only if the user is a member of the channel's guild
 * @param client Discord client
 * @param messageData Object containing title, description, and type for the embed
 * @param userId Optional user ID to check membership and mention in the message
 * @param profitLoss Optional profit/loss to include in the message
 */
export async function broadcastToSubscribedChannels(
    client: Client, 
    messageData: { 
        title: string; 
        description: string; 
        type: 'liquidation' | 'margin_call' | 'margin_warning' | 'options_exercised' | 'options_expired' | 'crypto_delisted' | 'crypto_dust';
        contractDetails?: {
            purchasePrice?: number;
            closingPrice?: number;
            quantity?: number;
            contractSize?: number;
            position?: 'long' | 'short';
            optionType?: 'call' | 'put';
            strikePrice?: number;
            stockPrice?: number;
        };
    },
    userId?: string, 
    profitLoss?: number
) {
    const channelIds = getAllSubscribedChannels();
    
    // Import EmbedBuilder here to avoid circular imports
    const { EmbedBuilder, Colors } = await import('discord.js');
    
    // Create embed with appropriate styling based on type
    const embed = new EmbedBuilder()
        .setTitle(messageData.title)
        .setDescription(messageData.description)
        .setTimestamp();
        
    // Set color based on message type
    switch (messageData.type) {
        case 'liquidation':
            embed.setColor(Colors.Red);
            break;
        case 'margin_call':
            embed.setColor(Colors.Orange);
            break;
        case 'margin_warning':
            embed.setColor(Colors.Yellow);
            break;
        case 'options_exercised':
            embed.setColor(Colors.Green);
            break;
        case 'options_expired':
            embed.setColor(Colors.DarkRed);
            break;
        case 'crypto_delisted':
            embed.setColor(Colors.DarkRed);
            break;
        case 'crypto_dust':
            embed.setColor(Colors.Grey);
            break;
        default:
            embed.setColor(Colors.Blue);
    }
    
    // Add profit/loss field if provided
    if (profitLoss !== undefined) {
        const isProfit = profitLoss >= 0;
        embed.addFields({
            name: isProfit ? '📈 Profit' : '📉 Loss',
            value: formatCurrency(Math.abs(profitLoss)),
            inline: true
        });
        
        // Add calculation explanation for options positions
        if (messageData.type === 'options_exercised' || messageData.type === 'options_expired') {
            const details = messageData.contractDetails;
            if (details && details.purchasePrice !== undefined && details.quantity !== undefined && details.contractSize !== undefined) {
                let explanation = '';
                const initialCost = details.purchasePrice * details.contractSize * details.quantity;
                
                if (messageData.type === 'options_exercised') {
                    explanation = `💹 **P/L Calculation**\n`;
                    explanation += `Initial Cost: ${details.quantity} × ${formatCurrency(details.purchasePrice)} × ${details.contractSize} = ${formatCurrency(initialCost)}\n\n`;
                    
                    // Explain exercise value calculation based on option type and position
                    if (details.optionType && details.strikePrice !== undefined && details.stockPrice !== undefined) {
                        let exerciseValueCalc = '';
                        const isLong = details.position === 'long';
                        
                        if (details.optionType === 'call') {
                            // For calls: exercise value comes from stock price > strike price
                            const valuePerShare = Math.max(0, details.stockPrice - details.strikePrice);
                            const totalValue = valuePerShare * details.contractSize * details.quantity;
                            
                            exerciseValueCalc = `Call Option Value: (Stock Price - Strike Price) × Contract Size × Quantity\n`;
                            exerciseValueCalc += `= (${formatCurrency(details.stockPrice)} - ${formatCurrency(details.strikePrice)}) × ${details.contractSize} × ${details.quantity}\n`;
                            exerciseValueCalc += `= ${formatCurrency(valuePerShare)} × ${details.contractSize} × ${details.quantity}\n`;
                            exerciseValueCalc += `= ${formatCurrency(totalValue)}`;
                            
                            explanation += `${exerciseValueCalc}\n\n`;
                            explanation += `As the ${isLong ? 'buyer' : 'seller'} of this call option, you ${isLong ? 'earned' : 'paid'} the difference between the stock price and strike price.\n\n`;
                        } else { // put
                            // For puts: exercise value comes from strike price > stock price
                            const valuePerShare = Math.max(0, details.strikePrice - details.stockPrice);
                            const totalValue = valuePerShare * details.contractSize * details.quantity;
                            
                            exerciseValueCalc = `Put Option Value: (Strike Price - Stock Price) × Contract Size × Quantity\n`;
                            exerciseValueCalc += `= (${formatCurrency(details.strikePrice)} - ${formatCurrency(details.stockPrice)}) × ${details.contractSize} × ${details.quantity}\n`;
                            exerciseValueCalc += `= ${formatCurrency(valuePerShare)} × ${details.contractSize} × ${details.quantity}\n`;
                            exerciseValueCalc += `= ${formatCurrency(totalValue)}`;
                            
                            explanation += `${exerciseValueCalc}\n\n`;
                            explanation += `As the ${isLong ? 'buyer' : 'seller'} of this put option, you ${isLong ? 'earned' : 'paid'} the difference between the strike price and stock price.\n\n`;
                        }
                        
                        // Final P/L calculation
                        if (isLong) {
                            explanation += `P/L = Exercise Value - Initial Cost = ${formatCurrency(profitLoss)}`;
                        } else {
                            explanation += `P/L = Premium Received - Exercise Cost = ${formatCurrency(profitLoss)}`;
                        }
                    } else {
                        explanation += `Exercise Value: ${formatCurrency(profitLoss + initialCost)}\n\n`;
                        explanation += `P/L = Exercise Value - Initial Cost = ${formatCurrency(profitLoss)}`;
                    }
                } else if (messageData.type === 'options_expired') {
                    explanation = `💹 **P/L Calculation**\n`;
                    explanation += `Initial Cost: ${details.quantity} × ${formatCurrency(details.purchasePrice)} × ${details.contractSize} = ${formatCurrency(initialCost)}\n\n`;
                    
                    // Explain expiration based on position type
                    if (details.position === 'long') {
                        explanation += `Expiration Value: ${formatCurrency(0)} (Options expired worthless)\n\n`;
                        explanation += `When a ${details.optionType} option expires out-of-the-money, it has no value. As the buyer, you lose your entire premium.\n\n`;
                        explanation += `P/L = Expiration Value - Initial Cost = ${formatCurrency(-initialCost)}`;
                    } else { // short position
                        explanation += `Expiration Value: ${formatCurrency(initialCost)} (Full premium retained)\n\n`;
                        explanation += `When a ${details.optionType} option expires out-of-the-money, it has no value. As the seller, you keep the entire premium.\n\n`;
                        explanation += `P/L = Premium Received = ${formatCurrency(initialCost)}`;
                    }
                }
                
                if (explanation) {
                    embed.addFields({
                        name: 'Calculation Breakdown',
                        value: explanation
                    });
                }
            }
        }
    }
    
    // Add footer
    embed.setFooter({ 
        text: `PaperCord Trading Bot | ${new Date().toLocaleDateString()}` 
    });
    
    for (const channelId of channelIds) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel && channel.isTextBased()) {
            // If userId is provided, check if user is in the guild
            if (userId && 'guild' in channel && channel.guild) {
                const member = await channel.guild.members.fetch(userId).catch(() => null);
                if (!member) continue; // Skip if user is not in this guild
                
                // User mention if userId is provided
                const userMention = userId ? `<@${userId}> ` : '';
                
                // Send message with user mention and embed
                (channel as TextChannel).send({
                    content: userMention,
                    embeds: [embed]
                }).catch(() => {});
            } else {
                // Send message with just the embed
                (channel as TextChannel).send({
                    embeds: [embed]
                }).catch(() => {});
            }
        }
    }
}
