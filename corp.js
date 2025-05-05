import puppeteer from 'puppeteer';
import { getStocksFromCSV } from './stocklist.js';
import dotenv from 'dotenv';
import axios from 'axios';
const stocks = await getStocksFromCSV();
//const stocks=['20Microns','360ONE']

dotenv.config();
const wpApiUrl = process.env.WP_API_CORP;

async function scrapeDividendInfo() {
  const browser = await puppeteer.launch({
    headless: true, // Changed to headless mode for production
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

  // Get today's date in the format DD-MMM-YYYY
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const year = today.getFullYear();
  
  // Month abbreviations as they appear in the format DD-MMM-YYYY
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[today.getMonth()];
  
  // The exact format: DD-MMM-YYYY (07-Mar-2025)
  const todayFormatted = `${day}-${month}-${year}`;
  
  console.log(`Looking for corporate actions from today: ${todayFormatted}`);

  await page.goto('https://web.stockedge.com/share/dr-lal-pathlabs/15890?section=corp-actions', {
    waitUntil: 'networkidle2',
    timeout: 180000
  });

  // Wait for the page to be fully loaded
  await delay(5000);

  const allResults = [];

  for (const stock of stocks) {
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
      
      // Type the stock name 
      for (const char of stock) {
        await page.type('input.searchbar-input', char, { delay: 100 });
      }
      
      // Waiting longer for search results to appear and stabilize
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
      
      // Check if we're on the corp-actions page, if not, add the section parameter
      if (!currentUrl.includes('section=corp-actions')) {
        const corpActionsUrl = `${currentUrl.split('?')[0]}?section=corp-actions`;
        console.log(`Navigating to corporate actions: ${corpActionsUrl}`);
        await page.goto(corpActionsUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await delay(5000);
      }

      // Wait for dividend data to load
      try {
        await page.waitForSelector('ion-item[se-item]', { timeout: 20000 });
      } catch (e) {
        console.log("Could not find dividend information, trying to continue anyway");
      }

      // Extract dividend information - only for today
      const dividendData = await page.evaluate((todaysDate) => {
        const items = Array.from(document.querySelectorAll('ion-item[se-item]'));
        const todayResults = [];
        
        // Function to check if a date string contains today's date
        const isToday = (dateStr) => {
          if (!dateStr) return false;
          return dateStr.includes(todaysDate);
        };
        
        for (const item of items) {
          const rows = item.querySelectorAll('ion-grid ion-row');
          const dividendInfo = {};
          let isTodayItem = false;
          
          rows.forEach(row => {
            const text = row.textContent.trim();
            
            if (text.includes('Ex-Date')) {
              const dateElement = row.querySelector('se-date-label ion-text');
              const dateText = dateElement ? dateElement.textContent.trim() : null;
              dividendInfo.exDate = dateText;
              
              // Check if this is a today item
              if (isToday(dateText)) {
                isTodayItem = true;
              }
            } else if (text.includes('Record-Date')) {
              const dateElement = row.querySelector('se-date-label ion-text');
              dividendInfo.recordDate = dateElement ? dateElement.textContent.trim() : null;
            } else if (text.includes('Dividend')) {
              dividendInfo.dividendDetails = text.trim();
            }
          });
          
          // Only add this item if it's from today
          if (isTodayItem) {
            todayResults.push(dividendInfo);
          }
        }
        
        return todayResults;
      }, todayFormatted);

      // Clean and parse dividend data
      const parsedDividendData = dividendData.map(item => {
        const text = item.dividendDetails || '';
        
        const datePattern = /(\d{2}\s+[A-Za-z]{3}\s+\d{4})/g;
        const dates = text.match(datePattern) || [];
        
        const dividendPattern = /((?:Interim |Final )?Dividend \d+% @ Rs\. \d+(\.\d+)? per share)/;
        const dividendMatch = text.match(dividendPattern);
        
        return {
          exDate: item.exDate || dates[0] || null,
          recordDate: item.recordDate || dates[1] || null,
          dividendDetails: dividendMatch ? dividendMatch[1] : item.dividendDetails || null
        };
      });
      
      console.log(`Today's dividend results for ${stock}:`, parsedDividendData);
      
      // Store all dividend entries for this stock immediately
      if (parsedDividendData && parsedDividendData.length > 0) {
        console.log(`Storing ${parsedDividendData.length} dividend entries from today for "${stock}"`);
        
        // Store each dividend entry separately
        for (const dividendEntry of parsedDividendData) {
          
          if (!dividendEntry.exDate || !dividendEntry.dividendDetails) {
            console.log(`Skipping incomplete dividend entry for "${stock}":`, dividendEntry);
            continue;
          }
          
          const wpData = { 
            stock: stock,
            exDate: dividendEntry.exDate, 
            recordDate: dividendEntry.recordDate,
            dividendDetails: dividendEntry.dividendDetails,
          };
          
          const stored = await storeInWordPress(wpData);
          if (stored) {
            console.log(`Successfully stored today's dividend entry (${dividendEntry.exDate}) for "${stock}" in WordPress.`);
          } else if(stored?.duplicate) {
            console.log(`Skipped duplicate dividend entry (${dividendEntry.exDate}) for "${stock}"`);
          } else {
            console.log(`Failed to store dividend entry (${dividendEntry.exDate}) for "${stock}" in WordPress.`);
          }
          
          await delay(500);
        }
      } else {
        console.log(`No dividend data from today found for "${stock}", skipping database storage.`);
      }
      
      allResults.push({ stock, dividendData: parsedDividendData });
      await delay(2000); // wait before next search
      
    } catch (error) {
      console.log(`Failed to extract data for ${stock}:`, error.message);
      // Continue with the next stock even if this one fails
    }
  }

  console.log("All today's dividend results:", JSON.stringify(allResults, null, 2));
  console.log("Waiting 10 seconds before closing the browser...");
  await delay(10000);
  await browser.close();
  return allResults;
}

async function storeInWordPress(data) {
  try {
    const response = await axios.post(wpApiUrl, {
      stock: data.stock,
      exDate: data.exDate,
      recordDate: data.recordDate,
      dividendDetails: data.dividendDetails
    });

    console.log('Stored in WordPress:', response.data);
    return response.data?.duplicate ? { duplicate: true } : true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    return false;
  }
}

scrapeDividendInfo();

export { scrapeDividendInfo };