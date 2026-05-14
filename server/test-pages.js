const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  
  try {
    // Test Booking Page
    console.log('\n=== TESTING BOOKING PAGE ===');
    const bookingPage = await browser.newPage();
    
    let bookingErrors = [];
    bookingPage.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        bookingErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    
    bookingPage.on('error', err => {
      bookingErrors.push(`[PAGE ERROR] ${err.message}`);
    });
    
    try {
      await bookingPage.goto('http://localhost:3000/booking.html', { waitUntil: 'networkidle2', timeout: 10000 });
      console.log('Booking page loaded successfully');
      
      if (bookingErrors.length > 0) {
        console.log('Console errors found:');
        bookingErrors.forEach(err => console.log(`  ${err}`));
      } else {
        console.log('No console errors on booking page');
      }
    } catch (e) {
      console.log(`Error loading booking page: ${e.message}`);
    }
    
    // Test Reservation Edit Page
    console.log('\n=== TESTING RESERVATION EDIT PAGE ===');
    const editPage = await browser.newPage();
    
    let editErrors = [];
    editPage.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        editErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    
    editPage.on('error', err => {
      editErrors.push(`[PAGE ERROR] ${err.message}`);
    });
    
    try {
      await editPage.goto('http://localhost:3000/shared-resource-reservation-edit.html', { waitUntil: 'networkidle2', timeout: 10000 });
      console.log('Reservation edit page loaded successfully');
      
      if (editErrors.length > 0) {
        console.log('Console errors found:');
        editErrors.forEach(err => console.log(`  ${err}`));
      } else {
        console.log('No console errors on reservation edit page');
      }
    } catch (e) {
      console.log(`Error loading reservation edit page: ${e.message}`);
    }
    
    console.log('\n=== SUMMARY ===');
    console.log(`Booking page errors: ${bookingErrors.length}`);
    console.log(`Reservation edit page errors: ${editErrors.length}`);
    
  } finally {
    await browser.close();
  }
})();
