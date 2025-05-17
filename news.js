import puppeteer from 'puppeteer';
import { getStockandNameFromCSV } from './Stockparse.js';
import dotenv from 'dotenv'
import axios from 'axios'
//const stocks=['20MICRONS']
const stocks = await getStockandNameFromCSV();
dotenv.config();
const wpApiUrl = process.env.WP_API_NEWS;

async function scrapeStockNews() {
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
    console.log('Navigating to initial page...');
    await page.goto('https://web.stockedge.com/share/manaksia-steels/15443?section=deliveries&time-period=Daily&exchange-name=Both', {
      waitUntil: 'networkidle2',
      timeout: 180000
    });

    // Wait for the page to be fully loaded
    await delay(5000);

    const allResults = [];
    
    // Get today's date in the format used by the website (DD-MMM-YYYY)
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[today.getMonth()];
    const year = today.getFullYear();
    const todayFormatted = `${day}-${month}-${year}`;
    
    console.log(`Looking for news from today: ${todayFormatted}`);

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
        await delay(1000);
        await page.waitForSelector('ion-item[button]', { timeout: 30000 });
        
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
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 50000 });
        await delay(5000);
        
        // Get the current URL
        const currentUrl = page.url();
        console.log(`Navigated to: ${currentUrl}`);
        
        if (!currentUrl.includes('section=news')) {
          const newsUrl = `${currentUrl.split('?')[0]}?section=news`;
          console.log(`Navigating to news section: ${newsUrl}`);
          await page.goto(newsUrl, { waitUntil: 'networkidle2', timeout: 50000 });
          await delay(5000);
        }

        console.log('Extracting today\'s news data...');
        const newsItems = await page.evaluate((todayDate) => {
          const dateElements = document.querySelectorAll('ion-text.sc-ion-label-md.ion-color.ion-color-se-grey-medium.md');
          const contentElements = document.querySelectorAll('ion-label.ion-text-wrap.ion-no-margin.low-padding-top.low-padding-bottom.low-margin-left.ripple-relative.cursorPointerNone.sc-ion-label-md-h.sc-ion-label-md-s.md.in-item-color');
          
          const results = [];
          const seen = new Set();
          
          for (let i = 0; i < dateElements.length; i++) {
            const dateText = dateElements[i]?.innerText?.trim();
            const content = contentElements[i]?.innerText?.trim();
            
            if (dateText && content) {
              // Check if the news is from today
              if (dateText.includes(todayDate)) {
                const key = dateText + '|' + content; 
                if (!seen.has(key)) {
                  seen.add(key);
                  results.push({ date: dateText, content });
                }
              } else {
                // Once we find a date that's not today, we can break since news are in chronological order
                break;
              }
            }
          }
          
          return results;
        }, todayFormatted);

        console.log(`Scraped ${newsItems.length} news items from today for ${stock}`);
        
        // Store news items immediately after scraping for this stock
        if (newsItems && newsItems.length > 0) {
          console.log(`Storing ${newsItems.length} news items for "${stock}"`);
          
          // Store each news item separately
          for (const newsItem of newsItems) {
            // Skip entries with missing critical data
            if (!newsItem.date || !newsItem.content) {
              console.log(`Skipping incomplete news item for "${stock}":`, newsItem);
              continue;
            }
            
            const wpData = { 
              stock: stock,
              stockName:stockName,
              date: newsItem.date,
              content: newsItem.content
            };
            
            const stored = await storeInWordPress(wpData);
            if (stored) {
              console.log(`Successfully stored news from ${newsItem.date} for "${stock}" in WordPress.`);
            } else if(stored?.duplicate) {
              console.log(`Skipped duplicate news from ${newsItem.date} for "${stock}"`);
            } else {
              console.log(`Failed to store news from ${newsItem.date} for "${stock}" in WordPress.`);
            }
            
            await delay(500);
          }
        } else {
          console.log(`No today's news items found for "${stock}", skipping database storage.`);
        }
        
        allResults.push({ stock,stockName, newsItems });
        await delay(2000); // wait before next search
        
      } catch (error) { 
        console.log(`Failed to extract news data for ${stock}:`, error.message);
        // Continue with the next stock even if this one fails
      }
    }

    console.log("Today's news data collected");
    console.log(JSON.stringify(allResults, null, 2));
    
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
    const response = await axios.post(wpApiUrl, {
      stock: data.stock,
      stockName:data.stockName,
      date: data.date,
      content: data.content
    });

    console.log('Stored in WordPress:', response.data);
    return true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    return false;
  }
}

async function news() {
  try {
    const scrapedData = await scrapeStockNews();
    console.log('Scraping completed successfully.');
  } catch (error) {
    console.error('Scraping failed:', error);
  }
}

news();