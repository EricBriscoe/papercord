// filepath: /home/eric/dev/paper-cord/test/test-coingecko.ts
import { coinGeckoService } from '../src/services/coinGeckoService';

async function testCoinGeckoService() {
    console.log('Testing CoinGecko Service...');
    
    console.log('\n1. Testing getCoinsList()');
    const coinsList = await coinGeckoService.getCoinsList();
    console.log(`Retrieved ${coinsList.length} coins`);
    console.log('First 5 coins:', coinsList.slice(0, 5));
    
    if (coinsList.length > 0) {
        const testCoin = coinsList[0];
        
        console.log(`\n2. Testing getCoinPrice() with ${testCoin.id}`);
        const priceData = await coinGeckoService.getCoinPrice(testCoin.id);
        console.log('Price data:', priceData);
        
        console.log(`\n3. Testing getTopCoins()`);
        const topCoins = await coinGeckoService.getTopCoins(5);
        console.log('Top 5 coins by market cap:', topCoins);
        
        if (topCoins.length > 0) {
            const popularCoin = topCoins[0];
            
            console.log(`\n4. Testing getHistoricalPrices() with ${popularCoin.id}`);
            const historicalData = await coinGeckoService.getHistoricalPrices(popularCoin.id, 7);
            console.log(`Retrieved ${historicalData.prices?.length || 0} historical price points`);
            if (historicalData.prices?.length > 0) {
                console.log('First price point:', historicalData.prices[0]);
                console.log('Last price point:', historicalData.prices[historicalData.prices.length - 1]);
            }
            
            console.log(`\n5. Testing searchCoins() with ${popularCoin.name.substring(0, 3)}`);
            const searchResults = await coinGeckoService.searchCoins(popularCoin.name.substring(0, 3));
            console.log(`Found ${searchResults.length} coins with search term`);
            console.log('First 3 search results:', searchResults.slice(0, 3));
        }
    }
    
    console.log('\nCoinGecko Service test completed!');
}

testCoinGeckoService().catch(console.error);