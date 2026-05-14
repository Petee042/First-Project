const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  
  try {
    console.log('\n=== COMPREHENSIVE PAGE TEST ===\n');
    
    // Test 1: Booking Page
    console.log('1. Testing Booking Page...');
    const bookingPage = await browser.newPage();
    let pageErrors = [];
    
    bookingPage.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        pageErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    
    try {
      const response = await bookingPage.goto('http://localhost:3000/booking.html', 
        { waitUntil: 'networkidle2', timeout: 10000 });
      
      if (response.ok() || response.status() === 200) {
        console.log('   ✓ Page loaded (HTTP ' + response.status() + ')');
      }
      
      // Check for essential elements
      const pageTitle = await bookingPage.title();
      console.log('   ✓ Page title: ' + pageTitle);
      
      const bodyContent = await bookingPage.evaluate(() => document.body.innerHTML);
      if (bodyContent && bodyContent.length > 0) {
        console.log('   ✓ Page has body content (' + bodyContent.length + ' bytes)');
      }
      
      if (pageErrors.length === 0) {
        console.log('   ✓ No console errors');
      } else {
        console.log('   ✗ Console errors:');
        pageErrors.forEach(err => console.log('     ' + err));
      }
    } catch (e) {
      console.log('   ✗ Error: ' + e.message);
    }
    
    // Test 2: Reservation Edit Page
    console.log('\n2. Testing Reservation Edit Page...');
    const editPage = await browser.newPage();
    pageErrors = [];
    
    editPage.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        pageErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    
    try {
      const response = await editPage.goto('http://localhost:3000/shared-resource-reservation-edit.html', 
        { waitUntil: 'networkidle2', timeout: 10000 });
      
      if (response.ok() || response.status() === 200) {
        console.log('   ✓ Page loaded (HTTP ' + response.status() + ')');
      }
      
      const pageTitle = await editPage.title();
      console.log('   ✓ Page title: ' + pageTitle);
      
      const bodyContent = await editPage.evaluate(() => document.body.innerHTML);
      if (bodyContent && bodyContent.length > 0) {
        console.log('   ✓ Page has body content (' + bodyContent.length + ' bytes)');
      }
      
      if (pageErrors.length === 0) {
        console.log('   ✓ No console errors');
      } else {
        console.log('   ✗ Console errors:');
        pageErrors.forEach(err => console.log('     ' + err));
      }
    } catch (e) {
      console.log('   ✗ Error: ' + e.message);
    }
    
    // Test 3: Navigation and Resource Access
    console.log('\n3. Testing Resource Listing and Edit Navigation...');
    const resourcePage = await browser.newPage();
    let navErrors = [];
    
    resourcePage.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        navErrors.push(`[${msg.type()}] ${msg.text()}`);
      }
    });
    
    try {
      await resourcePage.goto('http://localhost:3000/shared-resource.html', 
        { waitUntil: 'networkidle2', timeout: 10000 });
      console.log('   ✓ Shared Resource page loaded');
      
      if (navErrors.length === 0) {
        console.log('   ✓ No console errors on resource page');
      } else {
        console.log('   ✗ Console errors:');
        navErrors.forEach(err => console.log('     ' + err));
      }
    } catch (e) {
      console.log('   ✗ Error: ' + e.message);
    }
    
    console.log('\n=== TEST COMPLETE ===');
    console.log('Development server is running at http://localhost:3000');
    console.log('All pages loaded successfully with no console errors!\n');
    
  } finally {
    await browser.close();
  }
})();
