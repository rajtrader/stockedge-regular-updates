import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin());
import dotenv from 'dotenv'
import axios from 'axios'
import { getStocksFromCSV } from './stocklist.js';
const stocks = await getStocksFromCSV();

dotenv.config();
const wpApiUrl='https://profitbooking.in/wp-json/scraper/v1/stock-delivery';

const scrape = async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    timeout: 0,
    args: [
       '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled', // Important
    '--window-size=1920,1080'
    ],ignoreHTTPSErrors: true,
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

  await page.goto('https://web.stockedge.com/share/manaksia-steels/15443?section=deliveries&time-period=Daily&exchange-name=Both', {
    waitUntil: 'networkidle2',
    timeout: 180000
  });

  // Wait for the page to be fully loaded
  await delay(5000);

  for (const stock of stocks) {
    let dailyData = [];
    try {
      console.log(`Searching for stock: ${stock}`);
      
      // Wait for the page to be completely loaded
      await delay(3000);
      
      // Click on the search bar
      await page.waitForSelector('input.searchbar-input', { timeout: 60000 });
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
      await page.waitForSelector('ion-item[button]', { timeout: 60000 });
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
      await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
      await delay(8000);
      
      // Get the current URL
      const currentUrl = page.url();
      console.log(`Navigated to: ${currentUrl}`);
      
      // Check if we're on the deliveries page, if not, add the section parameter
      if (!currentUrl.includes('section=deliveries')) {
        const deliveryUrl = `${currentUrl.split('?')[0]}?section=deliveries&exchange-name=Both&time-period=Daily`;
        console.log(`Adding deliveries section: ${deliveryUrl}`);
        await page.goto(deliveryUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        await delay(5000);
      }

      // Wait longer to ensure the delivery chart is loaded
      try {
        await page.waitForSelector('g.deld3bar > rect', { timeout: 60000 });
      } catch (e) {
        console.log("Could not find delivery bars, trying to continue anyway");
      }

      dailyData = await page.evaluate(async () => {
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const bars = Array.from(document.querySelectorAll('g.deld3bar > rect'));
        const extractedData = [];
        
        // Set to track unique dates we've already processed
        const processedDates = new Set();
        
        for (let i = 0; i < 1; i++) {
          try {
            bars[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            console.log(`Clicked bar ${i+1}`);
            
            await wait(1000); 
            
            const tooltipTexts = Array.from(document.querySelectorAll('g[transform^="translate(-35,0)"] text'))
              .map(el => el.textContent.trim());

            const tooltipHTMLs = Array.from(document.querySelectorAll('g[transform^="translate(-35,0)"] text'))
              .map(el => el.innerHTML.trim());
            
            console.log(tooltipHTMLs);
            
            if (tooltipTexts && tooltipTexts.length > 0) {
              const date = tooltipTexts.find(text => text.includes('202'));
              const deliveredQty = tooltipTexts.find(text => text.includes('Delivered Qty'));
              const tradedQty = tooltipTexts.find(text => text.includes('Traded Qty'));
              const vwap = tooltipTexts.find(text => text.includes('VWAP'));
              
              if (date && !processedDates.has(date)) {
                extractedData.push({
                  date,
                  deliveredQty,
                  tradedQty,
                  vwap
                });
                processedDates.add(date);
              }
            }
            
            document.body.click(); // Click away anywhere
            await wait(2000);
          } catch (error) {
            console.error(`Error processing bar ${i+1}:`, error);
          }
        }
        
        return extractedData;
      });

      console.log(`Daily data for ${stock}:`, dailyData);
      
      
      if (!dailyData || dailyData.length === 0) {
        console.log(`No daily data items for "${stock}", skipping...`);
        continue;
      }
      
  
      for (const dayData of dailyData) {
        const wpData = { 
          stock: stock,
          date: dayData.date,
          deliveredQty: dayData.deliveredQty,
          tradedQty: dayData.tradedQty,
          vwap: dayData.vwap  
        };
        
        const stored = await storeInWordPress(wpData);
        if (stored) {
          console.log(`Successfully stored "${stock}" data for ${dayData.date} in WordPress.`);
        } else if(stored?.duplicate) {
          console.log(`Skipped duplicate: "${stock}" data for ${dayData.date}`);
        } else {
          console.log(`Failed to store "${stock}" data for ${dayData.date} in WordPress.`);
        }
        
        await delay(1000); // Short delay between storing each day's data
      }
      
      await delay(2000); // Wait before next search
      
    } catch (error) {
      console.log(`Failed to extract data for ${stock}:`, error.message);
    }
  }

  await browser.close();
};

async function storeInWordPress(data) {
  try {
    const response = await axios.post(wpApiUrl, {
      stock: data.stock,
      date: data.date,
      deliveredQty: data.deliveredQty,
      tradedQty: data.tradedQty,
      vwap: data.vwap
    });

    console.log('Stored in WordPress:', response.data);
    return true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    
    // Check if this is a duplicate entry error
    if (error.response?.data?.message?.includes('already exists')) {
      return { duplicate: true };
    }
    
    return false;
  }
}
scrape();


export default scrape;