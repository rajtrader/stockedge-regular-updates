import puppeteer from 'puppeteer';
import { getStockandNameFromCSV } from './Stockparse.js';
const stocks = await getStockandNameFromCSV();


//const stocks=['20Microns','360ONE']
import dotenv from 'dotenv'
import axios from 'axios'

dotenv.config();
const wpApiUrl = process.env.WP_API_FEED;

async function scrapeStockFeeds() {
  console.log('Starting browser...');
  const browser = await puppeteer.launch({
    headless: true, 
    defaultViewport: null,
    timeout: 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process'
    ]
  });
  
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const page = await browser.newPage();
  
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  );
  
  await page.setExtraHTTPHeaders({
    'accept-language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  });

  try {
    // Get today's date
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const year = today.getFullYear();
    
    // Month abbreviations as they appear in the format DD-MMM-YYYY
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[today.getMonth()];
    
    // The exact format as specified: DD-MMM-YYYY (07-Mar-2025)
    const todayFormatted = `${day}-${month}-${year}`;
    
    console.log(`Today's date in : ${todayFormatted}`);
    
    // We'll primarily look for the exact format, but include some fallbacks
    const formattedDateOptions = [
      todayFormatted,
      `Today`,
      `Just now`,
      // Include the format without the year as fallback
      `${day}-${month}`
    ];
    
    console.log(`Looking for feed items from today (${formattedDateOptions.join(' or ')})`);
    
    // Navigate to the initial page first
    console.log('Navigating to initial page...');
    await page.goto('https://web.stockedge.com/share/dr-lal-pathlabs/15890?section=feeds', {
      waitUntil: 'networkidle2',
      timeout: 180000
    });

    // Wait for the page to be fully loaded
    await delay(5000);
   
    const allResults = [];
   
    for (const { stockName, stock } of stocks) {
      try {
        console.log(`🔍 Searching for stock: ${stock}`);
        
        // Wait for the page to be completely loaded
        await delay(3000);
        
        // Click on the search bar
        await page.waitForSelector('input.searchbar-input', { timeout: 30000 });
        await page.click('input.searchbar-input');
        await delay(1000);
        
        // Clear any existing search text
        await page.evaluate(() => {
          document.querySelector('input.searchbar-input').value = '';
        });
        await delay(1000);
        
        // Type the stock name slowly with delay between keys
        for (const char of stock) {
          await page.type('input.searchbar-input', char, { delay: 100 });
        }
        
        // Wait longer for search results to appear and stabilize
        await delay(3000);
        await page.waitForSelector('ion-item[button]', { timeout: 30000 });
        await delay(2000);
        
        // Click on the first stock result
        const clickedResult = await page.evaluate(() => {
          const stockItems = Array.from(document.querySelectorAll('ion-item[button]'));
          for (const item of stockItems) {
            const labelText = item.querySelector('ion-label').textContent;
            const chipText = item.querySelector('ion-chip ion-label')?.textContent || '';
            
            if (chipText.includes('Stock')) {
              console.log(`Found stock result: ${labelText}`);
              item.click();
              return labelText;
            }
          }
          return null;
        });
        
        if (!clickedResult) {
          console.log(`No matching stock found for: ${stock}`);
          continue;
        }
        
        console.log(`Clicked on stock: ${clickedResult}`);

        // Wait for navigation to complete - longer timeout
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        await delay(8000);
        
        // Get the current URL
        const currentUrl = page.url();
        console.log(`Navigated to: ${currentUrl}`);
        
        if (!currentUrl.includes('section=feeds')) {
          const feedsUrl = `${currentUrl.split('?')[0]}?section=feeds`;
          console.log(`Navigating to feeds section: ${feedsUrl}`);
          await page.goto(feedsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
          await delay(5000);
        }

        // Wait for feed items to load
        console.log('Waiting for feed items to load...');
        try {
          await page.waitForSelector('ion-item.item', { timeout: 20000 });
        } catch (e) {
          console.log("Could not find feed items, trying to continue anyway");
        }

        console.log('Extracting today\'s feed data...');
        const feedItems = await page.evaluate((dateOptions) => {
          const results = [];
          const seen = new Set(); // To avoid duplicates
          
          const listItems = document.querySelectorAll('ion-item.item');
          
          // Helper function to check if a date string is from today
          const isToday = (dateStr) => {
            if (!dateStr) return false;
            dateStr = dateStr.trim();
            
            // Check if date matches any of our today's date formats
            return dateOptions.some(format => {
              return dateStr.includes(format) || 
                    (format === 'Today' && dateStr.includes('Today'));
            });
          };
          
          let foundOlderPost = false;
          
          for (const item of listItems) {
            const sourceElement = item.querySelector('ion-text');
            const source = sourceElement ? sourceElement.textContent.trim() : null;
            
            const contentElement = item.querySelector('p');
            const content = contentElement ? contentElement.textContent.trim() : null;
            
            const dateElement = item.querySelector('ion-col.ion-text-end ion-text');
            const date = dateElement ? dateElement.textContent.trim() : null;
            
            // Once we find a post from an older date, we can stop processing
            // since they're in chronological order
            if (date && !isToday(date) && !date.includes('min') && !date.includes('hour')) {
              console.log(`Found older post with date "${date}", stopping search`);
              foundOlderPost = true;
              break;
            }
            
            if (date && content) {
              const key = `${date}-${source}-${content}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push({
                  date,
                  source,
                  content
                });
              }
            }
          }
          
          return results;
        }, formattedDateOptions);

        console.log(`Scraped ${feedItems.length} feed items from today for ${stock}`);
        
        if (feedItems && feedItems.length > 0) {
          console.log(`\n===== TODAY'S FEED ITEMS FOR ${stock} =====`);
          feedItems.forEach((item, index) => {
            console.log(`\nItem #${index + 1}:`);
            console.log(`Date: ${item.date}`);
            console.log(`Source: ${item.source}`);
            console.log(`Content: ${item.content}`);
            console.log('-----------------------------------');
          });
          console.log('\n');
          
          console.log(`Storing today's feed data for ${stock} in WordPress...`);
          
          // Store each feed item in WordPress
          for (const [index, item] of feedItems.entries()) {
            const wpData = { 
              stock: stock,
              stockName:stockName,
              date: item.date, 
              source: item.source,
              content: item.content,
            };
            
            console.log(`\nStoring item #${index + 1} for ${stock}:`);
            console.log(JSON.stringify(wpData, null, 2));
            
            const stored = await storeInWordPress(wpData);
            if (stored) {
              console.log(`Successfully stored "${stock}" feed item from ${item.date} in WordPress.`);
            } else if (stored?.duplicate) {
              console.log(`Skipped duplicate: "${stock}" feed item from ${item.date}`);
            } else {
              console.log(`Failed to store "${stock}" feed item from ${item.date} in WordPress.`);
            }
            
            await delay(500);
          }
        } else {
          console.log(`No today's feed items found for ${stock}, nothing to store.`);
        }
        
        allResults.push({ stock,stockName, feedItems });
        await delay(2000); // wait before next search
        
      } catch (error) {
        console.log(`Failed to extract feed data for ${stock}:`, error.message);
        // Continue with the next stock even if this one fails
      }
    }

    console.log("Today's feed data collected and stored");
    return allResults;
  } catch (error) {
    console.error('Error during scraping:', error);
    throw error;
  } finally {
    console.log("Waiting 10 seconds before closing the browser...");
    await delay(10000);
    
    await browser.close();
    console.log('Browser closed.');
  }
}

async function storeInWordPress(data) {
  try {
    console.log('Sending to WordPress API...');
    const response = await axios.post(wpApiUrl, {
      stock: data.stock,
      stockName:data.stockName,
      date: data.date,
      source: data.source,
      content: data.content
    });

    console.log('WordPress API response:', response.data);
    return response.data?.duplicate ? { duplicate: true } : true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    return false;
  }
}

async function feed() {
  try {
    const scrapedData = await scrapeStockFeeds();
    console.log('Scraping complete. All today\'s feed data has been stored in WordPress.');
  } catch (error) {
    console.error('Scraping failed:', error);
  }
}

feed()