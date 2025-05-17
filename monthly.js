import puppeteer from 'puppeteer';
import dotenv from 'dotenv'
import axios from 'axios'
import { getStockandNameFromCSV } from './Stockparse.js';

const stocks = await getStockandNameFromCSV();

dotenv.config();
const wpApiUrl=process.env.WP_API_MONTHLY;

const scrapeMonthly = async () => {
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

  await page.goto('https://web.stockedge.com/share/sbi-life-insurance-company/86648?section=deliveries&exchange-name=Both&time-period=Monthly', {
    waitUntil: 'networkidle2',
    timeout: 180000
  });

  await delay(5000);

  for (const { stockName, stock } of stocks)  {
    let monthlyData = [];
    try {
      console.log(`Searching for stock: ${stock}`);
      
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
      
      // Check if we're on the deliveries page, if not, add the section parameter
      if (!currentUrl.includes('section=deliveries')) {
        const deliveryUrl = `${currentUrl.split('?')[0]}?section=deliveries&exchange-name=Both&time-period=Monthly`;
        console.log(`Adding deliveries section: ${deliveryUrl}`);
        await page.goto(deliveryUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await delay(4000);
      }

      try {
        await page.waitForSelector('g.deld3bar > rect', { timeout: 20000 });
      } catch (e) {
        console.log("Could not find delivery bars, trying to continue anyway");
      }

      monthlyData = await page.evaluate(async () => {
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        const bars = Array.from(document.querySelectorAll('g.deld3bar > rect'));
        const extractedData = [];
        
        // Create a Set to track unique months we've already processed
        const processedMonths = new Set();
        
        for (let i = 0; i < 1; i++) {
          try {
            bars[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            console.log(`Clicked bar ${i+1}`);
            
            await wait(1000); // Longer delay for tooltip to appear
            
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
              
              // Only add if we haven't processed this month yet (avoid duplicates)
              if (date && !processedMonths.has(date)) {
                extractedData.push({
                  date,
                  deliveredQty,
                  tradedQty,
                  vwap
                });
                processedMonths.add(date);
              }
            }
            
            document.body.click(); 
            await wait(2000);
          } catch (error) {
            console.error(`Error processing bar ${i+1}:`, error);
          }
        }
        
        return extractedData;
      });

      console.log(`Monthly data for ${stock}:`, monthlyData);
      
      // Store each monthly data entry
      if (!monthlyData || monthlyData.length === 0) {
        console.log(`No monthly data items for "${stock}", skipping...`);
        continue;
      }
      
      
      for (const monthData of monthlyData) {
        const wpData = { 
          stock: stock,
          stockName:stockName,
          date: monthData.date,  
          deliveredQty: monthData.deliveredQty,
          tradedQty: monthData.tradedQty,
          vwap: monthData.vwap  
        };
        
        try {
          const stored = await storeInWordPress(wpData);
          if (stored?.updated) {
            console.log(`Updated "${stock}" data for ${monthData.date} in WordPress.`);
          } else if (stored) {
            console.log(`Successfully stored "${stock}" data for ${monthData.date} in WordPress.`);
          } else {
            console.log(`Failed to store "${stock}" data for ${monthData.date} in WordPress.`);
          }
        } catch (error) {
          console.error(`API error for "${stock}" data on ${monthData.date}: ${error.message}`);
        }
        
        await delay(2000); // Longer delay between storing each month's data to give WordPress time to process
      }
      
      await delay(3000); // Wait before next search
      
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
      stockName:data.stockName,
      date: data.date,
      deliveredQty: data.deliveredQty,
      tradedQty: data.tradedQty,
      vwap: data.vwap
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 15000 // Increase timeout to 15 seconds
    });

    return response.data;
  } catch (error) {
    console.error('WP API Error:', error.response?.data?.message || error.message);
    
    // Return detailed error information
    return {
      error: true,
      message: error.response?.data?.message || error.message
    };
  }
}
scrapeMonthly();
