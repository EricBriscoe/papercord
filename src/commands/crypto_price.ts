import { ApplicationCommandOptionType, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../models/command';
import { coinGeckoService } from '../services/coinGeckoService';
import { formatCurrency } from '../utils/formatters';

export const cryptoPriceCommand: Command = {
    name: 'crypto_price',
    description: 'Get the current price of a cryptocurrency',
    options: [
        {
            name: 'coin',
            description: 'Name or symbol of the cryptocurrency (e.g., bitcoin, btc, ethereum)',
            type: ApplicationCommandOptionType.String,
            required: true
        }
    ],
    execute: async (interaction: ChatInputCommandInteraction) => {
        // Defer reply to give us time to fetch data
        await interaction.deferReply();
        
        const query = interaction.options.getString('coin')?.toLowerCase() || '';
        
        // Add timestamp to identify when the command was executed
        console.log(`[${new Date().toISOString()}] Crypto price command executed for query: "${query}"`);
        
        try {
            // First search for the coin
            console.log(`[DEBUG] Searching for coin matching query: "${query}"`);
            const searchResults = await coinGeckoService.searchCoins(query);
            
            console.log(`[DEBUG] Search returned ${searchResults.length} results`);
            
            if (searchResults.length === 0) {
                await interaction.editReply(`Could not find any cryptocurrency matching "${query}". Please try another search term.`);
                return;
            }
            
            // Use the first (best) match
            const coin = searchResults[0];
            console.log(`[DEBUG] Selected coin: ${coin.name} (${coin.symbol}) with ID: ${coin.id}`);
            
            // Get API call stats for debugging
            const apiStats = coinGeckoService.getApiCallStats();
            console.log(`[DEBUG] CoinGecko API stats before price fetch - Total calls: ${apiStats.totalCalls}, Daily calls: ${apiStats.dailyCalls}`);
            
            // Check cache state
            console.log(`[DEBUG] Checking cache state before price fetch`);
            try {
                // Force a cache update to ensure we get fresh data
                console.log(`[DEBUG] Forcing cache update for fresh data`);
                await coinGeckoService.forceUpdateCache();
                console.log(`[DEBUG] Cache update completed`);
            } catch (cacheError) {
                console.error(`[ERROR] Failed to update cache: ${cacheError}`);
            }
            
            // Get current price
            console.log(`[DEBUG] Fetching price for coin ID: ${coin.id}`);
            const startTime = Date.now();
            const priceData = await coinGeckoService.getCoinPrice(coin.id);
            const endTime = Date.now();
            
            console.log(`[DEBUG] Price fetch completed in ${endTime - startTime}ms`);
            console.log(`[DEBUG] Price data:`, JSON.stringify(priceData));
            
            if (!priceData.price) {
                console.error(`[ERROR] Failed to fetch price for ${coin.id}. Error: ${priceData.error || 'Unknown error'}`);
                await interaction.editReply(`Could not fetch current price for ${coin.name} (${coin.symbol.toUpperCase()}). Please try again later.`);
                return;
            }
            
            // Log if price was from cache
            if (priceData.cached) {
                console.log(`[DEBUG] Price was served from cache. Cache status: ${JSON.stringify({
                    source: priceData.source || 'unknown',
                    lastUpdated: priceData.lastUpdated || 'unknown'
                })}`);
            } else {
                console.log(`[DEBUG] Price was fetched fresh from API`);
            }
            
            // Try to get additional details
            let coinDetails;
            try {
                console.log(`[DEBUG] Fetching additional details for ${coin.id}`);
                coinDetails = await coinGeckoService.getCoinDetails(coin.id);
                console.log(`[DEBUG] Successfully fetched coin details`);
            } catch (error) {
                console.error(`[ERROR] Failed to fetch details for ${coin.id}:`, error);
            }
            
            // Create embed for response
            console.log(`[DEBUG] Creating response embed with price: ${priceData.price}`);
            const embed = new EmbedBuilder()
                .setTitle(`${coin.name} (${coin.symbol.toUpperCase()})`)
                .setColor('#f7931a') // Bitcoin gold color
                .addFields([
                    {
                        name: 'Current Price',
                        value: formatCurrency(priceData.price),
                        inline: true
                    }
                ]);
            
            // Add more details if available
            if (coinDetails) {
                // Add image if available
                if (coinDetails.image?.small) {
                    embed.setThumbnail(coinDetails.image.small);
                }
                
                // Market cap
                if (coinDetails.market_data?.market_cap?.usd) {
                    embed.addFields({
                        name: 'Market Cap',
                        value: formatCurrency(coinDetails.market_data.market_cap.usd),
                        inline: true
                    });
                }
                
                // 24h price change
                if (coinDetails.market_data?.price_change_percentage_24h !== undefined) {
                    const change24h = coinDetails.market_data.price_change_percentage_24h;
                    const changeText = `${change24h >= 0 ? '📈' : '📉'} ${change24h.toFixed(2)}%`;
                    embed.addFields({
                        name: '24h Change',
                        value: changeText,
                        inline: true
                    });
                }
                
                // All time high
                if (coinDetails.market_data?.ath?.usd) {
                    embed.addFields({
                        name: 'All Time High',
                        value: formatCurrency(coinDetails.market_data.ath.usd),
                        inline: true
                    });
                }
                
                // Description
                if (coinDetails.description?.en) {
                    // Trim description to avoid huge embeds
                    const description = coinDetails.description.en
                        .replace(/<[^>]*>/g, '') // Remove HTML tags
                        .split('. ')[0] + '.'; // Take first sentence
                    
                    embed.setDescription(description);
                }
            }
            
            // Add a link to CoinGecko page
            embed.addFields({
                name: 'More Info',
                value: `[View on CoinGecko](https://www.coingecko.com/en/coins/${coin.id})`,
                inline: false
            });
            
            embed.setFooter({ 
                text: 'Data provided by CoinGecko API',
                iconURL: 'https://static.coingecko.com/s/thumbnail-007177f3eca19695592f0b8b0eabbdae282b54154e1be912285c9034ea6cbaf2.png'
            });
            
            embed.setTimestamp();
            
            console.log(`[DEBUG] Sending price response for ${coin.name} (${coin.symbol.toUpperCase()})`);
            await interaction.editReply({ embeds: [embed] });
            console.log(`[${new Date().toISOString()}] Crypto price command completed successfully for ${coin.name}`);
            
        } catch (error) {
            console.error('[ERROR] Error in crypto_price command:', error);
            await interaction.editReply('An error occurred while fetching cryptocurrency price data. Please try again later.');
        }
    }
};