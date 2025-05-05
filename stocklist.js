import fs from 'fs'
import csv from 'csv-parser';



function getStocksFromCSV() {
  return new Promise((resolve, reject) => {
    const stocks = [];
    
    console.log('Starting to read stocks.csv file...');
    
    fs.createReadStream('stocks.csv')
      .pipe(csv())
      .on('data', (row) => {
        console.log('Processing row:', row);
        
        
        if (row.Symbol) {
          console.log('Found Symbol column:', row.Symbol);
          stocks.push(row.Symbol);
        } else if (Object.values(row)[1]) {
       
          console.log('Using second column value:', Object.values(row)[1]);
          stocks.push(Object.values(row)[1]);
        }
      })
      .on('end', () => {
        console.log('Finished reading CSV file');
        console.log('Total stocks found:', stocks.length);
        console.log('Stocks list:', stocks);
        resolve(stocks);
      })
      .on('error', (error) => {
        console.error('Error reading CSV:', error);
        reject(error);
      });
  });
}

export { getStocksFromCSV };